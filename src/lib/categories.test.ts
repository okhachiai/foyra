import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import {
  addDefaultCategories, createCategory, DEFAULT_CATEGORIES, deleteCategory, FIXED_DEFAULTS, getCategory, listCategories, parseForecast, setCategoryArchived, updateCategory,
} from "./categories";
import { fullScope } from "./access";
import { prisma } from "./db";
import { accountBalance, createEntry, createTransfer, LedgerError, NotFoundError, parseDay, updateEntry } from "./ledger";

let hh: string;
let user: string;
const day = parseDay("2026-10-29")!;
const base = { forecastAmount: 0, enabled: true, recurring: true, isTemplate: true, sortOrder: 0 };
const cat = (name: string, kind: "INCOME" | "EXPENSE" = "EXPENSE", parentId: string | null = null, forecastAmount = 0) =>
  createCategory(hh, { ...base, name, kind, parentId, forecastAmount });
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
const account = async () => (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING", initialBalance: 100000 } })).id;
const expense = (accountId: string, categoryId: string | null, amount = 4550) =>
  createEntry(fullScope(hh), user, { accountId, kind: "EXPENSE", amount, occurredOn: day, note: null, categoryId });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("catégories", () => {
  it("Setup : modèles de la spécification, montants à zéro, ordonnés", async () => {
    const list = await listCategories(hh);
    expect(list.filter((c) => c.kind === "EXPENSE").map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.EXPENSE.map(([n]) => n));
    expect(list.find((c) => c.name === "Revenus")!.children.map((c) => c.name)).toEqual(["Salaire 1", "Salaire 2", "Autres revenus"]);
    expect(list.find((c) => c.name === "Famille au Maroc")!.children.map((c) => c.name)).toEqual(["Envois réguliers", "Frais de transfert"]);
    expect(list.find((c) => c.name === "Factures")!.children.every((c) => c.kind === "EXPENSE")).toBe(true);
    expect(list.filter((c) => c.kind === "EXPENSE" && c.fixed).map((c) => c.name)).toEqual([...FIXED_DEFAULTS]);
    const all = await prisma.category.findMany({ where: { householdId: hh } });
    expect(all.every((c) => c.forecastAmount === 0 && c.enabled && c.recurring && c.isTemplate && !c.archivedAt)).toBe(true);
  });

  it("Créer : « Vacances » 150 € → 15000 centimes ; montant négatif refusé en base ; saisie du montant", async () => {
    const c = await cat("Vacances", "EXPENSE", null, 15000);
    expect(c).toMatchObject({ forecastAmount: 15000, enabled: true, recurring: true, kind: "EXPENSE" });
    await expect(cat("Négatif", "EXPENSE", null, -300)).rejects.toThrow();
    expect([parseForecast("150"), parseForecast("0"), parseForecast(""), parseForecast("-3"), parseForecast("abc"), parseForecast("1,234")])
      .toEqual([15000, 0, 0, undefined, undefined, undefined]);
  });

  it("Doublon insensible à la casse au même niveau → erreur sur name ; même nom sous un autre parent accepté", async () => {
    await expect(cat("logement")).rejects.toMatchObject({ field: "name", message: "Ce nom existe déjà." });
    await expect(cat("Pharmacie", "EXPENSE", await byName("Factures"))).resolves.toBeTruthy();
    const vacances = await cat("Vacances");
    await expect(updateCategory(hh, vacances.id, { ...base, name: "TRANSPORT" })).rejects.toMatchObject({ field: "name" });
  });

  it("Sous-catégorie : sens hérité du parent ; pas de 3e niveau ni de sens différent (contraintes SQL)", async () => {
    const divers = await byName("Divers et imprévus");
    const sub = await cat("Cadeaux", "INCOME", divers);
    expect(sub.kind).toBe("EXPENSE");
    await expect(cat("Anniversaires", "EXPENSE", sub.id)).rejects.toMatchObject({ field: "parentId" });
    await expect(cat("X", "EXPENSE", "autre-foyer")).rejects.toBeInstanceOf(NotFoundError);
    // Garanties en base même sans passer par l'application.
    await expect(prisma.category.create({ data: { householdId: hh, kind: "EXPENSE", name: "Profond", parentId: sub.id } })).rejects.toThrow();
    await expect(prisma.category.create({ data: { householdId: hh, kind: "INCOME", name: "Sens", parentId: divers } })).rejects.toThrow();
    await expect(prisma.category.update({ where: { id: divers }, data: { parentId: await byName("Logement") } })).rejects.toThrow(); // parent avec enfants
  });

  it("Modifier : inclusion, reprise, modèle, ordre", async () => {
    const id = await byName("Divers et imprévus");
    await updateCategory(hh, id, { name: "Divers", enabled: false, forecastAmount: 5000, recurring: false, isTemplate: false, sortOrder: 99 });
    expect(await getCategory(hh, id)).toMatchObject({ name: "Divers", enabled: false, forecastAmount: 5000, recurring: false, isTemplate: false, sortOrder: 99 });
  });

  it("Rattacher : catégorie de revenu refusée sur une dépense ; virement jamais catégorisé", async () => {
    const c = await account();
    const marche = await byName("Marché");
    const t = await expense(c, marche);
    expect(t.categoryId).toBe(marche);
    await expect(expense(c, await byName("Salaire 1"))).rejects.toMatchObject({ field: "categoryId", message: "Catégorie incompatible avec le type d’opération." });
    await expect(updateEntry(fullScope(hh), t.id, { accountId: c, kind: "INCOME", amount: 100, occurredOn: day, note: null, categoryId: marche })).rejects.toBeInstanceOf(LedgerError);
    const e = (await prisma.account.create({ data: { householdId: hh, name: "Épargne", kind: "SAVINGS" } })).id;
    await createTransfer(fullScope(hh), user, { fromAccountId: c, toAccountId: e, amount: 100, occurredOn: day, note: null });
    await expect(prisma.transaction.updateMany({ where: { kind: "TRANSFER" }, data: { categoryId: marche } })).rejects.toThrow();
  });

  it("Archiver : historique conservé, nouvelles saisies refusées, branche archivée, réactivation", async () => {
    const c = await account();
    const alimentation = await byName("Alimentation");
    const marche = await byName("Marché");
    const t = await expense(c, marche);
    const before = await accountBalance(fullScope(hh), c);
    await setCategoryArchived(hh, alimentation, true);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(marche);
    expect(await accountBalance(fullScope(hh), c)).toBe(before);
    expect((await listCategories(hh)).some((x) => x.name === "Alimentation")).toBe(false);
    await expect(expense(c, marche)).rejects.toMatchObject({ field: "categoryId", message: "Cette catégorie est archivée." });
    await updateEntry(fullScope(hh), t.id, { accountId: c, kind: "EXPENSE", amount: 100, occurredOn: day, note: "ok", categoryId: marche }); // inchangée : acceptée
    await expect(setCategoryArchived(hh, marche, false)).rejects.toThrow("Réactivez d’abord la catégorie parente.");
    await setCategoryArchived(hh, alimentation, false);
    expect((await getCategory(hh, alimentation)).archivedAt).toBeNull();
  });

  it("Hors foyer : id inconnu → introuvable partout", async () => {
    const c = await account();
    await expect(getCategory(hh, "autre")).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCategory(hh, "autre", { ...base, name: "X" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCategoryArchived(hh, "autre", true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(expense(c, "autre")).rejects.toBeInstanceOf(NotFoundError);
    const loyer = await byName("Loyer");
    await expect(getCategory("autre-foyer", loyer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCategoryArchived("autre-foyer", loyer, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Modèles manquants : ajoutés sans doublon ni modification des existantes, double clic sûr", async () => {
    const total = await prisma.category.count();
    await prisma.category.updateMany({ where: { name: "Loyer" }, data: { forecastAmount: 90000 } });
    await prisma.category.deleteMany({ where: { name: { in: ["Streaming", "Logiciels"] } } });
    await Promise.all([addDefaultCategories(hh), addDefaultCategories(hh)]);
    expect(await prisma.category.count()).toBe(total);
    expect((await prisma.category.findFirstOrThrow({ where: { name: "Loyer" } })).forecastAmount).toBe(90000);
  });

  it("Supprimer : parent et sous-catégories partent, l'opération reste sans catégorie ; refusé si une récurrence l'utilise", async () => {
    const a = await account();
    const parent = await cat("Vacances"), sub = await cat("Hôtel", "EXPENSE", parent.id);
    const t = await expense(a, sub.id);
    await deleteCategory(hh, parent.id);
    expect(await prisma.category.count({ where: { id: { in: [parent.id, sub.id] } } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();

    const loyer = await byName("Loyer");
    await prisma.fixedCharge.create({ data: { householdId: hh, name: "Loyer", amount: 1, dueDay: 1, accountId: a, categoryId: loyer, startMonth: parseDay("2026-10-01")! } });
    await expect(deleteCategory(hh, await byName("Logement"))).rejects.toThrow(LedgerError);
    await expect(deleteCategory(hh, "absent")).rejects.toThrow(NotFoundError);
  });
});
