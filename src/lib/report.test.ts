import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth, removeItem, setBudgetStatus } from "./budget";
import { createCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, deleteTransaction, LedgerError, NotFoundError, parseDay } from "./ledger";
import { complete, LlmError } from "./llm";
import {
  applyAllocations, applyCategories, buildInput, generateDailyReports, generateReport, listReports, OUTPUT_SCHEMA, validateOutput,
  type ReportInput, type ReportOutput,
} from "./report";

vi.mock("./llm", async (real) => ({ ...(await real<typeof import("./llm")>()), complete: vi.fn() }));
const llm = vi.mocked(complete);

const op = (id: string, kind: "INCOME" | "EXPENSE") => ({ id, label: "x", amount: 100, kind, paidBy: "Alice", categoryId: null });
const env = (id: string, allocatable: boolean) => ({ id, label: id, planned: 1000, actual: 0, left: 1000, allocatable });

const INPUT: ReportInput = {
  today: "2026-11-10", daysLeft: 21, month: "2026-11",
  split: { commonNet: 0, members: [] },
  envelopes: [env("e1", true), env("e2", false)],
  reserve: { ...env("r", true), overrun: 0 },
  available: 5000,
  todayOps: [op("t1", "EXPENSE")],
  uncategorized: [op("t2", "INCOME")],
  categories: [{ id: "cE", name: "Courses", kind: "EXPENSE" }, { id: "cI", name: "Salaire", kind: "INCOME" }],
  upcoming: [],
  members: [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }],
};

const OK: ReportOutput = {
  allocations: [{ budgetItemId: "e1", amount: 3000 }, { budgetItemId: "r", amount: 2000 }],
  categorize: [{ transactionId: "t1", categoryId: "cE" }, { transactionId: "t2", categoryId: "cI" }],
  plan: [{ date: "2026-11-15", budgetItemId: "e1", label: "Courses", amount: 1500 }, { date: "2026-11-20", budgetItemId: "e1", label: "Courses", amount: 1500 }],
  balancing: [{ fromUserId: "u1", toUserId: "u2", amount: 100, reason: "équilibrer" }],
  advice: "Tout va bien.",
};

const check = (over: Partial<ReportOutput>, input = INPUT) => validateOutput(input, JSON.stringify({ ...OK, ...over }));
const fails = (over: Partial<ReportOutput>, ...words: string[]) => {
  const r = check(over);
  expect(r.ok).toBe(false);
  for (const w of words) expect(!r.ok && r.error).toContain(w);
};

describe("validateOutput", () => {
  it("sortie cohérente acceptée", () => {
    expect(check({})).toEqual({ ok: true, output: OK });
  });

  it("schéma : tous champs requis, aucun champ en trop", () => {
    expect(OUTPUT_SCHEMA).toMatchObject({ type: "object", additionalProperties: false, required: ["allocations", "categorize", "plan", "balancing", "advice"] });
  });

  it("texte non JSON ou mal formé", () => {
    expect(validateOutput(INPUT, "Voici mon rapport")).toEqual({ ok: false, error: "Réponse non JSON." });
    expect(validateOutput(INPUT, "Voici { pas du json }")).toEqual({ ok: false, error: "Réponse non JSON." });
    expect(validateOutput(INPUT, JSON.stringify({ ...OK, advice: 3 })).ok).toBe(false);
    expect(validateOutput(INPUT, JSON.stringify({ ...OK, allocations: [{ budgetItemId: "e1" }] })).ok).toBe(false);
  });

  it("JSON entouré de ```json ou de prose (modèle local) : accepté", () => {
    expect(validateOutput(INPUT, "Voici le rapport :\n```json\n" + JSON.stringify(OK, null, 2) + "\n```\nBonne soirée.")).toEqual({ ok: true, output: OK });
  });

  it("Σ allocations ≠ disponible : erreur avec les deux montants", () => {
    fails({ allocations: [{ budgetItemId: "e1", amount: 3000 }, { budgetItemId: "r", amount: 1000 }] }, "4000", "5000");
  });

  it("ligne non allouable, inconnue ou en double", () => {
    fails({ allocations: [{ budgetItemId: "e2", amount: 5000 }], plan: [] }, "e2");
    fails({ allocations: [{ budgetItemId: "zz", amount: 5000 }], plan: [] }, "zz");
    fails({ allocations: [{ budgetItemId: "r", amount: 2500 }, { budgetItemId: "r", amount: 2500 }], plan: [] }, "r");
  });

  it("opération inconnue, catégorie inconnue ou de mauvais sens", () => {
    fails({ categorize: [{ transactionId: "t9", categoryId: "cE" }] }, "t9");
    fails({ categorize: [{ transactionId: "t1", categoryId: "c9" }] }, "c9");
    fails({ categorize: [{ transactionId: "t1", categoryId: "cI" }] }, "cI");
    fails({ categorize: [{ transactionId: "t1", categoryId: "cE" }, { transactionId: "t1", categoryId: "cE" }] }, "t1");
  });

  it("membres inconnus du rééquilibrage", () => {
    fails({ balancing: [{ fromUserId: "u9", toUserId: "u2", amount: 100, reason: "" }] }, "u9");
    fails({ balancing: [{ fromUserId: "u1", toUserId: "u8", amount: 100, reason: "" }] }, "u8");
  });

  it("montant négatif ou non entier", () => {
    fails({ allocations: [{ budgetItemId: "e1", amount: 5500 }, { budgetItemId: "r", amount: -500 }], plan: [] }, "r");
    fails({ allocations: [{ budgetItemId: "e1", amount: 4999.5 }, { budgetItemId: "r", amount: 0.5 }], plan: [] }, "e1");
    fails({ balancing: [{ fromUserId: "u1", toUserId: "u2", amount: -1, reason: "" }] }, "u1");
    fails({ plan: [{ date: "2026-11-15", budgetItemId: "e1", label: "x", amount: 1.5 }] }, "e1");
  });

  it("plan : Σ d'une ligne > son allocation, ligne non allouable, date hors du reste du mois", () => {
    fails({ plan: [{ date: "2026-11-15", budgetItemId: "e1", label: "x", amount: 3001 }] }, "e1");
    fails({ plan: [{ date: "2026-11-15", budgetItemId: "e2", label: "x", amount: 0 }] }, "e2");
    fails({ plan: [{ date: "2026-11-09", budgetItemId: "e1", label: "x", amount: 1 }] }, "2026-11-09");
    fails({ plan: [{ date: "2026-12-01", budgetItemId: "e1", label: "x", amount: 1 }] }, "2026-12-01");
  });

  it("aucune ligne allouable : allocations vides acceptées quel que soit le disponible", () => {
    const none = { ...INPUT, envelopes: [env("e2", false)], reserve: null };
    expect(check({ allocations: [], plan: [] }, none).ok).toBe(true);
    expect(check({ allocations: [{ budgetItemId: "e2", amount: 5000 }], plan: [] }, none).ok).toBe(false);
  });
});

const nov = parseMonth("2026-11")!;
const day = (s: string) => parseDay(s)!;
const today = day("2026-11-10");

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
});

/** Foyer : Alice (admin), Bob ; `income` = recette commune du 01/11 (net du mois de départ). */
async function household(income: number) {
  const admin = (await setupHousehold({ householdName: "Test", name: "Alice", email: "alice@test.fr", password: "password1" }))!;
  const hh = admin.householdId;
  const bob = (await createMember(hh, { name: "Bob", email: "bob@test.fr", password: "password1", role: "MEMBER" }))!;
  const cat = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
  if (income) {
    await createEntry(hh, admin.id, { paidById: admin.id, kind: "INCOME", amount: income, occurredOn: day("2026-11-01"), note: null, categoryId: await cat("Autres revenus"), shared: true });
  }
  return { admin, bob: { ...bob, householdId: hh }, hh, cat };
}

describe("buildInput", () => {
  it("sans budget du mois : rejet", async () => {
    const { admin } = await household(0);
    await expect(buildInput(admin, today)).rejects.toThrow("Aucun budget pour ce mois.");
  });

  it("entrée complète, identique pour chaque membre, aucun e-mail", async () => {
    const { admin, bob, hh, cat } = await household(200000);
    const loyer = await cat("Loyer");
    await createCharge(hh, { kind: "EXPENSE", active: true, name: "Loyer", dueDay: 25, categoryId: loyer, startMonth: nov, endMonth: null, shared: true });
    await createCharge(hh, { kind: "EXPENSE", active: true, name: "Eau", dueDay: 2, categoryId: loyer, startMonth: nov, endMonth: null, shared: true }); // échue : comptée dans le disponible, pas à venir
    const entry = (paidById: string, kind: "INCOME" | "EXPENSE", amount: number, categoryId: string | null, note: string | null, on = "2026-11-10") =>
      createEntry(hh, admin.id, { paidById, kind, amount, occurredOn: day(on), note, categoryId });
    const tA = await entry(admin.id, "EXPENSE", 1200, null, "Boulangerie");
    const tA2 = await entry(admin.id, "EXPENSE", 800, null, null, "2026-11-04");
    const tB = await entry(bob.id, "EXPENSE", 2500, await cat("Supermarché"), null);
    const tB2 = await entry(bob.id, "INCOME", 700, null, "Remboursement", "2026-11-03");
    await entry(bob.id, "EXPENSE", 999, null, null, "2026-10-30"); // hors mois

    const budget = await createBudget(hh, nov);
    await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
    const item = (label: string, amount: number, extra: { parentId?: string; reserve?: boolean } = {}) =>
      addItem(hh, budget.id, { kind: "EXPENSE", parentId: extra.parentId ?? null, label, amount, included: true, recurring: false, shared: true, reserve: extra.reserve ?? false });
    const leaf = await item("Courses", 40000);
    const parent = await item("Loisirs", 0);
    await item("Cinéma", 5000, { parentId: parent.id });
    const reserve = await item("Réserve", 10000, { reserve: true });
    // Montants des récurrences : lignes du budget (charges fixes, hors enveloppes).
    const logement = await prisma.budgetItem.create({ data: { householdId: hh, budgetId: budget.id, kind: "EXPENSE", label: "Logement", categoryId: await cat("Logement") } });
    await prisma.budgetItem.createMany({ data: [["Loyer", 95000], ["Eau", 3000]].map(([label, amount]) => ({ householdId: hh, budgetId: budget.id, parentId: logement.id, kind: "EXPENSE" as const, label: label as string, amount: amount as number, categoryId: loyer })) });

    const { budgetId, input } = await buildInput(admin, today);
    expect(budgetId).toBe(budget.id);
    expect(input).toMatchObject({ today: "2026-11-10", month: "2026-11", daysLeft: 21, available: 200000 + 700 - 1200 - 800 - 2500 - 95000 - 3000 });
    expect(input.envelopes).toEqual([
      { id: leaf.id, label: "Courses", planned: 40000, actual: 0, left: 40000, allocatable: true },
      { id: parent.id, label: "Loisirs", planned: 5000, actual: 0, left: 5000, allocatable: false },
    ]);
    expect(input.reserve).toMatchObject({ id: reserve.id, planned: 10000, overrun: 0, allocatable: true });
    expect(input.upcoming).toEqual([{ name: "Loyer", amount: 95000, due: "2026-11-25" }]);
    expect(input.members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
    expect(input.categories.some((c) => c.id === loyer && c.kind === "EXPENSE")).toBe(true);
    expect(input.todayOps.map((o) => o.id).sort()).toEqual([tA.id, tB.id].sort());
    expect(input.todayOps.find((o) => o.id === tB.id)).toMatchObject({ label: "Supermarché", amount: 2500, kind: "EXPENSE", paidBy: "Bob" });
    expect(input.uncategorized.map((o) => o.id).sort()).toEqual([tA.id, tA2.id, tB2.id].sort());
    const json = JSON.stringify(input);
    for (const e of ["alice@test.fr", "bob@test.fr"]) expect(json).not.toContain(e);
    expect((await buildInput(bob, today)).input).toEqual(input);
  });

  it("sans catégorie : les 50 plus récentes seulement", async () => {
    const { admin, hh } = await household(0);
    await createBudget(hh, nov);
    const entry = (on: string) => createEntry(hh, admin.id, { paidById: admin.id, kind: "EXPENSE", amount: 100, occurredOn: day(on), note: null, categoryId: null });
    for (let i = 0; i < 49; i++) await entry("2026-11-05");
    const latest = await entry("2026-11-10");
    const oldest = await entry("2026-11-04"); // créée en dernier, mais la plus ancienne : écartée
    const { uncategorized } = (await buildInput(admin, today)).input;
    expect(uncategorized).toHaveLength(50);
    expect(uncategorized[0].id).toBe(latest.id);
    expect(uncategorized.map((o) => o.id)).not.toContain(oldest.id);
  });

  it("disponible jamais négatif", async () => {
    const { admin, hh, cat } = await household(1000);
    await createCharge(hh, { kind: "EXPENSE", active: true, name: "Loyer", dueDay: 25, categoryId: await cat("Loyer"), startMonth: nov, endMonth: null, shared: true });
    const budget = await createBudget(hh, nov);
    await prisma.budgetItem.updateMany({ where: { budgetId: budget.id, label: "Loyer" }, data: { amount: 95000 } });
    expect((await buildInput(admin, today)).input.available).toBe(0);
  });
});

describe("génération, stockage, application", () => {
  afterEach(() => {
    llm.mockReset();
    vi.unstubAllEnvs();
  });

  /** Budget de novembre : une enveloppe « Courses » (catégorie Supermarché) et une réserve ; 2 000 € communs disponibles. */
  async function setup() {
    const h = await household(200000);
    const budget = await createBudget(h.hh, nov);
    await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
    const item = (label: string, reserve: boolean) =>
      addItem(h.hh, budget.id, { kind: "EXPENSE", parentId: null, label, amount: 10000, included: true, recurring: false, shared: true, reserve });
    const courses = await item("Courses", false);
    await prisma.budgetItem.update({ where: { id: courses.id }, data: { categoryId: await h.cat("Supermarché") } });
    const reserve = await item("Réserve", true);
    const out = (categorize: ReportOutput["categorize"] = []): ReportOutput => ({
      allocations: [{ budgetItemId: courses.id, amount: 150000 }, { budgetItemId: reserve.id, amount: 50000 }],
      categorize, plan: [], balancing: [], advice: "Tenez le cap.",
    });
    const reply = (o: ReportOutput | string) => llm.mockResolvedValueOnce({ model: "m1", text: typeof o === "string" ? o : JSON.stringify(o) });
    return { ...h, budget, courses, reserve, out, reply };
  }

  it("sortie valide au premier appel : stockée", async () => {
    const { admin, budget, out, reply } = await setup();
    reply(out());
    const r = await generateReport(admin, today, "MANUAL", "CLAUDE");
    expect(r).toMatchObject({ budgetId: budget.id, userId: admin.id, trigger: "MANUAL", provider: "CLAUDE", model: "m1", output: out(), error: null });
    expect(r.day).toEqual(today);
    expect(llm).toHaveBeenCalledTimes(1);
    expect((r.input as ReportInput).available).toBe(200000);
  });

  it("invalide puis valide : relance avec l'erreur", async () => {
    const { admin, out, reply } = await setup();
    reply("pas du json");
    reply(out());
    const r = await generateReport(admin, today, "MANUAL", "CLAUDE");
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][1].retry).toEqual({ previous: "pas du json", error: "Réponse non JSON." });
    expect(r).toMatchObject({ output: out(), error: null });
  });

  it("invalide deux fois : dernière erreur stockée, sans sortie", async () => {
    const { admin, out, reply } = await setup();
    reply("pas du json");
    reply({ ...out(), allocations: [] });
    const r = await generateReport(admin, today, "MANUAL", "CLAUDE");
    expect(llm).toHaveBeenCalledTimes(2);
    expect(r.output).toBeNull();
    expect(r.error).toContain("200000");
  });

  it("erreur du fournisseur (dont réponse tronquée) : rapport en erreur, sans exception ni relance", async () => {
    const { admin } = await setup();
    for (const msg of ["Fournisseur LLM injoignable", "Fournisseur LLM : réponse tronquée."]) {
      llm.mockReset();
      llm.mockRejectedValueOnce(new LlmError(msg));
      const r = await generateReport(admin, today, "MANUAL", "CLAUDE");
      expect(r).toMatchObject({ output: null, error: msg });
      expect(llm).toHaveBeenCalledTimes(1);
    }
  });

  it("aucun fournisseur configuré : rejet", async () => {
    const { admin } = await setup();
    await expect(generateReport(admin, today, "MANUAL")).rejects.toThrow(new LedgerError("Aucun fournisseur LLM configuré."));
  });

  it("DAILY : un seul par foyer et par jour, sans auteur ; tâche quotidienne", async () => {
    const { admin, hh, out, reply } = await setup();
    reply(out());
    const a = await generateReport(admin, today, "DAILY", "CLAUDE");
    const b = await generateReport(admin, today, "DAILY", "CLAUDE");
    expect(b.id).toBe(a.id);
    expect(a.userId).toBeNull();
    expect(llm).toHaveBeenCalledTimes(1);
    expect(await prisma.report.count({ where: { householdId: hh } })).toBe(1);

    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    reply(out());
    expect(await generateDailyReports(today)).toBe(0); // déjà fait
    expect(await generateDailyReports(day("2026-11-11"))).toBe(1);
    expect(await generateDailyReports(day("2026-12-01"))).toBe(0); // pas de budget en décembre
  });

  it("DAILY : l'échec d'un foyer n'empêche pas les autres", async () => {
    await setup(); // foyer 1 : 2 000 € disponibles
    const admin2 = (await setupHousehold({ householdName: "Autre", name: "Zoé", email: "zoe@test.fr", password: "password1" }, { force: true }))!;
    await createBudget(admin2.householdId, nov);
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    // L'ordre des foyers n'est pas garanti : le foyer 1 (disponible > 0) échoue, le foyer 2 (rien de disponible) reçoit une sortie vide valide.
    llm.mockImplementation(async (_p, req) => {
      if (JSON.parse(req.user).available > 0) throw new Error("boom");
      return { model: "m1", text: JSON.stringify({ allocations: [], categorize: [], plan: [], balancing: [], advice: "ok" }) };
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const created = await generateDailyReports(today);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][1]).toBe("boom");
    err.mockRestore();
    expect(created).toBe(1);
    expect(await prisma.report.count()).toBe(1);
  });

  it("listReports : un membre ne voit que les siens, l'admin tout", async () => {
    const { admin, bob, out, reply } = await setup();
    for (let i = 0; i < 3; i++) reply(out());
    const daily = await generateReport(admin, today, "DAILY", "CLAUDE");
    const mine = await generateReport(admin, today, "MANUAL", "CLAUDE");
    const his = await generateReport(bob, today, "MANUAL", "CLAUDE");
    expect((await listReports(bob)).map((r) => r.id)).toEqual([his.id]);
    expect((await listReports(admin)).map((r) => r.id)).toEqual([his.id, mine.id, daily.id]);
  });

  it("applyAllocations : prévu = réel actuel + allocation ; ligne supprimée ignorée ; budget validé ; rapport d'un autre", async () => {
    const { admin, bob, hh, budget, courses, reserve, out, reply, cat } = await setup();
    const spend = async (amount: number) => createEntry(hh, admin.id, { paidById: admin.id, shared: true, kind: "EXPENSE", amount, occurredOn: today, note: null, categoryId: await cat("Supermarché") });
    await spend(1200); // disponible : 198 800
    reply({ ...out(), allocations: [{ budgetItemId: courses.id, amount: 150000 }, { budgetItemId: reserve.id, amount: 48800 }] });
    const r = await generateReport(admin, today, "MANUAL", "CLAUDE");
    await spend(300); // réel recalculé à l'application
    await removeItem(hh, budget.id, reserve.id);

    await expect(applyAllocations(bob, r.id, today)).rejects.toThrow(NotFoundError);
    await setBudgetStatus(hh, budget.id, "VALIDATED");
    await expect(applyAllocations(admin, r.id, today)).rejects.toThrow(new LedgerError("Repasser le budget en brouillon pour appliquer"));
    await setBudgetStatus(hh, budget.id, "DRAFT");
    expect(await applyAllocations(admin, r.id, today)).toBe(1);
    expect(await prisma.budgetItem.findUniqueOrThrow({ where: { id: courses.id } })).toMatchObject({ amount: 1500 + 150000, label: "Courses", included: true });
  });

  it("applyAllocations : rapport d'un autre jour périmé, budget inchangé", async () => {
    const { admin, courses, out, reply } = await setup();
    reply(out());
    const r = await generateReport(admin, day("2026-11-09"), "MANUAL", "CLAUDE");
    await expect(applyAllocations(admin, r.id, today)).rejects.toThrow(new LedgerError("Rapport périmé : relancez « Analyser »."));
    expect((await prisma.budgetItem.findUniqueOrThrow({ where: { id: courses.id } })).amount).toBe(10000);
  });

  it("applyCategories : opération supprimée ou déjà catégorisée ignorée", async () => {
    const { admin, bob, hh, courses, reserve, out, reply, cat } = await setup();
    const entry = (paidById: string) => createEntry(hh, bob.id, { paidById, kind: "EXPENSE", amount: 500, occurredOn: today, note: "x", categoryId: null });
    const [ok, other, gone] = [await entry(bob.id), await entry(admin.id), await entry(bob.id)];
    const [supermarche, loyer] = [await cat("Supermarché"), await cat("Loyer")];
    const chosen = await createEntry(hh, bob.id, { paidById: bob.id, kind: "EXPENSE", amount: 500, occurredOn: today, note: "y", categoryId: loyer });
    // 4 dépenses de 5 € : disponible 2 000 − 20 = 1 980 €.
    const categorize = [ok, other, gone, chosen].map((t) => ({ transactionId: t.id, categoryId: supermarche }));
    reply({ ...out(categorize), allocations: [{ budgetItemId: courses.id, amount: 150000 }, { budgetItemId: reserve.id, amount: 48000 }] });
    const r = await generateReport(bob, today, "MANUAL", "CLAUDE");
    expect(r.error).toBeNull();
    await deleteTransaction(hh, gone.id);

    expect(await applyCategories(bob, r.id)).toBe(2);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ categoryId: supermarche, amount: 500, note: "x", paidById: bob.id });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: other.id } })).categoryId).toBe(supermarche);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: chosen.id } })).categoryId).toBe(loyer); // choix de l'utilisateur gardé
  });
});
