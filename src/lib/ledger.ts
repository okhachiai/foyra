import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AccountKind, AccountSharing } from "@prisma/client";
import { assertManageable, assertWritable, readable, writable, type Scope } from "./access";
import { prisma } from "./db";
import { bigintToCents } from "./money";

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

export type EntryInput = { accountId: string; kind: "INCOME" | "EXPENSE"; amount: number; occurredOn: Date; note: string | null; categoryId: string | null };
export type TransferInput = { fromAccountId: string; toAccountId: string; amount: number; occurredOn: Date; note: string | null };
/** Clé d'idempotence facultative (formulaires) : rejouer la même clé renvoie l'opération déjà créée. */
type Idempotent = { idempotencyKey?: string | null };

const SIGNED_AMOUNT = Prisma.sql`CASE WHEN t."kind" = 'INCOME' OR t."transferSide" = 'IN' THEN t."amount" ELSE -t."amount" END`;

/** Soldes calculés (initial + somme signée) des comptes lisibles du foyer, archivés compris. */
async function balances(scope: Scope, db: Db = prisma, accountId?: string) {
  const rows = await db.$queryRaw<{ id: string; balance: bigint }[]>`
    SELECT a."id", a."initialBalance"::bigint + COALESCE(SUM(${SIGNED_AMOUNT}), 0)::bigint AS balance
    FROM "Account" a LEFT JOIN "Transaction" t ON t."accountId" = a."id"
    WHERE a."householdId" = ${scope.householdId}
      ${scope.read ? Prisma.sql`AND a."id" = ANY(${scope.read})` : Prisma.empty}
      ${accountId ? Prisma.sql`AND a."id" = ${accountId}` : Prisma.empty}
    GROUP BY a."id"`;
  return new Map(rows.map((r) => [r.id, bigintToCents(r.balance)]));
}

export async function accountBalance(scope: Scope, accountId: string, db: Db = prisma) {
  const balance = (await balances(scope, db, accountId)).get(accountId);
  if (balance === undefined) throw new NotFoundError();
  return balance;
}

/** Comptes lisibles du foyer avec leur solde ; les archivés sont marqués. */
export async function listAccounts(scope: Scope) {
  const [accounts, map] = await Promise.all([
    prisma.account.findMany({ where: { householdId: scope.householdId, id: readable(scope) }, orderBy: [{ createdAt: "asc" }] }),
    balances(scope),
  ]);
  return accounts.map((a) => ({ ...a, balance: map.get(a.id) ?? a.initialBalance }));
}

/** Solde global = somme des soldes des comptes lisibles non archivés. */
export async function householdTotal(scope: Scope) {
  return (await listAccounts(scope)).filter((a) => !a.archivedAt).reduce((s, a) => s + a.balance, 0);
}

export async function getAccount(scope: Scope, id: string) {
  const account = await prisma.account.findFirst({ where: { id, householdId: scope.householdId, AND: [{ id: readable(scope) }] } });
  if (!account) throw new NotFoundError();
  return account;
}

/** Comptes actifs modifiables (listes de choix) ; `keep` : compte actuel conservé même archivé. */
export function writableAccounts(scope: Scope, keep?: string) {
  return prisma.account.findMany({
    where: { householdId: scope.householdId, id: writable(scope), OR: [{ archivedAt: null }, ...(keep ? [{ id: keep }] : [])] },
    orderBy: { createdAt: "asc" },
  });
}

type AccountData = { kind: AccountKind; name: string; notes?: string };

/** Crée un compte : son créateur en est gestionnaire ; partage par défaut limité aux membres sélectionnés. */
export function createAccount(scope: Scope, userId: string, data: AccountData & { initialBalance: number; sharing?: AccountSharing }) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({ data: { ...data, householdId: scope.householdId } });
    await tx.accountAccess.create({ data: { userId, accountId: account.id, level: "MANAGE" } });
    return account;
  });
}

/** Nom, type et notes ; le solde initial reste celui fixé à la création. */
export async function updateAccount(scope: Scope, id: string, data: AccountData) {
  assertManageable(scope, id);
  const { count } = await prisma.account.updateMany({ where: { id, householdId: scope.householdId, archivedAt: null }, data });
  if (!count) throw new LedgerError("Compte introuvable ou archivé.");
}

/** Vérifie l'écriture sur chaque compte, les verrouille (ordre stable, anti-interblocage), puis qu'ils sont du foyer et actifs. */
async function lockActiveAccounts(tx: Db, scope: Scope, accounts: { id: string; field: string }[]) {
  for (const a of accounts) assertWritable(scope, a.id, a.field);
  const householdId = scope.householdId;
  const ids = [...new Set(accounts.map((a) => a.id))].sort();
  const rows = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
    SELECT "id", "archivedAt" FROM "Account"
    WHERE "householdId" = ${householdId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR UPDATE`;
  if (rows.length !== ids.length) throw new NotFoundError();
  for (const a of accounts) {
    if (rows.find((r) => r.id === a.id)!.archivedAt) throw new LedgerError("Ce compte est archivé : aucune saisie possible.", a.field);
  }
}

/** Verrouille des lignes (FOR UPDATE, ordre stable) avant de les relire : elles ne peuvent plus changer de compte. */
const lockLines = (tx: Db, householdId: string, where: Prisma.Sql) =>
  tx.$queryRaw`SELECT "id" FROM "Transaction" WHERE "householdId" = ${householdId} AND ${where} ORDER BY "id" FOR UPDATE`;

// --- Recettes / dépenses ---

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

/** Création dans une transaction SQL existante (ex. paiement d'une récurrence). */
export async function createEntryTx(tx: Db, scope: Scope, userId: string, input: EntryInput & Idempotent) {
  await lockActiveAccounts(tx, scope, [{ id: input.accountId, field: "accountId" }]);
  await checkCategory(tx, scope.householdId, input);
  return tx.transaction.create({ data: { ...input, householdId: scope.householdId, createdById: userId } });
}

/** Écrit ; si la clé existe déjà (double clic, nouvelle tentative), renvoie l'opération déjà enregistrée au lieu d'un doublon. */
async function replay<T>(scope: Scope, key: string | null | undefined, write: () => Promise<T>, existing: (id: string, transferId: string | null) => T | PromiseLike<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (!key || !isCode(e, "P2002")) throw e;
    const t = await prisma.transaction.findFirst({ where: { householdId: scope.householdId, idempotencyKey: key, accountId: readable(scope) } });
    if (!t) throw e;
    return existing(t.id, t.transferId);
  }
}

export async function createEntry(scope: Scope, userId: string, input: EntryInput & Idempotent) {
  return replay(
    scope, input.idempotencyKey,
    () => prisma.$transaction((tx) => createEntryTx(tx, scope, userId, input)),
    (id) => prisma.transaction.findUniqueOrThrow({ where: { id } }),
  );
}

/** Opération d'un compte lisible. */
export async function getTransaction(scope: Scope, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, householdId: scope.householdId, accountId: readable(scope) } });
  if (!t) throw new NotFoundError();
  return t;
}

export async function updateEntry(scope: Scope, id: string, input: EntryInput) {
  const householdId = scope.householdId;
  return prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"id" = ${id}`);
    const current = await tx.transaction.findFirst({ where: { id, householdId, accountId: readable(scope), kind: { not: "TRANSFER" } } });
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
    await lockActiveAccounts(tx, scope, [
      { id: current.accountId, field: "accountId" },
      { id: input.accountId, field: "accountId" },
    ]);
    await checkCategory(tx, householdId, input, current.categoryId);
    return tx.transaction.update({ where: { id }, data: input });
  });
}

/** Supprime une transaction ; s'il s'agit d'un côté de virement, les deux côtés partent ensemble. */
export async function deleteTransaction(scope: Scope, id: string) {
  const householdId = scope.householdId;
  await prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"id" = ${id}`);
    const t = await tx.transaction.findFirst({ where: { id, householdId, accountId: readable(scope) } });
    if (!t) throw new NotFoundError();
    if (t.transferId) return deleteTransferTx(tx, scope, t.transferId);
    await lockActiveAccounts(tx, scope, [{ id: t.accountId, field: "accountId" }]);
    await tx.transaction.deleteMany({ where: { id, householdId } });
  });
}

// --- Virements : deux lignes liées par transferId, toujours écrites en bloc ---

function checkDistinct(input: TransferInput) {
  if (input.fromAccountId === input.toAccountId) throw new LedgerError("Choisissez deux comptes différents.", "toAccountId");
}

const lockTransferAccounts = (tx: Db, scope: Scope, input: TransferInput) =>
  lockActiveAccounts(tx, scope, [
    { id: input.fromAccountId, field: "fromAccountId" },
    { id: input.toAccountId, field: "toAccountId" },
  ]);

/** Débit de la source et crédit de la destination dans une seule transaction SQL : les deux lignes ou aucune. */
export async function createTransfer(scope: Scope, userId: string, input: TransferInput & Idempotent) {
  checkDistinct(input);
  const transferId = randomUUID();
  const common = { householdId: scope.householdId, createdById: userId, kind: "TRANSFER" as const, amount: input.amount, occurredOn: input.occurredOn, note: input.note, transferId };
  return replay(
    scope, input.idempotencyKey,
    async () => {
      await prisma.$transaction(async (tx) => {
        await lockTransferAccounts(tx, scope, input);
        await tx.transaction.create({ data: { ...common, accountId: input.fromAccountId, transferSide: "OUT", idempotencyKey: input.idempotencyKey } });
        await tx.transaction.create({ data: { ...common, accountId: input.toAccountId, transferSide: "IN" } });
      });
      return transferId;
    },
    (_, existing) => existing!,
  );
}

/** Les deux lignes d'un virement du foyer, [OUT, IN] ; au moins un des deux comptes doit être lisible. */
export async function getTransfer(scope: Scope, transferId: string, db: Db = prisma) {
  const lines = await db.transaction.findMany({ where: { householdId: scope.householdId, transferId }, orderBy: { transferSide: "asc" } });
  const out = lines.find((l) => l.transferSide === "OUT");
  const inn = lines.find((l) => l.transferSide === "IN");
  if (!out || !inn) throw new NotFoundError();
  if (scope.read && !scope.read.includes(out.accountId) && !scope.read.includes(inn.accountId)) throw new NotFoundError();
  return { out, in: inn };
}

export async function updateTransfer(scope: Scope, transferId: string, input: TransferInput) {
  checkDistinct(input);
  await prisma.$transaction(async (tx) => {
    await lockLines(tx, scope.householdId, Prisma.sql`"transferId" = ${transferId}`);
    const current = await getTransfer(scope, transferId, tx);
    await lockActiveAccounts(tx, scope, [
      { id: current.out.accountId, field: "fromAccountId" },
      { id: current.in.accountId, field: "toAccountId" },
      { id: input.fromAccountId, field: "fromAccountId" },
      { id: input.toAccountId, field: "toAccountId" },
    ]);
    const common = { amount: input.amount, occurredOn: input.occurredOn, note: input.note };
    await tx.transaction.update({ where: { id: current.out.id }, data: { ...common, accountId: input.fromAccountId } });
    await tx.transaction.update({ where: { id: current.in.id }, data: { ...common, accountId: input.toAccountId } });
  });
}

export async function deleteTransfer(scope: Scope, transferId: string) {
  await prisma.$transaction((tx) => deleteTransferTx(tx, scope, transferId));
}

async function deleteTransferTx(tx: Db, scope: Scope, transferId: string) {
  const householdId = scope.householdId;
  await lockLines(tx, householdId, Prisma.sql`"transferId" = ${transferId}`);
  const current = await getTransfer(scope, transferId, tx);
  await lockActiveAccounts(tx, scope, [
    { id: current.out.accountId, field: "fromAccountId" },
    { id: current.in.accountId, field: "toAccountId" },
  ]);
  await tx.transaction.deleteMany({ where: { householdId, transferId } });
}

// --- Comptes ---

/** Archive un compte (gestionnaire) : refusé si le solde n'est pas exactement 0. Opérations et historique conservés. */
export async function archiveAccount(scope: Scope, accountId: string) {
  assertManageable(scope, accountId);
  await prisma.$transaction(async (tx) => {
    await lockActiveAccounts(tx, scope, [{ id: accountId, field: "accountId" }]);
    if ((await accountBalance(scope, accountId, tx)) !== 0) {
      throw new LedgerError("Le solde doit être de 0 pour archiver ce compte.");
    }
    await tx.account.update({ where: { id: accountId }, data: { archivedAt: new Date() } });
  });
}

/**
 * Supprime définitivement un compte (gestionnaire) et ses recettes / dépenses.
 * Refusé s'il porte des virements (l'autre compte serait modifié) ou des récurrences / crédits.
 */
export async function deleteAccount(scope: Scope, accountId: string) {
  assertManageable(scope, accountId);
  const householdId = scope.householdId;
  await prisma.$transaction(async (tx) => {
    // FOR UPDATE : aucune saisie ne peut s'ajouter pendant la suppression.
    const [a] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Account" WHERE "id" = ${accountId} AND "householdId" = ${householdId} FOR UPDATE`;
    if (!a) throw new NotFoundError();
    if (await tx.fixedCharge.count({ where: { householdId, accountId } })) {
      throw new LedgerError("Des récurrences ou crédits utilisent ce compte : supprimez-les d’abord, ou archivez le compte.");
    }
    if (await tx.transaction.count({ where: { householdId, accountId, transferId: { not: null } } })) {
      throw new LedgerError("Ce compte a des virements : supprimez-les d’abord, ou archivez le compte.");
    }
    await tx.transaction.deleteMany({ where: { householdId, accountId } });
    await tx.account.deleteMany({ where: { householdId, id: accountId } });
  });
}

/** Réactive un compte archivé (gestionnaire). */
export async function unarchiveAccount(scope: Scope, accountId: string) {
  assertManageable(scope, accountId);
  const { count } = await prisma.account.updateMany({ where: { id: accountId, householdId: scope.householdId }, data: { archivedAt: null } });
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
