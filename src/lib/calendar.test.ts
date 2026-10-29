import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { parseMonth } from "./budget";
import { getCalendar } from "./calendar";
import { createCharge, payCharge, type ChargeInput } from "./charges";
import { fullScope } from "./access";
import { prisma } from "./db";
import { createEntry, createTransfer, formatDay, parseDay } from "./ledger";
import { createLoan } from "./loans";

let hh: string;
let user: string;
let courant: string;
let epargne: string;
const nov = parseMonth("2026-11")!;
const day = (s: string) => parseDay(s)!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
const charge = async (over: Partial<ChargeInput> = {}) =>
  createCharge(fullScope(hh), { name: "Loyer", amount: 95000, dueDay: 5, accountId: courant, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, ...over });
const summary = (cal: Awaited<ReturnType<typeof getCalendar>>) =>
  cal.days.map((d) => ({
    day: formatDay(d.day),
    charges: d.charges.map((c) => `${c.name}:${c.status}`),
    transactions: d.transactions.map((t) => `${t.note}:${t.amount}`),
  }));

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Account", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
  courant = (await prisma.account.create({ data: { householdId: hh, name: "Courant", kind: "CHECKING", initialBalance: 100000 } })).id;
  epargne = (await prisma.account.create({ data: { householdId: hh, name: "Épargne", kind: "SAVINGS" } })).id;
});

describe("calendrier", () => {
  it("Statuts : payée / en retard / à payer (aujourd’hui 10/11)", async () => {
    const loyer = await charge();
    await charge({ name: "Assurance", amount: 8000, dueDay: 8 });
    await charge({ name: "Internet", amount: 3000, dueDay: 20 });
    const p = await payCharge(fullScope(hh), user, loyer.id, nov, 95000, day("2026-11-05"));
    const cal = await getCalendar(fullScope(hh), nov, day("2026-11-10"));
    expect(summary(cal)).toEqual([
      { day: "2026-11-05", charges: ["Loyer:paid"], transactions: [] },
      { day: "2026-11-08", charges: ["Assurance:late"], transactions: [] },
      { day: "2026-11-20", charges: ["Internet:due"], transactions: [] },
    ]);
    expect(cal.days[0].charges[0].payment?.transactionId).toBe(p.transactionId);
  });

  it("Crédit : échéance au 05/11, montant = échéance du mois", async () => {
    await createLoan(fullScope(hh), {
      name: "Maison", accountId: courant, categoryId: await byName("Loyer"), firstDue: day("2026-11-05"),
      principal: 10_000_000, annualRate: 1200, termMonths: 240, payment: null, insurance: 1000,
    });
    const cal = await getCalendar(fullScope(hh), nov, day("2026-11-01"));
    expect(formatDay(cal.days[0].day)).toBe("2026-11-05");
    expect(cal.days[0].charges[0]).toMatchObject({ name: "Maison", amount: 46887 + 1000, status: "due" });
  });

  it("Fin de mois : jour 31 en février 2027 → 28/02", async () => {
    await charge({ dueDay: 31 });
    const cal = await getCalendar(fullScope(hh), parseMonth("2027-02")!, day("2026-11-10"));
    expect(cal.days.map((d) => formatDay(d.day))).toEqual(["2027-02-28"]);
  });

  it("Opérations : dépense et virement (une fois) ; dépense du Loyer non répétée", async () => {
    const loyer = await charge();
    await payCharge(fullScope(hh), user, loyer.id, nov, 95000, day("2026-11-12"));
    await createEntry(fullScope(hh), user, { accountId: courant, kind: "EXPENSE", amount: 4000, occurredOn: day("2026-11-12"), note: "Courses", categoryId: null });
    await createTransfer(fullScope(hh), user, { fromAccountId: courant, toAccountId: epargne, amount: 10000, occurredOn: day("2026-11-12"), note: "Épargne" });
    const cal = await getCalendar(fullScope(hh), nov, day("2026-11-15"));
    const d12 = cal.days.find((d) => formatDay(d.day) === "2026-11-12")!;
    expect(d12.transactions.map((t) => `${t.note}:${t.amount}`)).toEqual(["Courses:4000", "Épargne:10000"]);
    expect(d12.transactions[1]).toMatchObject({ transferSide: "OUT", otherAccount: "Épargne" });
  });

  it("À venir : aujourd’hui 28/11 → retard du mois + échéance du 02/12, quel que soit le mois consulté", async () => {
    await charge({ name: "Assurance", amount: 8000, dueDay: 8 });
    await charge({ name: "Gaz", amount: 5000, dueDay: 2 });
    const today = day("2026-11-28");
    const expected = ["Gaz:2026-11-02:late", "Assurance:2026-11-08:late", "Gaz:2026-12-02:due"];
    for (const m of ["2026-11", "2026-12", "2026-09"]) {
      const cal = await getCalendar(fullScope(hh), parseMonth(m)!, today);
      expect(cal.upcoming.map((c) => `${c.name}:${formatDay(c.due)}:${c.status}`)).toEqual(expected);
    }
  });

  it("Marquer payée : date hors mois / déjà payée refusées par payCharge ; l’échéance passe « payée »", async () => {
    const c = await charge();
    await expect(payCharge(fullScope(hh), user, c.id, nov, 95000, day("2026-12-01"))).rejects.toMatchObject({ field: "occurredOn" });
    await payCharge(fullScope(hh), user, c.id, nov, 95000, day("2026-11-05"));
    await expect(payCharge(fullScope(hh), user, c.id, nov, 95000, day("2026-11-05"))).rejects.toThrow("déjà payée");
    expect((await getCalendar(fullScope(hh), nov, day("2026-11-10"))).days[0].charges[0].status).toBe("paid");
  });

  it("Prévisionnel : Courant 1 000 € − 80 € en retard − 30 € à payer = 890 € ; absent sur un autre mois", async () => {
    await charge({ name: "Assurance", amount: 8000, dueDay: 8 });
    await charge({ name: "Internet", amount: 3000, dueDay: 20 });
    const cal = await getCalendar(fullScope(hh), nov, day("2026-11-10"));
    expect(cal.forecast).toEqual([
      { id: courant, name: "Courant", balance: 100000, unpaid: 11000, end: 89000 },
      { id: epargne, name: "Épargne", balance: 0, unpaid: 0, end: 0 },
    ]);
    expect((await getCalendar(fullScope(hh), parseMonth("2026-12")!, day("2026-11-10"))).forecast).toBeNull();
  });

  it("Vide : aucun jour", async () => {
    const cal = await getCalendar(fullScope(hh), nov, day("2026-11-10"));
    expect(cal).toEqual({ days: [], upcoming: [], forecast: expect.any(Array) });
  });
});
