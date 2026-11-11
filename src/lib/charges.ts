import { Prisma } from "@prisma/client";
import { prisma, type Db } from "./db";
import { addMonths, buildSchedule, dueDate } from "./amortization";
import { buildTree, type Item } from "./budget";
import { createEntryTx, isCode, LedgerError, NotFoundError } from "./ledger";

export type ChargeInput = {
  active: boolean; name: string; dueDay: number; categoryId: string; startMonth: Date; endMonth: Date | null; shared: boolean;
};

/** La récurrence s'applique au mois si elle est active et début ≤ mois ≤ dernier mois (vide = sans fin). */
export const appliesTo = (charge: { active: boolean; startMonth: Date; endMonth: Date | null }, month: Date) =>
  charge.active && charge.startMonth <= month && (!charge.endMonth || month <= charge.endMonth);

/** Période cohérente et catégorie de dépense du foyer ; FOR SHARE : la catégorie ne change pas avant l'écriture. */
export async function checkRefs(tx: Db, householdId: string, input: Omit<ChargeInput, "shared">) {
  if (input.endMonth && input.endMonth < input.startMonth) throw new LedgerError("The last month must be after the start month.", "endMonth");
  const [c] = await tx.$queryRaw<{ kind: string }[]>`
    SELECT "kind"::text FROM "Category" WHERE "id" = ${input.categoryId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!c) throw new NotFoundError();
  if (c.kind !== "EXPENSE") throw new LedgerError("Choose an expense category.", "categoryId");
}

export function createCharge(householdId: string, input: ChargeInput) {
  return prisma.$transaction(async (tx) => {
    await checkRefs(tx, householdId, input);
    return tx.fixedCharge.create({ data: { ...input, householdId } });
  });
}

export async function updateCharge(householdId: string, id: string, input: ChargeInput) {
  await prisma.$transaction(async (tx) => {
    await checkRefs(tx, householdId, input);
    // Charge portée par un crédit : modifiable seulement via le crédit.
    const { count } = await tx.fixedCharge.updateMany({ where: { id, householdId, loan: null }, data: input });
    if (!count) throw new NotFoundError();
  });
}

/** Supprime la charge et ses paiements ; les dépenses créées restent (elles deviennent variables). */
export async function deleteCharge(householdId: string, id: string) {
  const { count } = await prisma.fixedCharge.deleteMany({ where: { id, householdId } });
  if (!count) throw new NotFoundError();
}

export async function getCharge(householdId: string, id: string) {
  const c = await prisma.fixedCharge.findFirst({
    where: { id, householdId },
    include: { loan: { select: { id: true } } },
  });
  if (!c) throw new NotFoundError();
  return c;
}

const LOAN_INCLUDE = { include: { prepayments: { include: { transaction: true }, orderBy: { createdAt: "asc" } } } } as const;

type LoanWithPrepayments = Prisma.LoanGetPayload<typeof LOAN_INCLUDE>;

/** Ligne d'échéancier d'un mois pour une charge-crédit (undefined : crédit soldé ou hors période). */
function loanRow(charge: { dueDay: number; startMonth: Date; loan: LoanWithPrepayments }, month: Date) {
  const { loan } = charge;
  const s = buildSchedule(
    { ...loan, dueDay: charge.dueDay, startMonth: charge.startMonth },
    loan.prepayments.map((p) => ({ occurredOn: p.transaction.occurredOn, amount: p.transaction.amount, mode: p.mode })),
  );
  return s.rows.find((r) => r.month.getTime() === month.getTime());
}

/**
 * Montant prévu d'une récurrence : ligne incluse du budget de même catégorie (de même libellé si plusieurs) ; null sans ligne.
 * Une ligne avec sous-lignes vaut leur total.
 */
export function plannedAmount(items: Item[], charge: { categoryId: string; name: string }) {
  const lines = buildTree(items).filter((n) => n.included)
    .flatMap((n) => [n, ...n.children.filter((c) => c.included).map((c) => ({ ...c, total: c.amount }))])
    .filter((l) => l.categoryId === charge.categoryId);
  const name = charge.name.trim().toLowerCase();
  return (lines.find((l) => l.label.trim().toLowerCase() === name) ?? lines[0])?.total ?? null;
}

/**
 * Charges applicables au mois, triées par échéance, avec leur paiement du mois (et sa dépense) s'il existe.
 * Montant : ligne du budget du mois (`budgeted` faux et 0 sans budget ni ligne) ;
 * charge-crédit : échéance du mois (assurance incluse), absente si le crédit n'a pas d'échéance ce mois.
 */
export async function listMonthCharges(householdId: string, month: Date) {
  const budget = await prisma.budget.findUnique({ where: { householdId_month: { householdId, month } }, include: { items: true } });
  const charges = await prisma.fixedCharge.findMany({
    where: { householdId, active: true, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
    include: {
      category: { select: { name: true, parent: { select: { name: true } } } },
      payments: { where: { month }, include: { transaction: true } },
      loan: LOAN_INCLUDE,
    },
    orderBy: [{ dueDay: "asc" }, { name: "asc" }],
  });
  return charges.flatMap(({ payments, loan, ...c }) => {
    const payment = payments[0] ?? null;
    const row = loan ? loanRow({ ...c, loan }, month) : null;
    // Mois déjà payé mais sans échéance (crédit soldé depuis) : la charge payée reste comptée.
    if (row === undefined && !payment) return [];
    const planned = row === null ? plannedAmount(budget?.items ?? [], c) : row?.total ?? payment!.transaction.amount;
    const amount = planned ?? 0, budgeted = planned !== null;
    // Crédit : échéance n sur N (durée initiale) et date de 1ʳᵉ échéance.
    const installment = loan && row ? { n: row.n, of: loan.termMonths, firstDue: dueDate(c, c.startMonth) } : null;
    return [{ ...c, amount, budgeted, loanId: loan?.id ?? null, due: dueDate(c, month), payment, installment }];
  });
}

const ALREADY_PAID = "This charge is already paid for this month.";

/** Marque la charge payée pour le mois (payée par `userId`) : crée la dépense et le paiement dans une seule transaction SQL. */
export async function payCharge(householdId: string, userId: string, id: string, month: Date, amount: number, occurredOn: Date) {
  const next = addMonths(month, 1);
  if (occurredOn < month || occurredOn >= next) throw new LedgerError("The date must be within the due month.", "occurredOn");
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await tx.fixedCharge.findFirst({ where: { id, householdId }, include: { loan: LOAN_INCLUDE } });
      if (!charge) throw new NotFoundError();
      if (!appliesTo(charge, month) || (charge.loan && !loanRow({ ...charge, loan: charge.loan }, month))) {
        throw new LedgerError("This charge does not apply to this month.");
      }
      if (await tx.fixedChargePayment.count({ where: { fixedChargeId: id, month } })) throw new LedgerError(ALREADY_PAID);
      const t = await createEntryTx(tx, householdId, userId, {
        kind: "EXPENSE", amount, occurredOn, note: charge.name, categoryId: charge.categoryId, paidById: userId, shared: charge.shared,
      });
      return tx.fixedChargePayment.create({ data: { householdId, fixedChargeId: id, month, transactionId: t.id } });
    });
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError(ALREADY_PAID); // double clic / paiement concurrent
    if (isCode(e, "P2003")) throw new NotFoundError(); // charge supprimée entre-temps
    throw e;
  }
}
