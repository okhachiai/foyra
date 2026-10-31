import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth, removeItem, setBudgetStatus } from "./budget";
import { createCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, LedgerError, NotFoundError, parseDay } from "./ledger";
import { complete, LlmError } from "./llm";
import {
  applyPlan, generateAutoReports, generateReport, listReports, outputSchema, pace, toEuros, validateOutput,
  type DailyInput, type DailyOutput, type MonthlyInput, type PlanInput, type PlanOutput,
} from "./report";

vi.mock("./llm", async (real) => ({ ...(await real<typeof import("./llm")>()), complete: vi.fn() }));
const llm = vi.mocked(complete);

describe("pace", () => {
  it("attendu au prorata, projection, montant par jour restant, statut", () => {
    expect(pace(30000, 10000, 10, 30)).toEqual({ expected: 10000, projected: 30000, perDay: 952, status: "ok" });
    expect(pace(30000, 14000, 10, 30).status).toBe("rapide"); // > 10 000 + 3 000
    expect(pace(30000, 12000, 10, 30).status).toBe("ok"); // dans la tolérance
    expect(pace(30000, 31000, 10, 30)).toMatchObject({ status: "dépassé", perDay: 0 });
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
    expect(validateOutput("DAILY", input, "pas du json")).toEqual({ ok: false, error: "Réponse non JSON." });
    expect(validateOutput("MONTHLY", {} as MonthlyInput, JSON.stringify(ok)).ok).toBe(false);
    expect(validateOutput("MONTHLY", {} as MonthlyInput, JSON.stringify({ verdict: "v", respected: [], mistakes: ["m"], advice: [] })).ok).toBe(true);
  });

  it("PLAN : euros → centimes, ordre de l'entrée, lignes omises à 0", () => {
    expect(planOf(lines(["r", 100], ["a", 900]))).toEqual([["a", 90000], ["b", 0], ["r", 10000]]);
  });

  it("PLAN : somme ramenée sur le reste à répartir (surplus sur la réserve, excédent retiré de la réserve puis des plus grosses)", () => {
    expect(planOf(lines(["a", 500], ["b", 100], ["r", 100]))).toEqual([["a", 50000], ["b", 10000], ["r", 40000]]);
    expect(planOf(lines(["a", 900], ["b", 200], ["r", 50]))).toEqual([["a", 80000], ["b", 20000], ["r", 0]]);
    const noReserve = { ...PLAN, lines: PLAN.lines.slice(0, 2) };
    const r = validateOutput("PLAN", noReserve, lines(["a", 600], ["b", 100]));
    expect(r.ok && (r.output as PlanOutput).lines.map((l) => l.amount)).toEqual([90000, 10000]);
  });

  it("PLAN : ligne inconnue, en double, montant négatif refusés", () => {
    expect(validateOutput("PLAN", PLAN, lines(["zz", 1000]))).toEqual({ ok: false, error: "Ligne inconnue : zz." });
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
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
});
afterEach(() => {
  llm.mockReset();
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
    await expect(generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).rejects.toThrow("Aucun budget pour ce mois.");
    expect(llm).not.toHaveBeenCalled();
  });

  it("enveloppes variables et rythme, opérations du jour, sans catégorie, charges à venir ; aucun e-mail envoyé", async () => {
    const { admin, hh, item, spend, fixedCat } = await household();
    await item("INCOME", "Salaire", 300000);
    const courses = await item("EXPENSE", "Courses", 30000);
    const loyer = await fixedCat("Loyer");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 90000 } });
    await createCharge(hh, { kind: "EXPENSE", active: true, name: "Loyer", dueDay: 25, categoryId: loyer.categoryId!, startMonth: nov, endMonth: null, shared: true });
    await spend(courses.categoryId, 14000, "2026-11-05");
    await spend(courses.categoryId, 2500, "2026-11-10", "Marché");
    await spend(null, 700, "2026-11-03");
    reply(DAILY_OK);

    const r = await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    expect(r).toMatchObject({ kind: "DAILY", trigger: "MANUAL", userId: admin.id, output: DAILY_OK, error: null });
    const input = r.input as DailyInput;
    expect(input).toMatchObject({ today: "2026-11-10", day: 10, daysInMonth: 30, uncategorized: { count: 1, amount: 700 } });
    expect(input.lines).toEqual([{ label: "Courses", planned: 30000, actual: 16500, expected: 10000, projected: 49500, perDay: 642, status: "rapide" }]);
    expect(input.todayOps).toEqual([{ label: "Marché", category: "Courses", amount: 2500, kind: "EXPENSE", paidBy: "Alice" }]);
    expect(input.upcoming).toEqual([{ name: "Loyer", amount: 90000, due: "2026-11-25" }]);
    expect(input.planned).toMatchObject({ income: 300000, fixed: 90000, variable: 30000 });
    const sent = llm.mock.calls[0][2].user;
    expect(sent).toContain('"planned":300'); // euros
    for (const e of ["alice@test.fr", "bob@test.fr"]) expect(sent).not.toContain(e);
  });

  it("invalide puis valide : relance avec l'erreur ; invalide deux fois : erreur stockée", async () => {
    const { admin } = await household();
    reply("pas du json");
    reply(DAILY_OK);
    const r = await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" });
    expect(llm.mock.calls[1][2].retry).toEqual({ previous: "pas du json", error: "Réponse non JSON." });
    expect(r.output).toEqual(DAILY_OK);
    reply("x");
    reply({ summary: 1 });
    expect(await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).toMatchObject({ output: null, error: "Réponse non conforme au schéma." });
  });

  it("erreur du fournisseur : rapport en erreur sans relance ; aucun fournisseur : rejet", async () => {
    const { admin } = await household();
    llm.mockRejectedValueOnce(new LlmError("Fournisseur LLM injoignable"));
    expect(await generateReport(admin, "DAILY", today, "MANUAL", { provider: "CLAUDE" })).toMatchObject({ output: null, error: "Fournisseur LLM injoignable" });
    expect(llm).toHaveBeenCalledTimes(1);
    await expect(generateReport(admin, "DAILY", today, "MANUAL")).rejects.toThrow(new LedgerError("Aucun fournisseur LLM configuré."));
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
    const loyer = await fixedCat("Loyer");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 150000 } });
    const courses = await item("EXPENSE", "Courses", 0);
    const loisirs = await item("EXPENSE", "Loisirs", 0);
    const cine = await item("EXPENSE", "Cinéma", 0, { parentId: loisirs.id });
    const reserve = await item("EXPENSE", "Réserve", 0, { reserve: true });
    await spend(courses.categoryId, 50000, "2026-08-10");
    await spend(courses.categoryId, 48000, "2026-10-10");
    await spend(cine.categoryId, 2000, "2026-09-03");
    await spend(courses.categoryId, 1000, "2026-07-31"); // hors des 3 mois
    reply(lines([courses.id, 600], [cine.id, 50]));

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
    await removeItem(hh, budget.id, reserve.id);
    expect(await applyPlan(admin, r.id)).toBe(2);
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: courses.id } })).amount).toBe(60000);
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: cine.id } })).amount).toBe(5000);
    await setBudgetStatus(hh, budget.id, "VALIDATED");
    await expect(applyPlan(admin, r.id)).rejects.toThrow(LedgerError);
  });

  it("rien à répartir, aucune ligne variable ou budget validé : rejet sans appel au LLM", async () => {
    const { admin, hh, budget, item, fixedCat } = await household();
    const plan = () => generateReport(admin, "PLAN", today, "MANUAL", { provider: "CLAUDE", month: nov });
    await item("INCOME", "Salaire", 100000);
    await expect(plan()).rejects.toThrow("Aucune ligne de charge variable dans ce budget.");
    await item("EXPENSE", "Courses", 0);
    const loyer = await fixedCat("Loyer");
    await prisma.budgetItem.update({ where: { id: loyer.id }, data: { amount: 100000 } });
    await expect(plan()).rejects.toThrow("Rien à répartir");
    await setBudgetStatus(hh, budget.id, "VALIDATED");
    await expect(plan()).rejects.toThrow("validé");
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("rapports automatiques", () => {
  it("un seul par foyer, jour et type, sans auteur ; le 1er, bilan du mois écoulé en plus", async () => {
    const { admin, hh } = await household();
    await createBudget(hh, oct);
    await prisma.household.updateMany({ data: { claudeApiKey: "k" } });
    llm.mockImplementation(async (_p, _c, req) => ({ model: "m1", text: JSON.stringify(req.system.includes("Bilan") ? MONTHLY_OK : DAILY_OK) }));

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
    await prisma.household.updateMany({ data: { claudeApiKey: "k" } });
    let calls = 0;
    llm.mockImplementation(async () => {
      if (calls++ === 0) throw new Error("boom");
      return { model: "m1", text: JSON.stringify(DAILY_OK) };
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await generateAutoReports(today)).toBe(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][1]).toBe("boom");
    err.mockRestore();
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
