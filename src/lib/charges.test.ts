import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { getBudget, parseMonth, savePlanned } from "./budget";
import { deleteCategory } from "./categories";
import { appliesTo, createCharge, deleteCharge, dueDate, listMonthCharges, payCharge, updateCharge, type ChargeInput } from "./charges";
import { fullScope } from "./access";
import { prisma } from "./db";
import { createEntry, deleteTransaction, formatDay, LedgerError, parseDay, updateEntry } from "./ledger";

let hh: string;
let user: string;
let courant: string;
const oct = parseMonth("2026-10")!;
const nov = parseMonth("2026-11")!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
const charge = async (over: Partial<ChargeInput> = {}) =>
  createCharge(fullScope(hh), { name: "Loyer", amount: 95000, dueDay: 5, accountId: courant, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, ...over });
const pay = (id: string, amount: number, day: string, month = nov) => payCharge(fullScope(hh), user, id, month, amount, parseDay(day)!);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
  courant = (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING" } })).id;
});

describe("charges fixes", () => {
  it("Créer : active dès le mois de début ; montant, jour, catégorie de revenu, compte archivé refusés", async () => {
    await charge();
    expect((await listMonthCharges(fullScope(hh), nov)).map((c) => c.name)).toEqual(["Loyer"]);
    await expect(charge({ amount: 0 })).rejects.toThrow(); // CHECK SQL (l'action refuse « 0 »/« abc » via parseCents)
    await expect(charge({ dueDay: 32 })).rejects.toThrow();
    await expect(charge({ dueDay: 0 })).rejects.toThrow();
    await expect(charge({ categoryId: await byName("Salaires") })).rejects.toMatchObject({ field: "categoryId" });
    const old = (await prisma.account.create({ data: { householdId: hh, name: "Vieux", kind: "CHECKING", archivedAt: new Date() } })).id;
    await expect(charge({ accountId: old })).rejects.toMatchObject({ field: "accountId" });
  });

  it("Échéance : jour 31 en février 2027 → 28/02/2027", () => {
    expect(formatDay(dueDate({ dueDay: 31 }, parseMonth("2027-02")!))).toBe("2027-02-28");
    expect(formatDay(dueDate({ dueDay: 5 }, nov))).toBe("2026-11-05");
  });

  it("Période : début 2026-11, dernier mois 2027-01 → absente en octobre et février ; fin < début refusée", async () => {
    const c = await charge({ endMonth: parseMonth("2027-01") });
    expect([oct, nov, parseMonth("2027-01")!, parseMonth("2027-02")!].map((m) => appliesTo(c, m))).toEqual([false, true, true, false]);
    expect(await listMonthCharges(fullScope(hh), oct)).toEqual([]);
    await expect(charge({ endMonth: oct })).rejects.toMatchObject({ field: "endMonth" });
    await expect(updateCharge(fullScope(hh), c.id, { ...c, endMonth: oct })).rejects.toMatchObject({ field: "endMonth" });
  });

  it("Marquer payée : dépense créée ; date hors mois refusée ; second paiement / concurrence → « déjà payée »", async () => {
    const c = await charge();
    await expect(pay(c.id, 95000, "2026-12-01")).rejects.toMatchObject({ field: "occurredOn" });
    const results = await Promise.allSettled([pay(c.id, 95000, "2026-11-05"), pay(c.id, 95000, "2026-11-05")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(LedgerError);
    expect(rejected.reason.message).toBe("Cette charge est déjà payée pour ce mois.");
    const [listed] = await listMonthCharges(fullScope(hh), nov);
    expect(listed.payment?.transaction).toMatchObject({ amount: 95000, accountId: courant, categoryId: c.categoryId, kind: "EXPENSE" });
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("Annuler : supprimer la dépense liée repasse la charge « à payer »", async () => {
    const c = await charge();
    const p = await pay(c.id, 95000, "2026-11-05");
    await deleteTransaction(fullScope(hh), p.transactionId);
    expect((await listMonthCharges(fullScope(hh), nov))[0].payment).toBeNull();
  });

  it("Modifier la dépense liée : date hors du mois payé ou passage en recette refusés", async () => {
    const c = await charge();
    const p = await pay(c.id, 95000, "2026-11-05");
    const base = { accountId: courant, kind: "EXPENSE" as const, amount: 90000, occurredOn: parseDay("2026-11-20")!, note: null, categoryId: c.categoryId };
    await updateEntry(fullScope(hh), p.transactionId, base); // dans le mois : accepté
    await expect(updateEntry(fullScope(hh), p.transactionId, { ...base, occurredOn: parseDay("2026-12-01")! })).rejects.toMatchObject({ field: "occurredOn" });
    await expect(updateEntry(fullScope(hh), p.transactionId, { ...base, kind: "INCOME", categoryId: null })).rejects.toMatchObject({ field: "kind" });
  });

  it("Budget : fixes 1 030 dont 80 à payer ; variables 150 ; restant à payer 330", async () => {
    const loyer = await charge();
    await charge({ name: "Assurance", amount: 8000, categoryId: await byName("Habitation") });
    const courses = await byName("Courses");
    await savePlanned(hh, nov, new Map([[loyer.categoryId, 95000], [courses, 40000], [await byName("Habitation"), 0]]));
    await pay(loyer.id, 95000, "2026-11-05");
    await createEntry(fullScope(hh), user, { accountId: courant, kind: "EXPENSE", amount: 15000, occurredOn: parseDay("2026-11-10")!, note: null, categoryId: courses });
    const { totals } = await getBudget(fullScope(hh), nov);
    expect(totals).toMatchObject({ fixedTotal: 103000, fixedRemaining: 8000, fixedPaid: 95000, variableActual: 15000, remainingToPay: 33000 });
  });

  it("Exclusion : charge d'une catégorie désactivée listée sur /charges, hors totaux du budget", async () => {
    await prisma.category.updateMany({ where: { name: "Loisirs" }, data: { enabled: false } });
    await charge({ name: "Club", amount: 3000, categoryId: await byName("Loisirs") });
    expect(await listMonthCharges(fullScope(hh), nov)).toHaveLength(1);
    expect((await getBudget(fullScope(hh), nov)).totals).toMatchObject({ fixedTotal: 0, remainingToPay: 0 });
  });

  it("Supprimer charge : dépenses conservées, comptées comme variables", async () => {
    const c = await charge();
    await pay(c.id, 95000, "2026-11-05");
    await deleteCharge(fullScope(hh), c.id);
    expect(await prisma.transaction.count()).toBe(1);
    expect((await getBudget(fullScope(hh), nov)).totals).toMatchObject({ fixedTotal: 0, variableActual: 95000 });
  });

  it("Supprimer catégorie utilisée par une charge : refus", async () => {
    const c = await charge();
    await expect(deleteCategory(hh, c.categoryId)).rejects.toThrow("Cette catégorie est utilisée par une charge fixe.");
  });
});
