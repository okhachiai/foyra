import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { fullScope, getScope, getSharing, NOT_MANAGER, READ_ONLY, setAccess, setSharing, type Scope } from "./access";
import { createMember, setupHousehold } from "./auth";
import { createBudget, getBudget, parseMonth } from "./budget";
import { getCalendar } from "./calendar";
import { createCharge, deleteCharge, getCharge, listMonthCharges, payCharge, updateCharge } from "./charges";
import { getDashboard } from "./dashboard";
import { prisma } from "./db";
import {
  accountBalance, archiveAccount, createAccount, createEntry, createTransfer, deleteTransaction, getAccount, getTransaction,
  householdTotal, LedgerError, listAccounts, NotFoundError, parseDay, unarchiveAccount, updateAccount, updateEntry, writableAccounts,
} from "./ledger";
import { createLoan, deleteLoan, getLoan, listLoans, prepay } from "./loans";

let hh: string;
let admin: Scope;
let adminId: string;
let memberId: string;
let courant: string;
let epargne: string;
const nov = parseMonth("2026-11")!;
const today = parseDay("2026-11-10")!;
const day = (s: string) => parseDay(s)!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
const member = async () => getScope({ id: memberId, householdId: hh });
const grant = (levels: Record<string, "READ" | "WRITE" | null>) => setAccess(hh, memberId, new Map(Object.entries(levels)));
// Dépense commune (comptes personnels de l'admin) : comptée sur les lignes communes du budget.
const spend = async (scope: Scope, accountId: string, amount: number, cat = "Supermarché") =>
  createEntry(scope, adminId, { accountId, kind: "EXPENSE", amount, occurredOn: day("2026-11-09"), note: null, categoryId: await byName(cat), shared: true });
const charge = async (accountId: string) =>
  createCharge(admin, { kind: "EXPENSE", active: true, name: "Loyer", amount: 95000, dueDay: 5, accountId, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, shared: true });
const loan = async (accountId: string) =>
  createLoan(admin, {
    name: "Maison", accountId, categoryId: await byName("Loyer"), firstDue: day("2026-11-15"),
    principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 0,
  });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const a = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = a.householdId;
  adminId = a.id;
  admin = fullScope(hh);
  memberId = (await createMember(hh, { name: "Membre", email: "m@test.fr", password: "password1", role: "MEMBER" }))!.id;
  courant = (await createAccount(admin, adminId, { name: "Courant", kind: "CHECKING", initialBalance: 100000 })).id;
  epargne = (await createAccount(admin, adminId, { name: "Épargne", kind: "SAVINGS", initialBalance: 50000 })).id;
});

describe("accès par compte", () => {
  it("Admin : portée complète, même sur un compte privé d'un membre", async () => {
    const privé = await createAccount(await member(), memberId, { name: "Privé", kind: "CHECKING", initialBalance: 0, sharing: "SELECTED" });
    const s = await getScope({ id: adminId, householdId: hh, role: "ADMIN" });
    expect([s.read, s.write, s.manage]).toEqual([null, null, null]);
    await expect(getAccount(s, privé.id)).resolves.toBeTruthy();
  });

  it("Migration : chaque membre existant reçoit l'écriture sur chaque compte du foyer", async () => {
    expect(await prisma.accountAccess.count({ where: { userId: memberId } })).toBe(0); // nouveau membre : aucun accès
    const sql = readFileSync(new URL("../../prisma/migrations/20261101000000_account_access/migration.sql", import.meta.url), "utf8");
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf("INSERT INTO")));
    const s = await member();
    expect(s.write?.sort()).toEqual([courant, epargne].sort());
    expect((await prisma.accountAccess.findMany({ where: { userId: adminId } })).map((a) => a.level)).toEqual(["MANAGE", "MANAGE"]); // créateur
    expect(await householdTotal(s)).toBe(150000);
  });

  it("Aucun accès : Épargne absente partout, accès direct introuvable", async () => {
    await grant({ [courant]: "WRITE" });
    const t = await spend(admin, epargne, 1000);
    const s = await member();
    expect((await listAccounts(s)).map((a) => a.name)).toEqual(["Courant"]);
    expect(await householdTotal(s)).toBe(100000);
    expect((await getDashboard(s, today)).accounts.map((a) => a.name)).toEqual(["Courant"]);
    expect((await getCalendar(s, nov, today)).forecast?.map((a) => a.name)).toEqual(["Courant"]);
    await expect(getAccount(s, epargne)).rejects.toBeInstanceOf(NotFoundError);
    await expect(accountBalance(s, epargne)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTransaction(s, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTransaction(s, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(spend(s, epargne, 100)).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveAccount(s, epargne)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Lecture : compte visible, toute écriture refusée en lecture seule", async () => {
    await grant({ [courant]: "READ" });
    const t = await spend(admin, courant, 1000);
    const s = await member();
    expect(await accountBalance(s, courant)).toBe(99000);
    expect((await getTransaction(s, t.id)).id).toBe(t.id);
    expect(await writableAccounts(s)).toEqual([]);
    const input = { accountId: courant, kind: "EXPENSE" as const, amount: 500, occurredOn: day("2026-11-09"), note: null, categoryId: null };
    await expect(createEntry(s, memberId, input)).rejects.toThrow(READ_ONLY);
    await expect(updateEntry(s, t.id, input)).rejects.toThrow(READ_ONLY);
    await expect(deleteTransaction(s, t.id)).rejects.toThrow(READ_ONLY);
    await expect(archiveAccount(s, courant)).rejects.toThrow(NOT_MANAGER);
    await expect(updateAccount(s, courant, { name: "X", kind: "CHECKING" }, nov)).rejects.toThrow(NOT_MANAGER);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("Virement : écriture Courant, lecture Épargne → refusé sur le champ du compte cible", async () => {
    await grant({ [courant]: "WRITE", [epargne]: "READ" });
    const s = await member();
    await expect(createTransfer(s, memberId, { fromAccountId: courant, toAccountId: epargne, amount: 100, occurredOn: today, note: null }))
      .rejects.toMatchObject({ message: READ_ONLY, field: "toAccountId" });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Déplacer une opération vers un compte sans accès → introuvable", async () => {
    await grant({ [courant]: "WRITE" });
    const s = await member();
    const t = await spend(s, courant, 1000);
    await expect(updateEntry(s, t.id, { accountId: epargne, kind: "EXPENSE", amount: 1000, occurredOn: t.occurredOn, note: null, categoryId: null }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).accountId).toBe(courant);
  });

  it("Budget : effectué de la catégorie = comptes lisibles seulement (50 € membre, 130 € admin)", async () => {
    await grant({ [courant]: "READ" });
    await spend(admin, courant, 5000);
    await spend(admin, epargne, 8000);
    await createBudget(hh, nov);
    const row = async (s: Scope) => (await getBudget(s, nov))!.tree.flatMap((n) => [n, ...n.children]).find((r) => r.label === "Supermarché")!.actual;
    expect(await row(await member())).toBe(5000);
    expect(await row(admin)).toBe(13000);
  });

  it("Charges / crédits sur un compte illisible : absents partout, introuvables", async () => {
    await grant({ [courant]: "WRITE" });
    const c = await charge(epargne);
    const l = await loan(epargne);
    const s = await member();
    expect(await listMonthCharges(s, nov)).toEqual([]);
    expect(await listLoans(s, today)).toEqual([]);
    const cal = await getCalendar(s, nov, today);
    expect([cal.days, cal.upcoming]).toEqual([[], []]);
    expect(await getDashboard(s, today)).toMatchObject({ unpaid: [], toPay: 0 });
    await expect(getCharge(s, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLoan(s, l.id, today)).rejects.toBeInstanceOf(NotFoundError);
    await expect(payCharge(s, memberId, c.id, nov, 95000, day("2026-11-05"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(prepay(s, memberId, l.id, 1000, today, "REDUCE_TERM")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCharge(s, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteLoan(s, l.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMonthCharges(admin, nov)).toHaveLength(2);
  });

  it("Charge en lecture : visible, paiement et modification refusés", async () => {
    await grant({ [courant]: "READ" });
    const c = await charge(courant);
    const s = await member();
    expect((await listMonthCharges(s, nov)).map((x) => x.name)).toEqual(["Loyer"]);
    await expect(payCharge(s, memberId, c.id, nov, 95000, day("2026-11-05"))).rejects.toThrow(READ_ONLY);
    await expect(updateCharge(s, c.id, { ...c, name: "X" })).rejects.toThrow(READ_ONLY);
    await expect(deleteCharge(s, c.id)).rejects.toThrow(READ_ONLY);
  });

  it("Calendrier : virement vers un compte non lisible affiché une fois, compte d'en face masqué", async () => {
    await grant({ [epargne]: "READ" });
    await createTransfer(admin, adminId, { fromAccountId: courant, toAccountId: epargne, amount: 1000, occurredOn: day("2026-11-09"), note: null });
    const [d] = (await getCalendar(await member(), nov, today)).days;
    expect(d.transactions).toMatchObject([{ transferSide: "IN", accountId: epargne, otherAccount: null }]);
  });

  it("Nouveau compte privé : gestion pour le créateur, invisible pour les autres membres ET pour l'admin", async () => {
    const other = (await createMember(hh, { name: "Autre", email: "o@test.fr", password: "password1", role: "MEMBER" }))!.id;
    const perso = await createAccount(await member(), memberId, { name: "Perso", kind: "CASH", initialBalance: 0 });
    expect(await member()).toMatchObject({ read: [perso.id], write: [perso.id], manage: [perso.id] });
    expect(await listAccounts(await getScope({ id: other, householdId: hh }))).toEqual([]);
    const adminScope = await getScope({ id: adminId, householdId: hh });
    expect((await listAccounts(adminScope)).map((a) => a.name)).toEqual(["Courant", "Épargne"]);
    await expect(getAccount(adminScope, perso.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(spend(adminScope, perso.id, 100)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Partage « tout le foyer » : écriture pour chacun ; gestion réservée aux gestionnaires", async () => {
    const adminScope = await getScope({ id: adminId, householdId: hh });
    await setSharing(adminScope, adminId, courant, "HOUSEHOLD", new Map());
    const s = await member();
    expect(s).toMatchObject({ read: [courant], write: [courant], manage: [] });
    await spend(s, courant, 1000);
    await expect(archiveAccount(s, courant)).rejects.toThrow(NOT_MANAGER);
    await expect(setSharing(s, memberId, courant, "SELECTED", new Map())).rejects.toThrow(NOT_MANAGER);
    await expect(getSharing(s, courant)).rejects.toThrow(NOT_MANAGER);
    // Retour aux membres sélectionnés : le membre perd l'accès, l'admin gestionnaire le garde.
    await setSharing(adminScope, adminId, courant, "SELECTED", new Map());
    expect((await member()).read).toEqual([]);
  });

  it("Partage sélectionné : niveaux explicites ; le gestionnaire ne peut pas se retirer la gestion", async () => {
    const adminScope = await getScope({ id: adminId, householdId: hh });
    await setSharing(adminScope, adminId, epargne, "SELECTED", new Map([[memberId, "MANAGE"], [adminId, null]]));
    expect((await member()).manage).toEqual([epargne]);
    expect((await getScope({ id: adminId, householdId: hh })).manage).toContain(epargne);
    const { users } = await getSharing(await member(), epargne);
    expect(users.map((u) => u.level)).toEqual(["MANAGE", "MANAGE"]);
    await expect(setSharing(adminScope, adminId, epargne, "SELECTED", new Map([["inconnu", "READ"]]))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Archivage / réactivation par un gestionnaire, historique conservé", async () => {
    const t = await spend(admin, courant, 100000); // solde 0
    const adminScope = await getScope({ id: adminId, householdId: hh });
    await archiveAccount(adminScope, courant);
    await expect(spend(adminScope, courant, 1)).rejects.toBeInstanceOf(LedgerError);
    expect((await getTransaction(adminScope, t.id)).id).toBe(t.id);
    await unarchiveAccount(adminScope, courant);
    expect((await getAccount(adminScope, courant)).archivedAt).toBeNull();
  });

  it("Accès bas niveau : utilisateur ou compte hors foyer → introuvable", async () => {
    await grant({ [courant]: "WRITE" });
    expect((await listAccounts(await member())).map((a) => a.name)).toEqual(["Courant"]);
    await grant({ [courant]: null });
    expect(await listAccounts(await member())).toEqual([]);
    await expect(setAccess("autre-foyer", memberId, new Map([[courant, "READ"]]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(grant({ inexistant: "READ" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
