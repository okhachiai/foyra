import { Prisma } from "@prisma/client";
import { readable, type Scope } from "./access";
import { addMonths, budgetTotals } from "./budget";
import { chargeStatus } from "./calendar";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { listAccounts } from "./ledger";
import { bigintToCents } from "./money";

/**
 * Tableau de bord du mois de `today` (jour du foyer), uniquement sur les comptes lisibles :
 * revenus et dépenses enregistrés (virements exclus), résultat, comptes actifs et leurs soldes,
 * dernières opérations, dépenses récurrentes encore à payer, et rappel du budget prévu s'il existe.
 */
export async function getDashboard(scope: Scope, today: Date) {
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const householdId = scope.householdId;
  const [accounts, sums, lines, charges, budget] = await Promise.all([
    listAccounts(scope),
    prisma.transaction.groupBy({
      by: ["kind"],
      where: { householdId, accountId: readable(scope), kind: { in: ["INCOME", "EXPENSE"] }, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { householdId, accountId: readable(scope) },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 12,
      include: { account: { select: { name: true } }, category: { select: { name: true, parent: { select: { name: true } } } } },
    }),
    listMonthCharges(scope, month),
    prisma.budget.findUnique({ where: { householdId_month: { householdId, month } }, include: { items: { include: { category: { select: { fixed: true } } } } } }),
  ]);
  const active = accounts.filter((a) => !a.archivedAt);
  const sum = (kind: "INCOME" | "EXPENSE") => sums.find((s) => s.kind === kind)?._sum.amount ?? 0;
  const income = sum("INCOME"), expense = sum("EXPENSE");

  // Un virement une seule fois : côté sortant s'il est visible.
  const outs = new Set(lines.filter((t) => t.transferSide === "OUT").map((t) => t.transferId));
  const recent = lines.filter((t) => t.transferSide !== "IN" || !outs.has(t.transferId)).slice(0, 8);

  const unpaid = charges.filter((c) => c.kind === "EXPENSE" && !c.payment).map((c) => ({ ...c, status: chargeStatus(c, today) }));
  const late = unpaid.filter((c) => c.status === "late");

  return {
    month,
    income,
    expense,
    result: income - expense,
    accounts: active,
    total: active.reduce((s, a) => s + a.balance, 0),
    recent,
    unpaid,
    toPay: unpaid.reduce((s, c) => s + c.amount, 0),
    late: { count: late.length, amount: late.reduce((s, c) => s + c.amount, 0) },
    budget: budget && { status: budget.status, totals: budgetTotals(budget.items) },
  };
}

const DAY = 86_400_000;
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m, d);
const pct = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
const fr = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "UTC" });
const NONE = "none";

/** Mouvements agrégés par jour, sens, côté de virement, catégorie et compte archivé ou non. */
export type Flow = { day: number; kind: "INCOME" | "EXPENSE" | "TRANSFER"; side: "IN" | "OUT" | null; categoryId: string | null; archived: boolean; amount: number };

/** Graphiques du tableau de bord : mouvements des comptes lisibles depuis le 1er janvier de l'an dernier. */
export async function getDashboardCharts(scope: Scope, today: Date, total: number) {
  const from = new Date(utc(today.getUTCFullYear() - 1, 0));
  const [rows, categories] = await Promise.all([
    prisma.$queryRaw<(Omit<Flow, "day" | "amount"> & { day: Date; amount: bigint })[]>`
      SELECT t."occurredOn" AS day, t."kind"::text AS kind, t."transferSide"::text AS side, t."categoryId" AS "categoryId",
        a."archivedAt" IS NOT NULL AS archived, SUM(t."amount")::bigint AS amount
      FROM "Transaction" t JOIN "Account" a ON a."id" = t."accountId"
      WHERE t."householdId" = ${scope.householdId} AND t."occurredOn" >= ${from}
        ${scope.read ? Prisma.sql`AND t."accountId" = ANY(${scope.read})` : Prisma.empty}
      GROUP BY 1, 2, 3, 4, 5`,
    prisma.category.findMany({ where: { householdId: scope.householdId }, select: { id: true, name: true, parentId: true } }),
  ]);
  return buildCharts(rows.map((r) => ({ ...r, day: r.day.getTime(), amount: bigintToCents(r.amount) })), categories, today, total);
}

export type DashboardCharts = ReturnType<typeof buildCharts>;

export function buildCharts(flows: Flow[], categories: { id: string; name: string; parentId: string | null }[], today: Date, total: number) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), t = today.getTime();
  const entries = flows.filter((f) => f.kind !== "TRANSFER");
  const sum = (kind: "INCOME" | "EXPENSE", from: number, to: number, pick: (f: Flow) => boolean = () => true) =>
    entries.reduce((s, f) => (f.kind === kind && f.day >= from && f.day < to && pick(f) ? s + f.amount : s), 0);

  // Solde global en fin de journée : solde actuel moins tout ce qui a été passé après ce jour (comptes actifs).
  const balance = Array.from({ length: 30 }, (_, i) => {
    const d = t - (29 - i) * DAY;
    const after = flows.reduce((s, f) => (!f.archived && f.day > d ? s + (f.kind === "INCOME" || f.side === "IN" ? f.amount : -f.amount) : s), 0);
    return { label: fr({ day: "numeric", month: "short" }).format(d), value: total - after };
  });

  // Entrées et sorties cumulées jour par jour : ce mois puis les deux précédents.
  const cumul = (kind: "INCOME" | "EXPENSE") =>
    [0, 1, 2].map((k) => Array.from({ length: 31 }, (_, d) => sum(kind, utc(y, m - k), Math.min(utc(y, m - k, d + 2), utc(y, m - k + 1)))));
  const income = cumul("INCOME"), expense = cumul("EXPENSE");

  // Dépenses par catégorie ; le groupe est la catégorie parente.
  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (id: string | null) => (id && byId.get(id)?.name) || "Sans catégorie";
  const yearAgo = utc(y - 1, m, today.getUTCDate() + 1);
  const periods = [
    { label: "Ce mois", from: utc(y, m), to: utc(y, m + 1), prev: [utc(y, m - 1), utc(y, m)], compare: "le mois dernier" },
    { label: "Mois dernier", from: utc(y, m - 1), to: utc(y, m), prev: [utc(y, m - 2), utc(y, m - 1)], compare: "le mois précédent" },
    { label: "Cette année", from: utc(y, 0), to: t + DAY, prev: [utc(y - 1, 0), yearAgo], compare: "l’an dernier à date" },
  ];
  const ids = [...new Set(entries.filter((f) => f.kind === "EXPENSE").map((f) => f.categoryId))];
  const items = ids
    .map((id) => ({
      id,
      name: nameOf(id),
      group: (id && byId.get(id)?.parentId) || id || NONE,
      values: periods.map((p) => sum("EXPENSE", p.from, p.to, (f) => f.categoryId === id)),
    }))
    .filter((i) => i.values.some((v) => v > 0))
    .sort((a, b) => b.values[0] - a.values[0] || b.values[2] - a.values[2]);
  const groups = [...new Set(items.map((i) => i.group))].map((id) => ({ id, name: id === NONE ? "Sans catégorie" : nameOf(id) }));

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

  return {
    balance: { series: balance, delta: pct(total, balance[0].value) },
    flows: {
      income,
      expense,
      months: [0, 1, 2].map((k) => fr({ month: "long" }).format(utc(y, m - k))),
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
