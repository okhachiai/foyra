import { addMonths } from "./amortization";
import { getBudget, groupOf, type Node } from "./budget";
import { chargeStatus } from "./calendar";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { dateFmt } from "./ledger";
import { bigintToCents } from "./money";

/**
 * Tableau de bord de `month` (par défaut le mois de `today`, jour du foyer) : revenus saisis dans le budget du mois, dépenses
 * enregistrées, résultat, net des opérations du mois (recettes − dépenses réelles), dernières opérations jusqu'à la fin du mois,
 * dépenses récurrentes encore à payer (retard jugé par rapport à `today`), et rappel du budget prévu s'il existe.
 */
export async function getDashboard(householdId: string, today: Date, month = addMonths(today, 0)) {
  const [sums, recent, charges, budget] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["kind"],
      where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { householdId, occurredOn: { lt: addMonths(month, 1) } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 8,
      include: { paidBy: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } } },
    }),
    listMonthCharges(householdId, month),
    getBudget(householdId, month),
  ]);
  const sum = (kind: "INCOME" | "EXPENSE") => sums.find((s) => s.kind === kind)?._sum.amount ?? 0;
  const income = budget?.totals.income ?? 0, expense = sum("EXPENSE");

  const unpaid = charges.filter((c) => !c.payment).map((c) => ({ ...c, status: chargeStatus(c, today) }));
  const late = unpaid.filter((c) => c.status === "late");

  return {
    month,
    income,
    expense,
    result: income - expense,
    net: sum("INCOME") - expense,
    recent,
    charges,
    unpaid,
    toPay: unpaid.reduce((s, c) => s + c.amount, 0),
    late: { count: late.length, amount: late.reduce((s, c) => s + c.amount, 0) },
    budget,
  };
}

const DAY = 86_400_000;
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m, d);
const pct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
const NONE = "none";

/** Opérations agrégées par jour, sens et catégorie. */
export type Flow = { day: number; kind: "INCOME" | "EXPENSE"; categoryId: string | null; amount: number };

/** Graphiques du tableau de bord : opérations du foyer depuis le 1er janvier de l'an dernier. */
export async function getDashboardCharts(householdId: string, today: Date, intl?: string) {
  const from = new Date(utc(today.getUTCFullYear() - 1, 0));
  const [rows, categories] = await Promise.all([
    prisma.$queryRaw<(Omit<Flow, "day" | "amount"> & { day: Date; amount: bigint })[]>`
      SELECT "occurredOn" AS day, "kind"::text AS kind, "categoryId", SUM("amount")::bigint AS amount
      FROM "Transaction"
      WHERE "householdId" = ${householdId} AND "occurredOn" >= ${from}
      GROUP BY 1, 2, 3`,
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, parentId: true } }),
  ]);
  return buildCharts(rows.map((r) => ({ ...r, day: r.day.getTime(), amount: bigintToCents(r.amount) })), categories, today, intl);
}

export type DashboardCharts = ReturnType<typeof buildCharts>;

export function buildCharts(flows: Flow[], categories: { id: string; name: string; parentId: string | null }[], today: Date, intl = "en-GB") {
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), t = today.getTime();
  const sum = (kind: "INCOME" | "EXPENSE", from: number, to: number, pick: (f: Flow) => boolean = () => true) =>
    flows.reduce((s, f) => (f.kind === kind && f.day >= from && f.day < to && pick(f) ? s + f.amount : s), 0);

  // Entrées et sorties cumulées jour par jour : ce mois puis les deux précédents.
  const cumul = (kind: "INCOME" | "EXPENSE") =>
    [0, 1, 2].map((k) => Array.from({ length: 31 }, (_, d) => sum(kind, utc(y, m - k), Math.min(utc(y, m - k, d + 2), utc(y, m - k + 1)))));
  const income = cumul("INCOME"), expense = cumul("EXPENSE");

  // Dépenses par catégorie ; le groupe est la catégorie parente.
  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (id: string | null) => (id && byId.get(id)?.name) || "Uncategorized";
  const yearAgo = utc(y - 1, m, today.getUTCDate() + 1);
  const periods = [
    { label: "This month", from: utc(y, m), to: utc(y, m + 1), prev: [utc(y, m - 1), utc(y, m)], compare: "last month" },
    { label: "Last month", from: utc(y, m - 1), to: utc(y, m), prev: [utc(y, m - 2), utc(y, m - 1)], compare: "the previous month" },
    { label: "This year", from: utc(y, 0), to: t + DAY, prev: [utc(y - 1, 0), yearAgo], compare: "last year to date" },
  ];
  const ids = [...new Set(flows.filter((f) => f.kind === "EXPENSE").map((f) => f.categoryId))];
  const items = ids
    .map((id) => ({
      id,
      name: nameOf(id),
      group: (id && byId.get(id)?.parentId) || id || NONE,
      values: periods.map((p) => sum("EXPENSE", p.from, p.to, (f) => f.categoryId === id)),
    }))
    .filter((i) => i.values.some((v) => v > 0))
    .sort((a, b) => b.values[0] - a.values[0] || b.values[2] - a.values[2]);
  const groups = [...new Set(items.map((i) => i.group))].map((id) => ({ id, name: id === NONE ? "Uncategorized" : nameOf(id) }));

  // Saisonnalité des dépenses : douze mois de cette année et de l'an dernier.
  const seasons = [y, y - 1].map((yy) => {
    const values = Array.from({ length: 12 }, (_, i) => sum("EXPENSE", utc(yy, i), utc(yy, i + 1)));
    const yearTotal = values.reduce((s, v) => s + v, 0);
    const top = items
      .map((i) => ({ label: i.name, value: sum("EXPENSE", utc(yy, 0), utc(yy + 1, 0), (f) => f.categoryId === i.id) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    return {
      label: String(yy),
      values,
      total: yearTotal,
      average: Math.round(yearTotal / (yy === y ? m + 1 : 12)),
      // Comparaison à date : l'an dernier jusqu'au même jour ; rien avant (hors de la fenêtre chargée).
      delta: yy === y ? pct(sum("EXPENSE", utc(y, 0), t + DAY), sum("EXPENSE", utc(y - 1, 0), yearAgo)) : null,
      top,
    };
  });

  // Revenus et dépenses par mois : les douze derniers mois, le plus ancien d'abord (barres du cash-flow).
  const last12 = Array.from({ length: 12 }, (_, i) => 11 - i);
  const monthly = {
    labels: last12.map((k) => dateFmt({ month: "short" }, intl).format(utc(y, m - k))),
    income: last12.map((k) => sum("INCOME", utc(y, m - k), utc(y, m - k + 1))),
    expense: last12.map((k) => sum("EXPENSE", utc(y, m - k), utc(y, m - k + 1))),
  };

  return {
    monthly,
    flows: {
      income,
      expense,
      months: [0, 1, 2].map((k) => dateFmt({ month: "long" }, intl).format(utc(y, m - k))),
      monthIncome: income[0][30],
      monthExpense: expense[0][30],
    },
    categories: {
      groups,
      items,
      periods: periods.map((p, i) => {
        const cur = items.reduce((s, it) => s + it.values[i], 0), prev = sum("EXPENSE", p.prev[0], p.prev[1]);
        return { label: p.label, total: cur, previous: prev, delta: pct(cur, prev), compare: p.compare };
      }),
    },
    seasons,
  };
}

export type PlanLine = { id: string; label: string; planned: number; actual: number; left: number };

/**
 * Plan de dépenses du budget : lignes principales de dépense incluses, charges fixes et variables (hors épargne),
 * par prévu décroissant, avec leur réel ; totaux prévu / réel / reste de ces seules lignes.
 */
export function spendingPlan(tree: (Node & { actual: number })[]) {
  const lines: PlanLine[] = tree
    .filter((n) => n.kind === "EXPENSE" && n.included && groupOf(n) !== "savings")
    .map((n) => ({ id: n.id, label: n.label, planned: n.total, actual: n.actual, left: n.total - n.actual }))
    .sort((a, b) => b.planned - a.planned);
  const planned = lines.reduce((s, l) => s + l.planned, 0), actual = lines.reduce((s, l) => s + l.actual, 0);
  return { lines, planned, actual, left: planned - actual };
}

/** Barre latérale : plan de dépenses du mois de `today` (null sans budget) et nombre d'échéances non payées. */
export async function getShell(householdId: string, today: Date) {
  const month = addMonths(today, 0);
  const [budget, charges] = await Promise.all([getBudget(householdId, month), listMonthCharges(householdId, month)]);
  return {
    month,
    plan: budget && spendingPlan(budget.tree),
    due: charges.filter((c) => !c.payment).length,
  };
}

const STATUS_RANK = { late: 0, due: 1, paid: 2 } as const;

/** Échéances de dépense du mois pour le tableau de bord : en retard, puis à payer, puis payées ; par date dans chaque groupe. */
export function upcomingCharges<T extends { payment: unknown; due: Date }>(charges: T[], today: Date, n = 5) {
  return charges
    .map((c) => ({ ...c, status: chargeStatus(c, today) }))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.due.getTime() - b.due.getTime())
    .slice(0, n);
}
