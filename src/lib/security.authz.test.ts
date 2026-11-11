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

import { createCategoryAction, importBudgetAction, updateLlmAction } from "@/app/actions";
import { checkCredentials, clearLoginFailures, createMember, loginBlocked, MAX_PASSWORD, recordLoginFailure, setDisabled, setRole, setupHousehold, startSession } from "./auth";
import { createBudget, removeItem, saveItems, setBudgetStatus } from "./budget";
import { exportMonth, importMonth, parseMonthFile } from "./budget-file";
import { deleteCategory, setCategoryArchived, updateCategory } from "./categories";
import { createCharge, deleteCharge, payCharge, updateCharge } from "./charges";
import { prisma } from "./db";
import { createEntry, deleteTransaction, LedgerError, NotFoundError, updateEntry } from "./ledger";
import { LlmError, localHostAllowed, openSecret, sealSecret } from "./llm";
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
  const charge = await createCharge(hh, { active: true, name: `Rent ${tag}`, dueDay: 5, categoryId: expense.id, startMonth: MONTH, endMonth: null, shared: true });
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
      expect(e instanceof NotFoundError || (e as Error).message === "Unknown member.", `${name}: ${(e as Error)?.message}`).toBe(true);
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
    expect((e as Error).message).toMatch(/not found/); // membres de B inconnus dans A
    expect(await prisma.transaction.count({ where: { householdId: B.hh } })).toBe(1);
  });
});

describe("FOY-001 : import réservé à l'ADMIN (il touche au catalogue et aux opérations de tous)", () => {
  it("importBudgetAction refuse le MEMBER sans rien modifier", async () => {
    await startSession(A.member.id);
    const file = {
      version: 1, month: "2026-03",
      members: [{ email: A.member.email, name: A.member.name }, { email: A.admin.email, name: A.admin.name }],
      categories: [{ kind: "EXPENSE", name: A.expense.name, parent: null, fixed: true, savings: true }, { kind: "EXPENSE", name: "Créée par membre", parent: null, fixed: false, savings: false }],
      charges: [], budget: null,
      transactions: [{ kind: "EXPENSE", amount: 999_00, occurredOn: "2026-03-15", note: "forgée", category: 1, shared: true, paidBy: 1, createdBy: 1, payment: null, prepayment: null }],
    };
    const up = new FormData();
    up.set("file", new File([JSON.stringify(file)], "m.json", { type: "application/json" }));
    expect((await err(importBudgetAction({}, up)) as Error).message).toBe("REDIRECT:/tableau-de-bord");

    expect((await prisma.category.findUnique({ where: { id: A.expense.id } }))?.savings).toBe(false);
    expect(await prisma.category.count({ where: { householdId: A.hh, name: "Créée par membre" } })).toBe(0);
    expect(await prisma.transaction.count({ where: { householdId: A.hh, note: "forgée" } })).toBe(0);
    expect(await prisma.transaction.count({ where: { id: A.tx.id } })).toBe(1);
  });
});

describe("FOY-003 : verrouillage de connexion par IP quand l'IP est connue", () => {
  const email = "victime@example.test", now = 1_000_000;
  it("10 échecs depuis d'autres IP ne bloquent pas la victime", () => {
    for (let i = 0; i < 10; i++) recordLoginFailure(`198.51.100.${i}`, email, now);
    expect(loginBlocked("203.0.113.7", email, now + 1)).toBe(false);
  });
  it("10 échecs depuis la même IP la bloquent, et un succès sur son propre compte ne remet pas le compteur à zéro", () => {
    for (let i = 0; i < 10; i++) recordLoginFailure("192.0.2.1", `cible${i}@example.test`, now);
    clearLoginFailures("192.0.2.1", "attaquant@example.test");
    expect(loginBlocked("192.0.2.1", "autre@example.test", now + 1)).toBe(true);
  });
});

describe("FOY-004 / FOY-005 : l'import refuse ce que la saisie refuse (LedgerError, pas d'erreur 500)", () => {
  const base = (amount: number) => JSON.stringify({
    version: 1, month: "2026-03", members: [{ email: A.admin.email, name: A.admin.name }], categories: [], charges: [], budget: null,
    transactions: [{ kind: "EXPENSE", amount, occurredOn: "2026-03-15", note: null, category: null, shared: true, paidBy: 0, createdBy: 0, payment: null, prepayment: null }],
  });
  for (const amount of [0, 2 ** 31]) {
    it(`montant ${amount} refusé par le parseur`, () => {
      expect(() => parseMonthFile(base(amount))).toThrow(LedgerError);
    });
  }

  it("charge rattachée à une catégorie de recette refusée", () => {
    const raw = JSON.stringify({
      version: 1, month: "2026-03", members: [], budget: null, transactions: [],
      categories: [{ kind: "INCOME", name: "Salaire", parent: null, fixed: false, savings: false }],
      charges: [{ kind: "EXPENSE", name: "x", category: 0, active: true, dueDay: 1, startMonth: "2026-03", endMonth: null, shared: true, loan: null }],
    });
    expect(() => parseMonthFile(raw)).toThrow(/income category/);
  });

  it("remboursement anticipé supérieur au capital restant refusé, rien n'est écrit", async () => {
    const file = await exportMonth(A.hh, MONTH);
    const ci = file.charges.findIndex((c) => c.loan);
    file.transactions.push({ kind: "EXPENSE", amount: 2_000_000, occurredOn: "2026-03-20", note: null, category: null, shared: true, paidBy: 0, createdBy: 0, payment: null, prepayment: { charge: ci, mode: "REDUCE_TERM" } });
    const e = (await err(importMonth(A.hh, parseMonthFile(JSON.stringify(file))))) as Error;
    expect(e).toBeInstanceOf(LedgerError);
    expect(e.message).toMatch(/principal still owed/);
    expect(await prisma.loanPrepayment.count({ where: { loanId: A.loan.id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { id: A.tx.id } })).toBe(1); // rollback
  });
});

describe("FOY-008 : remboursement anticipé idempotent", () => {
  it("deux soumissions avec la même clé créent un seul remboursement", async () => {
    const [x, y] = await Promise.all([
      prepay(A.hh, A.admin.id, A.loan.id, 10_000, D("2026-03-10"), "REDUCE_TERM", "k-prepay"),
      prepay(A.hh, A.admin.id, A.loan.id, 10_000, D("2026-03-10"), "REDUCE_TERM", "k-prepay"),
    ]);
    expect(x.id).toBe(y.id);
    expect(await prisma.loanPrepayment.count({ where: { loanId: A.loan.id } })).toBe(1);
  });
});

describe("FOY-002 : URL du modèle local limitée à LLM_ALLOWED_HOSTS", () => {
  it("hôte non autorisé : erreur de champ, aucune requête émise", async () => {
    vi.stubEnv("LLM_ALLOWED_HOSTS", "host.docker.internal:11434");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await startSession(A.admin.id);
    const fd = new FormData();
    fd.set("localLlmUrl", "http://db:5432");
    fd.set("localLlmModel", "m");
    fd.set("intent", "test");
    const res = await updateLlmAction({}, fd);
    expect(res?.fields?.localLlmUrl).toMatch(/not allowed/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localHostAllowed("http://host.docker.internal:11434")).toBe(true);
    expect(localHostAllowed("http://host.docker.internal:11435")).toBe(false);
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("FOY-006 : clés API LLM chiffrées en base", () => {
  it("chiffrée avec LLM_KEY_SECRET, relue en clair, illisible avec un autre secret", () => {
    vi.stubEnv("LLM_KEY_SECRET", "s1");
    const sealed = sealSecret("sk-ant-fictive");
    expect(sealed).not.toContain("sk-ant");
    expect(sealSecret(sealed)).toBe(sealed); // pas de double chiffrement
    expect(openSecret(sealed)).toBe("sk-ant-fictive");
    expect(openSecret("ancienne-en-clair")).toBe("ancienne-en-clair");
    vi.stubEnv("LLM_KEY_SECRET", "s2");
    expect(() => openSecret(sealed)).toThrow(LlmError);
    vi.unstubAllEnvs();
  });
});

describe("FOY-010 : longueur maximale du mot de passe", () => {
  it("un mot de passe trop long est refusé sans calcul Argon2", async () => {
    expect(await checkCredentials(A.admin.email, "x".repeat(MAX_PASSWORD + 1))).toBeNull();
    expect((await checkCredentials(A.admin.email, "fictif-pass-1"))?.id).toBe(A.admin.id);
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
