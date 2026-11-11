import { addMonths } from "./amortization";
import { buildTree, formatMonth } from "./budget";
import { prisma } from "./db";
import { createEntry, isCode, type EntryInput } from "./ledger";

const NAME = "Savings";

/**
 * Catégorie d'épargne du foyer (dépense fixe de premier niveau) : la première marquée, sinon « Épargne »
 * existante (marquée au passage), sinon créée. Double création simultanée : l'index unique du nom départage.
 */
export async function savingsCategory(householdId: string): Promise<string> {
  const find = async () => {
    const c = await prisma.category.findFirst({ where: { householdId, savings: true, parentId: null, archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (c) return c.id;
    const named = await prisma.category.findFirst({ where: { householdId, kind: "EXPENSE", parentId: null, name: { equals: NAME, mode: "insensitive" } } });
    if (!named) return null;
    await prisma.category.update({ where: { id: named.id }, data: { savings: true, fixed: true, archivedAt: null } });
    return named.id;
  };
  const id = await find();
  if (id) return id;
  try {
    return (await prisma.category.create({ data: { householdId, kind: "EXPENSE", name: NAME, fixed: true, savings: true, sortOrder: 100 } })).id;
  } catch (e) {
    if (!isCode(e, "P2002")) throw e;
    return (await find())!;
  }
}

/** Versement d'épargne : une dépense commune de la catégorie d'épargne, donc déduite des revenus comme une charge. */
export async function addSaving(householdId: string, userId: string, input: Omit<EntryInput, "kind" | "categoryId"> & { idempotencyKey?: string | null }) {
  const categoryId = await savingsCategory(householdId);
  return createEntry(householdId, userId, { shared: true, ...input, kind: "EXPENSE", categoryId });
}

export type SavingsMonth = { month: string; planned: number; actual: number; cumulative: number };

/** Série mensuelle : prévu (budget), versé (opérations), cumul versé depuis toujours (`before` = versé avant le premier mois). */
export function savingsSeries(months: Date[], paid: { occurredOn: Date; amount: number }[], planned: Map<string, number>, before: number): SavingsMonth[] {
  const actual = new Map<string, number>();
  for (const p of paid) actual.set(formatMonth(p.occurredOn), (actual.get(formatMonth(p.occurredOn)) ?? 0) + p.amount);
  let cumulative = before;
  return months.map((m) => {
    const key = formatMonth(m), a = actual.get(key) ?? 0;
    cumulative += a;
    return { month: key, planned: planned.get(key) ?? 0, actual: a, cumulative };
  });
}

/** Suivi des `count` derniers mois jusqu'à `month` inclus, et derniers versements. */
export async function getSavings(householdId: string, month: Date, count = 12) {
  const from = addMonths(month, 1 - count), to = addMonths(month, 1);
  const ids = (await prisma.category.findMany({ where: { householdId, OR: [{ savings: true }, { parent: { savings: true } }] }, select: { id: true } })).map((c) => c.id);
  const inSavings = { householdId, categoryId: { in: ids } };
  const [paid, before, budgets, recent] = await Promise.all([
    prisma.transaction.findMany({ where: { ...inSavings, occurredOn: { gte: from, lt: to } }, select: { occurredOn: true, amount: true } }),
    prisma.transaction.aggregate({ where: { ...inSavings, occurredOn: { lt: from } }, _sum: { amount: true } }),
    prisma.budget.findMany({ where: { householdId, month: { gte: from, lt: to } }, include: { items: true } }),
    prisma.transaction.findMany({
      where: { ...inSavings, occurredOn: { lt: to } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { paidBy: { select: { name: true } } },
    }),
  ]);
  // Prévu : lignes principales incluses rattachées à une catégorie d'épargne.
  const planned = new Map(
    budgets.map((b) => [formatMonth(b.month), buildTree(b.items).reduce((s, n) => s + (n.included && n.categoryId && ids.includes(n.categoryId) ? n.total : 0), 0)]),
  );
  const months = Array.from({ length: count }, (_, i) => addMonths(from, i));
  return { series: savingsSeries(months, paid, planned, before._sum.amount ?? 0), recent };
}
