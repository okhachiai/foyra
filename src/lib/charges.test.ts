import { beforeEach, describe, expect, it } from "vitest";
import { dueDate } from "./amortization";
import { setupHousehold } from "./auth";
import { parseMonth } from "./budget";
import { appliesTo, createCharge, deleteCharge, listMonthCharges, payCharge, updateCharge, type ChargeInput } from "./charges";
import { prisma } from "./db";
import { createEntry, deleteTransaction, formatDay, LedgerError, parseDay, updateEntry } from "./ledger";

let hh: string;
let user: string;
const oct = parseMonth("2026-10")!;
const nov = parseMonth("2026-11")!;
const byName = async (name: string) => (await prisma.category.findFirstOrThrow({ where: { name } })).id;
const charge = async (over: Partial<ChargeInput> = {}) =>
  createCharge(hh, { kind: "EXPENSE", active: true, name: "Loyer", dueDay: 5, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, shared: true, ...over });
const pay = (id: string, amount: number, day: string, month = nov) => payCharge(hh, user, id, month, amount, parseDay(day)!);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Category", "Session", "User", "Household" CASCADE`);
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("charges fixes", () => {
  it("Créer : active dès le mois de début ; jour, catégorie de revenu refusés", async () => {
    await charge();
    expect((await listMonthCharges(hh, nov)).map((c) => c.name)).toEqual(["Loyer"]);
    await expect(charge({ dueDay: 32 })).rejects.toThrow();
    await expect(charge({ dueDay: 0 })).rejects.toThrow();
    await expect(charge({ categoryId: await byName("Salaire 1") })).rejects.toMatchObject({ field: "categoryId" });
  });

  it("Échéance : jour 31 en février 2027 → 28/02/2027", () => {
    expect(formatDay(dueDate({ dueDay: 31 }, parseMonth("2027-02")!))).toBe("2027-02-28");
    expect(formatDay(dueDate({ dueDay: 5 }, nov))).toBe("2026-11-05");
  });

  it("Période : début 2026-11, dernier mois 2027-01 → absente en octobre et février ; fin < début refusée", async () => {
    const c = await charge({ endMonth: parseMonth("2027-01") });
    expect([oct, nov, parseMonth("2027-01")!, parseMonth("2027-02")!].map((m) => appliesTo(c, m))).toEqual([false, true, true, false]);
    expect(await listMonthCharges(hh, oct)).toEqual([]);
    await expect(charge({ endMonth: oct })).rejects.toMatchObject({ field: "endMonth" });
    await expect(updateCharge(hh, c.id, { ...c, endMonth: oct })).rejects.toMatchObject({ field: "endMonth" });
  });

  it("Marquer payée : dépense créée ; date hors mois refusée ; second paiement / concurrence → « déjà payée »", async () => {
    const c = await charge();
    await expect(pay(c.id, 95000, "2026-12-01")).rejects.toMatchObject({ field: "occurredOn" });
    const results = await Promise.allSettled([pay(c.id, 95000, "2026-11-05"), pay(c.id, 95000, "2026-11-05")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(LedgerError);
    expect(rejected.reason.message).toBe("Cette charge est déjà payée pour ce mois.");
    const [listed] = await listMonthCharges(hh, nov);
    expect(listed.payment?.transaction).toMatchObject({ amount: 95000, paidById: user, categoryId: c.categoryId, kind: "EXPENSE" });
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("Annuler : supprimer la dépense liée repasse la charge « à payer »", async () => {
    const c = await charge();
    const p = await pay(c.id, 95000, "2026-11-05");
    await deleteTransaction(hh, p.transactionId);
    expect((await listMonthCharges(hh, nov))[0].payment).toBeNull();
  });

  it("Modifier la dépense liée : date hors du mois payé ou passage en recette refusés", async () => {
    const c = await charge();
    const p = await pay(c.id, 95000, "2026-11-05");
    const base = { paidById: user, kind: "EXPENSE" as const, amount: 90000, occurredOn: parseDay("2026-11-20")!, note: null, categoryId: c.categoryId };
    await updateEntry(hh, p.transactionId, base); // dans le mois : accepté
    await expect(updateEntry(hh, p.transactionId, { ...base, occurredOn: parseDay("2026-12-01")! })).rejects.toMatchObject({ field: "occurredOn" });
    await expect(updateEntry(hh, p.transactionId, { ...base, kind: "INCOME", categoryId: null })).rejects.toMatchObject({ field: "kind" });
  });

  it("Catégorie de revenu refusée ; récurrence de revenu refusée en base", async () => {
    await expect(charge({ categoryId: await byName("Salaire 1") })).rejects.toMatchObject({ field: "categoryId" });
    const c = await charge();
    await expect(prisma.fixedCharge.update({ where: { id: c.id }, data: { kind: "INCOME" } })).rejects.toThrow();
  });

  it("Désactivée : absente des échéances du mois ; réactivée : de retour", async () => {
    const c = await charge();
    await updateCharge(hh, c.id, { ...c, kind: "EXPENSE", active: false });
    expect(await listMonthCharges(hh, nov)).toEqual([]);
    expect(appliesTo({ ...c, active: false }, nov)).toBe(false);
    await expect(pay(c.id, 95000, "2026-11-05")).rejects.toBeInstanceOf(LedgerError);
    await updateCharge(hh, c.id, { ...c, kind: "EXPENSE", active: true });
    expect(await listMonthCharges(hh, nov)).toHaveLength(1);
  });

  it("Supprimer : opérations déjà enregistrées conservées", async () => {
    const c = await charge();
    await pay(c.id, 95000, "2026-11-05");
    await deleteCharge(hh, c.id);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("Commune ou personnelle : choix conservé à la création et à la modification", async () => {
    const c = await charge({ shared: false });
    expect(c.shared).toBe(false);
    await updateCharge(hh, c.id, { ...c, shared: true });
    expect((await prisma.fixedCharge.findUniqueOrThrow({ where: { id: c.id } })).shared).toBe(true);
  });

  it("Paiement d'une charge personnelle : opération shared=false", async () => {
    const c = await charge({ shared: false });
    expect(c.shared).toBe(false);
    const p = await pay(c.id, 95000, "2026-11-05");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: p.transactionId } })).shared).toBe(false);
  });

  it("Modifier un paiement de charge commune sans préciser « commune » : reste commun", async () => {
    const c = await charge({ shared: true });
    const p = await pay(c.id, 95000, "2026-11-05");
    const t = await updateEntry(hh, p.transactionId, { paidById: user, kind: "EXPENSE", amount: 90000, occurredOn: parseDay("2026-11-06")!, note: null, categoryId: c.categoryId });
    expect(t.shared).toBe(true);
  });
});
