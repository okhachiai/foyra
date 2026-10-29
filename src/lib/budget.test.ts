import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { addMonths, ensureMonth, getBudget, parseMonth, savePlanned, summarize } from "./budget";
import { parseForecast, updateCategory } from "./categories";
import { prisma } from "./db";
import { createEntry, createTransfer, parseDay } from "./ledger";

let hh: string;
let user: string;
const oct = parseMonth("2026-10")!;
const nov = parseMonth("2026-11")!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
const setCat = (name: string, data: { forecastAmount?: number | null; carryOver?: "PREVIOUS" | "FORECAST" | "NONE"; enabled?: boolean }) =>
  prisma.category.updateMany({ where: { name }, data });
const row = async (month: Date, name: string) => (await getBudget(hh, month)).rows.find((r) => r.label === name);
const account = async () => (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING" } })).id;
const entry = (accountId: string, kind: "INCOME" | "EXPENSE", categoryId: string | null, amount: number, day: string) =>
  createEntry(hh, user, { accountId, kind, amount, occurredOn: parseDay(day)!, note: null, categoryId });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("budget mensuel", () => {
  it("FORECAST : prévisionnel 400 € → prévu 400 €", async () => {
    await setCat("Courses", { forecastAmount: 40000 });
    expect((await row(nov, "Courses"))?.planned).toBe(40000);
  });

  it("PREVIOUS : reprend la ligne antérieure la plus récente, sinon le prévisionnel", async () => {
    await setCat("Loyer", { forecastAmount: 90000, carryOver: "PREVIOUS" });
    await savePlanned(hh, oct, new Map([[await byName("Loyer"), 95000]]));
    expect((await row(nov, "Loyer"))?.planned).toBe(95000);
    expect((await row(addMonths(oct, -1), "Loyer"))?.planned).toBe(90000); // aucune ligne antérieure
  });

  it("NONE : prévu vide « à saisir », compte 0", async () => {
    await setCat("Électricité", { forecastAmount: 8000, carryOver: "NONE" });
    const b = await getBudget(hh, nov);
    expect(b.rows.find((r) => r.label === "Factures › Électricité")?.planned).toBeNull();
    expect(b.totals.expensePlanned).toBe(0);
  });

  it("Instantané : mois déjà ouvert inchangé ; ouvertures simultanées → une seule ligne", async () => {
    await setCat("Courses", { forecastAmount: 40000 });
    await Promise.all([ensureMonth(hh, nov), ensureMonth(hh, nov), getBudget(hh, nov)]);
    const courses = await byName("Courses");
    expect(await prisma.budgetLine.count({ where: { categoryId: courses, month: nov } })).toBe(1);
    await setCat("Courses", { forecastAmount: 99900 });
    expect((await row(nov, "Courses"))?.planned).toBe(40000);
  });

  it("Modifier : « 450 » → 45000 centimes, totaux recalculés ; saisies invalides refusées", async () => {
    const courses = await byName("Courses");
    await savePlanned(hh, nov, new Map([[courses, parseForecast("450")!]]));
    const b = await getBudget(hh, nov);
    expect(b.rows.find((r) => r.id === courses)?.planned).toBe(45000);
    expect(b.totals.expensePlanned).toBe(45000);
    expect([parseForecast("-3"), parseForecast("abc")]).toEqual([undefined, undefined]);
    await expect(prisma.budgetLine.updateMany({ where: { categoryId: courses }, data: { planned: -1 } })).rejects.toThrow();
    await savePlanned(hh, nov, new Map([["autre-foyer", 100]])); // id inconnu ignoré
  });

  it("Bornes du mois : 31/10 en octobre, 01/11 en novembre", async () => {
    const c = await account();
    const courses = await byName("Courses");
    await entry(c, "EXPENSE", courses, 1000, "2026-10-31");
    await entry(c, "EXPENSE", courses, 2000, "2026-11-01");
    expect((await row(oct, "Courses"))?.actual).toBe(1000);
    expect((await row(nov, "Courses"))?.actual).toBe(2000);
  });

  it("Exclusion : catégorie désactivée ou sous-catégorie d'un parent désactivé absente", async () => {
    await setCat("Loisirs", { enabled: false, forecastAmount: 5000 });
    await setCat("Factures", { enabled: false });
    await setCat("Gaz", { forecastAmount: 3000 });
    const b = await getBudget(hh, nov);
    expect(b.rows.some((r) => r.label === "Loisirs" || r.label.startsWith("Factures"))).toBe(false);
    expect(b.totals.expensePlanned).toBe(0);
  });

  it("Totaux : restant à payer, disponible, reste à vivre ; dépassement", () => {
    const rows = [
      { id: "s", kind: "INCOME" as const, label: "Salaires", planned: 300000, actual: 250000 },
      { id: "l", kind: "EXPENSE" as const, label: "Loyer", planned: 95000, actual: 95000 },
      { id: "c", kind: "EXPENSE" as const, label: "Courses", planned: 40000, actual: 15000 },
    ];
    expect(summarize(rows)).toEqual({
      incomePlanned: 300000, incomeActual: 250000, expensePlanned: 135000, expenseActual: 110000, remainingToPay: 25000, restToLive: 165000,
      fixedTotal: 0, fixedPaid: 0, fixedRemaining: 0, variableActual: 110000,
    });
    const over = summarize([{ id: "c", kind: "EXPENSE", label: "Courses", planned: 40000, actual: 50000 }]);
    expect(over.remainingToPay).toBe(0);
    expect(over.restToLive).toBe(-50000);
  });

  it("Hors calcul : sans catégorie et virement exclus des totaux, total sans catégorie signalé", async () => {
    const c = await account();
    const e = (await prisma.account.create({ data: { householdId: hh, name: "Épargne", kind: "SAVINGS" } })).id;
    await entry(c, "EXPENSE", null, 1234, "2026-11-05");
    await createTransfer(hh, user, { fromAccountId: c, toAccountId: e, amount: 5000, occurredOn: parseDay("2026-11-05")!, note: null });
    await updateCategory(hh, await byName("Loisirs"), { name: "Loisirs", forecastAmount: null, carryOver: "FORECAST", enabled: false });
    await entry(c, "EXPENSE", await byName("Loisirs"), 100, "2026-11-06");
    const b = await getBudget(hh, nov);
    expect(b.totals.expenseActual).toBe(0);
    expect(b.outside).toEqual({ EXPENSE: 1334, INCOME: 0 });
  });

  it("Mois invalide : ?m=2026-13 → null (mois courant côté page)", () => {
    expect([parseMonth("2026-13"), parseMonth("abc"), parseMonth(undefined), parseMonth("0000-01"), parseMonth("0050-03")]).toEqual([null, null, null, null, null]);
    expect(parseMonth("2026-11")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
