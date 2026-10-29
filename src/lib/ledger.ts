import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** Erreur métier affichable (optionnellement rattachée à un champ du formulaire). */
export class LedgerError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}
/** Objet inexistant ou d'un autre foyer : toujours traité en 404, sans distinction. */
export class NotFoundError extends Error {}

type Db = Prisma.TransactionClient;

export type EntryInput = { accountId: string; kind: "INCOME" | "EXPENSE"; amount: number; occurredOn: Date; note: string | null };
export type TransferInput = { fromAccountId: string; toAccountId: string; amount: number; occurredOn: Date; note: string | null };

const SIGNED_AMOUNT = Prisma.sql`CASE WHEN t."kind" = 'INCOME' OR t."transferSide" = 'IN' THEN t."amount" ELSE -t."amount" END`;

/** Soldes calculés (initial + somme signée) de tous les comptes du foyer, archivés compris. */
async function balances(householdId: string, db: Db = prisma, accountId?: string) {
  const rows = await db.$queryRaw<{ id: string; balance: bigint }[]>`
    SELECT a."id", a."initialBalance"::bigint + COALESCE(SUM(${SIGNED_AMOUNT}), 0)::bigint AS balance
    FROM "Account" a LEFT JOIN "Transaction" t ON t."accountId" = a."id"
    WHERE a."householdId" = ${householdId} ${accountId ? Prisma.sql`AND a."id" = ${accountId}` : Prisma.empty}
    GROUP BY a."id"`;
  return new Map(rows.map((r) => [r.id, Number(r.balance)]));
}

export async function accountBalance(householdId: string, accountId: string, db: Db = prisma) {
  const balance = (await balances(householdId, db, accountId)).get(accountId);
  if (balance === undefined) throw new NotFoundError();
  return balance;
}

/** Comptes du foyer avec leur solde ; les archivés sont marqués. */
export async function listAccounts(householdId: string) {
  const [accounts, map] = await Promise.all([
    prisma.account.findMany({ where: { householdId }, orderBy: [{ createdAt: "asc" }] }),
    balances(householdId),
  ]);
  return accounts.map((a) => ({ ...a, balance: map.get(a.id) ?? a.initialBalance }));
}

/** Solde global = somme des soldes des comptes non archivés. */
export async function householdTotal(householdId: string) {
  return (await listAccounts(householdId)).filter((a) => !a.archivedAt).reduce((s, a) => s + a.balance, 0);
}

export async function getAccount(householdId: string, id: string) {
  const account = await prisma.account.findFirst({ where: { id, householdId } });
  if (!account) throw new NotFoundError();
  return account;
}

/** Verrouille les comptes (ordre stable, anti-interblocage) et vérifie qu'ils sont du foyer et actifs. */
async function lockActiveAccounts(tx: Db, householdId: string, accounts: { id: string; field: string }[]) {
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

export async function createEntry(householdId: string, userId: string, input: EntryInput) {
  return prisma.$transaction(async (tx) => {
    await lockActiveAccounts(tx, householdId, [{ id: input.accountId, field: "accountId" }]);
    return tx.transaction.create({ data: { ...input, householdId, createdById: userId } });
  });
}

export async function getTransaction(householdId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, householdId } });
  if (!t) throw new NotFoundError();
  return t;
}

export async function updateEntry(householdId: string, id: string, input: EntryInput) {
  return prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"id" = ${id}`);
    const current = await tx.transaction.findFirst({ where: { id, householdId, kind: { not: "TRANSFER" } } });
    if (!current) throw new NotFoundError();
    await lockActiveAccounts(tx, householdId, [
      { id: current.accountId, field: "accountId" },
      { id: input.accountId, field: "accountId" },
    ]);
    return tx.transaction.update({ where: { id }, data: input });
  });
}

/** Supprime une transaction ; s'il s'agit d'un côté de virement, les deux côtés partent ensemble. */
export async function deleteTransaction(householdId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"id" = ${id}`);
    const t = await tx.transaction.findFirst({ where: { id, householdId } });
    if (!t) throw new NotFoundError();
    if (t.transferId) return deleteTransferTx(tx, householdId, t.transferId);
    await lockActiveAccounts(tx, householdId, [{ id: t.accountId, field: "accountId" }]);
    await tx.transaction.deleteMany({ where: { id, householdId } });
  });
}

// --- Virements : deux lignes liées par transferId, toujours écrites en bloc ---

function checkDistinct(input: TransferInput) {
  if (input.fromAccountId === input.toAccountId) throw new LedgerError("Choisissez deux comptes différents.", "toAccountId");
}

const lockTransferAccounts = (tx: Db, householdId: string, input: TransferInput) =>
  lockActiveAccounts(tx, householdId, [
    { id: input.fromAccountId, field: "fromAccountId" },
    { id: input.toAccountId, field: "toAccountId" },
  ]);

export async function createTransfer(householdId: string, userId: string, input: TransferInput) {
  checkDistinct(input);
  const transferId = randomUUID();
  const common = { householdId, createdById: userId, kind: "TRANSFER" as const, amount: input.amount, occurredOn: input.occurredOn, note: input.note, transferId };
  await prisma.$transaction(async (tx) => {
    await lockTransferAccounts(tx, householdId, input);
    await tx.transaction.create({ data: { ...common, accountId: input.fromAccountId, transferSide: "OUT" } });
    await tx.transaction.create({ data: { ...common, accountId: input.toAccountId, transferSide: "IN" } });
  });
  return transferId;
}

/** Les deux lignes d'un virement du foyer, [OUT, IN]. */
export async function getTransfer(householdId: string, transferId: string, db: Db = prisma) {
  const lines = await db.transaction.findMany({ where: { householdId, transferId }, orderBy: { transferSide: "asc" } });
  const out = lines.find((l) => l.transferSide === "OUT");
  const inn = lines.find((l) => l.transferSide === "IN");
  if (!out || !inn) throw new NotFoundError();
  return { out, in: inn };
}

export async function updateTransfer(householdId: string, transferId: string, input: TransferInput) {
  checkDistinct(input);
  await prisma.$transaction(async (tx) => {
    await lockLines(tx, householdId, Prisma.sql`"transferId" = ${transferId}`);
    const current = await getTransfer(householdId, transferId, tx);
    await lockActiveAccounts(tx, householdId, [
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

export async function deleteTransfer(householdId: string, transferId: string) {
  await prisma.$transaction((tx) => deleteTransferTx(tx, householdId, transferId));
}

async function deleteTransferTx(tx: Db, householdId: string, transferId: string) {
  await lockLines(tx, householdId, Prisma.sql`"transferId" = ${transferId}`);
  const current = await getTransfer(householdId, transferId, tx);
  await lockActiveAccounts(tx, householdId, [
    { id: current.out.accountId, field: "fromAccountId" },
    { id: current.in.accountId, field: "toAccountId" },
  ]);
  await tx.transaction.deleteMany({ where: { householdId, transferId } });
}

// --- Comptes ---

/** Archive un compte : refusé si le solde n'est pas exactement 0. L'historique est conservé. */
export async function archiveAccount(householdId: string, accountId: string) {
  await prisma.$transaction(async (tx) => {
    await lockActiveAccounts(tx, householdId, [{ id: accountId, field: "accountId" }]);
    if ((await accountBalance(householdId, accountId, tx)) !== 0) {
      throw new LedgerError("Le solde doit être de 0 pour archiver ce compte.");
    }
    await tx.account.update({ where: { id: accountId }, data: { archivedAt: new Date() } });
  });
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
