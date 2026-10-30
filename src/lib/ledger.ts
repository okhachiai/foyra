import { Prisma } from "@prisma/client";
import type { Scope } from "./access";
import { prisma } from "./db";

/** Erreur métier affichable (optionnellement rattachée à un champ du formulaire). */
export class LedgerError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}
/** Objet inexistant ou d'un autre foyer : toujours traité en 404, sans distinction. */
export class NotFoundError extends Error {}

export const isCode = (e: unknown, code: string) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

type Db = Prisma.TransactionClient;

/** `paidById` : membre qui a payé (dépense) ou reçu (recette) ; `shared` : opération commune (partagée au prorata). */
export type EntryInput = { kind: "INCOME" | "EXPENSE"; amount: number; occurredOn: Date; note: string | null; categoryId: string | null; paidById: string; shared?: boolean };
/** Clé d'idempotence facultative (formulaires) : rejouer la même clé renvoie l'opération déjà créée. */
type Idempotent = { idempotencyKey?: string | null };

/** Net des opérations du mois (recettes − dépenses) : remplace le solde des anciens comptes. */
export async function monthNet(scope: Scope, month: Date, db: Db = prisma) {
  const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const sums = await db.transaction.groupBy({
    by: ["kind"],
    where: { householdId: scope.householdId, occurredOn: { gte: month, lt: next } },
    _sum: { amount: true },
  });
  return sums.reduce((s, r) => s + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amount ?? 0), 0);
}

/** Verrouille des lignes (FOR UPDATE, ordre stable) avant de les relire. */
const lockLines = (tx: Db, householdId: string, where: Prisma.Sql) =>
  tx.$queryRaw`SELECT "id" FROM "Transaction" WHERE "householdId" = ${householdId} AND ${where} ORDER BY "id" FOR UPDATE`;

/**
 * La catégorie doit être du foyer, du même sens et non archivée (sauf si l'opération l'avait déjà) ;
 * FOR SHARE : elle ne peut pas disparaître avant l'écriture.
 */
async function checkCategory(tx: Db, householdId: string, input: EntryInput, current?: string | null) {
  if (!input.categoryId) return;
  const [c] = await tx.$queryRaw<{ kind: string; archived: boolean }[]>`
    SELECT "kind"::text, "archivedAt" IS NOT NULL AS archived FROM "Category"
    WHERE "id" = ${input.categoryId} AND "householdId" = ${householdId} FOR SHARE`;
  if (!c) throw new NotFoundError();
  if (c.kind !== input.kind) throw new LedgerError("Catégorie incompatible avec le type d’opération.", "categoryId");
  if (c.archived && input.categoryId !== current) throw new LedgerError("Cette catégorie est archivée.", "categoryId");
}

/** « Payé par » : membre actif du foyer (un membre désactivé reste accepté s'il était déjà choisi). */
async function checkPayer(tx: Db, householdId: string, paidById: string, current?: string) {
  if (paidById === current) return;
  if (!(await tx.user.count({ where: { id: paidById, householdId, disabledAt: null } }))) throw new LedgerError("Membre inconnu.", "paidById");
}

/** Choix du « payé par » : membres actifs, plus `keep` (payeur actuel, même désactivé). */
export const payers = (householdId: string, keep?: string) =>
  prisma.user.findMany({
    where: { householdId, OR: [{ disabledAt: null }, ...(keep ? [{ id: keep }] : [])] },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

/** Création dans une transaction SQL existante (ex. paiement d'une récurrence) ; personnelle par défaut. */
export async function createEntryTx(tx: Db, scope: Scope, userId: string, input: EntryInput & Idempotent) {
  await checkPayer(tx, scope.householdId, input.paidById);
  await checkCategory(tx, scope.householdId, input);
  return tx.transaction.create({ data: { ...input, shared: input.shared ?? false, householdId: scope.householdId, createdById: userId } });
}

/** Écrit ; si la clé existe déjà (double clic, nouvelle tentative), renvoie l'opération déjà enregistrée au lieu d'un doublon. */
export async function createEntry(scope: Scope, userId: string, input: EntryInput & Idempotent) {
  try {
    return await prisma.$transaction((tx) => createEntryTx(tx, scope, userId, input));
  } catch (e) {
    const key = input.idempotencyKey;
    if (!key || !isCode(e, "P2002")) throw e;
    const t = await prisma.transaction.findFirst({ where: { householdId: scope.householdId, idempotencyKey: key } });
    if (!t) throw e;
    return t;
  }
}

/** Opération du foyer. */
export async function getTransaction(scope: Scope, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, householdId: scope.householdId } });
  if (!t) throw new NotFoundError();
  return t;
}

export async function updateEntry(scope: Scope, id: string, input: EntryInput) {
  const householdId = scope.householdId;
  return prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"id" = ${id}`);
    const current = await tx.transaction.findFirst({ where: { id, householdId } });
    if (!current) throw new NotFoundError();
    // Opération réglant une récurrence : même sens, dans le mois de l'échéance.
    const payment = await tx.fixedChargePayment.findUnique({ where: { transactionId: id } });
    if (payment) {
      if (input.kind !== current.kind) throw new LedgerError("Cette opération règle une récurrence : son type ne peut pas changer.", "kind");
      const m = payment.month;
      if (input.occurredOn < m || input.occurredOn >= new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
        throw new LedgerError("Cette opération règle une récurrence : la date doit rester dans le mois de l’échéance.", "occurredOn");
      }
    }
    // Dépense d'un remboursement anticipé : montant et date contrôlés à la saisie, donc figés.
    if (await tx.loanPrepayment.count({ where: { transactionId: id } })) {
      if (input.kind !== "EXPENSE") throw new LedgerError("Cette dépense est un remboursement anticipé : elle doit rester une dépense.", "kind");
      const redo = "Remboursement anticipé : pour changer son montant ou sa date, supprimez-le et saisissez-le à nouveau.";
      if (input.amount !== current.amount) throw new LedgerError(redo, "amount");
      if (input.occurredOn.getTime() !== current.occurredOn.getTime()) throw new LedgerError(redo, "occurredOn");
    }
    await checkPayer(tx, householdId, input.paidById, current.paidById);
    await checkCategory(tx, householdId, input, current.categoryId);
    return tx.transaction.update({ where: { id }, data: { ...input, shared: input.shared ?? current.shared } });
  });
}

export async function deleteTransaction(scope: Scope, id: string) {
  const { count } = await prisma.transaction.deleteMany({ where: { id, householdId: scope.householdId } });
  if (!count) throw new NotFoundError();
}

// --- Dates d'opération (jour calendaire, sans heure) ---

/** « AAAA-MM-JJ » du jour dans le fuseau du foyer. */
export const todayIn = (timeZone: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

/** « AAAA-MM-JJ » → Date UTC minuit (colonne @db.Date), ou null si invalide. */
export function parseDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const formatDay = (d: Date) => d.toISOString().slice(0, 10);
