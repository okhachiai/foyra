import { beforeEach, describe, expect, it } from "vitest";
import { fullScope, getScope } from "./access";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth } from "./budget";
import { createCharge } from "./charges";
import { prisma } from "./db";
import { adjustBalance, createAccount, createEntry, createTransfer, parseDay } from "./ledger";
import { buildInput, OUTPUT_SCHEMA, validateOutput, type ReportInput, type ReportOutput } from "./report";

const op = (id: string, kind: "INCOME" | "EXPENSE") => ({ id, label: "x", amount: 100, kind, account: "Commun", categoryId: null });
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
    expect(validateOutput(INPUT, JSON.stringify({ ...OK, advice: 3 })).ok).toBe(false);
    expect(validateOutput(INPUT, JSON.stringify({ ...OK, allocations: [{ budgetItemId: "e1" }] })).ok).toBe(false);
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

describe("buildInput", () => {
  const nov = parseMonth("2026-11")!;
  const day = (s: string) => parseDay(s)!;
  const today = day("2026-11-10");

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  });

  /** Foyer : Alice (admin), Bob ; un compte commun partagé, un perso chacun (celui d'Alice illisible pour Bob). */
  async function household(commonBalance: number) {
    const admin = (await setupHousehold({ householdName: "Test", name: "Alice", email: "alice@test.fr", password: "password1" }))!;
    const hh = admin.householdId;
    const all = fullScope(hh);
    const bob = (await createMember(hh, { name: "Bob", email: "bob@test.fr", password: "password1", role: "MEMBER" }))!;
    const commun = (await createAccount(all, admin.id, { name: "Commun", kind: "CHECKING", initialBalance: commonBalance, ownerId: null, sharing: "HOUSEHOLD" })).id;
    const pa = (await createAccount(all, admin.id, { name: "Perso A", kind: "CHECKING", initialBalance: 0, ownerId: admin.id })).id;
    const pb = (await createAccount(all, bob.id, { name: "Perso B", kind: "CHECKING", initialBalance: 0, ownerId: bob.id })).id;
    const cat = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
    return { admin, bob: { ...bob, householdId: hh }, hh, all, commun, pa, pb, cat };
  }

  it("sans budget du mois : rejet", async () => {
    const { admin } = await household(0);
    await expect(buildInput(admin, today)).rejects.toThrow("Aucun budget pour ce mois.");
  });

  it("entrée complète, visibilité selon le lecteur, aucun e-mail", async () => {
    const { admin, bob, hh, all, commun, pa, pb, cat } = await household(200000);
    const loyer = await cat("Loyer");
    await createCharge(all, { kind: "EXPENSE", active: true, name: "Loyer", amount: 95000, dueDay: 25, accountId: commun, categoryId: loyer, startMonth: nov, endMonth: null, shared: true });
    await createCharge(all, { kind: "EXPENSE", active: true, name: "Eau", amount: 3000, dueDay: 2, accountId: commun, categoryId: loyer, startMonth: nov, endMonth: null, shared: true }); // échue : comptée dans le disponible, pas à venir
    const entry = (accountId: string, kind: "INCOME" | "EXPENSE", amount: number, categoryId: string | null, note: string | null, on = "2026-11-10") =>
      createEntry(all, admin.id, { accountId, kind, amount, occurredOn: day(on), note, categoryId });
    const tA = await entry(pa, "EXPENSE", 1200, null, "Boulangerie");
    const tA2 = await entry(pa, "EXPENSE", 800, null, null, "2026-11-04");
    const tB = await entry(pb, "EXPENSE", 2500, await cat("Supermarché"), null);
    const tB2 = await entry(pb, "INCOME", 700, null, "Remboursement", "2026-11-03");
    await entry(pb, "EXPENSE", 999, null, null, "2026-10-30"); // hors mois
    await adjustBalance(all, admin.id, pb, 50000, today); // ajustement : exclu
    await createTransfer(all, admin.id, { fromAccountId: pb, toAccountId: commun, amount: 1000, occurredOn: today, note: null }); // virement : exclu

    const budget = await createBudget(hh, nov);
    await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
    const item = (label: string, amount: number, extra: { parentId?: string; reserve?: boolean } = {}) =>
      addItem(hh, budget.id, { kind: "EXPENSE", parentId: extra.parentId ?? null, label, amount, included: true, recurring: false, shared: true, reserve: extra.reserve ?? false });
    const leaf = await item("Courses", 40000);
    const parent = await item("Loisirs", 0);
    await item("Cinéma", 5000, { parentId: parent.id });
    const reserve = await item("Réserve", 10000, { reserve: true });

    const { budgetId, input } = await buildInput(admin, today);
    expect(budgetId).toBe(budget.id);
    expect(input).toMatchObject({ today: "2026-11-10", month: "2026-11", daysLeft: 21, available: 200000 + 1000 - 95000 - 3000 });
    expect(input.envelopes).toEqual([
      { id: leaf.id, label: "Courses", planned: 40000, actual: 0, left: 40000, allocatable: true },
      { id: parent.id, label: "Loisirs", planned: 5000, actual: 0, left: 5000, allocatable: false },
    ]);
    expect(input.reserve).toMatchObject({ id: reserve.id, planned: 10000, overrun: 0, allocatable: true });
    expect(input.upcoming).toEqual([{ name: "Loyer", amount: 95000, due: "2026-11-25", account: "Commun" }]);
    expect(input.members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
    expect(input.categories.some((c) => c.id === loyer && c.kind === "EXPENSE")).toBe(true);
    expect(input.todayOps.map((o) => o.id).sort()).toEqual([tA.id, tB.id].sort());
    expect(input.todayOps.find((o) => o.id === tB.id)).toMatchObject({ label: "Supermarché", amount: 2500, kind: "EXPENSE", account: "Perso B" });
    expect(input.uncategorized.map((o) => o.id).sort()).toEqual([tA.id, tA2.id, tB2.id].sort());
    expect(input.split.members.every((m) => m.income !== null)).toBe(true);
    const json = JSON.stringify(input);
    for (const e of ["alice@test.fr", "bob@test.fr"]) expect(json).not.toContain(e);

    // Bob : comptes d'Alice illisibles → agrégats seulement, aucune opération de Perso A.
    expect((await getScope(bob)).read).not.toContain(pa);
    const asBob = (await buildInput(bob, today)).input;
    const alice = asBob.split.members.find((m) => m.userId === admin.id)!;
    expect(alice).toMatchObject({ income: null, personalLeft: null });
    expect(asBob.split.members.find((m) => m.userId === bob.id)!.income).not.toBeNull();
    expect([...asBob.todayOps, ...asBob.uncategorized].map((o) => o.id).sort()).toEqual([tB.id, tB2.id].sort());
    expect(asBob.available).toBe(input.available); // portée complète
    expect(asBob.envelopes).toEqual(input.envelopes);
    for (const e of ["alice@test.fr", "bob@test.fr"]) expect(JSON.stringify(asBob)).not.toContain(e);
  });

  it("disponible jamais négatif", async () => {
    const { admin, hh, all, commun, cat } = await household(1000);
    await createCharge(all, { kind: "EXPENSE", active: true, name: "Loyer", amount: 95000, dueDay: 25, accountId: commun, categoryId: await cat("Loyer"), startMonth: nov, endMonth: null, shared: true });
    await createBudget(hh, nov);
    expect((await buildInput(admin, today)).input.available).toBe(0);
  });
});
