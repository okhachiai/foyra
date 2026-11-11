import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, type BudgetSource, type Role } from "@prisma/client";
import { createDefaultCategories } from "./categories";
import { prisma } from "./db";
import { LedgerError, NotFoundError } from "./ledger";
import type { LlmConfig } from "./llm";

export const SESSION_COOKIE = "foyra_session"; // dupliqué dans src/middleware.ts (runtime edge)
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

/** Au-delà, refusé sans calcul Argon2 (évite de hacher des entrées de plusieurs centaines de Ko). */
export const MAX_PASSWORD = 1024;
const verifyPassword = async (passwordHash: string, password: string) =>
  password.length <= MAX_PASSWORD && verify(passwordHash, password).catch(() => false);

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");
const expiry = () => new Date(Date.now() + SESSION_DAYS * DAY_MS);

async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // COOKIE_SECURE explicite, sinon déduit de l'URL publique (https → Secure).
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : !!process.env.APP_URL?.startsWith("https://"),
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

/**
 * IP connue : compteur par IP, un tiers ne peut donc pas bloquer la victime depuis une autre IP.
 * IP inconnue ("", sans APP_URL) : seul l'email reste disponible ; définir APP_URL derrière un proxy pour éviter ce blocage ciblé.
 */
const key = (ip: string, email: string) => (ip ? `ip:${ip}` : `email:${email.toLowerCase()}`);

export function loginBlocked(ip: string, email: string, now = Date.now()) {
  const f = failures.get(key(ip, email));
  return f !== undefined && f.until > now && f.count >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  if (failures.size > 10_000) for (const [k, f] of failures) if (f.until <= now) failures.delete(k);
  const k = key(ip, email);
  const f = failures.get(k);
  failures.set(k, f && f.until > now ? { count: f.count + 1, until: now + WINDOW_MS } : { count: 1, until: now + WINDOW_MS });
}

/** Après un succès. Le compteur `ip:` n'est jamais effacé : se connecter à son propre compte le remettrait à zéro entre deux essais. */
export function clearLoginFailures(ip: string, email: string) {
  if (!ip) failures.delete(`email:${email.toLowerCase()}`);
}

let dummyHash: Promise<string> | undefined;

/** Vérifie email + mot de passe ; temps comparable que l'utilisateur existe, soit désactivé ou non. */
export async function checkCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    dummyHash ??= hash("foyra-dummy-password");
    await verifyPassword(await dummyHash, password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  return ok && !user.disabledAt ? user : null;
}

// --- Initialisation et membres ---

const g = globalThis as unknown as { setupToken?: string };

/** Jeton exigé par /setup : SETUP_TOKEN, sinon jeton aléatoire tiré une fois et affiché dans les journaux du serveur. */
export function setupToken() {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  if (!g.setupToken) {
    g.setupToken = randomBytes(16).toString("hex");
    console.log(`Setup token (/setup): ${g.setupToken}`);
  }
  return g.setupToken;
}

export async function householdExists() {
  return (await prisma.household.count()) > 0;
}

/**
 * Premier foyer de l'instance et son admin (assistant /setup). Renvoie null si un foyer existe déjà ou si l'email est pris.
 * `force` : foyer supplémentaire (tests, script) — chaque foyer reste strictement isolé par householdId.
 */
export async function setupHousehold(input: { householdName: string; name: string; email: string; password: string }, { force = false } = {}) {
  const passwordHash = await hash(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      // Verrou transactionnel : deux /setup simultanés se sérialisent, le second voit le foyer du premier.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242)`;
      if (!force && (await tx.household.count())) return null;
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
      data: { householdId, name: input.name, email: input.email.trim().toLowerCase(), passwordHash: await hash(input.password), role: input.role },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

const LAST_ADMIN = "The household must keep at least one active admin.";

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
    if (change.disabled && userId === actorId) throw new LedgerError("You cannot disable your own account.");
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
    // Les accès aux comptes sont explicites et indépendants du rôle : ils sont conservés.
    if (disabled) await tx.session.deleteMany({ where: { userId } });
  });
}

export const setRole = (householdId: string, actorId: string, userId: string, role: Role) =>
  updateUser(householdId, actorId, userId, { role });

export const setDisabled = (householdId: string, actorId: string, userId: string, disabled: boolean) =>
  updateUser(householdId, actorId, userId, { disabled });

/** Préférences du foyer (admin) : nom affiché et source des nouveaux budgets, ou réglages LLM. La devise reste l'euro. */
export async function updateHousehold(householdId: string, data: { name: string; budgetSource: BudgetSource } | LlmConfig) {
  await prisma.household.update({ where: { id: householdId }, data });
}

export async function updateDisplayName(userId: string, name: string) {
  await prisma.user.update({ where: { id: userId }, data: { name } });
}

/** Change son mot de passe (actuel exigé) ; supprime ses autres sessions, garde celle du cookie courant. */
export async function changePassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) throw new LedgerError("Incorrect current password.", "current");
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const passwordHash = await hash(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId, NOT: { tokenHash: sha256(token) } } }),
  ]);
}
