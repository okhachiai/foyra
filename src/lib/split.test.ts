import { beforeEach, describe, expect, it } from "vitest";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth } from "./budget";
import { prisma } from "./db";
import { createEntry, parseDay } from "./ledger";
import { getSplit, splitMonth, type SplitInput } from "./split";

const A = { id: "a", name: "Alice" };
const B = { id: "b", name: "Bob" };
const base = (over: Partial<SplitInput>): SplitInput => ({
  members: [A, B], income: {}, commonIncome: 0, plannedCommon: 0, paidCommon: {}, spentPersonal: {}, ...over,
});

describe("splitMonth", () => {
  it("prorata 60/40 avec facture commune payée en perso", () => {
    const s = splitMonth(base({ income: { a: 300000, b: 200000 }, plannedCommon: 240000, paidCommon: { a: 11000 }, spentPersonal: { a: 5000 } }));
    expect(s.commonNet).toBe(240000);
    const [a, b] = s.members;
    expect([a.shareBp, b.shareBp]).toEqual([6000, 4000]);
    expect([a.due, b.due]).toEqual([144000, 96000]);
    expect(a).toMatchObject({ contribution: 11000, toTransfer: 133000, personalLeft: 300000 - 144000 - 5000, income: 300000 });
    expect(b).toMatchObject({ contribution: 0, toTransfer: 96000, personalLeft: 104000 });
  });

  it("arrondi : somme des dus exacte", () => {
    const s = splitMonth(base({ income: { a: 100000, b: 200000 }, plannedCommon: 10001 }));
    expect(s.members.reduce((t, m) => t + m.due, 0)).toBe(10001);
    expect(s.members.reduce((t, m) => t + m.shareBp, 0)).toBe(10000);
  });

  it("arrondi à 3 membres : somme des dus et des parts exacte", () => {
    const s = splitMonth(base({ members: [A, B, { id: "c", name: "Chloé" }], income: { a: 100000, b: 100000, c: 100000 }, plannedCommon: 10000 }));
    expect(s.members.reduce((t, m) => t + m.due, 0)).toBe(10000);
    expect(s.members.reduce((t, m) => t + m.shareBp, 0)).toBe(10000);
    expect(s.members.map((m) => m.shareBp)).toEqual([3334, 3333, 3333]);
  });

  it("sans revenu : parts égales", () => {
    const s = splitMonth(base({ plannedCommon: 1001 }));
    expect(s.members.map((m) => m.shareBp)).toEqual([5000, 5000]);
    expect(s.members.map((m) => m.due)).toEqual([501, 500]); // reliquat au premier à égalité
  });

  it("recettes communes > dépenses : commonNet 0, reste à verser négatif", () => {
    const s = splitMonth(base({ income: { a: 1000, b: 1000 }, plannedCommon: 5000, commonIncome: 8000, paidCommon: { b: 300 } }));
    expect(s.commonNet).toBe(0);
    expect(s.members[1]).toMatchObject({ due: 0, contribution: 300, toTransfer: -300 });
  });

});

describe("getSplit", () => {
  let hh: string;
  const nov = parseMonth("2026-11")!;
  const day = (s: string) => parseDay(s)!;
  const cat = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  });

  it("getSplit : attribution au « payé par » ; recettes communes déduites ; revenus sans catégorie ignorés ; membre désactivé exclu", async () => {
    const admin = (await setupHousehold({ householdName: "Test", name: "Alice", email: "a@test.fr", password: "password1" }))!;
    hh = admin.householdId;
    const all = hh;
    const bob = (await createMember(hh, { name: "Bob", email: "b@test.fr", password: "password1", role: "MEMBER" }))!;
    const ex = (await createMember(hh, { name: "Ex", email: "x@test.fr", password: "password1", role: "MEMBER" }))!;
    const entry = (paidById: string, kind: "INCOME" | "EXPENSE", amount: number, categoryId: string | null, shared?: boolean, on = "2026-11-09") =>
      createEntry(all, admin.id, { paidById, kind, amount, occurredOn: day(on), note: null, categoryId, shared });

    await entry(admin.id, "INCOME", 300000, await cat("Salary 1"));
    await entry(admin.id, "INCOME", 50000, null); // sans catégorie : ignoré
    await entry(admin.id, "EXPENSE", 7000, null); // dépense sans catégorie (perso) : comptée
    await entry(admin.id, "EXPENSE", 2000, null, true); // dépense commune sans catégorie : contribution
    await entry(admin.id, "INCOME", 99999, await cat("Salary 1"), undefined, "2026-10-31"); // hors mois
    await entry(admin.id, "EXPENSE", 11000, await cat("Supermarket"), true);
    await entry(admin.id, "EXPENSE", 5000, await cat("Supermarket"), false);
    await entry(admin.id, "INCOME", 20000, await cat("Other income"), true); // recette commune
    await entry(bob.id, "EXPENSE", 50000, await cat("Rent"), true); // saisie par Alice, payée par Bob
    await entry(bob.id, "INCOME", 200000, await cat("Salary 2"));
    await entry(ex.id, "EXPENSE", 9000, null, true);
    await prisma.user.update({ where: { id: ex.id }, data: { disabledAt: new Date() } });
    const budget = await createBudget(hh, nov);
    await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
    const line = (amount: number, included: boolean, shared: boolean) =>
      addItem(hh, budget.id, { kind: "EXPENSE", parentId: null, label: "l", amount, included, recurring: false, shared, reserve: false });
    await line(95000, true, true); // le prévu commun vient du budget seul
    await line(4000, true, false); // perso : hors commun
    await line(60000, true, true);
    await line(30000, true, false);
    await line(9999, false, true);

    const s = await getSplit(hh, nov);
    expect(s.members.map((m) => m.userId)).toEqual([admin.id, bob.id]);
    expect(s.commonNet).toBe(95000 + 60000 - 20000);
    const [a, b] = s.members;
    expect(a).toMatchObject({ income: 300000, shareBp: 6000, due: 81000, contribution: 13000, toTransfer: 68000, personalLeft: 300000 - 81000 - 5000 - 7000 });
    expect(b).toMatchObject({ income: 200000, shareBp: 4000, due: 54000, contribution: 50000, toTransfer: 4000, personalLeft: 146000 });
  });
});
