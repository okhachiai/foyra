import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, type Role } from "@prisma/client";
import { createDefaultCategories } from "./categories";
import { prisma } from "./db";
import { LedgerError, NotFoundError } from "./ledger";

export const SESSION_COOKIE = "foyra_session"; // dupliqué dans src/middleware.ts (runtime edge)
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) =>
  verify(passwordHash, password).catch(() => false);

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");
const expiry = () => new Date(Date.now() + SESSION_DAYS * DAY_MS);

async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** Crée une session en base (jeton haché) et pose le cookie. À appeler depuis une Server Action. */
export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt: expiry() } });
  await setSessionCookie(token);
}

/** Session valide pour ce jeton, ou null (expirée → supprimée ; utilisateur désactivé → ses sessions supprimées). */
export async function findSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { household: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (session.user.disabledAt) {
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    return null;
  }
  return session;
}

export type CurrentUser = Awaited<ReturnType<typeof requireUser>>;

/** Lit la session en base ; redirige vers /login si absente, expirée ou supprimée. */
export async function requireUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await findSession(token);
  if (!session) redirect("/login");

  // Renouvellement glissant : seulement si le cookie peut être réécrit (Server Action),
  // pour que cookie et base gardent la même échéance.
  if (session.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
    try {
      await setSessionCookie(token!);
      await prisma.session.update({ where: { id: session.id }, data: { expiresAt: expiry() } });
    } catch {
      // rendu d'un Server Component : cookies en lecture seule, on renouvellera à la prochaine action
    }
  }
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/tableau-de-bord");
  return user;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  store.delete(SESSION_COOKIE);
}

// --- Limitation des tentatives de connexion (en mémoire, par IP et par email) ---
// ponytail: compteur en mémoire d'un seul processus ; remis à zéro au redémarrage, suffisant pour une instance auto-hébergée.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

/** IP inconnue ("") : pas de clé par IP, sinon tous les clients partageraient le même compteur. */
const keys = (ip: string, email: string) => [...(ip ? [`ip:${ip}`] : []), `email:${email.toLowerCase()}`];

export function loginBlocked(ip: string, email: string, now = Date.now()) {
  return keys(ip, email).some((k) => {
    const f = failures.get(k);
    return f !== undefined && f.until > now && f.count >= MAX_FAILURES;
  });
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  if (failures.size > 10_000) for (const [k, f] of failures) if (f.until <= now) failures.delete(k);
  for (const k of keys(ip, email)) {
    const f = failures.get(k);
    failures.set(k, f && f.until > now ? { count: f.count + 1, until: now + WINDOW_MS } : { count: 1, until: now + WINDOW_MS });
  }
}

export function clearLoginFailures(ip: string, email: string) {
  for (const k of keys(ip, email)) failures.delete(k);
}

let dummyHash: Promise<string> | undefined;

/** Vérifie email + mot de passe ; temps comparable que l'utilisateur existe, soit désactivé ou non. */
export async function checkCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    dummyHash ??= hashPassword("foyra-dummy-password");
    await verifyPassword(await dummyHash, password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  return ok && !user.disabledAt ? user : null;
}

// --- Initialisation et membres ---

export async function householdExists() {
  return (await prisma.household.count()) > 0;
}

/** Crée le foyer unique et son admin. Renvoie null si un foyer existe déjà (y compris setup concurrent). */
export async function setupHousehold(input: { householdName: string; name: string; email: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const household = await tx.household.create({ data: { name: input.householdName } });
      await createDefaultCategories(tx, household.id);
      return tx.user.create({
        data: { householdId: household.id, name: input.name, email: input.email.trim().toLowerCase(), passwordHash, role: "ADMIN" },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

/** Crée un membre ; renvoie null si l'email est déjà pris. */
export async function createMember(householdId: string, input: { name: string; email: string; password: string; role: Role }) {
  try {
    return await prisma.user.create({
      data: { householdId, name: input.name, email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password), role: input.role },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

const LAST_ADMIN = "Le foyer doit garder au moins un admin actif.";

/**
 * Change le rôle et/ou l'état actif d'un utilisateur du foyer, sans jamais laisser zéro admin actif.
 * Les admins actifs sont verrouillés (FOR UPDATE) : deux changements concurrents se sérialisent,
 * le second relit l'état validé par le premier.
 */
async function updateUser(householdId: string, actorId: string, userId: string, change: { role?: Role; disabled?: boolean }) {
  await prisma.$transaction(async (tx) => {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "householdId" = ${householdId} AND "role" = 'ADMIN' AND "disabledAt" IS NULL FOR UPDATE`;
    // Cible verrouillée aussi (après les admins, même ordre partout) : pas d'écriture depuis une lecture périmée.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} AND "householdId" = ${householdId} FOR UPDATE`;
    const target = await tx.user.findFirst({ where: { id: userId, householdId } });
    if (!target) throw new NotFoundError();
    if (change.disabled && userId === actorId) throw new LedgerError("Vous ne pouvez pas désactiver votre propre compte.");
    const role = change.role ?? target.role;
    const disabled = change.disabled ?? target.disabledAt !== null;
    const losesAdmin = admins.some((a) => a.id === userId) && (role !== "ADMIN" || disabled);
    if (losesAdmin && admins.length === 1) throw new LedgerError(LAST_ADMIN, change.role ? "role" : undefined);
    // Acteur rétrogradé / désactivé entre-temps : aucune écriture (après le refus « dernier admin », attendu en cas de croisement).
    if (!admins.some((a) => a.id === actorId)) throw new NotFoundError();

    await tx.user.update({
      where: { id: userId },
      data: { role, disabledAt: disabled ? (target.disabledAt ?? new Date()) : null },
    });
    // Rétrogradé : aucun accès aux comptes tant que l'admin n'en donne pas (comme un nouveau membre).
    if (target.role === "ADMIN" && role === "MEMBER") await tx.accountAccess.deleteMany({ where: { userId } });
    if (disabled) await tx.session.deleteMany({ where: { userId } });
  });
}

export const setRole = (householdId: string, actorId: string, userId: string, role: Role) =>
  updateUser(householdId, actorId, userId, { role });

export const setDisabled = (householdId: string, actorId: string, userId: string, disabled: boolean) =>
  updateUser(householdId, actorId, userId, { disabled });

/** Change son mot de passe (actuel exigé) ; supprime ses autres sessions, garde celle du cookie courant. */
export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) throw new LedgerError("Mot de passe actuel incorrect.", "current");
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const passwordHash = await hashPassword(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId, NOT: { tokenHash: sha256(token) } } }),
  ]);
}
