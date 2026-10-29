import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { buildSchedule, dueDate } from "./amortization";
import { createEntryTx, isCode, LedgerError, NotFoundError } from "./ledger";

export { dueDate };

type Db = Prisma.TransactionClient;

export type ChargeInput = {
  name: string; amount: number; dueDay: number; accountId: string; categoryId: string; startMonth: Date; endMonth: Date | null;
};

/** La charge s'applique au mois si début ≤ mois ≤ dernier mois (vide = sans fin). */
export const appliesTo = (charge: { startMonth: Date; endMonth: Date | null }, month: Date) =>
  charge.startMonth <= month && (!charge.endMonth || month <= charge.endMonth);

/** Catégorie de dépense du foyer, compte du foyer non archivé ; FOR SHARE : ni l'un ni l'autre ne change avant l'écriture. */
export async function checkRefs(tx: Db, householdId: string, input: ChargeInput) {
  if (input.endMonth && input.endMonth < input.startMonth) throw new LedgerError("Le dernier mois doit être après le mois de début.", "endMonth");
  const [c] = await tx.$queryRaw<{ kind: string }[]>`
    SELECT "kind"::text FROM "Category" WHERE "id" = ${input.categoryId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!c) throw new NotFoundError();
  if (c.kind !== "EXPENSE") throw new LedgerError("Choisissez une catégorie de dépense.", "categoryId");
  const [a] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM "Account" WHERE "id" = ${input.accountId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!a) throw new NotFoundError();
  if (a.archivedAt) throw new LedgerError("Ce compte est archivé : aucune saisie possible.", "accountId");
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
  const c = await prisma.fixedCharge.findFirst({ where: { id, householdId }, include: { loan: { select: { id: true } } } });
  if (!c) throw new NotFoundError();
  return c;
}

const LOAN_INCLUDE = { include: { prepayments: { include: { transaction: true }, orderBy: { createdAt: "asc" } } } } as const;

type LoanWithPrepayments = Prisma.LoanGetPayload<typeof LOAN_INCLUDE>;

/** Ligne d'échéancier d'un mois pour une charge-crédit (undefined : crédit soldé ou hors période). */
export function loanRow(charge: { dueDay: number; startMonth: Date; loan: LoanWithPrepayments }, month: Date) {
  const { loan } = charge;
  const s = buildSchedule(
    { ...loan, dueDay: charge.dueDay, startMonth: charge.startMonth },
    loan.prepayments.map((p) => ({ occurredOn: p.transaction.occurredOn, amount: p.transaction.amount, mode: p.mode })),
  );
  return s.rows.find((r) => r.month.getTime() === month.getTime());
}

/**
 * Charges applicables au mois, triées par échéance, avec leur paiement du mois (et sa dépense) s'il existe.
 * Charge-crédit : montant = échéance du mois (assurance incluse) ; absente si le crédit n'a pas d'échéance ce mois.
 */
export async function listMonthCharges(householdId: string, month: Date) {
  const charges = await prisma.fixedCharge.findMany({
    where: { householdId, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
    include: {
      account: { select: { name: true } },
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
    const amount = row === null ? c.amount : row?.total ?? payment!.transaction.amount;
    return [{ ...c, amount, loanId: loan?.id ?? null, due: dueDate(c, month), payment }];
  });
}

const ALREADY_PAID = "Cette charge est déjà payée pour ce mois.";

/** Marque la charge payée pour le mois : crée la dépense et le paiement dans une seule transaction SQL. */
export async function payCharge(householdId: string, userId: string, id: string, month: Date, amount: number, occurredOn: Date) {
  const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  if (occurredOn < month || occurredOn >= next) throw new LedgerError("La date doit être dans le mois de l’échéance.", "occurredOn");
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await tx.fixedCharge.findFirst({ where: { id, householdId }, include: { loan: LOAN_INCLUDE } });
      if (!charge) throw new NotFoundError();
      if (!appliesTo(charge, month) || (charge.loan && !loanRow({ ...charge, loan: charge.loan }, month))) {
        throw new LedgerError("Cette charge ne s’applique pas à ce mois.");
      }
      if (await tx.fixedChargePayment.count({ where: { fixedChargeId: id, month } })) throw new LedgerError(ALREADY_PAID);
      const t = await createEntryTx(tx, householdId, userId, {
        accountId: charge.accountId, kind: "EXPENSE", amount, occurredOn, note: charge.name, categoryId: charge.categoryId,
      });
      return tx.fixedChargePayment.create({ data: { householdId, fixedChargeId: id, month, transactionId: t.id } });
    });
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError(ALREADY_PAID); // double clic / paiement concurrent
    if (isCode(e, "P2003")) throw new NotFoundError(); // charge supprimée entre-temps
    throw e;
  }
}
