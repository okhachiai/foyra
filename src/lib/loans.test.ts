import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { getBudget, parseMonth } from "./budget";
import { getCharge, listMonthCharges, payCharge, updateCharge } from "./charges";
import { prisma } from "./db";
import { deleteTransaction, parseDay, updateEntry } from "./ledger";
import { createLoan, deleteLoan, getLoan, listLoans, prepay, updateLoan, type LoanInput } from "./loans";

let hh: string;
let user: string;
let courant: string;
let credit: string;
const jan = parseMonth("2027-01")!;
const day = (s: string) => parseDay(s)!;
const loan = (over: Partial<LoanInput> = {}) =>
  createLoan(hh, {
    name: "Maison", accountId: courant, categoryId: credit, firstDue: day("2027-01-05"),
    principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 0, ...over,
  });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
  courant = (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING" } })).id;
  credit = (await prisma.category.create({ data: { householdId: hh, name: "Crédit", kind: "EXPENSE" } })).id;
});

describe("crédits", () => {
  it("Créer : charge 468,87 € le 5, de 01/2027 à 12/2046 ; contraintes SQL ; mensualité ≤ intérêts refusée", async () => {
    const l = await loan();
    const c = await getCharge(hh, l.fixedChargeId);
    expect(c).toMatchObject({ amount: 46887, dueDay: 5, startMonth: jan, endMonth: parseMonth("2046-12"), loan: { id: l.id } });
    // CHECK SQL de Loan lui-même (écriture directe, hors contrôles de la charge)
    for (const data of [{ principal: 0 }, { annualRate: -1 }, { annualRate: 50_001 }, { termMonths: 0 }, { termMonths: 601 }, { payment: 0 }, { insurance: -1 }]) {
      await expect(prisma.loan.update({ where: { id: l.id }, data })).rejects.toThrow(/check constraint/i);
    }
    await expect(loan({ payment: 10000 })).rejects.toMatchObject({ field: "payment", message: "La mensualité ne couvre pas les intérêts." });
    expect(await prisma.loan.count()).toBe(1);
  });

  it("Budget : janvier 2027 → 468,87 € + 15 € d'assurance à payer ; « Marquer payée » crée la dépense", async () => {
    const l = await loan({ insurance: 1500 });
    const [c] = await listMonthCharges(hh, jan);
    expect(c).toMatchObject({ amount: 48387, loanId: l.id, due: day("2027-01-05"), payment: null });
    expect((await getBudget(hh, jan)).totals).toMatchObject({ fixedTotal: 48387, fixedRemaining: 48387 });
    await payCharge(hh, user, c.id, jan, c.amount, day("2027-01-05"));
    expect((await listMonthCharges(hh, jan))[0].payment?.transaction).toMatchObject({ amount: 48387, categoryId: credit, kind: "EXPENSE" });
  });

  it("Hors période : décembre 2026 et janvier 2047 sans échéance", async () => {
    await loan();
    expect(await listMonthCharges(hh, parseMonth("2026-12")!)).toEqual([]);
    expect(await listMonthCharges(hh, parseMonth("2047-01")!)).toEqual([]);
  });

  it("Anticipé durée : dépense 10 000 € ; capital restant dû −10 000 € ; montant > capital refusé", async () => {
    const l = await loan();
    const before = await getLoan(hh, l.id, day("2028-01-10"));
    await expect(prepay(hh, user, l.id, before.status.balance + 1, day("2028-01-10"), "REDUCE_TERM")).rejects.toMatchObject({ field: "amount" });
    const p = await prepay(hh, user, l.id, 1_000_000, day("2028-01-10"), "REDUCE_TERM");
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: p.transactionId } })).toMatchObject({ amount: 1_000_000, accountId: courant, categoryId: credit });
    const after = await getLoan(hh, l.id, day("2028-01-10"));
    expect(after.status.balance).toBe(before.status.balance - 1_000_000);
    expect(after.schedule.rows.length).toBeLessThan(240);
    expect(after.schedule.rows[13].total).toBe(46887);
  });

  it("Anticipé mensualité : fin inchangée, échéance de 02/2028 plus basse au budget", async () => {
    const l = await loan();
    await prepay(hh, user, l.id, 1_000_000, day("2028-01-10"), "REDUCE_PAYMENT");
    const s = (await getLoan(hh, l.id, day("2028-01-10"))).schedule;
    expect(s.rows).toHaveLength(240);
    const [feb] = await listMonthCharges(hh, parseMonth("2028-02")!);
    expect(feb.amount).toBe(s.rows[13].total);
    expect(feb.amount).toBeLessThan(46887);
  });

  it("Soldé : anticipé = capital restant dû → plus d'échéance ni de paiement possible ensuite", async () => {
    const l = await loan();
    const { status } = await getLoan(hh, l.id, day("2028-01-10"));
    await prepay(hh, user, l.id, status.balance, day("2028-01-10"), "REDUCE_TERM");
    expect(await listMonthCharges(hh, parseMonth("2028-02")!)).toEqual([]);
    await expect(payCharge(hh, user, l.fixedChargeId, parseMonth("2028-02")!, 46887, day("2028-02-05"))).rejects.toThrow("ne s’applique pas");
    await expect(prepay(hh, user, l.id, 1, day("2028-03-01"), "REDUCE_TERM")).rejects.toMatchObject({ field: "amount" });
  });

  it("Anticipé antidaté qui rognerait un anticipé ultérieur : refusé", async () => {
    const l = await loan();
    await prepay(hh, user, l.id, 1_000_000, day("2030-01-10"), "REDUCE_TERM");
    const { status } = await getLoan(hh, l.id, day("2028-01-10"));
    await expect(prepay(hh, user, l.id, status.balance, day("2028-01-10"), "REDUCE_TERM")).rejects.toMatchObject({ field: "amount" });
    expect(await prisma.loanPrepayment.count()).toBe(1);
  });

  it("Mois payé puis crédit soldé avant l'échéance : la charge payée reste listée et au budget", async () => {
    const l = await loan();
    const jan28 = parseMonth("2028-01")!;
    await payCharge(hh, user, l.fixedChargeId, jan28, 46887, day("2028-01-02"));
    const { status } = await getLoan(hh, l.id, day("2028-01-04"));
    await prepay(hh, user, l.id, status.balance, day("2028-01-04"), "REDUCE_TERM");
    const [c] = await listMonthCharges(hh, jan28);
    expect(c).toMatchObject({ amount: 46887, payment: { transaction: { amount: 46887 } } });
    expect((await getBudget(hh, jan28)).totals).toMatchObject({ fixedTotal: 46887, fixedRemaining: 0 });
  });

  it("Annuler anticipé : supprimer la dépense rétablit l'échéancier initial ; elle ne peut pas devenir une recette", async () => {
    const l = await loan();
    const initial = (await getLoan(hh, l.id, day("2028-01-10"))).schedule;
    const p = await prepay(hh, user, l.id, 1_000_000, day("2028-01-10"), "REDUCE_TERM");
    const base = { accountId: courant, kind: "INCOME" as const, amount: 1_000_000, occurredOn: day("2028-01-10"), note: null, categoryId: null };
    await expect(updateEntry(hh, p.transactionId, base)).rejects.toMatchObject({ field: "kind" });
    const expense = { ...base, kind: "EXPENSE" as const, categoryId: credit };
    await expect(updateEntry(hh, p.transactionId, { ...expense, amount: 2_000_000 })).rejects.toMatchObject({ field: "amount" });
    await expect(updateEntry(hh, p.transactionId, { ...expense, occurredOn: day("2027-06-10") })).rejects.toMatchObject({ field: "occurredOn" });
    await updateEntry(hh, p.transactionId, { ...expense, note: "ok" }); // note modifiable
    await deleteTransaction(hh, p.transactionId);
    expect((await getLoan(hh, l.id, day("2028-01-10"))).schedule).toEqual(initial);
  });

  it("Charge-crédit : non modifiable comme charge ; modifier le crédit recalcule ; supprimer garde les dépenses", async () => {
    const l = await loan();
    const c = await getCharge(hh, l.fixedChargeId);
    await expect(updateCharge(hh, c.id, { ...c, amount: 100 })).rejects.toThrow();
    await updateLoan(hh, l.id, {
      name: "Maison", accountId: courant, categoryId: credit, firstDue: day("2027-02-10"),
      principal: 10_000_000, annualRate: 1200, termMonths: 120, payment: null, insurance: 0,
    });
    expect(await getCharge(hh, l.fixedChargeId)).toMatchObject({ dueDay: 10, startMonth: parseMonth("2027-02"), endMonth: parseMonth("2037-01") });
    await payCharge(hh, user, l.fixedChargeId, parseMonth("2027-02")!, 50000, day("2027-02-10"));
    await prepay(hh, user, l.id, 100_000, day("2027-03-01"), "REDUCE_TERM");
    await deleteLoan(hh, l.id);
    expect(await prisma.transaction.count()).toBe(2);
    expect(await prisma.fixedCharge.count()).toBe(0);
    expect(await listLoans(hh, jan)).toEqual([]);
  });

  it("Autre foyer : introuvable", async () => {
    const l = await loan();
    await expect(getLoan("autre", l.id, jan)).rejects.toThrow();
    await expect(prepay("autre", user, l.id, 100, jan, "REDUCE_TERM")).rejects.toThrow();
    await expect(deleteLoan("autre", l.id)).rejects.toThrow();
  });
});
