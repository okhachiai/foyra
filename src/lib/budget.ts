import type { CarryOver, CategoryKind } from "@prisma/client";
import { listCategories } from "./categories";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { parseDay } from "./ledger";

/** « AAAA-MM » (années 2000–2099) → Date UTC du 1er du mois (colonne @db.Date), ou null si invalide. */
export const parseMonth = (s: string | undefined) => (s && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s) ? parseDay(`${s}-01`) : null);
export const formatMonth = (month: Date) => month.toISOString().slice(0, 7);
export const addMonths = (month: Date, n: number) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1));

type Seed = { id: string; forecastAmount: number | null; carryOver: CarryOver };

/** Montant prévu d'un mois neuf selon la règle de reconduction ; `previous` = ligne la plus récente avant ce mois. */
export function carriedAmount(c: Seed, previous: { planned: number | null } | undefined): number | null {
  if (c.carryOver === "NONE") return null;
  if (c.carryOver === "PREVIOUS" && previous) return previous.planned;
  return c.forecastAmount;
}

/** Crée les lignes manquantes du mois (instantané : les lignes existantes ne sont jamais réécrites). */
export async function ensureMonth(householdId: string, month: Date) {
  const missing = await prisma.category.findMany({
    where: { householdId, budgetLines: { none: { month } } },
    select: { id: true, forecastAmount: true, carryOver: true },
  });
  if (!missing.length) return;
  const previous = await prisma.$queryRaw<{ categoryId: string; planned: number | null }[]>`
    SELECT DISTINCT ON ("categoryId") "categoryId", "planned" FROM "BudgetLine"
    WHERE "householdId" = ${householdId} AND "month" < ${month} ORDER BY "categoryId", "month" DESC`;
  const prev = new Map(previous.map((p) => [p.categoryId, p]));
  // skipDuplicates + unique (catégorie, mois) : deux ouvertures simultanées ne créent qu'une ligne.
  await prisma.budgetLine.createMany({
    data: missing.map((c) => ({ householdId, categoryId: c.id, month, planned: carriedAmount(c, prev.get(c.id)) })),
    skipDuplicates: true,
  });
}

/**
 * `fixed` = Σ charges fixes applicables de la catégorie, `unpaidFixed` = celles non payées ce mois,
 * `fixedActual` = dépenses du mois liées à un paiement de charge.
 */
export type BudgetRow = {
  id: string; kind: CategoryKind; label: string; planned: number | null; actual: number;
  fixed?: number; unpaidFixed?: number; fixedActual?: number;
};

/** Disponible d'une ligne de dépense = prévu (vide = 0) − effectué ; négatif = dépassement. */
export const available = (r: BudgetRow) => (r.planned ?? 0) - r.actual;

/**
 * Totaux du mois (prévu vide = 0). Reste à vivre = fin de mois projetée.
 * Une charge non payée reste due même si le prévu est vide ou dépassé : restant = max(prévu − effectué, non payé).
 */
export function summarize(rows: BudgetRow[]) {
  const t = {
    incomePlanned: 0, incomeActual: 0, expensePlanned: 0, expenseActual: 0, remainingToPay: 0, restToLive: 0,
    fixedTotal: 0, fixedPaid: 0, fixedRemaining: 0, variableActual: 0,
  };
  for (const r of rows) {
    const planned = r.planned ?? 0;
    if (r.kind === "INCOME") {
      t.incomePlanned += planned;
      t.incomeActual += r.actual;
      t.restToLive += Math.max(planned, r.actual);
    } else {
      const unpaid = r.unpaidFixed ?? 0;
      t.expensePlanned += planned;
      t.expenseActual += r.actual;
      t.remainingToPay += Math.max(planned - r.actual, unpaid);
      t.restToLive -= Math.max(planned, r.actual + unpaid);
      t.fixedTotal += r.fixed ?? 0;
      t.fixedRemaining += unpaid;
      t.variableActual += r.actual - (r.fixedActual ?? 0);
    }
  }
  t.fixedPaid = t.fixedTotal - t.fixedRemaining;
  return t;
}

/** Budget d'un mois : catégories incluses (prévu + réel), totaux, et opérations hors calcul. */
export async function getBudget(householdId: string, month: Date) {
  await ensureMonth(householdId, month);
  const next = addMonths(month, 1);
  const [categories, lines, sums, charges, fixedSums] = await Promise.all([
    listCategories(householdId),
    prisma.budgetLine.findMany({ where: { householdId, month }, select: { categoryId: true, planned: true } }),
    prisma.transaction.groupBy({
      by: ["categoryId", "kind"],
      where: { householdId, kind: { in: ["INCOME", "EXPENSE"] }, occurredOn: { gte: month, lt: next } },
      _sum: { amount: true },
    }),
    listMonthCharges(householdId, month),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { householdId, kind: "EXPENSE", occurredOn: { gte: month, lt: next }, fixedPayment: { isNot: null } },
      _sum: { amount: true },
    }),
  ]);
  const planned = new Map(lines.map((l) => [l.categoryId, l.planned]));
  const actual = new Map<string, number>();
  for (const s of sums) if (s.categoryId) actual.set(s.categoryId, s._sum.amount ?? 0);
  const fixed = new Map<string, { fixed: number; unpaidFixed: number }>();
  for (const c of charges) {
    const f = fixed.get(c.categoryId) ?? { fixed: 0, unpaidFixed: 0 };
    f.fixed += c.amount;
    if (!c.payment) f.unpaidFixed += c.amount;
    fixed.set(c.categoryId, f);
  }
  const fixedActual = new Map(fixedSums.map((s) => [s.categoryId, s._sum.amount ?? 0]));

  // Incluse = activée et (sans parent ou parent activé). Chaque sous-catégorie a sa propre ligne.
  const rows: BudgetRow[] = categories.filter((c) => c.enabled).flatMap((c) =>
    [{ c, label: c.name }, ...c.children.filter((s) => s.enabled).map((s) => ({ c: s, label: `${c.name} › ${s.name}` }))].map(({ c, label }) => ({
      id: c.id, kind: c.kind, label, planned: planned.get(c.id) ?? null, actual: actual.get(c.id) ?? 0,
      fixed: fixed.get(c.id)?.fixed ?? 0, unpaidFixed: fixed.get(c.id)?.unpaidFixed ?? 0, fixedActual: fixedActual.get(c.id) ?? 0,
    })),
  );
  const included = new Set(rows.map((r) => r.id));
  const outside = { INCOME: 0, EXPENSE: 0 };
  for (const s of sums) if (!s.categoryId || !included.has(s.categoryId)) outside[s.kind as CategoryKind] += s._sum.amount ?? 0;

  return { rows, totals: summarize(rows), outside, charges };
}

/** Enregistre les montants prévus du mois ; ids hors foyer ignorés (filtre householdId). */
export async function savePlanned(householdId: string, month: Date, planned: Map<string, number | null>) {
  await ensureMonth(householdId, month);
  await prisma.$transaction(
    [...planned].map(([categoryId, value]) => prisma.budgetLine.updateMany({ where: { householdId, categoryId, month }, data: { planned: value } })),
  );
}
