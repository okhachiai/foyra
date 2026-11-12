import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth, removeItem, saveItems, setBudgetStatus } from "./budget";
import { createCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, LedgerError, NotFoundError, parseDay } from "./ledger";
import { complete, LlmError } from "./llm";
import {
  applyPlan, undoPlan, requestReport, processNextReport, retryReport, getReport, generateAutoReports, generateReport, listReports, renderReferences, outputSchema, pace, toEuros, validateOutput,
  type DailyInput, type DailyOutput, type MonthlyInput, type PlanInput, type PlanOutput,
} from "./report";

vi.mock("./llm", async (real) => ({ ...(await real<typeof import("./llm")>()), complete: vi.fn() }));
const llm = vi.mocked(complete);

describe("pace", () => {
  it("attendu au prorata, projection, montant par jour restant, statut", () => {
    expect(pace(30000, 10000, 10, 30)).toEqual({ expected: 10000, projected: 30000, perDay: 952, status: "ok" });
    expect(pace(30000, 14000, 10, 30).status).toBe("fast"); // > 10 000 + 3 000
    expect(pace(30000, 12000, 10, 30).status).toBe("ok"); // dans la tolérance
    expect(pace(30000, 31000, 10, 30)).toMatchObject({ status: "over", perDay: 0 });
    expect(pace(30000, 0, 30, 30).perDay).toBe(30000); // dernier jour : tout le reste
  });
});

const PLAN: PlanInput = {
  month: "2026-11", income: 300000, fixed: 150000, savings: 50000, toDistribute: 100000,
  lines: [
    { id: "a", label: "Courses", planned: 0, history: [50000, 52000, 48000], reserve: false },
    { id: "b", label: "Loisirs", planned: 0, history: [0, 0, 0], reserve: false },
    { id: "r", label: "Réserve", planned: 0, history: [0, 0, 0], reserve: true },
  ],
};
const lines = (...l: [string, number][]) => JSON.stringify({ lines: l.map(([budgetItemId, amount]) => ({ budgetItemId, amount, reason: "x" })), advice: "ok" });
const planOf = (text: string) => {
  const r = validateOutput("PLAN", PLAN, text);
  if (!r.ok) throw new Error(r.error);
  return (r.output as PlanOutput).lines.map((l) => [l.budgetItemId, l.amount]);
};

describe("validateOutput", () => {
  it("DAILY / MONTHLY : textes seuls, schéma strict", () => {
    const ok: DailyOutput = { summary: "s", alerts: [], advice: ["a"] };
    const input = {} as DailyInput;
    expect(validateOutput("DAILY", input, JSON.stringify(ok))).toEqual({ ok: true, output: ok });
    expect(validateOutput("DAILY", input, "Voici :\n```json\n" + JSON.stringify(ok) + "\n```")).toEqual({ ok: true, output: ok });
    expect(validateOutput("DAILY", input, JSON.stringify({ ...ok, extra: 1 })).ok).toBe(false);
    expect(validateOutput("DAILY", input, "pas du json")).toEqual({ ok: false, error: "Response is not JSON." });
    expect(validateOutput("MONTHLY", {} as MonthlyInput, JSON.stringify(ok)).ok).toBe(false);
    expect(validateOutput("MONTHLY", {} as MonthlyInput, JSON.stringify({ verdict: "v", respected: [], mistakes: ["m"], advice: [] })).ok).toBe(true);
  });

  it("PLAN : euros → centimes, ordre de l'entrée, toutes les lignes requises", () => {
    expect(planOf(lines(["r", 100], ["a", 900], ["b", 0]))).toEqual([["a", 90000], ["b", 0], ["r", 10000]]);
  });

  it("PLAN : rejette les répartitions incomplètes, vides ou dont la somme est incorrecte", () => {
    for (const text of [lines(), lines(["a", 1000]), lines(["a", 500], ["b", 100], ["r", 100]), lines(["a", 900], ["b", 200], ["r", 50]), lines(["a", 1e308], ["b", 0], ["r", 0])]) expect(validateOutput("PLAN", PLAN, text).ok).toBe(false);
    expect(planOf(lines(["a", 899.99], ["b", 0.01], ["r", 100]))).toEqual([["a", 89999], ["b", 1], ["r", 10000]]);
  });

  it("refuse les chiffres inventés et les références inexistantes ; rend les montants vérifiés", () => {
    const input = { planned: { income: 123456 } } as DailyInput;
    for (const summary of ["Vous avez 999999 euros.", "Vous avez {{planned.fake}}.", "الرصيد ٩٩٩٩."]) expect(validateOutput("DAILY", input, JSON.stringify({ summary, alerts: [], advice: [] })).ok).toBe(false);
    const output = { summary: "Revenu : {{planned.income}}.", alerts: [], advice: [] };
    expect(validateOutput("DAILY", input, JSON.stringify(output)).ok).toBe(true);
    expect((renderReferences(input, output, "fr") as DailyOutput).summary).toContain("1 234,56");
  });

  it("PLAN : ligne inconnue, en double, montant négatif refusés", () => {
    expect(validateOutput("PLAN", PLAN, lines(["zz", 1000]))).toEqual({ ok: false, error: "Unknown line: zz." });
    expect(validateOutput("PLAN", PLAN, lines(["a", 500], ["a", 500])).ok).toBe(false);
    expect(validateOutput("PLAN", PLAN, lines(["a", -5])).ok).toBe(false);
  });

  it("schéma PLAN : ids restreints aux lignes reçues", () => {
    expect(outputSchema("PLAN", PLAN)).toMatchObject({ properties: { lines: { items: { properties: { budgetItemId: { enum: ["a", "b", "r"] } } } } } });
  });

  it("toEuros : montants en euros, compteurs et jours inchangés", () => {
    const sent = JSON.parse(toEuros({ ...PLAN, lines: [PLAN.lines[0]] }));
    expect(sent).toMatchObject({ income: 3000, toDistribute: 1000, lines: [{ planned: 0, history: [500, 520, 480] }] });
    expect(JSON.parse(toEuros({ day: 10, daysInMonth: 30, uncategorized: { count: 3, amount: 1250 } } as DailyInput))).toEqual({ day: 10, daysInMonth: 30, uncategorized: { count: 3, amount: 12.5 } });
  });
});

const nov = parseMonth("2026-11")!;
const oct = parseMonth("2026-10")!;
const day = (s: string) => parseDay(s)!;
const today = day("2026-11-10");

beforeEach(async () => {
  vi.stubEnv("CRON_TOKEN", "test-worker-token");
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
});
afterEach(() => {
  llm.mockReset();
  vi.unstubAllEnvs();
});

/** Foyer : Alice (admin), Bob ; budget du mois `month` vidé, avec les lignes données (catégories créées par addItem). */
async function household(month = nov) {
  const admin = (await setupHousehold({ householdName: "Test", name: "Alice", email: "alice@test.fr", password: "password1" }))!;
  const hh = admin.householdId;
  const bob = { ...(await createMember(hh, { name: "Bob", email: "bob@test.fr", password: "password1", role: "MEMBER" }))!, householdId: hh };
  const budget = await createBudget(hh, month);
  await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
  const item = (kind: "INCOME" | "EXPENSE", label: string, amount: number, extra: { parentId?: string; reserve?: boolean } = {}) =>
    addItem(hh, budget.id, { kind, parentId: extra.parentId ?? null, label, amount, included: true, recurring: true, shared: true, reserve: extra.reserve ?? false });
  const spend = (categoryId: string | null, amount: number, on = "2026-11-10", note: string | null = null) =>
    createEntry(hh, admin.id, { paidById: admin.id, kind: "EXPENSE", amount, occurredOn: day(on), note, categoryId, shared: true });
  const fixedCat = async (label: string) => {
    const it = await item("EXPENSE", label, 0);
    await prisma.category.update({ where: { id: it.categoryId! }, data: { fixed: true } });
    return it;
  };
  return { admin, bob, hh, budget, item, spend, fixedCat };
}

const reply = (o: object | string) => llm.mockResolvedValueOnce({ model: "m1", text: typeof o === "string" ? o : JSON.stringify(o) });
const DAILY_OK: DailyOutput = { summary: "Ça va.", alerts: [], advice: [] };
const MONTHLY_OK = { verdict: "v", respected: [], mistakes: [], advice: [] };

describe("rapport du jour", () => {
  it("sans budget du mois : rejet, rien de stocké", async () => {
    const { admin } = await household(oct);
    await expect(generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).rejects.toThrow("No budget for this month.");
    expect(llm).not.toHaveBeenCalled();
  });

  it("enveloppes variables et rythme, opérations du jour, sans catégorie, charges à venir ; aucun e-mail envoyé", async () => {
    const { admin, hh, item, spend, fixedCat } = await household();
    await item("INCOME", "Salaire", 300000);
    const courses = await item("EXPENSE", "Courses", 30000);
    const loyer = await fixedCat("Rent");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 90000 } });
    await createCharge(hh, { active: true, name: "Rent", dueDay: 25, categoryId: loyer.categoryId!, startMonth: nov, endMonth: null, shared: true });
    await spend(courses.categoryId, 14000, "2026-11-05");
    await spend(courses.categoryId, 2500, "2026-11-10", "Market");
    await spend(null, 700, "2026-11-03");
    reply(DAILY_OK);

    const r = await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    expect(r).toMatchObject({ kind: "DAILY", trigger: "MANUAL", userId: admin.id, output: DAILY_OK, error: null });
    const input = r.input as DailyInput;
    expect(input).toMatchObject({ today: "2026-11-10", day: 10, daysInMonth: 30, uncategorized: { count: 1, amount: 700 } });
    expect(input.lines).toEqual([{ label: "Courses", planned: 30000, actual: 16500, expected: 10000, projected: 49500, perDay: 642, status: "fast" }]);
    expect(input.todayOps).toEqual([{ label: "Market", category: "Courses", amount: 2500, kind: "EXPENSE", paidBy: "Alice" }]);
    expect(input.upcoming).toEqual([{ name: "Rent", amount: 90000, due: "2026-11-25" }]);
    expect(input.planned).toMatchObject({ income: 300000, fixed: 90000, variable: 30000 });
    const sent = llm.mock.calls[0][2].user;
    expect(sent).not.toContain("Market");
    expect(sent).not.toContain("Alice");
    expect(sent).toContain('"planned":300'); // euros
    for (const e of ["alice@test.fr", "bob@test.fr"]) expect(sent).not.toContain(e);
  });

  it("invalide puis valide : relance avec l'erreur ; invalide deux fois : erreur stockée", async () => {
    const { admin } = await household();
    reply("pas du json");
    reply(DAILY_OK);
    const r = await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    expect(llm.mock.calls[1][2].retry).toEqual({ previous: "pas du json", error: "Response is not JSON." });
    expect(r.output).toEqual(DAILY_OK);
    reply("x");
    reply({ summary: 1 });
    expect(await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).toMatchObject({ output: null, error: "The model could not produce a reliable report. Try another model or review the budget." });
  });

  it("erreur du fournisseur : rapport en erreur sans relance ; aucun fournisseur : rejet", async () => {
    const { admin } = await household();
    llm.mockRejectedValueOnce(new LlmError("Fournisseur LLM injoignable"));
    expect(await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).toMatchObject({ output: null, error: "Fournisseur LLM injoignable" });
    expect(llm).toHaveBeenCalledTimes(1);
    await expect(generateReport(admin, "DAILY", today, "MANUAL")).rejects.toThrow(new LedgerError("No LLM provider configured."));
  });
});

describe("bilan du mois", () => {
  it("mois écoulé : prévu contre réel par ligne, hors budget", async () => {
    const { admin, hh, item, spend } = await household(oct);
    await item("INCOME", "Salaire", 300000);
    const courses = await item("EXPENSE", "Courses", 40000);
    await spend(courses.categoryId, 45000, "2026-10-12");
    const autre = await prisma.category.create({ data: { householdId: hh, kind: "EXPENSE", name: "Divers" } });
    await spend(autre.id, 3000, "2026-10-20");
    await spend(courses.categoryId, 999, "2026-11-02"); // novembre : hors bilan
    reply(MONTHLY_OK);

    const r = await generateReport(admin, "MONTHLY", day("2026-11-01"), "MANUAL", { provider: "CLAUDE" });
    const input = r.input as MonthlyInput;
    expect(input.month).toBe("2026-10");
    expect(input.lines).toEqual([
      { label: "Salaire", group: "income", planned: 300000, actual: 0, diff: -300000 },
      { label: "Courses", group: "variable", planned: 40000, actual: 45000, diff: 5000 },
    ]);
    expect(input.offBudget).toBe(3000);
    expect(input.actual).toMatchObject({ variable: 48000 });
  });
});

describe("préparation du budget", () => {
  it("reste à répartir, historique des 3 mois précédents (sous-lignes à plat), application au budget", async () => {
    const { admin, bob, hh, budget, item, spend, fixedCat } = await household();
    await item("INCOME", "Salaire", 300000);
    const loyer = await fixedCat("Rent");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 150000 } });
    const courses = await item("EXPENSE", "Courses", 0);
    const loisirs = await item("EXPENSE", "Loisirs", 0);
    const cine = await item("EXPENSE", "Cinéma", 0, { parentId: loisirs.id });
    const reserve = await item("EXPENSE", "Réserve", 0, { reserve: true });
    await spend(courses.categoryId, 50000, "2026-08-10");
    await spend(courses.categoryId, 48000, "2026-10-10");
    await spend(cine.categoryId, 2000, "2026-09-03");
    await spend(courses.categoryId, 1000, "2026-07-31"); // hors des 3 mois
    reply(lines([courses.id, 600], [cine.id, 50], [reserve.id, 850]));

    const r = await generateReport(admin, "PLAN", today, "MANUAL", { provider: "CLAUDE", month: nov });
    expect(r).toMatchObject({ kind: "PLAN", budgetId: budget.id, error: null });
    const input = r.input as PlanInput;
    expect(input).toMatchObject({ month: "2026-11", income: 300000, fixed: 150000, savings: 0, toDistribute: 150000 });
    expect(input.lines).toEqual([
      { id: courses.id, label: "Courses", planned: 0, history: [50000, 0, 48000], reserve: false },
      { id: cine.id, label: "Loisirs › Cinéma", planned: 0, history: [0, 2000, 0], reserve: false },
      { id: reserve.id, label: "Réserve", planned: 0, history: [0, 0, 0], reserve: true },
    ]);
    expect((r.output as PlanOutput).lines.map((l) => l.amount)).toEqual([60000, 5000, 85000]);

    await expect(applyPlan(bob, r.id)).rejects.toThrow(NotFoundError);
    expect(await applyPlan(admin, r.id)).toBe(3);
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: courses.id } })).amount).toBe(60000);
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: cine.id } })).amount).toBe(5000);
    await expect(applyPlan(admin, r.id)).rejects.toThrow("already been applied");
    await undoPlan(admin, r.id);
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: courses.id } })).amount).toBe(0);
    await removeItem(hh, budget.id, reserve.id);
    await expect(applyPlan(admin, r.id)).rejects.toThrow("budget changed");
    await setBudgetStatus(hh, budget.id, "VALIDATED");
    await expect(applyPlan(admin, r.id)).rejects.toThrow(LedgerError);
  });

  it("rien à répartir, aucune ligne variable ou budget validé : rejet sans appel au LLM", async () => {
    const { admin, hh, budget, item, fixedCat } = await household();
    const plan = () => generateReport(admin, "PLAN", today, "MANUAL", { provider: "CLAUDE", month: nov });
    await item("INCOME", "Salaire", 100000);
    await expect(plan()).rejects.toThrow("No variable expense line in this budget.");
    await item("EXPENSE", "Courses", 0);
    const loyer = await fixedCat("Rent");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 100000 } });
    await expect(plan()).rejects.toThrow("Nothing to allocate");
    await setBudgetStatus(hh, budget.id, "VALIDATED");
    await expect(plan()).rejects.toThrow("validated");
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("rapports automatiques", () => {
  it("un seul par foyer, jour et type, sans auteur ; le 1er, bilan du mois écoulé en plus", async () => {
    const { admin, hh } = await household();
    await createBudget(hh, oct);
    await prisma.household.updateMany({ data: { claudeApiKey: "k", aiAutomatic: true } });
    llm.mockImplementation(async (_p, _c, req) => ({ model: "m1", text: JSON.stringify(req.system.includes("Review of the past month") ? MONTHLY_OK : DAILY_OK) }));

    const a = await generateReport(admin, "DAILY", today, "AUTO", { provider: "CLAUDE" });
    expect(a.userId).toBeNull();
    expect((await generateReport(admin, "DAILY", today, "AUTO", { provider: "CLAUDE" })).id).toBe(a.id);
    expect(await generateAutoReports(today)).toBe(0); // déjà fait
    expect(await generateAutoReports(day("2026-11-11"))).toBe(1);
    expect(await generateAutoReports(day("2026-11-01"))).toBe(2); // bilan d'octobre + jour
    expect(await prisma.report.count({ where: { householdId: hh, kind: "MONTHLY", trigger: "AUTO" } })).toBe(1);
    expect(await generateAutoReports(day("2026-12-01"))).toBe(1); // bilan de novembre ; pas de budget en décembre
  });

  it("l'échec d'un foyer n'empêche pas les autres", async () => {
    await household();
    const admin2 = (await setupHousehold({ householdName: "Autre", name: "Zoé", email: "zoe@test.fr", password: "password1" }, { force: true }))!;
    await createBudget(admin2.householdId, nov);
    await prisma.household.updateMany({ data: { claudeApiKey: "k", aiAutomatic: true } });
    let calls = 0;
    llm.mockImplementation(async () => {
      if (calls++ === 0) throw new Error("boom");
      return { model: "m1", text: JSON.stringify(DAILY_OK) };
    });
    expect(await generateAutoReports(today)).toBe(2);
    await processNextReport();
    await processNextReport();
    expect(await prisma.report.count({ where: { status: "ERROR" } })).toBe(1);
    expect(await prisma.report.count({ where: { status: "READY" } })).toBe(1);
  });

  it("listReports : un membre ne voit que les siens, l'admin tout", async () => {
    const { admin, bob } = await household();
    for (let i = 0; i < 3; i++) reply(DAILY_OK);
    const auto = await generateReport(admin, "DAILY", today, "AUTO", { provider: "CLAUDE" });
    const mine = await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    const his = await generateReport(bob, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    expect((await listReports(bob)).map((r) => r.id)).toEqual([his.id]);
    expect((await listReports(admin)).map((r) => r.id)).toEqual([his.id, mine.id, auto.id]);
  });
});

describe("durable report queue", () => {
  it("enqueue is idempotent and never calls the model from the user request", async () => {
    const { admin, hh } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    const [a, b] = await Promise.all([requestReport(admin, "DAILY", today, "MANUAL"), requestReport(admin, "DAILY", today, "MANUAL")]);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("QUEUED");
    expect(llm).not.toHaveBeenCalled();
    llm.mockResolvedValue({ model: "m1", text: JSON.stringify(DAILY_OK), inputTokens: 20, outputTokens: 10 });
    const completed = await Promise.all([processNextReport(), processNextReport()]);
    expect(completed.filter(Boolean)).toHaveLength(1);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(await getReport(admin, a.id)).toMatchObject({ status: "READY", attempts: 1, inputTokens: 20, outputTokens: 10 });
  });

  it("failed jobs can be retried by their owner, without duplicating the report", async () => {
    const { admin, bob, hh } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    const r = await requestReport(admin, "DAILY", today, "MANUAL");
    llm.mockRejectedValueOnce(new LlmError("temporarily unavailable"));
    await processNextReport();
    expect(await getReport(admin, r.id)).toMatchObject({ status: "ERROR" });
    await expect(retryReport(bob, r.id)).rejects.toThrow(NotFoundError);
    await retryReport(admin, r.id);
    reply(DAILY_OK);
    await processNextReport();
    expect(await getReport(admin, r.id)).toMatchObject({ status: "READY", attempts: 2 });
    expect(await prisma.report.count()).toBe(1);
  });

  it("recovers expired work and preserves the selected language", async () => {
    const { admin, hh } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    const r = await requestReport(admin, "DAILY", today, "MANUAL", { locale: "fr" });
    await prisma.report.update({ where: { id: r.id }, data: { status: "RUNNING", startedAt: new Date(Date.now() - 31 * 60 * 1000), attempts: 1 } });
    reply(DAILY_OK);
    expect(await processNextReport()).toBe(true);
    expect(llm.mock.calls[0][2].system).toContain("Answer in French");
    expect(await getReport(admin, r.id)).toMatchObject({ status: "READY", attempts: 2 });
  });

  it("respects automatic opt-in and blocks generation without a worker token", async () => {
    const { admin, hh } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    expect(await generateAutoReports(today)).toBe(0);
    vi.stubEnv("CRON_TOKEN", "");
    await expect(requestReport(admin, "DAILY", today, "MANUAL")).rejects.toThrow("report worker");
    expect(llm).not.toHaveBeenCalled();
  });

  it("historical analysis uses the selected month and rejects future daily analysis", async () => {
    const { admin, hh } = await household(oct);
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    const r = await requestReport(admin, "DAILY", today, "MANUAL", { month: oct });
    expect((r.input as DailyInput).today).toBe("2026-10-31");
    await expect(requestReport(admin, "DAILY", today, "MANUAL", { month: day("2026-12-01") })).rejects.toThrow("Future");
  });

  it("blocks applying a proposal after another member changes the income", async () => {
    const { admin, hh, budget, item } = await household();
    const income = await item("INCOME", "Salary", 100000);
    const groceries = await item("EXPENSE", "Groceries", 0);
    reply(lines([groceries.id, 1000]));
    const r = await generateReport(admin, "PLAN", today, "MANUAL", { provider: "CLAUDE", month: nov });
    await saveItems(hh, budget.id, new Map([[income.id, { label: income.label, amount: 50000, included: true, recurring: true }]]));
    await expect(applyPlan(admin, r.id)).rejects.toThrow("budget changed");
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: groceries.id } })).amount).toBe(0);
  });

  it("edited allocations preserve totals and undo refuses to erase subsequent changes", async () => {
    const { admin, hh, budget, item } = await household();
    await item("INCOME", "Salary", 100000);
    const a = await item("EXPENSE", "Groceries", 0);
    const b = await item("EXPENSE", "Leisure", 0);
    reply(lines([a.id, 900], [b.id, 100]));
    const r = await generateReport(admin, "PLAN", today, "MANUAL", { provider: "CLAUDE", month: nov });
    await expect(applyPlan(admin, r.id, new Map([[a.id, 90000], [b.id, 20000]]))).rejects.toThrow("exactly");
    await applyPlan(admin, r.id, new Map([[a.id, 80000], [b.id, 20000]]));
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: a.id } })).amount).toBe(80000);
    await saveItems(hh, budget.id, new Map([[a.id, { label: a.label, amount: 70000, included: true, recurring: true }]]));
    await expect(undoPlan(admin, r.id)).rejects.toThrow("Undo is unavailable");
  });

  it("old reports remain accessible outside the first history page", async () => {
    const { admin, hh, budget } = await household();
    const r = await prisma.report.create({ data: { householdId: hh, budgetId: budget.id, userId: admin.id, day: today, kind: "DAILY", trigger: "MANUAL", provider: "CLAUDE", model: "m", input: {} } });
    await prisma.report.createMany({ data: Array.from({ length: 30 }, () => ({ householdId: hh, budgetId: budget.id, userId: admin.id, day: today, kind: "DAILY", trigger: "MANUAL", provider: "CLAUDE", model: "m", input: {} })) });
    expect((await listReports(admin)).some((x) => x.id === r.id)).toBe(false);
    expect(await getReport(admin, r.id)).toMatchObject({ id: r.id });
    expect(await listReports(admin, 2)).toHaveLength(1);
  });
});

describe("queue limits and immutable disclosure", () => {
  it("enforces the rolling household quota even with distinct report requests", async () => {
    const { admin, hh, budget } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    await prisma.report.createMany({ data: Array.from({ length: 20 }, () => ({ householdId: hh, budgetId: budget.id, userId: admin.id, day: today, kind: "DAILY", trigger: "MANUAL", provider: "CLAUDE", model: "m", input: {} })) });
    await expect(requestReport(admin, "DAILY", today, "MANUAL")).rejects.toThrow("limit");
    expect(llm).not.toHaveBeenCalled();
  });
  it("retains request-time privacy settings when preferences change before processing", async () => {
    const { admin, hh, item, spend } = await household();
    const category = await item("EXPENSE", "Groceries", 10000);
    await spend(category.categoryId, 500, "2026-11-10", "Private medical note");
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k", aiMinimizeData: true } });
    await requestReport(admin, "DAILY", today, "MANUAL");
    await prisma.household.update({ where: { id: hh }, data: { aiMinimizeData: false } });
    reply(DAILY_OK);
    await processNextReport();
    expect(llm.mock.calls[0][2].user).not.toContain("Private medical note");
    expect(llm.mock.calls[0][2].user).not.toContain("Alice");
  });
  it("records usage across validation retries", async () => {
    const { admin, hh } = await household();
    await prisma.household.update({ where: { id: hh }, data: { claudeApiKey: "k" } });
    const r = await requestReport(admin, "DAILY", today, "MANUAL");
    llm.mockResolvedValueOnce({ model: "m", text: "invalid", inputTokens: 10, outputTokens: 3 });
    llm.mockResolvedValueOnce({ model: "m", text: JSON.stringify(DAILY_OK), inputTokens: 20, outputTokens: 5 });
    await processNextReport();
    expect(await getReport(admin, r.id)).toMatchObject({ inputTokens: 30, outputTokens: 8, status: "READY" });
  });
});
