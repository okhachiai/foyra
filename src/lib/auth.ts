import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, type Role } from "@prisma/client";
import { createDefaultCategories } from "./categories";
import { prisma } from "./db";

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

/** Session valide pour ce jeton, ou null (expirée → supprimée). */
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
  if (user.role !== "ADMIN") redirect("/accounts");
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

/** Vérifie email + mot de passe ; temps comparable que l'utilisateur existe ou non. */
export async function checkCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    dummyHash ??= hashPassword("foyra-dummy-password");
    await verifyPassword(await dummyHash, password);
    return null;
  }
  return (await verifyPassword(user.passwordHash, password)) ? user : null;
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
