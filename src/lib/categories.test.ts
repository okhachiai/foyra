import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import {
  addDefaultCategories, createCategory, DEFAULT_CATEGORIES, deleteCategory, FIXED_DEFAULTS, getCategory, listCategories, parseForecast, setCategoryArchived, updateCategory,
} from "./categories";
import { prisma } from "./db";
import { createEntry, LedgerError, NotFoundError, parseDay, updateEntry } from "./ledger";

let hh: string;
let user: string;
const day = parseDay("2026-10-29")!;
const base = { enabled: true, recurring: true, isTemplate: true, sortOrder: 0 };
const cat = (name: string, kind: "INCOME" | "EXPENSE" = "EXPENSE", parentId: string | null = null) =>
  createCategory(hh, { ...base, name, kind, parentId });
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, householdId: hh } })).id;
const expense = (categoryId: string | null, amount = 4550) =>
  createEntry(hh, user, { paidById: user, kind: "EXPENSE", amount, occurredOn: day, note: null, categoryId });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("catégories", () => {
  it("Setup : modèles de la spécification, ordonnés", async () => {
    const list = await listCategories(hh);
    expect(list.filter((c) => c.kind === "EXPENSE").map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.EXPENSE.map(([n]) => n));
    expect(list.find((c) => c.name === "Income")!.children.map((c) => c.name)).toEqual(["Salary 1", "Salary 2", "Other income"]);
    expect(list.find((c) => c.name === "Family in Morocco")!.children.map((c) => c.name)).toEqual(["Regular transfers", "Transfer fees"]);
    expect(list.find((c) => c.name === "Bills")!.children.every((c) => c.kind === "EXPENSE")).toBe(true);
    expect(list.filter((c) => c.kind === "EXPENSE" && c.fixed).map((c) => c.name)).toEqual([...FIXED_DEFAULTS]);
    const all = await prisma.category.findMany({ where: { householdId: hh } });
    expect(all.every((c) => c.enabled && c.recurring && c.isTemplate && !c.archivedAt)).toBe(true);
  });

  it("Créer : « Vacances » sans montant ; saisie d'un montant prévisionnel", async () => {
    expect(await cat("Vacances")).toMatchObject({ enabled: true, recurring: true, kind: "EXPENSE" });
    expect([parseForecast("150"), parseForecast("0"), parseForecast(""), parseForecast("-3"), parseForecast("abc"), parseForecast("1,234")])
      .toEqual([15000, 0, 0, undefined, undefined, undefined]);
  });

  it("Doublon insensible à la casse au même niveau → erreur sur name ; même nom sous un autre parent accepté", async () => {
    await expect(cat("housing")).rejects.toMatchObject({ field: "name", message: "This name already exists." });
    await expect(cat("Pharmacy", "EXPENSE", await byName("Bills"))).resolves.toBeTruthy();
    const vacances = await cat("Vacances");
    await expect(updateCategory(hh, vacances.id, { ...base, name: "TRANSPORT" })).rejects.toMatchObject({ field: "name" });
  });

  it("Sous-catégorie : sens hérité du parent ; pas de 3e niveau ni de sens différent (contraintes SQL)", async () => {
    const divers = await byName("Miscellaneous and unexpected");
    const sub = await cat("Cadeaux", "INCOME", divers);
    expect(sub.kind).toBe("EXPENSE");
    await expect(cat("Anniversaires", "EXPENSE", sub.id)).rejects.toMatchObject({ field: "parentId" });
    await expect(cat("X", "EXPENSE", "autre-foyer")).rejects.toBeInstanceOf(NotFoundError);
    // Garanties en base même sans passer par l'application.
    await expect(prisma.category.create({ data: { householdId: hh, kind: "EXPENSE", name: "Profond", parentId: sub.id } })).rejects.toThrow();
    await expect(prisma.category.create({ data: { householdId: hh, kind: "INCOME", name: "Sens", parentId: divers } })).rejects.toThrow();
    await expect(prisma.category.update({ where: { id: divers }, data: { parentId: await byName("Housing") } })).rejects.toThrow(); // parent avec enfants
  });

  it("Modifier : inclusion, reprise, modèle, ordre", async () => {
    const id = await byName("Miscellaneous and unexpected");
    await updateCategory(hh, id, { name: "Divers", enabled: false, recurring: false, isTemplate: false, sortOrder: 99 });
    expect(await getCategory(hh, id)).toMatchObject({ name: "Divers", enabled: false, recurring: false, isTemplate: false, sortOrder: 99 });
  });

  it("Rattacher : catégorie de revenu refusée sur une dépense", async () => {
    const marche = await byName("Market");
    const t = await expense(marche);
    expect(t.categoryId).toBe(marche);
    await expect(expense(await byName("Salary 1"))).rejects.toMatchObject({ field: "categoryId", message: "Category incompatible with the transaction type." });
    await expect(updateEntry(hh, t.id, { paidById: user, kind: "INCOME", amount: 100, occurredOn: day, note: null, categoryId: marche })).rejects.toBeInstanceOf(LedgerError);
  });

  it("Archiver : historique conservé, nouvelles saisies refusées, branche archivée, réactivation", async () => {
    const alimentation = await byName("Food");
    const marche = await byName("Market");
    const t = await expense(marche);
    await setCategoryArchived(hh, alimentation, true);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(marche);
    expect((await listCategories(hh)).some((x) => x.name === "Food")).toBe(false);
    await expect(expense(marche)).rejects.toMatchObject({ field: "categoryId", message: "This category is archived." });
    await updateEntry(hh, t.id, { paidById: user, kind: "EXPENSE", amount: 100, occurredOn: day, note: "ok", categoryId: marche }); // inchangée : acceptée
    await expect(setCategoryArchived(hh, marche, false)).rejects.toThrow("Reactivate the parent category first.");
    await setCategoryArchived(hh, alimentation, false);
    expect((await getCategory(hh, alimentation)).archivedAt).toBeNull();
  });

  it("Hors foyer : id inconnu → introuvable partout", async () => {
    await expect(getCategory(hh, "autre")).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCategory(hh, "autre", { ...base, name: "X" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCategoryArchived(hh, "autre", true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(expense("autre")).rejects.toBeInstanceOf(NotFoundError);
    const loyer = await byName("Rent");
    await expect(getCategory("autre-foyer", loyer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCategoryArchived("autre-foyer", loyer, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Modèles manquants : ajoutés sans doublon ni modification des existantes, double clic sûr", async () => {
    const total = await prisma.category.count();
    await prisma.category.updateMany({ where: { name: "Rent" }, data: { sortOrder: 42 } });
    await prisma.category.deleteMany({ where: { name: { in: ["Streaming", "Software"] } } });
    await Promise.all([addDefaultCategories(hh), addDefaultCategories(hh)]);
    expect(await prisma.category.count()).toBe(total);
    expect((await prisma.category.findFirstOrThrow({ where: { name: "Rent" } })).sortOrder).toBe(42);
  });

  it("Supprimer : parent et sous-catégories partent, l'opération reste sans catégorie ; refusé si une récurrence l'utilise", async () => {
    const parent = await cat("Vacances"), sub = await cat("Hôtel", "EXPENSE", parent.id);
    const t = await expense(sub.id);
    await deleteCategory(hh, parent.id);
    expect(await prisma.category.count({ where: { id: { in: [parent.id, sub.id] } } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();

    const loyer = await byName("Rent");
    await prisma.fixedCharge.create({ data: { householdId: hh, name: "Rent", dueDay: 1, categoryId: loyer, startMonth: parseDay("2026-10-01")! } });
    await expect(deleteCategory(hh, await byName("Housing"))).rejects.toThrow(LedgerError);
    await expect(deleteCategory(hh, "absent")).rejects.toThrow(NotFoundError);
  });
});
