import type { AccessLevel, AccountSharing } from "@prisma/client";
import { prisma } from "./db";
import { LedgerError, NotFoundError } from "./ledger";

/**
 * Portée d'un utilisateur : comptes lisibles, modifiables et gérables (null = tous les comptes du foyer, usage interne et tests).
 * Seul point de contrôle des accès : toute fonction de src/lib qui touche un compte la reçoit.
 * Le rôle admin ne donne aucun accès aux comptes : seuls comptent les accès explicites et le partage « tout le foyer ».
 */
export type Scope = { householdId: string; read: string[] | null; write: string[] | null; manage: string[] | null };

export const READ_ONLY = "Accès en lecture seule sur ce compte.";
export const NOT_MANAGER = "Seuls les gestionnaires de ce compte peuvent le modifier.";

export const fullScope = (householdId: string): Scope => ({ householdId, read: null, write: null, manage: null });

const RANK: Record<AccessLevel, number> = { READ: 1, WRITE: 2, MANAGE: 3 };

/** Niveau effectif : accès explicite, relevé à l'écriture si le compte est partagé avec tout le foyer. */
export function effectiveLevel(sharing: AccountSharing, explicit: AccessLevel | null): AccessLevel | null {
  const shared: AccessLevel | null = sharing === "HOUSEHOLD" ? "WRITE" : null;
  if (!explicit) return shared;
  return shared && RANK[shared] > RANK[explicit] ? shared : explicit;
}

export async function getScope(user: { id: string; householdId: string }): Promise<Scope> {
  const accounts = await prisma.account.findMany({
    where: { householdId: user.householdId, OR: [{ sharing: "HOUSEHOLD" }, { access: { some: { userId: user.id } } }] },
    select: { id: true, sharing: true, access: { where: { userId: user.id }, select: { level: true } } },
  });
  const levels = accounts.map((a) => ({ id: a.id, level: effectiveLevel(a.sharing, a.access[0]?.level ?? null)! }));
  const atLeast = (min: AccessLevel) => levels.filter((l) => RANK[l.level] >= RANK[min]).map((l) => l.id);
  return { householdId: user.householdId, read: atLeast("READ"), write: atLeast("WRITE"), manage: atLeast("MANAGE") };
}

/** Fragment Prisma à poser sur `accountId` / `id` : undefined = pas de filtre. */
export const readable = (s: Scope) => (s.read ? { in: s.read } : undefined);
export const writable = (s: Scope) => (s.write ? { in: s.write } : undefined);

export const canRead = (s: Scope, accountId: string) => !s.read || s.read.includes(accountId);
export const canWrite = (s: Scope, accountId: string) => !s.write || s.write.includes(accountId);
export const canManage = (s: Scope, accountId: string) => !s.manage || s.manage.includes(accountId);

/** Illisible → NotFoundError (aucune fuite d'existence) ; lecture seule → LedgerError. */
export function assertWritable(s: Scope, accountId: string, field?: string) {
  if (!canRead(s, accountId)) throw new NotFoundError();
  if (!canWrite(s, accountId)) throw new LedgerError(READ_ONLY, field);
}

export function assertManageable(s: Scope, accountId: string) {
  if (!canRead(s, accountId)) throw new NotFoundError();
  if (!canManage(s, accountId)) throw new LedgerError(NOT_MANAGER);
}

/** Règle les accès explicites d'un utilisateur ; null = aucun. Bas niveau, sans contrôle de l'acteur (setup, tests). */
export async function setAccess(householdId: string, userId: string, levels: Map<string, AccessLevel | null>) {
  if (!(await prisma.user.count({ where: { id: userId, householdId } }))) throw new NotFoundError();
  const ids = [...levels.keys()];
  if ((await prisma.account.count({ where: { householdId, id: { in: ids } } })) !== ids.length) throw new NotFoundError();
  await prisma.$transaction(
    [...levels].map(([accountId, level]) =>
      level
        ? prisma.accountAccess.upsert({
            where: { userId_accountId: { userId, accountId } },
            create: { userId, accountId, level },
            update: { level },
          })
        : prisma.accountAccess.deleteMany({ where: { userId, accountId } }),
    ),
  );
}

/** Partage d'un compte géré : mode et niveau explicite de chaque utilisateur du foyer. */
export async function getSharing(scope: Scope, accountId: string) {
  assertManageable(scope, accountId);
  const account = await prisma.account.findFirst({ where: { id: accountId, householdId: scope.householdId } });
  if (!account) throw new NotFoundError();
  const users = await prisma.user.findMany({
    where: { householdId: scope.householdId },
    include: { accountAccess: { where: { accountId }, select: { level: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { sharing: account.sharing, users: users.map(({ accountAccess, ...u }) => ({ ...u, level: accountAccess[0]?.level ?? null })) };
}

/**
 * Change le partage d'un compte (gestionnaire seulement). L'acteur garde toujours la gestion :
 * sa propre ligne est ignorée, le compte n'est donc jamais sans gestionnaire.
 */
export async function setSharing(scope: Scope, actorId: string, accountId: string, sharing: AccountSharing, levels: Map<string, AccessLevel | null>) {
  assertManageable(scope, accountId);
  levels.delete(actorId);
  const ids = [...levels.keys()];
  if ((await prisma.user.count({ where: { householdId: scope.householdId, id: { in: ids } } })) !== ids.length) throw new NotFoundError();
  await prisma.$transaction([
    prisma.account.updateMany({ where: { id: accountId, householdId: scope.householdId }, data: { sharing } }),
    prisma.accountAccess.upsert({
      where: { userId_accountId: { userId: actorId, accountId } },
      create: { userId: actorId, accountId, level: "MANAGE" },
      update: { level: "MANAGE" },
    }),
    ...[...levels].map(([userId, level]) =>
      level
        ? prisma.accountAccess.upsert({ where: { userId_accountId: { userId, accountId } }, create: { userId, accountId, level }, update: { level } })
        : prisma.accountAccess.deleteMany({ where: { userId, accountId } }),
    ),
  ]);
}
