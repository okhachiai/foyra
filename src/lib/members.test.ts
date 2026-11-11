import { execFileSync } from "node:child_process";
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
  changePassword, checkCredentials, createMember, findSession, SESSION_COOKIE, setDisabled, setRole, setupHousehold, startSession,
} from "./auth";
import { prisma } from "./db";
import { LedgerError, NotFoundError } from "./ledger";

let hh: string;
let adminId: string;
let bobId: string;

/** Ouvre une session pour l'utilisateur et renvoie son jeton (le cookie courant devient le sien). */
async function login(userId: string) {
  await startSession(userId);
  return jar.get(SESSION_COOKIE)!;
}

const message = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

beforeEach(async () => {
  jar.clear();
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  const a = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = a.householdId;
  adminId = a.id;
  bobId = (await createMember(hh, { name: "Bob", email: "bob@x.fr", password: "password1", role: "MEMBER" }))!.id;
});

describe("gestion des membres", () => {
  it("Désactiver : session de Bob supprimée, connexion refusée", async () => {
    const token = await login(bobId);
    await setDisabled(hh, adminId, bobId, true);
    expect(await findSession(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: bobId } })).toBe(0);
    expect(await checkCredentials("bob@x.fr", "password1")).toBeNull();
  });

  it("Désactivé : une session restante est refusée et purgée", async () => {
    const token = await login(bobId);
    await prisma.user.update({ where: { id: bobId }, data: { disabledAt: new Date() } });
    expect(await findSession(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: bobId } })).toBe(0);
  });

  it("Réactiver : connexion avec son mot de passe", async () => {
    await setDisabled(hh, adminId, bobId, true);
    await setDisabled(hh, adminId, bobId, false);
    expect(await checkCredentials("bob@x.fr", "password1")).not.toBeNull();
  });

  it("Dernier admin : se rétrograder ou être désactivé est refusé", async () => {
    const e = await setRole(hh, adminId, adminId, "MEMBER").catch((e) => e);
    expect(e).toBeInstanceOf(LedgerError);
    expect(e.message).toBe("The household must keep at least one active admin.");
    // Second admin désactivé : ne compte pas.
    const c = (await createMember(hh, { name: "C", email: "c@x.fr", password: "password1", role: "ADMIN" }))!.id;
    await setDisabled(hh, adminId, c, true);
    expect(await message(setRole(hh, adminId, adminId, "MEMBER"))).toBe("The household must keep at least one active admin.");
    // C réactivé : A peut se rétrograder ; C devient alors le dernier admin.
    await setDisabled(hh, adminId, c, false);
    await setRole(hh, adminId, adminId, "MEMBER");
    expect(await message(setRole(hh, c, c, "MEMBER"))).toBe("The household must keep at least one active admin.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).role).toBe("MEMBER");
  });

  it("Rétrograder soi-même autorisé s'il reste un autre admin actif", async () => {
    await setRole(hh, adminId, bobId, "ADMIN");
    await setRole(hh, adminId, adminId, "MEMBER");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).role).toBe("MEMBER");
  });

  it("Soi-même : désactiver son propre compte est refusé", async () => {
    await setRole(hh, adminId, bobId, "ADMIN"); // même avec un autre admin
    expect(await message(setDisabled(hh, adminId, adminId, true))).toBe("You cannot disable your own account.");
  });

  it("Concurrence : deux admins se rétrogradent l'un l'autre → une seule réussit", async () => {
    await setRole(hh, adminId, bobId, "ADMIN");
    const results = await Promise.allSettled([setRole(hh, adminId, bobId, "MEMBER"), setRole(hh, bobId, adminId, "MEMBER")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("The household must keep at least one active admin.");
    expect(await prisma.user.count({ where: { householdId: hh, role: "ADMIN", disabledAt: null } })).toBe(1);
  });

  it("Concurrence : désactivation et rétrogradation croisées → un admin actif reste", async () => {
    await setRole(hh, adminId, bobId, "ADMIN");
    await Promise.allSettled([setDisabled(hh, adminId, bobId, true), setRole(hh, bobId, adminId, "MEMBER")]);
    expect(await prisma.user.count({ where: { householdId: hh, role: "ADMIN", disabledAt: null } })).toBe(1);
  });

  it("Acteur qui n'est plus admin actif : aucune écriture", async () => {
    const c = (await createMember(hh, { name: "C", email: "c@x.fr", password: "password1", role: "ADMIN" }))!.id;
    await expect(setDisabled(hh, bobId, c, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setRole(hh, bobId, bobId, "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bobId } })).role).toBe("MEMBER");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c } })).disabledAt).toBeNull();
  });

  it("Mot de passe : changé, autres sessions supprimées, session courante conservée", async () => {
    const other = await login(bobId);
    const current = await login(bobId);
    await changePassword(bobId, "password1", "nouveau123");
    expect(await findSession(current)).not.toBeNull();
    expect(await findSession(other)).toBeNull();
    expect(await checkCredentials("bob@x.fr", "nouveau123")).not.toBeNull();
    expect(await checkCredentials("bob@x.fr", "password1")).toBeNull();
  });

  it("Mot de passe : actuel faux → erreur sur le champ, rien modifié", async () => {
    const e = await changePassword(bobId, "mauvais", "nouveau123").catch((e) => e);
    expect(e).toBeInstanceOf(LedgerError);
    expect(e.field).toBe("current");
    expect(await checkCredentials("bob@x.fr", "password1")).not.toBeNull();
  });

  it("Hors foyer : id inconnu → NotFoundError", async () => {
    await expect(setRole(hh, adminId, "inconnu", "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setDisabled(hh, adminId, "inconnu", true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setRole("autre-foyer", adminId, bobId, "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CLI reset-password", () => {
  const cli = (...args: string[]) =>
    execFileSync("node", ["scripts/reset-password.mjs", ...args], { env: process.env, encoding: "utf8", stdio: "pipe" });

  it("affiche un nouveau mot de passe, supprime les sessions, l'ancien est refusé", async () => {
    await login(bobId);
    await login(bobId);
    const out = cli("Bob@x.fr");
    const password = out.match(/: (\S+)\n/)![1];
    expect(await prisma.session.count({ where: { userId: bobId } })).toBe(0);
    expect(await checkCredentials("bob@x.fr", password)).not.toBeNull();
    expect(await checkCredentials("bob@x.fr", "password1")).toBeNull();
  });

  it("compte désactivé : non réactivé", async () => {
    await setDisabled(hh, adminId, bobId, true);
    cli("bob@x.fr");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bobId } })).disabledAt).not.toBeNull();
  });

  it("email inconnu → code de sortie ≠ 0, rien modifié", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: bobId } })).passwordHash;
    expect(() => cli("inconnu@x.fr")).toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bobId } })).passwordHash).toBe(before);
  });
});
