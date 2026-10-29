import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { createBudget, parseMonth } from "./budget";
import { createCharge, payCharge, type ChargeInput } from "./charges";
import { buildCharts, getDashboard, type Flow } from "./dashboard";
import { fullScope } from "./access";
import { prisma } from "./db";
import { archiveAccount, createEntry, createTransfer, parseDay } from "./ledger";
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
  createCharge(fullScope(hh), { kind: "EXPENSE", active: true, name: "Loyer", amount: 95000, dueDay: 5, accountId: courant, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, ...over });
const spend = async (cat: string, amount: number, accountId = courant) =>
  createEntry(fullScope(hh), user, { accountId, kind: "EXPENSE", amount, occurredOn: day("2026-11-09"), note: null, categoryId: await byName(cat) });

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
    await archiveAccount(fullScope(hh), vieux);
    const d = await getDashboard(fullScope(hh), today);
    expect(d.total).toBe(150000);
    expect(d.accounts.map((a) => `${a.name}:${a.balance}`)).toEqual(["Courant:100000", "Épargne:50000"]);
  });

  it("À payer : 110 €, retard (Assurance) en tête, Internet à payer, Loyer payé absent", async () => {
    const loyer = await charge();
    await charge({ name: "Assurance", amount: 8000, dueDay: 8 });
    await charge({ name: "Internet", amount: 3000, dueDay: 20 });
    await payCharge(fullScope(hh), user, loyer.id, nov, 95000, day("2026-11-05"));
    const d = await getDashboard(fullScope(hh), today);
    expect(d.toPay).toBe(11000);
    expect(d.late).toEqual({ count: 1, amount: 8000 });
    expect(d.unpaid.map((c) => `${c.name}:${c.status}`)).toEqual(["Assurance:late", "Internet:due"]);
  });

  it("Crédit : échéance du mois non payée comptée (assurance incluse)", async () => {
    await createLoan(fullScope(hh), {
      name: "Maison", accountId: courant, categoryId: await byName("Loyer"), firstDue: day("2026-11-15"),
      principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 1000,
    });
    const d = await getDashboard(fullScope(hh), today);
    expect(d.toPay).toBe(46887 + 1000);
    expect(d.unpaid).toMatchObject([{ name: "Maison", status: "due" }]);
  });

  it("Mois : revenus et dépenses enregistrés, résultat ; virements et autres mois exclus", async () => {
    await createEntry(fullScope(hh), user, { accountId: courant, kind: "INCOME", amount: 250000, occurredOn: day("2026-11-02"), note: "Salaire", categoryId: await byName("Salaire 1") });
    await spend("Marché", 4500);
    await spend("Carburant", 6000);
    await createEntry(fullScope(hh), user, { accountId: courant, kind: "EXPENSE", amount: 99900, occurredOn: day("2026-10-31"), note: null, categoryId: null });
    await createTransfer(fullScope(hh), user, { fromAccountId: courant, toAccountId: epargne, amount: 30000, occurredOn: day("2026-11-05"), note: "Épargne" });
    const d = await getDashboard(fullScope(hh), today);
    expect(d).toMatchObject({ income: 250000, expense: 10500, result: 239500 });
    expect(d.total).toBe(150000 + 250000 - 10500 - 99900);
    // Dernières opérations : un virement n'apparaît qu'une fois.
    expect(d.recent.map((t) => `${t.kind}:${t.amount}`)).toEqual(["EXPENSE:6000", "EXPENSE:4500", "TRANSFER:30000", "INCOME:250000", "EXPENSE:99900"]);
  });

  it("Budget : rappel du prévu s'il existe, jamais créé par le tableau de bord", async () => {
    expect((await getDashboard(fullScope(hh), today)).budget).toBeNull();
    expect(await prisma.budget.count()).toBe(0);
    await createBudget(hh, nov);
    expect((await getDashboard(fullScope(hh), today)).budget).toMatchObject({ status: "DRAFT", totals: { income: 0, expense: 0, remaining: 0 } });
  });

  it("Vide : foyer sans compte ni charge", async () => {
    await prisma.account.deleteMany({ where: { householdId: hh } });
    const d = await getDashboard(fullScope(hh), today);
    expect(d).toMatchObject({ accounts: [], total: 0, income: 0, expense: 0, result: 0, recent: [], unpaid: [], toPay: 0, late: { count: 0, amount: 0 } });
  });
});

describe("graphiques du tableau de bord", () => {
  const f = (d: string, kind: Flow["kind"], amount: number, over: Partial<Flow> = {}): Flow =>
    ({ day: day(d).getTime(), kind, side: null, categoryId: "c1", archived: false, amount, ...over });
  const cats = [{ id: "p", name: "Logement", parentId: null }, { id: "c1", name: "Loyer", parentId: "p" }];

  it("solde, cumuls, catégories et saisonnalité", () => {
    const flows = [
      f("2026-11-02", "INCOME", 200000, { categoryId: null }),
      f("2026-11-05", "EXPENSE", 95000),
      f("2026-11-20", "EXPENSE", 1000, { categoryId: null }), // future : hors solde des jours passés
      f("2026-10-05", "EXPENSE", 90000),
      f("2025-03-01", "EXPENSE", 50000),
      f("2026-11-03", "TRANSFER", 7000, { side: "OUT", archived: true }), // compte archivé : hors courbe de solde
    ];
    const c = buildCharts(flows, cats, today, 300000);
    expect(c.balance.series.at(-1)).toMatchObject({ value: 301000 }); // 300 000 + dépense future de 1 000
    expect(c.balance.series[0].value).toBe(301000 - 200000 + 95000);
    expect(c.flows.income[0][0]).toBe(0);
    expect(c.flows.income[0][1]).toBe(200000);
    expect(c.flows.expense[0][30]).toBe(96000);
    expect(c.flows.expense[1][30]).toBe(90000);
    expect(c.categories.items.map((i) => `${i.name}/${i.group}:${i.values}`)).toEqual(["Loyer/p:95000,90000,185000", "Sans catégorie/none:1000,0,0"]);
    expect(c.categories.groups.map((g) => g.name)).toEqual(["Logement", "Sans catégorie"]);
    expect(c.categories.periods[0]).toMatchObject({ total: 96000, previous: 90000 });
    expect(c.seasons[0].values[10]).toBe(96000);
    expect(c.seasons[0].average).toBe(Math.round(186000 / 11));
    expect(c.seasons[1]).toMatchObject({ total: 50000, delta: null });
    expect(c.seasons[0].top).toEqual([{ label: "Loyer", value: 185000 }, { label: "Sans catégorie", value: 1000 }]);
  });
});
