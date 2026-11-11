import { beforeEach, describe, expect, it } from "vitest";
import { createMember, setupHousehold } from "./auth";
import { prisma } from "./db";
import { parseMonth } from "./budget";
import { createCharge, payCharge } from "./charges";
import { createEntry, deleteTransaction, LedgerError, monthNet, NotFoundError, parseDay, todayIn, updateEntry } from "./ledger";

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Session", "User", "Household" CASCADE`);
}

let hh: string;
let user: string;
const day = parseDay("2026-10-29")!;

const oct = parseMonth("2026-10")!;
const entry = (kind: "INCOME" | "EXPENSE", amount: number, extra: object = {}) =>
  createEntry(hh, user, { kind, amount, occurredOn: day, note: null, categoryId: null, paidById: user, ...extra });
const expense = (amount: number) => entry("EXPENSE", amount);

beforeEach(async () => {
  await resetDb();
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("ledger", () => {
  it("Net du mois : recettes − dépenses du mois seulement", async () => {
    await entry("INCOME", 100000);
    await expense(4550);
    await entry("EXPENSE", 999, { occurredOn: parseDay("2026-11-01")! });
    expect(await monthNet(hh, oct)).toBe(95450);
    expect(await monthNet(hh, parseMonth("2026-11")!)).toBe(-999);
  });

  it("Montant ≤ 0 refusé par la contrainte CHECK en base", async () => {
    await expect(expense(0)).rejects.toThrow();
    await expect(expense(-100)).rejects.toThrow();
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Modifier une dépense 45,50 → 50,00 : net recalculé", async () => {
    const t = await expense(4550);
    await updateEntry(hh, t.id, { kind: "EXPENSE", amount: 5000, occurredOn: day, note: null, categoryId: null, paidById: user });
    expect(await monthNet(hh, oct)).toBe(-5000);
  });

  it("Hors foyer : id inexistant ou mauvais foyer → NotFound", async () => {
    const t = await expense(100);
    await expect(updateEntry("autre-foyer", t.id, { kind: "EXPENSE", amount: 1, occurredOn: day, note: null, categoryId: null, paidById: user }))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTransaction("autre-foyer", t.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteTransaction(hh, t.id);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Date d'opération : jour du fuseau du foyer", () => {
    expect(todayIn("Europe/Paris", new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-29");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("29/10/2026")).toBeNull();
  });

  it("Idempotence : même clé rejouée (double clic, nouvelle tentative) → une seule dépense", async () => {
    const input = { kind: "EXPENSE" as const, amount: 1000, occurredOn: day, note: null, categoryId: null, paidById: user, idempotencyKey: "k-1" };
    const [a, b] = await Promise.all([createEntry(hh, user, input), createEntry(hh, user, input)]);
    const again = await createEntry(hh, user, input);
    expect(new Set([a.id, b.id, again.id]).size).toBe(1);
    await createEntry(hh, user, { ...input, idempotencyKey: "k-2" });
    expect(await monthNet(hh, oct)).toBe(-2000);
  });

  it("Isolation entre foyers : payeur d'un autre foyer refusé ; même clé d'idempotence indépendante", async () => {
    const other = (await setupHousehold({ householdName: "Autre", name: "B", email: "b@test.fr", password: "password1" }, { force: true }))!;
    await expect(entry("EXPENSE", 1, { paidById: other.id })).rejects.toMatchObject({ field: "paidById" });
    await entry("EXPENSE", 1, { idempotencyKey: "same" });
    await createEntry(other.householdId, other.id, { kind: "EXPENSE", amount: 1, occurredOn: day, note: null, categoryId: null, paidById: other.id, idempotencyKey: "same" });
    expect(await prisma.transaction.count({ where: { idempotencyKey: "same" } })).toBe(2);
  });

  it("Payé par : membre actif à la saisie ; un payeur désactivé reste accepté s'il était déjà choisi", async () => {
    const m = (await createMember(hh, { name: "M", email: "m@test.fr", password: "password1", role: "MEMBER" }))!.id;
    const t = await entry("EXPENSE", 100, { paidById: m });
    expect(t.paidById).toBe(m);
    await prisma.user.update({ where: { id: m }, data: { disabledAt: new Date() } });
    await expect(entry("EXPENSE", 100, { paidById: m })).rejects.toBeInstanceOf(LedgerError);
    const u = await updateEntry(hh, t.id, { kind: "EXPENSE", amount: 200, occurredOn: day, note: null, categoryId: null, paidById: m });
    expect(u.amount).toBe(200);
  });

  it("Commune : personnelle par défaut, commune si demandé, inchangée si non précisée à la modification", async () => {
    expect((await expense(100)).shared).toBe(false);
    const t = await entry("EXPENSE", 100, { shared: true });
    expect(t.shared).toBe(true);
    const u = await updateEntry(hh, t.id, { kind: "EXPENSE", amount: 100, occurredOn: day, note: null, categoryId: null, paidById: user });
    expect(u.shared).toBe(true);
  });

  it("Paiement de charge : type et mois figés ; supprimer la dépense supprime le paiement", async () => {
    const loyer = (await prisma.category.findFirstOrThrow({ where: { householdId: hh, name: "Rent" } })).id;
    const ch = await createCharge(hh, { active: true, name: "Rent", dueDay: 5, categoryId: loyer, startMonth: oct, endMonth: null, shared: true });
    const p = await payCharge(hh, user, ch.id, oct, 95000, parseDay("2026-10-05")!);
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: p.transactionId } });
    expect(t).toMatchObject({ paidById: user, shared: true });
    const base = { kind: "EXPENSE" as const, amount: 95000, occurredOn: parseDay("2026-10-05")!, note: null, categoryId: loyer, paidById: user };
    await expect(updateEntry(hh, t.id, { ...base, occurredOn: parseDay("2026-11-05")! })).rejects.toMatchObject({ field: "occurredOn" });
    await deleteTransaction(hh, t.id);
    expect(await prisma.fixedChargePayment.count()).toBe(0);
  });
});
