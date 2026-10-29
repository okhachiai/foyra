import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { fullScope, getScope } from "./access";
import { prisma } from "./db";
import {
  accountBalance, archiveAccount, createEntry, createTransfer, deleteAccount, deleteTransaction, getAccount, getTransfer,
  householdTotal, LedgerError, NotFoundError, parseDay, todayIn, updateEntry, updateTransfer,
} from "./ledger";

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transaction", "Account", "Session", "User", "Household" CASCADE`);
}

let hh: string;
let user: string;
const day = parseDay("2026-10-29")!;

async function account(name: string, initialBalance: number) {
  return (await prisma.account.create({ data: { householdId: hh, name, kind: "CHECKING", initialBalance } })).id;
}
const expense = (accountId: string, amount: number) =>
  createEntry(fullScope(hh), user, { accountId, kind: "EXPENSE", amount, occurredOn: day, note: null, categoryId: null });
const transfer = (fromAccountId: string, toAccountId: string, amount: number) =>
  createTransfer(fullScope(hh), user, { fromAccountId, toAccountId, amount, occurredOn: day, note: null });

beforeEach(async () => {
  await resetDb();
  const admin = (await setupHousehold({ householdName: "Test", name: "Admin", email: "a@test.fr", password: "password1" }))!;
  hh = admin.householdId;
  user = admin.id;
});

describe("ledger", () => {
  it("Dépense : 1 000,00 − 45,50 = 954,50", async () => {
    const c = await account("Courant", 100000);
    await expense(c, 4550);
    expect(await accountBalance(fullScope(hh), c)).toBe(95450);
  });

  it("Montant ≤ 0 refusé par la contrainte CHECK en base", async () => {
    const c = await account("Courant", 0);
    await expect(expense(c, 0)).rejects.toThrow();
    await expect(expense(c, -100)).rejects.toThrow();
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Découvert : 10 € − 30 € = −20 €", async () => {
    const c = await account("Courant", 1000);
    await expense(c, 3000);
    expect(await accountBalance(fullScope(hh), c)).toBe(-2000);
  });

  it("Virement : 200 € du courant vers l'épargne, total inchangé", async () => {
    const c = await account("Courant", 95450);
    const e = await account("Épargne", 0);
    const before = await householdTotal(fullScope(hh));
    await transfer(c, e, 20000);
    expect(await accountBalance(fullScope(hh), c)).toBe(75450);
    expect(await accountBalance(fullScope(hh), e)).toBe(20000);
    expect(await householdTotal(fullScope(hh))).toBe(before);
  });

  it("Virement vers le même compte refusé", async () => {
    const c = await account("Courant", 0);
    await expect(transfer(c, c, 100)).rejects.toBeInstanceOf(LedgerError);
  });

  it("Virement en échec : compte cible invalide → aucune ligne", async () => {
    const c = await account("Courant", 1000);
    await expect(transfer(c, "inexistant", 100)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Virement en échec : la 2ᵉ insertion échoue en base → rollback complet", async () => {
    const c = await account("Courant", 1000);
    const e = await account("Épargne", 0);
    // Un trigger fait échouer l'insertion du côté IN (après celle du côté OUT).
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_in() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_in BEFORE INSERT ON "Transaction" FOR EACH ROW WHEN (NEW."transferSide" = 'IN') EXECUTE FUNCTION fail_in()`);
    try {
      await expect(transfer(c, e, 100)).rejects.toThrow(/boom/);
      expect(await prisma.transaction.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER fail_in ON "Transaction"; `);
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_in`);
    }
  });

  it("Modifier un virement 200 → 150 : les deux côtés suivent", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 0);
    const id = await transfer(c, e, 20000);
    await updateTransfer(fullScope(hh), id, { fromAccountId: c, toAccountId: e, amount: 15000, occurredOn: day, note: "x" });
    const t = await getTransfer(fullScope(hh), id);
    expect([t.out.amount, t.in.amount]).toEqual([15000, 15000]);
    expect(await accountBalance(fullScope(hh), c)).toBe(-15000);
    expect(await accountBalance(fullScope(hh), e)).toBe(15000);
  });

  it("Supprimer un virement depuis un des comptes supprime les deux côtés", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 0);
    const id = await transfer(c, e, 20000);
    const inSide = (await getTransfer(fullScope(hh), id)).in;
    await deleteTransaction(fullScope(hh), inSide.id);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await accountBalance(fullScope(hh), c)).toBe(0);
  });

  it("Modifier une dépense 45,50 → 50,00 : solde recalculé", async () => {
    const c = await account("Courant", 100000);
    const t = await expense(c, 4550);
    await updateEntry(fullScope(hh), t.id, { accountId: c, kind: "EXPENSE", amount: 5000, occurredOn: day, note: null, categoryId: null });
    expect(await accountBalance(fullScope(hh), c)).toBe(95000);
  });

  it("Archiver : refusé si solde ≠ 0, accepté à 0, masqué du total, historique conservé", async () => {
    const c = await account("Courant", 1000);
    const other = await account("Autre", 500);
    await expect(archiveAccount(fullScope(hh), c)).rejects.toBeInstanceOf(LedgerError);
    await expense(c, 1000);
    await archiveAccount(fullScope(hh), c);
    expect((await getAccount(fullScope(hh), c)).archivedAt).not.toBeNull();
    expect(await householdTotal(fullScope(hh))).toBe(500);
    expect(await prisma.transaction.count({ where: { accountId: c } })).toBe(1);
    expect(other).toBeTruthy();
  });

  it("Saisie sur archivé : dépense et virement refusés", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 1000);
    await archiveAccount(fullScope(hh), c);
    await expect(expense(c, 100)).rejects.toBeInstanceOf(LedgerError);
    await expect(transfer(e, c, 100)).rejects.toBeInstanceOf(LedgerError);
    await expect(transfer(c, e, 100)).rejects.toBeInstanceOf(LedgerError);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Hors foyer : id inexistant ou mauvais foyer → NotFound", async () => {
    const c = await account("Courant", 0);
    await expect(getAccount(fullScope(hh), "inexistant")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAccount(fullScope("autre-foyer"), c)).rejects.toBeInstanceOf(NotFoundError);
    await expect(accountBalance(fullScope("autre-foyer"), c)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createEntry(fullScope("autre-foyer"), user, { accountId: c, kind: "EXPENSE", amount: 100, occurredOn: day, note: null, categoryId: null })).rejects.toBeInstanceOf(NotFoundError);
    const t = await expense(c, 100);
    await expect(deleteTransaction(fullScope("autre-foyer"), t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Date d'opération : jour du fuseau du foyer", () => {
    expect(todayIn("Europe/Paris", new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-29");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("29/10/2026")).toBeNull();
  });

  it("Idempotence : même clé rejouée (double clic, nouvelle tentative) → une seule dépense", async () => {
    const c = await account("Courant", 10000);
    const input = { accountId: c, kind: "EXPENSE" as const, amount: 1000, occurredOn: day, note: null, categoryId: null, idempotencyKey: "k-1" };
    const [a, b] = await Promise.all([createEntry(fullScope(hh), user, input), createEntry(fullScope(hh), user, input)]);
    const again = await createEntry(fullScope(hh), user, input);
    expect(new Set([a.id, b.id, again.id]).size).toBe(1);
    expect(await accountBalance(fullScope(hh), c)).toBe(9000);
    await createEntry(fullScope(hh), user, { ...input, idempotencyKey: "k-2" });
    expect(await accountBalance(fullScope(hh), c)).toBe(8000);
  });

  it("Idempotence d'un virement : deux lignes une seule fois, même identifiant renvoyé", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 0);
    const input = { fromAccountId: c, toAccountId: e, amount: 5000, occurredOn: day, note: null, idempotencyKey: "t-1" };
    const ids = await Promise.all([1, 2, 3].map(() => createTransfer(fullScope(hh), user, input)));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.transaction.count()).toBe(2);
    expect([await accountBalance(fullScope(hh), c), await accountBalance(fullScope(hh), e)]).toEqual([-5000, 5000]);
  });

  it("Virement : jamais compté comme revenu ni dépense du foyer", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 0);
    await transfer(c, e, 7000);
    const kinds = await prisma.transaction.groupBy({ by: ["kind"], _count: true });
    expect(kinds).toEqual([{ kind: "TRANSFER", _count: 2 }]);
  });

  it("Isolation entre foyers : un utilisateur d'un autre foyer ne voit ni ne touche rien", async () => {
    const c = await account("Courant", 10000);
    const t = await expense(c, 100);
    const other = (await setupHousehold({ householdName: "Autre", name: "B", email: "b@test.fr", password: "password1" }, { force: true }))!;
    const s = await getScope(other);
    expect(s.read).toEqual([]);
    await expect(getAccount(s, c)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createEntry(s, other.id, { accountId: c, kind: "EXPENSE", amount: 1, occurredOn: day, note: null, categoryId: null })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTransaction(s, t.id)).rejects.toBeInstanceOf(NotFoundError);
    // Même clé d'idempotence dans deux foyers : indépendantes.
    await createEntry(fullScope(hh), user, { accountId: c, kind: "EXPENSE", amount: 1, occurredOn: day, note: null, categoryId: null, idempotencyKey: "same" });
    const theirs = (await prisma.account.create({ data: { householdId: other.householdId, name: "X", kind: "CASH" } })).id;
    await createEntry(fullScope(other.householdId), other.id, { accountId: theirs, kind: "EXPENSE", amount: 1, occurredOn: day, note: null, categoryId: null, idempotencyKey: "same" });
    expect(await prisma.transaction.count({ where: { idempotencyKey: "same" } })).toBe(2);
  });

  it("Supprimer un compte : ses opérations partent ; refusé s'il a un virement", async () => {
    const c = await account("Courant", 1000), e = await account("Épargne", 0);
    await expense(c, 100);
    await deleteAccount(fullScope(hh), c);
    expect(await prisma.account.count({ where: { id: c } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId: c } })).toBe(0);

    const d = await account("Autre", 1000);
    await transfer(d, e, 100);
    await expect(deleteAccount(fullScope(hh), d)).rejects.toThrow(LedgerError);
  });
});
