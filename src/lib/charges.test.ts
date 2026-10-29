import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { parseMonth } from "./budget";
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
  createCharge(fullScope(hh), { kind: "EXPENSE", active: true, name: "Loyer", amount: 95000, dueDay: 5, accountId: courant, categoryId: await byName("Loyer"), startMonth: nov, endMonth: null, shared: true, ...over });
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
    await expect(charge({ categoryId: await byName("Salaire 1") })).rejects.toMatchObject({ field: "categoryId" });
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

  it("Revenu récurrent : catégorie de revenu exigée, « reçu » crée un revenu ; aucune opération sans action", async () => {
    await expect(charge({ kind: "INCOME" })).rejects.toMatchObject({ field: "categoryId" });
    const salaire = await charge({ kind: "INCOME", name: "Salaire", amount: 250000, categoryId: await byName("Salaire 1") });
    expect(await prisma.transaction.count()).toBe(0); // indicative : rien n'est payé automatiquement
    await pay(salaire.id, 250000, "2026-11-28");
    expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({ kind: "INCOME", amount: 250000 });
  });

  it("Désactivée : absente des échéances du mois ; réactivée : de retour", async () => {
    const c = await charge();
    await updateCharge(fullScope(hh), c.id, { ...c, kind: "EXPENSE", active: false });
    expect(await listMonthCharges(fullScope(hh), nov)).toEqual([]);
    expect(appliesTo({ ...c, active: false }, nov)).toBe(false);
    await expect(pay(c.id, 95000, "2026-11-05")).rejects.toBeInstanceOf(LedgerError);
    await updateCharge(fullScope(hh), c.id, { ...c, kind: "EXPENSE", active: true });
    expect(await listMonthCharges(fullScope(hh), nov)).toHaveLength(1);
  });

  it("Supprimer : opérations déjà enregistrées conservées", async () => {
    const c = await charge();
    await pay(c.id, 95000, "2026-11-05");
    await deleteCharge(fullScope(hh), c.id);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("Charge sur compte commun : shared forcé à true", async () => {
    const c = await charge({ shared: false });
    expect(c.shared).toBe(true);
    await updateCharge(fullScope(hh), c.id, { ...c, shared: false });
    expect((await prisma.fixedCharge.findUniqueOrThrow({ where: { id: c.id } })).shared).toBe(true);
  });

  it("Paiement d'une charge personnelle : opération shared=false", async () => {
    await prisma.account.update({ where: { id: courant }, data: { ownerId: user } });
    const c = await charge({ shared: false });
    expect(c.shared).toBe(false);
    const p = await pay(c.id, 95000, "2026-11-05");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: p.transactionId } })).shared).toBe(false);
  });

  it("Modifier un paiement de charge commune sur compte perso : reste commun", async () => {
    await prisma.account.update({ where: { id: courant }, data: { ownerId: user } });
    const c = await charge({ shared: true });
    const p = await pay(c.id, 95000, "2026-11-05");
    const t = await updateEntry(fullScope(hh), p.transactionId, { accountId: courant, kind: "EXPENSE", amount: 90000, occurredOn: parseDay("2026-11-06")!, note: null, categoryId: c.categoryId });
    expect(t.shared).toBe(true);
  });
});
