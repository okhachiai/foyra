import { beforeEach, describe, expect, it, vi } from "vitest";

// Faux magasin de cookies pour next/headers (hors requête Next).
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import {
  checkCredentials, clearLoginFailures, endSession, householdExists, loginBlocked, recordLoginFailure,
  requireUser, SESSION_COOKIE, setupHousehold, setupToken, startSession,
} from "./auth";
import { prisma } from "./db";

const admin = { householdName: "Foyer", name: "Admin", email: "Admin@Test.fr", password: "password1" };

/** requireUser() redirige (throw NEXT_REDIRECT) : renvoie la cible, ou null si l'accès est accepté. */
async function redirectTarget() {
  try {
    await requireUser();
    return null;
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
}

beforeEach(async () => {
  jar.clear();
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Session", "User", "Household" CASCADE`);
});

describe("premier démarrage", () => {
  it("crée le foyer et l'admin une seule fois", async () => {
    expect(await householdExists()).toBe(false);
    const user = await setupHousehold(admin);
    expect(user?.role).toBe("ADMIN");
    expect(await setupHousehold({ ...admin, email: "b@test.fr" })).toBeNull();
    expect(await prisma.household.count()).toBe(1);
  });

  it("deux setups simultanés → un seul foyer", async () => {
    const results = await Promise.all([setupHousehold(admin), setupHousehold({ ...admin, email: "b@test.fr" })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.household.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("sessions", () => {
  it("non connecté → /login", async () => {
    expect(await redirectTarget()).toContain("/login");
  });

  it("session valide acceptée, jeton stocké haché", async () => {
    const user = (await setupHousehold(admin))!;
    await startSession(user.id);
    expect(await redirectTarget()).toBeNull();
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(jar.get(SESSION_COOKIE));
  });

  it("session supprimée (déconnexion) → ancien cookie refusé", async () => {
    const user = (await setupHousehold(admin))!;
    await startSession(user.id);
    const old = jar.get(SESSION_COOKIE)!;
    await endSession();
    expect(await prisma.session.count()).toBe(0);
    jar.set(SESSION_COOKIE, old);
    expect(await redirectTarget()).toContain("/login");
  });

  it("session expirée → refusée et purgée", async () => {
    const user = (await setupHousehold(admin))!;
    await startSession(user.id);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await redirectTarget()).toContain("/login");
    expect(await prisma.session.count()).toBe(0);
  });

  it("renouvelle l'expiration à mi-parcours", async () => {
    const user = (await setupHousehold(admin))!;
    await startSession(user.id);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(await redirectTarget()).toBeNull();
    const { expiresAt } = await prisma.session.findFirstOrThrow();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });
});

describe("connexion", () => {
  it("vérifie les identifiants (email insensible à la casse)", async () => {
    await setupHousehold(admin);
    expect(await checkCredentials("admin@test.fr", "password1")).not.toBeNull();
    expect(await checkCredentials("admin@test.fr", "mauvais")).toBeNull();
    expect(await checkCredentials("inconnu@test.fr", "password1")).toBeNull();
  });

  it("10 échecs rapprochés → IP bloquée (pas l'email depuis une autre IP), puis débloquée", () => {
    const now = Date.now();
    for (let i = 0; i < 9; i++) recordLoginFailure("1.2.3.4", "x@test.fr", now);
    expect(loginBlocked("1.2.3.4", "x@test.fr", now)).toBe(false);
    recordLoginFailure("1.2.3.4", "x@test.fr", now);
    expect(loginBlocked("9.9.9.9", "X@test.fr", now)).toBe(false); // même email, autre IP : pas de blocage ciblé (FOY-003)
    expect(loginBlocked("1.2.3.4", "y@test.fr", now)).toBe(true); // même IP, autre email
    expect(loginBlocked("1.2.3.4", "x@test.fr", now + 16 * 60_000)).toBe(false);
    clearLoginFailures("1.2.3.4", "x@test.fr");
  });

  it("IP inconnue : seule la limite par email s'applique", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) recordLoginFailure("", "z@test.fr", now);
    expect(loginBlocked("", "z@test.fr", now)).toBe(true);
    expect(loginBlocked("", "w@test.fr", now)).toBe(false);
    clearLoginFailures("", "z@test.fr");
  });
});

describe("setupToken", () => {
  it("SETUP_TOKEN s'il est défini, sinon un jeton aléatoire stable (jamais vide)", () => {
    vi.stubEnv("SETUP_TOKEN", "");
    const t = setupToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(setupToken()).toBe(t);
    vi.stubEnv("SETUP_TOKEN", "fixe");
    expect(setupToken()).toBe("fixe");
    vi.unstubAllEnvs();
  });
});
