import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { createEntryTx, isCode, LedgerError, NotFoundError } from "./ledger";

type Db = Prisma.TransactionClient;

export type ChargeInput = {
  name: string; amount: number; dueDay: number; accountId: string; categoryId: string; startMonth: Date; endMonth: Date | null;
};

/** Échéance d'une charge pour un mois (1er du mois UTC) : min(jour, dernier jour du mois). Pure. */
export function dueDate(charge: { dueDay: number }, month: Date) {
  const y = month.getUTCFullYear(), m = month.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(charge.dueDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
}

/** La charge s'applique au mois si début ≤ mois ≤ dernier mois (vide = sans fin). */
export const appliesTo = (charge: { startMonth: Date; endMonth: Date | null }, month: Date) =>
  charge.startMonth <= month && (!charge.endMonth || month <= charge.endMonth);

/** Catégorie de dépense du foyer, compte du foyer non archivé ; FOR SHARE : ni l'un ni l'autre ne change avant l'écriture. */
async function checkRefs(tx: Db, householdId: string, input: ChargeInput) {
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
    const { count } = await tx.fixedCharge.updateMany({ where: { id, householdId }, data: input });
    if (!count) throw new NotFoundError();
  });
}

/** Supprime la charge et ses paiements ; les dépenses créées restent (elles deviennent variables). */
export async function deleteCharge(householdId: string, id: string) {
  const { count } = await prisma.fixedCharge.deleteMany({ where: { id, householdId } });
  if (!count) throw new NotFoundError();
}

export async function getCharge(householdId: string, id: string) {
  const c = await prisma.fixedCharge.findFirst({ where: { id, householdId } });
  if (!c) throw new NotFoundError();
  return c;
}

/** Charges applicables au mois, triées par échéance, avec leur paiement du mois (et sa dépense) s'il existe. */
export async function listMonthCharges(householdId: string, month: Date) {
  const charges = await prisma.fixedCharge.findMany({
    where: { householdId, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
      payments: { where: { month }, include: { transaction: true } },
    },
    orderBy: [{ dueDay: "asc" }, { name: "asc" }],
  });
  return charges.map(({ payments, ...c }) => ({ ...c, due: dueDate(c, month), payment: payments[0] ?? null }));
}

const ALREADY_PAID = "Cette charge est déjà payée pour ce mois.";

/** Marque la charge payée pour le mois : crée la dépense et le paiement dans une seule transaction SQL. */
export async function payCharge(householdId: string, userId: string, id: string, month: Date, amount: number, occurredOn: Date) {
  const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  if (occurredOn < month || occurredOn >= next) throw new LedgerError("La date doit être dans le mois de l’échéance.", "occurredOn");
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await tx.fixedCharge.findFirst({ where: { id, householdId } });
      if (!charge) throw new NotFoundError();
      if (!appliesTo(charge, month)) throw new LedgerError("Cette charge ne s’applique pas à ce mois.");
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
