import type { AccessLevel, Role } from "@prisma/client";
import { prisma } from "./db";
import { LedgerError, NotFoundError } from "./ledger";

/**
 * Portée d'un utilisateur : comptes lisibles et modifiables (null = tous les comptes du foyer, cas de l'admin).
 * Seul point de contrôle des accès : toute fonction de src/lib qui touche un compte la reçoit.
 */
export type Scope = { householdId: string; read: string[] | null; write: string[] | null };

export const READ_ONLY = "Accès en lecture seule sur ce compte.";

export const fullScope = (householdId: string): Scope => ({ householdId, read: null, write: null });

/** Admin → tous les comptes ; membre → ses lignes AccountAccess (écriture ⇒ lecture). */
export async function getScope(user: { id: string; role: Role; householdId: string }): Promise<Scope> {
  if (user.role === "ADMIN") return fullScope(user.householdId);
  const rows = await prisma.accountAccess.findMany({
    where: { userId: user.id, account: { householdId: user.householdId } },
    select: { accountId: true, level: true },
  });
  return {
    householdId: user.householdId,
    read: rows.map((r) => r.accountId),
    write: rows.filter((r) => r.level === "WRITE").map((r) => r.accountId),
  };
}

/** Fragment Prisma à poser sur `accountId` / `id` : undefined = pas de filtre. */
export const readable = (s: Scope) => (s.read ? { in: s.read } : undefined);
export const writable = (s: Scope) => (s.write ? { in: s.write } : undefined);

export const canRead = (s: Scope, accountId: string) => !s.read || s.read.includes(accountId);
export const canWrite = (s: Scope, accountId: string) => !s.write || s.write.includes(accountId);

/** Illisible → NotFoundError (aucune fuite d'existence) ; lecture seule → LedgerError. */
export function assertWritable(s: Scope, accountId: string, field?: string) {
  if (!canRead(s, accountId)) throw new NotFoundError();
  if (!canWrite(s, accountId)) throw new LedgerError(READ_ONLY, field);
}

async function findMember(householdId: string, memberId: string) {
  const member = await prisma.user.findFirst({ where: { id: memberId, householdId, role: "MEMBER" } });
  if (!member) throw new NotFoundError();
  return member;
}

/** Utilisateur du foyer (tout rôle) et niveau d'accès sur chaque compte du foyer, archivés compris. */
export async function getAccess(householdId: string, memberId: string) {
  const member = await prisma.user.findFirst({ where: { id: memberId, householdId } });
  if (!member) throw new NotFoundError();
  const accounts = await prisma.account.findMany({
    where: { householdId },
    include: { access: { where: { userId: memberId }, select: { level: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { member, accounts: accounts.map(({ access, ...a }) => ({ ...a, level: access[0]?.level ?? null })) };
}

/** Règle les accès d'un membre ; null = aucun accès. Compte hors foyer → NotFoundError, rien n'est écrit. */
export async function setAccess(householdId: string, memberId: string, levels: Map<string, AccessLevel | null>) {
  await findMember(householdId, memberId);
  const ids = [...levels.keys()];
  if ((await prisma.account.count({ where: { householdId, id: { in: ids } } })) !== ids.length) throw new NotFoundError();
  await prisma.$transaction(
    [...levels].map(([accountId, level]) =>
      level
        ? prisma.accountAccess.upsert({
            where: { userId_accountId: { userId: memberId, accountId } },
            create: { userId: memberId, accountId, level },
            update: { level },
          })
        : prisma.accountAccess.deleteMany({ where: { userId: memberId, accountId } }),
    ),
  );
}
