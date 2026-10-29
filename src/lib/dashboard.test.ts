import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { getBudget, parseMonth, savePlanned } from "./budget";
import { createCharge, payCharge, type ChargeInput } from "./charges";
import { getDashboard } from "./dashboard";
import { prisma } from "./db";
import { archiveAccount, createEntry, parseDay } from "./ledger";
import { createLoan } from "./loans";

let hh: string;
let user: string;
let courant: string;
let epargne: string;
const nov = parseMonth("2026-11")!;
const today = parseDay("2026-11-10")!;
const day = (s: string) => parseDay(s)!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
const charge = async (over: Partial<ChargeInput> = {}) =>
  createCharge(hh, { name: "Loyer", amount: 95000, dueDay: 5, accountId: courant, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, ...over });
const spend = async (cat: string, amount: number, accountId = courant) =>
  createEntry(hh, user, { accountId, kind: "EXPENSE", amount, occurredOn: day("2026-11-09"), note: null, categoryId: await byName(cat) });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
  courant = (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING", initialBalance: 100000 } })).id;
  epargne = (await prisma.account.create({ data: { householdId: hh, name: "Épargne", kind: "SAVINGS", initialBalance: 50000 } })).id;
});

describe("tableau de bord", () => {
  it("Soldes : global 1 500 €, compte archivé absent", async () => {
    const vieux = (await prisma.account.create({ data: { householdId: hh, name: "Vieux", kind: "CASH" } })).id;
    await archiveAccount(hh, vieux);
    const d = await getDashboard(hh, today);
    expect(d.total).toBe(150000);
    expect(d.accounts.map((a) => `${a.name}:${a.balance}`)).toEqual(["Courant:100000", "Épargne:50000"]);
  });

  it("À payer : 110 €, retard (Assurance) en tête, Internet à payer, Loyer payé absent", async () => {
    const loyer = await charge();
    await charge({ name: "Assurance", amount: 8000, dueDay: 8 });
    await charge({ name: "Internet", amount: 3000, dueDay: 20 });
    await payCharge(hh, user, loyer.id, nov, 95000, day("2026-11-05"));
    const d = await getDashboard(hh, today);
    expect(d.toPay).toBe(11000);
    expect(d.late).toEqual({ count: 1, amount: 8000 });
    expect(d.unpaid.map((c) => `${c.name}:${c.status}`)).toEqual(["Assurance:late", "Internet:due"]);
  });

  it("Crédit : échéance du mois non payée comptée (assurance incluse)", async () => {
    await createLoan(hh, {
      name: "Maison", accountId: courant, categoryId: await byName("Loyer"), firstDue: day("2026-11-15"),
      principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 1000,
    });
    const d = await getDashboard(hh, today);
    expect(d.toPay).toBe(46887 + 1000);
    expect(d.unpaid).toMatchObject([{ name: "Maison", status: "due" }]);
  });

  it("Disponible : Courses −50 € en tête, Transports 80 €, Loisirs absent ; reste à vivre = /budget", async () => {
    await savePlanned(hh, nov, new Map([[await byName("Courses"), 40000], [await byName("Transports"), 10000], [await byName("Loisirs"), null]]));
    await spend("Transports", 2000);
    await spend("Courses", 45000);
    const d = await getDashboard(hh, today);
    expect(d.categories.map((r) => `${r.label}:${r.available}`)).toEqual(["Courses:-5000", "Transports:8000"]);
    expect(d.restToLive).toBe((await getBudget(hh, nov)).totals.restToLive);
    expect(d.total).toBe(150000 - 47000);
  });

  it("Vide : foyer sans compte ni charge", async () => {
    await prisma.account.deleteMany({ where: { householdId: hh } });
    const d = await getDashboard(hh, today);
    expect(d).toMatchObject({ accounts: [], total: 0, unpaid: [], toPay: 0, late: { count: 0, amount: 0 } });
  });
});
