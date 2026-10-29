import { beforeEach, describe, expect, it } from "vitest";
import { setupHousehold } from "./auth";
import { prisma } from "./db";
import {
  accountBalance, archiveAccount, createEntry, createTransfer, deleteTransaction, getAccount, getTransfer,
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
  createEntry(hh, user, { accountId, kind: "EXPENSE", amount, occurredOn: day, note: null, categoryId: null });
const transfer = (fromAccountId: string, toAccountId: string, amount: number) =>
  createTransfer(hh, user, { fromAccountId, toAccountId, amount, occurredOn: day, note: null });

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
    expect(await accountBalance(hh, c)).toBe(95450);
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
    expect(await accountBalance(hh, c)).toBe(-2000);
  });

  it("Virement : 200 € du courant vers l'épargne, total inchangé", async () => {
    const c = await account("Courant", 95450);
    const e = await account("Épargne", 0);
    const before = await householdTotal(hh);
    await transfer(c, e, 20000);
    expect(await accountBalance(hh, c)).toBe(75450);
    expect(await accountBalance(hh, e)).toBe(20000);
    expect(await householdTotal(hh)).toBe(before);
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
    await updateTransfer(hh, id, { fromAccountId: c, toAccountId: e, amount: 15000, occurredOn: day, note: "x" });
    const t = await getTransfer(hh, id);
    expect([t.out.amount, t.in.amount]).toEqual([15000, 15000]);
    expect(await accountBalance(hh, c)).toBe(-15000);
    expect(await accountBalance(hh, e)).toBe(15000);
  });

  it("Supprimer un virement depuis un des comptes supprime les deux côtés", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 0);
    const id = await transfer(c, e, 20000);
    const inSide = (await getTransfer(hh, id)).in;
    await deleteTransaction(hh, inSide.id);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await accountBalance(hh, c)).toBe(0);
  });

  it("Modifier une dépense 45,50 → 50,00 : solde recalculé", async () => {
    const c = await account("Courant", 100000);
    const t = await expense(c, 4550);
    await updateEntry(hh, t.id, { accountId: c, kind: "EXPENSE", amount: 5000, occurredOn: day, note: null, categoryId: null });
    expect(await accountBalance(hh, c)).toBe(95000);
  });

  it("Archiver : refusé si solde ≠ 0, accepté à 0, masqué du total, historique conservé", async () => {
    const c = await account("Courant", 1000);
    const other = await account("Autre", 500);
    await expect(archiveAccount(hh, c)).rejects.toBeInstanceOf(LedgerError);
    await expense(c, 1000);
    await archiveAccount(hh, c);
    expect((await getAccount(hh, c)).archivedAt).not.toBeNull();
    expect(await householdTotal(hh)).toBe(500);
    expect(await prisma.transaction.count({ where: { accountId: c } })).toBe(1);
    expect(other).toBeTruthy();
  });

  it("Saisie sur archivé : dépense et virement refusés", async () => {
    const c = await account("Courant", 0);
    const e = await account("Épargne", 1000);
    await archiveAccount(hh, c);
    await expect(expense(c, 100)).rejects.toBeInstanceOf(LedgerError);
    await expect(transfer(e, c, 100)).rejects.toBeInstanceOf(LedgerError);
    await expect(transfer(c, e, 100)).rejects.toBeInstanceOf(LedgerError);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("Hors foyer : id inexistant ou mauvais foyer → NotFound", async () => {
    const c = await account("Courant", 0);
    await expect(getAccount(hh, "inexistant")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAccount("autre-foyer", c)).rejects.toBeInstanceOf(NotFoundError);
    await expect(accountBalance("autre-foyer", c)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createEntry("autre-foyer", user, { accountId: c, kind: "EXPENSE", amount: 100, occurredOn: day, note: null, categoryId: null })).rejects.toBeInstanceOf(NotFoundError);
    const t = await expense(c, 100);
    await expect(deleteTransaction("autre-foyer", t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Date d'opération : jour du fuseau du foyer", () => {
    expect(todayIn("Europe/Paris", new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-29");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("29/10/2026")).toBeNull();
  });
});
