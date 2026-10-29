import { beforeEach, describe, expect, it } from "vitest";
import { fullScope, type Scope } from "./access";
import { createMember, setupHousehold } from "./auth";
import { addItem, createBudget, parseMonth } from "./budget";
import { createCharge } from "./charges";
import { prisma } from "./db";
import { createAccount, createEntry, createTransfer, parseDay } from "./ledger";
import { getSplit, splitMonth, visibleSplit, type SplitInput } from "./split";

const A = { id: "a", name: "Alice" };
const B = { id: "b", name: "Bob" };
const base = (over: Partial<SplitInput>): SplitInput => ({
  members: [A, B], income: {}, forecast: {}, commonIncome: 0, plannedCommon: 0, toCommon: {}, paidCommon: {}, spentPersonal: {}, ...over,
});

describe("splitMonth", () => {
  it("prorata 60/40 avec facture commune payée en perso", () => {
    const s = splitMonth(base({ income: { a: 300000, b: 200000 }, plannedCommon: 240000, paidCommon: { a: 11000 }, spentPersonal: { a: 5000 } }));
    expect(s.commonNet).toBe(240000);
    const [a, b] = s.members;
    expect([a.shareBp, b.shareBp]).toEqual([6000, 4000]);
    expect([a.due, b.due]).toEqual([144000, 96000]);
    expect(a).toMatchObject({ contribution: 11000, toTransfer: 133000, personalLeft: 300000 - 144000 - 5000, forecast: false, income: 300000 });
    expect(b).toMatchObject({ contribution: 0, toTransfer: 96000, personalLeft: 104000 });
  });

  it("arrondi : somme des dus exacte", () => {
    const s = splitMonth(base({ income: { a: 100000, b: 200000 }, plannedCommon: 10001 }));
    expect(s.members.reduce((t, m) => t + m.due, 0)).toBe(10001);
    expect(s.members.reduce((t, m) => t + m.shareBp, 0)).toBe(10000);
  });

  it("sans revenu : parts égales", () => {
    const s = splitMonth(base({ plannedCommon: 1001 }));
    expect(s.members.map((m) => m.shareBp)).toEqual([5000, 5000]);
    expect(s.members.map((m) => m.due)).toEqual([501, 500]); // reliquat au premier à égalité
  });

  it("recettes communes > dépenses : commonNet 0, reste à virer négatif", () => {
    const s = splitMonth(base({ income: { a: 1000, b: 1000 }, plannedCommon: 5000, commonIncome: 8000, toCommon: { b: 300 } }));
    expect(s.commonNet).toBe(0);
    expect(s.members[1]).toMatchObject({ due: 0, contribution: 300, toTransfer: -300 });
  });

  it("revenu prévisionnel utilisé tant qu'aucun salaire n'est saisi", () => {
    const s = splitMonth(base({ income: { a: 300000 }, forecast: { a: 999999, b: 100000 }, plannedCommon: 40000 }));
    expect(s.members[0]).toMatchObject({ income: 300000, forecast: false, shareBp: 7500, due: 30000 });
    expect(s.members[1]).toMatchObject({ income: 100000, forecast: true, shareBp: 2500, due: 10000 });
  });

  it("visibleSplit : membre sans lecture des comptes de l'autre → revenu et reste perso masqués", () => {
    const s = splitMonth(base({ income: { a: 300000, b: 200000 }, plannedCommon: 1000 }));
    const scope: Scope = { householdId: "h", read: ["a2", "b1"], write: [], manage: [] };
    const owned = { a: ["a1", "a2"], b: ["b1"] };
    const v = visibleSplit(s, { id: "b", role: "MEMBER" }, scope, owned);
    expect(v.members[0]).toMatchObject({ income: null, personalLeft: null, shareBp: 6000, due: 600, toTransfer: 600 });
    expect(v.members[1].income).toBe(200000); // soi-même
    expect(visibleSplit(s, { id: "b", role: "MEMBER" }, { ...scope, read: ["a1", "a2"] }, owned).members[0].income).toBe(300000);
    // Absent de ownedBy : masqué par défaut.
    expect(visibleSplit(s, { id: "b", role: "MEMBER" }, { ...scope, read: ["a1", "a2"] }, { b: ["b1"] }).members[0]).toMatchObject({ income: null, personalLeft: null });
    expect(visibleSplit(s, { id: "b", role: "ADMIN" }, scope, owned).members[0].income).toBe(300000);
  });
});

describe("getSplit", () => {
  let hh: string;
  const nov = parseMonth("2026-11")!;
  const day = (s: string) => parseDay(s)!;
  const cat = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  });

  it("getSplit : virement perso → commun compté en contribution ; revenus sans catégorie ignorés, dépenses sans catégorie comptées", async () => {
    const admin = (await setupHousehold({ householdName: "Test", name: "Alice", email: "a@test.fr", password: "password1" }))!;
    hh = admin.householdId;
    const all = fullScope(hh);
    const bob = (await createMember(hh, { name: "Bob", email: "b@test.fr", password: "password1", role: "MEMBER" }))!;
    await createMember(hh, { name: "Sans compte", email: "g@test.fr", password: "password1", role: "MEMBER" });
    const acc = async (name: string, ownerId: string | null) => (await createAccount(all, admin.id, { name, kind: "CHECKING", initialBalance: 0, ownerId })).id;
    const pa = await acc("Perso A", admin.id);
    const pb = await acc("Perso B", bob.id);
    const commun = await acc("Commun", null);
    const entry = (accountId: string, kind: "INCOME" | "EXPENSE", amount: number, categoryId: string | null, shared?: boolean, on = "2026-11-09") =>
      createEntry(all, admin.id, { accountId, kind, amount, occurredOn: day(on), note: null, categoryId, shared });

    await entry(pa, "INCOME", 300000, await cat("Salaire 1"));
    await entry(pa, "INCOME", 50000, null); // ajustement : ignoré
    await entry(pa, "EXPENSE", 7000, null); // dépense sans catégorie (perso) : comptée
    await entry(pa, "EXPENSE", 2000, null, true); // dépense commune sans catégorie : contribution
    await entry(pa, "INCOME", 99999, await cat("Salaire 1"), undefined, "2026-10-31"); // hors mois
    await entry(pa, "EXPENSE", 11000, await cat("Supermarché"), true);
    await entry(pa, "EXPENSE", 5000, await cat("Supermarché"), false);
    await entry(commun, "INCOME", 20000, await cat("Autres revenus"));
    await createTransfer(all, admin.id, { fromAccountId: pb, toAccountId: commun, amount: 50000, occurredOn: day("2026-11-03"), note: null });
    await createTransfer(all, admin.id, { fromAccountId: pa, toAccountId: pb, amount: 1000, occurredOn: day("2026-11-03"), note: null }); // perso → perso
    const charge = (kind: "INCOME" | "EXPENSE", accountId: string, amount: number, categoryId: string, shared: boolean) =>
      createCharge(all, { kind, active: true, name: "c", amount, dueDay: 5, accountId, categoryId, startMonth: nov, endMonth: null, shared });
    await charge("INCOME", pb, 200000, await cat("Salaire 2"), false); // prévisionnel de Bob
    await charge("EXPENSE", commun, 95000, await cat("Loyer"), true);
    await charge("EXPENSE", pa, 4000, await cat("Loyer"), false); // perso : hors commun
    const budget = await createBudget(hh, nov);
    await prisma.budgetItem.deleteMany({ where: { budgetId: budget.id } });
    const line = (amount: number, included: boolean, shared: boolean) =>
      addItem(hh, budget.id, { kind: "EXPENSE", parentId: null, label: "l", amount, included, recurring: false, shared, reserve: false });
    await line(60000, true, true);
    await line(30000, true, false);
    await line(9999, false, true);

    const s = await getSplit(hh, nov);
    expect(s.members.map((m) => m.userId)).toEqual([admin.id, bob.id]); // ghost : aucun compte
    expect(s.commonNet).toBe(95000 + 60000 - 20000);
    const [a, b] = s.members;
    expect(a).toMatchObject({ income: 300000, forecast: false, shareBp: 6000, due: 81000, contribution: 13000, toTransfer: 68000, personalLeft: 300000 - 81000 - 5000 - 7000 });
    expect(b).toMatchObject({ income: 200000, forecast: true, shareBp: 4000, due: 54000, contribution: 50000, toTransfer: 4000, personalLeft: 146000 });
  });
});
