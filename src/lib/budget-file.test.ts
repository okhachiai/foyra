import { beforeEach, describe, expect, it } from "vitest";
import { addMonths } from "./amortization";
import { createMember, setupHousehold } from "./auth";
import { actualTotals, createBudget, getBudget, parseMonth, setBudgetStatus } from "./budget";
import { exportMonth, importMonth, parseMonthFile } from "./budget-file";
import { createCharge, listMonthCharges, payCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, formatDay, parseDay } from "./ledger";
import { createLoan, prepay } from "./loans";

let hh = "", admin = "", bob = "";
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  const a = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  [hh, admin] = [a.householdId, a.id];
  bob = (await createMember(hh, { name: "Bob", email: "bob@test.fr", password: "password1", role: "MEMBER" }))!.id;
});

const nov = parseMonth("2026-11")!;
const dec = parseMonth("2026-12")!;
const day = (s: string) => parseDay(s)!;

/** Tout ce que l'application affiche du mois, sans identifiants. */
async function snapshot(month: Date) {
  const b = await getBudget(hh, month);
  const line = (l: { kind: string; label: string; amount: number; categoryId: string | null; included: boolean; recurring: boolean; shared: boolean; reserve: boolean; actual: number }) =>
    [l.kind, l.label, l.amount, l.categoryId, l.included, l.recurring, l.shared, l.reserve, l.actual];
  const tx = await prisma.transaction.findMany({
    where: { householdId: hh, occurredOn: { gte: month, lt: addMonths(month, 1) } },
    include: { fixedPayment: true, prepayment: true },
    orderBy: [{ occurredOn: "asc" }, { amount: "asc" }],
  });
  return {
    status: b?.status, totals: b?.totals,
    tree: b?.tree.map((n) => [...line(n), n.total, n.children.map(line)]),
    actual: await actualTotals(hh, month),
    charges: (await listMonthCharges(hh, month)).map((c) => [c.name, c.amount, c.payment?.transaction.amount ?? null, c.installment?.n ?? null]),
    tx: tx.map((t) => [t.kind, t.amount, formatDay(t.occurredOn), t.note, t.categoryId, t.shared, t.paidById, t.createdById, !!t.fixedPayment, t.prepayment?.mode ?? null]),
  };
}

const roundTrip = async (month: Date) => parseMonthFile(JSON.stringify(await exportMonth(hh, month)));

describe("export / import d'un mois", () => {
  it("Le mois importé redevient identique à l'export (budget, opérations, charges, crédit) ; les autres mois ne bougent pas", async () => {
    const rent = (await prisma.category.findFirstOrThrow({ where: { householdId: hh, kind: "EXPENSE", parentId: null, fixed: true } })).id;
    await createBudget(hh, nov, [{ label: "Salaire", amount: 250000, categoryId: null }]);
    const charge = await createCharge(hh, { active: true, name: "Rent", dueDay: 5, categoryId: rent, startMonth: nov, endMonth: null, shared: true });
    await payCharge(hh, admin, charge.id, nov, 80000, day("2026-11-05"));
    const loan = await createLoan(hh, { name: "Auto", categoryId: rent, firstDue: day("2026-10-10"), principal: 1000000, annualRate: 3000, termMonths: 48, payment: null, insurance: 500 });
    await prepay(hh, bob, loan.id, 50000, day("2026-11-12"), "REDUCE_TERM");
    await createEntry(hh, bob, { kind: "EXPENSE", amount: 4250, occurredOn: day("2026-11-20"), note: "Courses", categoryId: null, paidById: bob, shared: true });
    await createEntry(hh, admin, { kind: "EXPENSE", amount: 999, occurredOn: day("2026-12-01"), note: "Décembre", categoryId: null, paidById: admin });
    const id = (await prisma.budget.findFirstOrThrow({ where: { householdId: hh, month: nov } })).id;
    await setBudgetStatus(hh, id, "VALIDATED");
    const [before, decBefore] = [await snapshot(nov), await snapshot(dec)];
    const file = await roundTrip(nov);

    // Le mois diverge localement…
    await setBudgetStatus(hh, id, "DRAFT");
    await prisma.budgetItem.deleteMany({ where: { budgetId: id, kind: "INCOME" } });
    await prisma.transaction.deleteMany({ where: { householdId: hh, note: "Courses" } });
    await createEntry(hh, admin, { kind: "INCOME", amount: 1, occurredOn: day("2026-11-02"), note: "Parasite", categoryId: null, paidById: admin });
    await prisma.category.update({ where: { id: rent }, data: { fixed: false } });

    // … l'import le rend identique, sans toucher décembre.
    await importMonth(hh, file);
    expect(await snapshot(nov)).toEqual(before);
    expect(await snapshot(dec)).toEqual(decBefore);
    await importMonth(hh, file); // rejouable
    expect(await snapshot(nov)).toEqual(before);
  });

  it("Mois sans budget dans le fichier : budget local supprimé ; membre absent : refusé sans rien écrire", async () => {
    await createEntry(hh, admin, { kind: "EXPENSE", amount: 100, occurredOn: day("2026-11-03"), note: null, categoryId: null, paidById: admin });
    const file = await roundTrip(nov);
    await createBudget(hh, nov);
    await importMonth(hh, file);
    expect(await getBudget(hh, nov)).toBeNull();

    file.members[0] = { email: "x@y.fr", name: "Inconnu" };
    await createEntry(hh, admin, { kind: "EXPENSE", amount: 7, occurredOn: day("2026-11-04"), note: null, categoryId: null, paidById: admin });
    await expect(importMonth(hh, file)).rejects.toThrow(/Inconnu/);
    expect(await prisma.transaction.count({ where: { householdId: hh } })).toBe(2);
  });

  it("Fichier invalide : message lisible", () => {
    expect(() => parseMonthFile("pas du json")).toThrow(/unreadable JSON/);
    expect(() => parseMonthFile(JSON.stringify({ version: 2 }))).toThrow(/version/);
    const base = { version: 1, month: "2026-11", members: [{ email: "a@test.fr", name: "A" }], categories: [], charges: [], budget: null };
    const t = { kind: "EXPENSE", amount: 5, occurredOn: "2026-12-01", note: null, category: null, shared: true, paidBy: 0, createdBy: 0, payment: null, prepayment: null };
    expect(() => parseMonthFile(JSON.stringify({ ...base, transactions: [t] }))).toThrow(/outside the month/);
    expect(() => parseMonthFile(JSON.stringify({ ...base, transactions: [{ ...t, occurredOn: "2026-11-01", paidBy: 3 }] }))).toThrow(/transaction 1/);
  });
});
