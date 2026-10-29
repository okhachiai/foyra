import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { addDefaultCategories, createCategory, deleteCategory, getCategory, listCategories, parseForecast, updateCategory } from "./categories";
import { fullScope } from "./access";
import { prisma } from "./db";
import { accountBalance, createEntry, createTransfer, LedgerError, NotFoundError, parseDay, updateEntry } from "./ledger";

let hh: string;
let user: string;
const day = parseDay("2026-10-29")!;
const base = { forecastAmount: null, carryOver: "FORECAST" as const, enabled: true };
const cat = (name: string, kind: "INCOME" | "EXPENSE" = "EXPENSE", parentId: string | null = null, forecastAmount: number | null = null) =>
  createCategory(hh, { ...base, name, kind, parentId, forecastAmount });
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name, parentId: null } })).id;
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
  it("Setup : catégories par défaut créées avec le foyer", async () => {
    const list = await listCategories(hh);
    const factures = list.find((c) => c.name === "Factures")!;
    expect(factures.kind).toBe("EXPENSE");
    expect(factures.children.map((c) => c.name)).toContain("Électricité");
    expect(factures.children.every((c) => c.kind === "EXPENSE")).toBe(true);
    expect(list.find((c) => c.name === "Salaires")?.kind).toBe("INCOME");
    expect(list.every((c) => c.forecastAmount === null && c.carryOver === "FORECAST" && c.enabled)).toBe(true);
  });

  it("Créer : « Vacances » 150 € → 15000 centimes, FORECAST, activée ; prévisionnel négatif refusé en base", async () => {
    const c = await cat("Vacances", "EXPENSE", null, 15000);
    expect(c).toMatchObject({ forecastAmount: 15000, carryOver: "FORECAST", enabled: true, kind: "EXPENSE" });
    await expect(cat("Négatif", "EXPENSE", null, -300)).rejects.toThrow();
    expect([parseForecast("150"), parseForecast("0"), parseForecast(""), parseForecast("-3"), parseForecast("abc")]).toEqual([15000, 0, null, undefined, undefined]);
  });

  it("Doublon insensible à la casse au même niveau → erreur sur name ; même nom sous un autre parent accepté", async () => {
    await expect(cat("loyer")).rejects.toMatchObject({ field: "name", message: "Ce nom existe déjà." });
    await expect(cat("santé", "EXPENSE", await byName("Factures"))).resolves.toBeTruthy();
    const vacances = await cat("Vacances");
    await expect(updateCategory(hh, vacances.id, { ...base, name: "COURSES" })).rejects.toMatchObject({ field: "name" });
  });

  it("Sous-catégorie : sens hérité du parent ; parent inconnu ou déjà sous-catégorie → refus", async () => {
    const loisirs = await byName("Loisirs");
    const sub = await cat("Cinéma", "INCOME", loisirs);
    expect(sub.kind).toBe("EXPENSE");
    await expect(cat("Séance", "EXPENSE", sub.id)).rejects.toMatchObject({ field: "parentId" });
    await expect(cat("X", "EXPENSE", "autre-foyer")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Désactiver : enabled = false", async () => {
    const id = await byName("Loisirs");
    await updateCategory(hh, id, { ...base, name: "Loisirs", enabled: false, forecastAmount: 5000, carryOver: "NONE" });
    expect(await getCategory(hh, id)).toMatchObject({ enabled: false, forecastAmount: 5000, carryOver: "NONE" });
  });

  it("Rattacher : dépense liée à « Courses » ; catégorie de revenu refusée sur categoryId ; virement jamais catégorisé", async () => {
    const c = await account();
    const courses = await byName("Courses");
    const t = await expense(c, courses);
    expect(t.categoryId).toBe(courses);
    const salaires = await byName("Salaires");
    await expect(expense(c, salaires)).rejects.toMatchObject({ field: "categoryId", message: "Catégorie incompatible avec le type d’opération." });
    await expect(updateEntry(fullScope(hh), t.id, { accountId: c, kind: "INCOME", amount: 100, occurredOn: day, note: null, categoryId: courses })).rejects.toBeInstanceOf(LedgerError);
    const e = (await prisma.account.create({ data: { householdId: hh, name: "Épargne", kind: "SAVINGS" } })).id;
    await createTransfer(fullScope(hh), user, { fromAccountId: c, toAccountId: e, amount: 100, occurredOn: day, note: null });
    await expect(prisma.transaction.updateMany({ where: { kind: "TRANSFER" }, data: { categoryId: courses } })).rejects.toThrow();
  });

  it("Supprimer : opérations « Sans catégorie », solde inchangé ; refus avec sous-catégories", async () => {
    const c = await account();
    const courses = await byName("Courses");
    const t = await expense(c, courses);
    const before = await accountBalance(fullScope(hh), c);
    await deleteCategory(hh, courses);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();
    expect(await accountBalance(fullScope(hh), c)).toBe(before);
    await expect(deleteCategory(hh, await byName("Factures"))).rejects.toBeInstanceOf(LedgerError);
  });

  it("Hors foyer : id inconnu → introuvable partout", async () => {
    const c = await account();
    await expect(getCategory(hh, "autre")).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCategory(hh, "autre", { ...base, name: "X" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCategory(hh, "autre")).rejects.toBeInstanceOf(NotFoundError);
    await expect(expense(c, "autre")).rejects.toBeInstanceOf(NotFoundError);
    const loyer = await byName("Loyer");
    await expect(getCategory("autre-foyer", loyer)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteCategory("autre-foyer", loyer)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Défauts à la demande : seulement si aucune catégorie", async () => {
    const total = await prisma.category.count();
    await addDefaultCategories(hh);
    expect(await prisma.category.count()).toBe(total);
    await prisma.category.deleteMany({ where: { parentId: { not: null } } });
    await prisma.category.deleteMany();
    await Promise.all([addDefaultCategories(hh), addDefaultCategories(hh)]);
    expect(await prisma.category.count()).toBe(total);
  });
});
