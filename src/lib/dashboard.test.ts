import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { createBudget, parseMonth } from "./budget";
import { createCharge, payCharge, type ChargeInput } from "./charges";
import { buildCharts, getDashboard, getShell, spendingPlan, upcomingCharges, type Flow } from "./dashboard";
import { prisma } from "./db";
import { createEntry, parseDay } from "./ledger";
import { createLoan } from "./loans";

let hh: string;
let user: string;
const nov = parseMonth("2026-11")!;
const today = parseDay("2026-11-10")!;
const day = (s: string) => parseDay(s)!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
const charge = async (over: Partial<ChargeInput> = {}) =>
  createCharge(hh, { kind: "EXPENSE", active: true, name: "Loyer", dueDay: 5, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, shared: true, ...over });
/** Budget du mois : lignes de dépense (libellé = nom de la récurrence) dans la catégorie Loyer. */
const plan = async (lines: [string, number][], month = nov) => {
  const b = await createBudget(hh, month);
  const categoryId = await byName("Loyer");
  await prisma.budgetItem.deleteMany({ where: { budgetId: b.id } });
  await prisma.budgetItem.createMany({ data: lines.map(([label, amount]) => ({ householdId: hh, budgetId: b.id, kind: "EXPENSE" as const, label, amount, categoryId })) });
};
const spend = async (cat: string, amount: number) =>
  createEntry(hh, user, { paidById: user, kind: "EXPENSE", amount, occurredOn: day("2026-11-09"), note: null, categoryId: await byName(cat) });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("tableau de bord", () => {
  it("À payer : 110 €, retard (Assurance) en tête, Internet à payer, Loyer payé absent", async () => {
    await plan([["Loyer", 95000], ["Assurance", 8000], ["Internet", 3000]]);
    const loyer = await charge();
    await charge({ name: "Assurance", dueDay: 8 });
    await charge({ name: "Internet", dueDay: 20 });
    await payCharge(hh, user, loyer.id, nov, 95000, day("2026-11-05"));
    const d = await getDashboard(hh, today);
    expect(d.toPay).toBe(11000);
    expect(d.late).toEqual({ count: 1, amount: 8000 });
    expect(d.unpaid.map((c) => `${c.name}:${c.status}`)).toEqual(["Assurance:late", "Internet:due"]);
  });

  it("Montants lus dans le budget du mois, jamais dans la récurrence ; sans ligne : 0, « absente du budget »", async () => {
    await charge();
    await charge({ name: "Assurance", dueDay: 20 });
    expect((await getDashboard(hh, today)).unpaid.map((c) => `${c.name}:${c.amount}:${c.budgeted}`)).toEqual(["Loyer:0:false", "Assurance:0:false"]);
    await plan([["Loyer", 90000]]);
    const d = await getDashboard(hh, today);
    // Deux récurrences dans la même catégorie : le libellé départage, sinon première ligne de la catégorie.
    expect(d.unpaid.map((c) => `${c.name}:${c.amount}:${c.budgeted}`)).toEqual(["Loyer:90000:true", "Assurance:90000:true"]);
  });

  it("Crédit : échéance du mois non payée comptée (assurance incluse)", async () => {
    await createLoan(hh, {
      name: "Maison", categoryId: await byName("Loyer"), firstDue: day("2026-11-15"),
      principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 1000,
    });
    const d = await getDashboard(hh, today);
    expect(d.toPay).toBe(46887 + 1000);
    expect(d.unpaid).toMatchObject([{ name: "Maison", status: "due" }]);
  });

  it("Mois : revenus du budget, dépenses enregistrées, résultat, net des opérations ; autres mois exclus", async () => {
    await createEntry(hh, user, { paidById: user, kind: "INCOME", amount: 250000, occurredOn: day("2026-11-02"), note: "Salaire", categoryId: await byName("Salaire 1") });
    await spend("Marché", 4500);
    await spend("Carburant", 6000);
    await createEntry(hh, user, { paidById: user, kind: "EXPENSE", amount: 99900, occurredOn: day("2026-10-31"), note: null, categoryId: null });
    expect((await getDashboard(hh, today)).income).toBe(0); // sans budget : opération de revenu ignorée
    await createBudget(hh, nov, [{ label: "Salaire", amount: 300000, categoryId: null }]);
    const d = await getDashboard(hh, today);
    expect(d).toMatchObject({ income: 300000, expense: 10500, result: 289500, net: 250000 - 10500 });
    expect(d.recent.map((t) => `${t.kind}:${t.amount}`)).toEqual(["EXPENSE:6000", "EXPENSE:4500", "INCOME:250000", "EXPENSE:99900"]);
  });

  it("Budget : rappel du prévu s'il existe, jamais créé par le tableau de bord", async () => {
    expect((await getDashboard(hh, today)).budget).toBeNull();
    expect(await prisma.budget.count()).toBe(0);
    await createBudget(hh, nov);
    expect((await getDashboard(hh, today)).budget).toMatchObject({ status: "DRAFT", totals: { income: 0, expense: 0, remaining: 0 } });
  });

  it("Vide : foyer sans opération ni charge", async () => {
    const d = await getDashboard(hh, today);
    expect(d).toMatchObject({ net: 0, income: 0, expense: 0, result: 0, recent: [], unpaid: [], toPay: 0, late: { count: 0, amount: 0 } });
  });
});

describe("graphiques du tableau de bord", () => {
  const f = (d: string, kind: Flow["kind"], amount: number, over: Partial<Flow> = {}): Flow =>
    ({ day: day(d).getTime(), kind, categoryId: "c1", amount, ...over });
  const cats = [{ id: "p", name: "Logement", parentId: null }, { id: "c1", name: "Loyer", parentId: "p" }];

  it("cumuls, catégories et saisonnalité", () => {
    const flows = [
      f("2026-11-02", "INCOME", 200000, { categoryId: null }),
      f("2026-11-05", "EXPENSE", 95000),
      f("2026-11-20", "EXPENSE", 1000, { categoryId: null }),
      f("2026-10-05", "EXPENSE", 90000),
      f("2025-03-01", "EXPENSE", 50000),
    ];
    const c = buildCharts(flows, cats, today);
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
    // Mois : douze derniers, novembre en dernier, égal aux cumuls de fin de mois.
    expect(c.monthly.labels).toHaveLength(12);
    expect(c.monthly.labels.at(-1)).toBe("nov.");
    expect(c.monthly.income.at(-1)).toBe(c.flows.income[0][30]);
    expect(c.monthly.expense.slice(-2)).toEqual([90000, 96000]);
    expect(c.monthly.expense.slice(0, 10).every((v) => v === 0)).toBe(true);
  });

});

describe("plan de dépenses", () => {
  const node = (id: string, kind: "INCOME" | "EXPENSE", total: number, actual: number, over: object = {}) =>
    ({ id, label: id, kind, total, actual, included: true, category: { fixed: false }, children: [], ...over }) as unknown as Parameters<typeof spendingPlan>[0][number];

  it("lignes de dépense incluses hors épargne, par prévu décroissant ; totaux de ces lignes", () => {
    const p = spendingPlan([
      node("Revenu", "INCOME", 300000, 300000),
      node("Courses", "EXPENSE", 70000, 62000),
      node("Loyer", "EXPENSE", 140000, 130000, { category: { fixed: true } }),
      node("Livret", "EXPENSE", 50000, 50000, { category: { fixed: true, savings: true } }),
      node("Exclue", "EXPENSE", 10000, 0, { included: false }),
      node("Loisirs", "EXPENSE", 10000, 15000),
    ]);
    expect(p.lines.map((l) => `${l.label}:${l.left}`)).toEqual(["Loyer:10000", "Courses:8000", "Loisirs:-5000"]);
    expect(p).toMatchObject({ planned: 220000, actual: 207000, left: 13000 });
  });
});

describe("barre latérale", () => {
  it("sans budget : pas de plan ; échéances non payées comptées", async () => {
    await charge();
    await charge({ name: "Internet", dueDay: 12 });
    const s = await getShell(hh, today);
    expect(s.plan).toBeNull();
    expect(s.due).toBe(2);
  });
  it("avec budget : plan des lignes de dépense", async () => {
    await plan([["Loyer", 90000]]);
    // Ligne commune : seul le réel commun compte (logique de getBudget).
    await createEntry(hh, user, { paidById: user, kind: "EXPENSE", amount: 30000, occurredOn: day("2026-11-09"), note: null, categoryId: await byName("Loyer"), shared: true });
    await spend("Loyer", 5000);
    const s = await getShell(hh, today);
    expect(s.plan).toMatchObject({ planned: 90000, actual: 30000, left: 60000 });
  });
});

describe("échéances du tableau de bord", () => {
  it("retards, puis à payer, puis payées ; dépenses seules ; tronqué", () => {
    const c = (name: string, due: string, paid = false, kind = "EXPENSE") => ({ name, kind, due: day(due), payment: paid ? {} : null });
    const list = [c("Payée", "2026-11-01", true), c("Plus tard", "2026-11-20"), c("Retard", "2026-11-05"), c("Bientôt", "2026-11-12"), c("Salaire", "2026-11-01", false, "INCOME")];
    expect(upcomingCharges(list, today).map((x) => [x.name, x.status])).toEqual([["Retard", "late"], ["Bientôt", "due"], ["Plus tard", "due"], ["Payée", "paid"]]);
    expect(upcomingCharges(list, today, 2)).toHaveLength(2);
  });
});
