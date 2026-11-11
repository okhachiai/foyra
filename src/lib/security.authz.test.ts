// Audit de sécurité 2026-11-11 : isolation inter-foyers, rôles, intégrité. Données fictives (@example.test), base foyra_test.
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createCategoryAction, importBudgetAction } from "@/app/actions";
import { createMember, loginBlocked, recordLoginFailure, setDisabled, setRole, setupHousehold, startSession } from "./auth";
import { createBudget, removeItem, saveItems, setBudgetStatus } from "./budget";
import { exportMonth, importMonth, parseMonthFile } from "./budget-file";
import { deleteCategory, setCategoryArchived, updateCategory } from "./categories";
import { createCharge, deleteCharge, payCharge, updateCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, deleteTransaction, NotFoundError, updateEntry } from "./ledger";
import { createLoan, deleteLoan, prepay, updateLoan } from "./loans";
import { parseCents } from "./money";
import { applyPlan } from "./report";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const MONTH = D("2026-03-01");
const err = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

type Fx = Awaited<ReturnType<typeof seed>>;
async function seed(tag: string) {
  const admin = (await setupHousehold({ householdName: `Foyer ${tag}`, name: `Admin ${tag}`, email: `admin-${tag}@example.test`, password: "fictif-pass-1" }, { force: true }))!;
  const hh = admin.householdId;
  const member = (await createMember(hh, { name: `Membre ${tag}`, email: `member-${tag}@example.test`, password: "fictif-pass-1", role: "MEMBER" }))!;
  const expense = (await prisma.category.findFirst({ where: { householdId: hh, kind: "EXPENSE", parentId: null } }))!;
  const tx = await createEntry(hh, admin.id, { kind: "EXPENSE", amount: 4200, occurredOn: D("2026-03-10"), note: `secret ${tag}`, categoryId: expense.id, paidById: admin.id });
  const charge = await createCharge(hh, { active: true, name: `Loyer ${tag}`, dueDay: 5, categoryId: expense.id, startMonth: MONTH, endMonth: null, shared: true });
  const loan = await createLoan(hh, { name: `Prêt ${tag}`, categoryId: expense.id, firstDue: D("2026-01-05"), principal: 1_000_000, annualRate: 0, termMonths: 10, payment: null, insurance: 0 });
  const budget = await createBudget(hh, MONTH);
  const item = (await prisma.budgetItem.findFirst({ where: { budgetId: budget.id } }))!;
  const report = await prisma.report.create({
    data: { householdId: hh, budgetId: budget.id, userId: admin.id, day: MONTH, kind: "PLAN", trigger: "MANUAL", provider: "CLAUDE", model: "x", input: {}, output: { lines: [{ budgetItemId: item.id, amount: 1, reason: "" }], advice: "" } },
  });
  return { hh, admin, member, expense, tx, charge, loan, budget, item, report };
}

let A: Fx, B: Fx;
beforeEach(async () => {
  jar.clear();
  await prisma.$executeRawUnsafe(`TRUNCATE "Household" CASCADE`);
  A = await seed("a");
  B = await seed("b");
});

describe("IDOR : un foyer A n'atteint jamais les objets du foyer B", () => {
  it("chaque écriture ciblant un ID de B échoue en NotFoundError", async () => {
    const entry = { kind: "EXPENSE" as const, amount: 1, occurredOn: D("2026-03-11"), note: null, categoryId: null, paidById: A.admin.id };
    const loanIn = { name: "x", categoryId: A.expense.id, firstDue: D("2026-01-05"), principal: 1000, annualRate: 0, termMonths: 1, payment: null, insurance: 0 };
    const chargeIn = { active: true, name: "x", dueDay: 1, categoryId: A.expense.id, startMonth: MONTH, endMonth: null, shared: true };
    const attempts: [string, () => Promise<unknown>][] = [
      ["updateEntry", () => updateEntry(A.hh, B.tx.id, entry)],
      ["deleteTransaction", () => deleteTransaction(A.hh, B.tx.id)],
      ["createEntry catégorie B", () => createEntry(A.hh, A.admin.id, { ...entry, categoryId: B.expense.id })],
      ["createEntry payeur B", () => createEntry(A.hh, A.admin.id, { ...entry, paidById: B.admin.id })],
      ["updateCharge", () => updateCharge(A.hh, B.charge.id, chargeIn)],
      ["deleteCharge", () => deleteCharge(A.hh, B.charge.id)],
      ["payCharge", () => payCharge(A.hh, A.admin.id, B.charge.id, MONTH, 100, D("2026-03-05"))],
      ["updateLoan", () => updateLoan(A.hh, B.loan.id, loanIn)],
      ["deleteLoan", () => deleteLoan(A.hh, B.loan.id)],
      ["prepay", () => prepay(A.hh, A.admin.id, B.loan.id, 100, D("2026-03-10"), "REDUCE_TERM")],
      ["updateCategory", () => updateCategory(A.hh, B.expense.id, { name: "pwn", sortOrder: 0, enabled: true, recurring: false, isTemplate: false })],
      ["setCategoryArchived", () => setCategoryArchived(A.hh, B.expense.id, true)],
      ["deleteCategory", () => deleteCategory(A.hh, B.expense.id)],
      ["saveItems", () => saveItems(A.hh, B.budget.id, new Map([[B.item.id, { label: "pwn", amount: 1, included: true, recurring: true }]]))],
      ["removeItem", () => removeItem(A.hh, B.budget.id, B.item.id)],
      ["setBudgetStatus", () => setBudgetStatus(A.hh, B.budget.id, "VALIDATED")],
      ["setRole", () => setRole(A.hh, A.admin.id, B.member.id, "ADMIN")],
      ["setDisabled", () => setDisabled(A.hh, A.admin.id, B.admin.id, true)],
      ["applyPlan", () => applyPlan(A.admin, B.report.id)],
    ];
    for (const [name, p] of attempts) {
      const e = await err(p());
      expect(e, name).not.toBeNull();
      expect(e instanceof NotFoundError || (e as Error).message === "Membre inconnu.", `${name}: ${(e as Error)?.message}`).toBe(true);
    }
    // État de B inchangé.
    expect((await prisma.transaction.findUnique({ where: { id: B.tx.id } }))?.amount).toBe(4200);
    expect(await prisma.fixedCharge.count({ where: { id: B.charge.id } })).toBe(1);
    expect(await prisma.loan.count({ where: { id: B.loan.id } })).toBe(1);
    expect((await prisma.category.findUnique({ where: { id: B.expense.id } }))?.archivedAt).toBeNull();
    expect((await prisma.budgetItem.findUnique({ where: { id: B.item.id } }))?.label).toBe(B.item.label);
    expect((await prisma.budget.findUnique({ where: { id: B.budget.id } }))?.status).toBe("DRAFT");
    expect((await prisma.user.findUnique({ where: { id: B.member.id } }))?.role).toBe("MEMBER");
  });

  it("l'export de A ne contient aucune donnée de B", async () => {
    const json = JSON.stringify(await exportMonth(A.hh, MONTH));
    expect(json).not.toContain("secret b");
    expect(json).not.toContain("example.test\",\"name\":\"Admin b");
    expect(json).not.toMatch(/passwordHash|householdId/);
  });

  it("un fichier importé dans A n'écrit que dans A (rapprochement par nom/e-mail du foyer)", async () => {
    const file = await exportMonth(B.hh, MONTH);
    const e = await err(importMonth(A.hh, file));
    expect((e as Error).message).toMatch(/introuvable/); // membres de B inconnus dans A
    expect(await prisma.transaction.count({ where: { householdId: B.hh } })).toBe(1);
  });
});

describe("FOY-001 : import accessible à un MEMBER alors que le catalogue est réservé à l'ADMIN", () => {
  it("createCategoryAction refuse le MEMBER, importBudgetAction l'accepte et modifie le catalogue", async () => {
    await startSession(A.member.id);
    const fd = new FormData();
    fd.set("kind", "EXPENSE");
    fd.set("name", "Créée par membre");
    expect((await err(createCategoryAction({}, fd)) as Error).message).toBe("REDIRECT:/tableau-de-bord");

    const file = {
      version: 1, month: "2026-03",
      members: [{ email: A.member.email, name: A.member.name }, { email: A.admin.email, name: A.admin.name }],
      categories: [{ kind: "EXPENSE", name: A.expense.name, parent: null, fixed: true, savings: true }, { kind: "EXPENSE", name: "Créée par membre", parent: null, fixed: false, savings: false }],
      charges: [], budget: null,
      transactions: [{ kind: "EXPENSE", amount: 999_00, occurredOn: "2026-03-15", note: "forgée", category: 1, shared: true, paidBy: 1, createdBy: 1, payment: null, prepayment: null }],
    };
    const up = new FormData();
    up.set("file", new File([JSON.stringify(file)], "m.json", { type: "application/json" }));
    expect((await err(importBudgetAction({}, up)) as Error).message).toMatch(/^REDIRECT:\/budget/);

    expect((await prisma.category.findUnique({ where: { id: A.expense.id } }))?.savings).toBe(true); // drapeau changé par un MEMBER
    expect(await prisma.category.count({ where: { householdId: A.hh, name: "Créée par membre" } })).toBe(1);
    const forged = (await prisma.transaction.findFirst({ where: { householdId: A.hh, note: "forgée" } }))!;
    expect(forged.createdById).toBe(A.admin.id); // créée par le membre, attribuée à l'admin
    expect(await prisma.transaction.count({ where: { id: A.tx.id } })).toBe(0); // opération de l'admin effacée
  });
});

describe("FOY-003 : verrouillage par e-mail indépendant de l'IP", () => {
  it("10 échecs depuis une IP bloquent la victime depuis toute autre IP", () => {
    const email = "victime@example.test", now = 1_000_000;
    for (let i = 0; i < 10; i++) recordLoginFailure(`198.51.100.${i}`, email, now);
    expect(loginBlocked("203.0.113.7", email, now + 1)).toBe(true);
  });
});

describe("FOY-004 : valeurs acceptées par parseMonthFile mais refusées par la base", () => {
  const base = (amount: number) => JSON.stringify({
    version: 1, month: "2026-03", members: [{ email: A.admin.email, name: A.admin.name }], categories: [], charges: [], budget: null,
    transactions: [{ kind: "EXPENSE", amount, occurredOn: "2026-03-15", note: null, category: null, shared: true, paidBy: 0, createdBy: 0, payment: null, prepayment: null }],
  });
  for (const amount of [0, 2 ** 31]) {
    it(`montant ${amount} : validé par le parseur, puis erreur Prisma (non LedgerError → 500)`, async () => {
      const file = parseMonthFile(base(amount));
      const e = (await err(importMonth(A.hh, file))) as Error;
      expect(e?.constructor.name).toMatch(/Prisma/);
      expect(await prisma.transaction.count({ where: { id: A.tx.id } })).toBe(1); // rollback : rien perdu
    });
  }
});

describe("FOY-008 : remboursement anticipé sans idempotence", () => {
  it("deux soumissions identiques créent deux remboursements", async () => {
    await prepay(A.hh, A.admin.id, A.loan.id, 10_000, D("2026-03-10"), "REDUCE_TERM");
    await prepay(A.hh, A.admin.id, A.loan.id, 10_000, D("2026-03-10"), "REDUCE_TERM");
    expect(await prisma.loanPrepayment.count({ where: { loanId: A.loan.id } })).toBe(2);
  });
});

describe("Contrôles positifs", () => {
  it("idempotence : même clé → une seule opération", async () => {
    const input = { kind: "EXPENSE" as const, amount: 100, occurredOn: D("2026-03-12"), note: null, categoryId: null, paidById: A.admin.id, idempotencyKey: "k-1" };
    const [x, y] = await Promise.all([createEntry(A.hh, A.admin.id, input), createEntry(A.hh, A.admin.id, input)]);
    expect(x.id).toBe(y.id);
    expect(await prisma.transaction.count({ where: { householdId: A.hh, idempotencyKey: "k-1" } })).toBe(1);
  });

  it("parseCents rejette les entrées hostiles", () => {
    for (const s of ["NaN", "Infinity", "1e9", "-5", "0", "0,005", "21474836,48", "1.2.3", ""]) expect(parseCents(s), s).toBeNull();
    expect(parseCents("1 234,56")).toBe(123456);
  });

  it("MEMBER refusé sur une action ADMIN (rôle relu en base à chaque requête)", async () => {
    await startSession(A.member.id);
    const fd = new FormData();
    expect((await err(createCategoryAction({}, fd)) as Error).message).toBe("REDIRECT:/tableau-de-bord");
    await prisma.user.update({ where: { id: A.member.id }, data: { disabledAt: new Date() } });
    expect((await err(createCategoryAction({}, fd)) as Error).message).toBe("REDIRECT:/login");
  });
});
