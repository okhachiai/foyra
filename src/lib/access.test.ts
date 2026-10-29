import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { fullScope, getAccess, getScope, READ_ONLY, setAccess, type Scope } from "./access";
import { createMember, setupHousehold } from "./auth";
import { getBudget, parseMonth } from "./budget";
import { getCalendar } from "./calendar";
import { createCharge, deleteCharge, getCharge, listMonthCharges, payCharge, updateCharge } from "./charges";
import { getDashboard } from "./dashboard";
import { prisma } from "./db";
import {
  accountBalance, archiveAccount, createAccount, createEntry, createTransfer, deleteTransaction, getAccount, getTransaction,
  householdTotal, listAccounts, NotFoundError, parseDay, updateAccount, updateEntry, writableAccounts,
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
const member = async () => getScope({ id: memberId, role: "MEMBER", householdId: hh });
const grant = (levels: Record<string, "READ" | "WRITE" | null>) => setAccess(hh, memberId, new Map(Object.entries(levels)));
const spend = async (scope: Scope, accountId: string, amount: number, cat = "Courses") =>
  createEntry(scope, adminId, { accountId, kind: "EXPENSE", amount, occurredOn: day("2026-11-09"), note: null, categoryId: await byName(cat) });
const charge = async (accountId: string) =>
  createCharge(admin, { name: "Loyer", amount: 95000, dueDay: 5, accountId, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null });
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
  it("Migration : chaque membre existant reçoit l'écriture sur chaque compte du foyer", async () => {
    expect(await prisma.accountAccess.count()).toBe(0); // nouveau membre : aucun accès
    const sql = readFileSync(new URL("../../prisma/migrations/20261101000000_account_access/migration.sql", import.meta.url), "utf8");
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf("INSERT INTO")));
    const s = await member();
    expect(s.write?.sort()).toEqual([courant, epargne].sort());
    expect(await prisma.accountAccess.count({ where: { userId: adminId } })).toBe(0);
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
    await expect(archiveAccount(s, courant)).rejects.toThrow(READ_ONLY);
    await expect(updateAccount(s, courant, { name: "X", kind: "CHECKING", initialBalance: 0 })).rejects.toThrow(READ_ONLY);
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
    const row = async (s: Scope) => (await getBudget(s, nov)).rows.find((r) => r.label === "Courses")!.actual;
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
    expect((await getBudget(s, nov)).totals).toMatchObject({ fixedTotal: 0, fixedRemaining: 0 });
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

  it("Nouveau compte : écriture pour le membre créateur, invisible pour les autres membres, visible pour l'admin", async () => {
    const other = (await createMember(hh, { name: "Autre", email: "o@test.fr", password: "password1", role: "MEMBER" }))!.id;
    const perso = await createAccount(await member(), memberId, { name: "Perso", kind: "CASH", initialBalance: 0 });
    expect((await member()).write).toEqual([perso.id]);
    const o = await getScope({ id: other, role: "MEMBER", householdId: hh });
    expect(await listAccounts(o)).toEqual([]);
    expect((await listAccounts(admin)).map((a) => a.name)).toContain("Perso");
  });

  it("Réglage admin : écriture → aucun accès ; réglage sur un admin ou hors foyer → introuvable", async () => {
    await grant({ [courant]: "WRITE" });
    expect((await listAccounts(await member())).map((a) => a.name)).toEqual(["Courant"]);
    await grant({ [courant]: null });
    expect(await listAccounts(await member())).toEqual([]);
    expect((await getAccess(hh, memberId)).accounts.map((a) => a.level)).toEqual([null, null]);
    await expect(setAccess(hh, adminId, new Map([[courant, "READ"]]))).rejects.toBeInstanceOf(NotFoundError);
    await expect(setAccess("autre-foyer", memberId, new Map([[courant, "READ"]]))).rejects.toBeInstanceOf(NotFoundError);
    expect((await getAccess(hh, adminId)).member.id).toBe(adminId); // la page membre charge tout utilisateur du foyer
    await expect(getAccess("autre-foyer", memberId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(grant({ inexistant: "READ" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
