import { Prisma } from "@prisma/client";
import { assertWritable, readable, type Scope } from "./access";
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

/** Catégorie de dépense du foyer, compte du foyer modifiable et non archivé ; FOR SHARE : ni l'un ni l'autre ne change avant l'écriture. */
export async function checkRefs(tx: Db, scope: Scope, input: ChargeInput) {
  const householdId = scope.householdId;
  if (input.endMonth && input.endMonth < input.startMonth) throw new LedgerError("Le dernier mois doit être après le mois de début.", "endMonth");
  const [c] = await tx.$queryRaw<{ kind: string }[]>`
    SELECT "kind"::text FROM "Category" WHERE "id" = ${input.categoryId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!c) throw new NotFoundError();
  if (c.kind !== "EXPENSE") throw new LedgerError("Choisissez une catégorie de dépense.", "categoryId");
  assertWritable(scope, input.accountId, "accountId");
  const [a] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM "Account" WHERE "id" = ${input.accountId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!a) throw new NotFoundError();
  if (a.archivedAt) throw new LedgerError("Ce compte est archivé : aucune saisie possible.", "accountId");
}

export function createCharge(scope: Scope, input: ChargeInput) {
  return prisma.$transaction(async (tx) => {
    await checkRefs(tx, scope, input);
    return tx.fixedCharge.create({ data: { ...input, householdId: scope.householdId } });
  });
}

/** Charge d'un compte lisible, verrouillée ; son compte actuel doit être modifiable. */
async function lockWritableCharge(tx: Db, scope: Scope, id: string) {
  const [c] = await tx.$queryRaw<{ accountId: string }[]>`
    SELECT "accountId" FROM "FixedCharge" WHERE "id" = ${id} AND "householdId" = ${scope.householdId} FOR UPDATE`;
  if (!c) throw new NotFoundError();
  assertWritable(scope, c.accountId);
}

export async function updateCharge(scope: Scope, id: string, input: ChargeInput) {
  await prisma.$transaction(async (tx) => {
    await lockWritableCharge(tx, scope, id);
    await checkRefs(tx, scope, input);
    // Charge portée par un crédit : modifiable seulement via le crédit.
    const { count } = await tx.fixedCharge.updateMany({ where: { id, householdId: scope.householdId, loan: null }, data: input });
    if (!count) throw new NotFoundError();
  });
}

/** Supprime la charge et ses paiements ; les dépenses créées restent (elles deviennent variables). */
export async function deleteCharge(scope: Scope, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockWritableCharge(tx, scope, id);
    await tx.fixedCharge.deleteMany({ where: { id, householdId: scope.householdId } });
  });
}

export async function getCharge(scope: Scope, id: string) {
  const c = await prisma.fixedCharge.findFirst({
    where: { id, householdId: scope.householdId, accountId: readable(scope) },
    include: { loan: { select: { id: true } } },
  });
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
export async function listMonthCharges(scope: Scope, month: Date) {
  const charges = await prisma.fixedCharge.findMany({
    where: { householdId: scope.householdId, accountId: readable(scope), startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
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
export async function payCharge(scope: Scope, userId: string, id: string, month: Date, amount: number, occurredOn: Date) {
  const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  if (occurredOn < month || occurredOn >= next) throw new LedgerError("La date doit être dans le mois de l’échéance.", "occurredOn");
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await tx.fixedCharge.findFirst({ where: { id, householdId: scope.householdId, accountId: readable(scope) }, include: { loan: LOAN_INCLUDE } });
      if (!charge) throw new NotFoundError();
      assertWritable(scope, charge.accountId);
      if (!appliesTo(charge, month) || (charge.loan && !loanRow({ ...charge, loan: charge.loan }, month))) {
        throw new LedgerError("Cette charge ne s’applique pas à ce mois.");
      }
      if (await tx.fixedChargePayment.count({ where: { fixedChargeId: id, month } })) throw new LedgerError(ALREADY_PAID);
      const t = await createEntryTx(tx, scope, userId, {
        accountId: charge.accountId, kind: "EXPENSE", amount, occurredOn, note: charge.name, categoryId: charge.categoryId,
      });
      return tx.fixedChargePayment.create({ data: { householdId: scope.householdId, fixedChargeId: id, month, transactionId: t.id } });
    });
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError(ALREADY_PAID); // double clic / paiement concurrent
    if (isCode(e, "P2003")) throw new NotFoundError(); // charge supprimée entre-temps
    throw e;
  }
}
