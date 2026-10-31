import { addMonths } from "./amortization";
import { getBudget } from "./budget";
import { prisma } from "./db";

/** Montants du mois par membre (id utilisateur → centimes). */
type PerMember = Record<string, number>;

export type SplitInput = {
  members: { id: string; name: string }[]; // utilisateurs actifs du foyer
  income: PerMember; // recettes personnelles catégorisées du mois, par bénéficiaire
  commonIncome: number; // recettes communes catégorisées du mois
  plannedCommon: number; // lignes EXPENSE principales incluses shared (total) : le budget seul
  paidCommon: PerMember; // dépenses communes payées par le membre
  spentPersonal: PerMember; // dépenses personnelles payées par le membre
};

export type MemberSplit = {
  userId: string; name: string; income: number; shareBp: number; // 0–10000
  due: number; contribution: number; toTransfer: number; personalLeft: number;
};

export type Split = { commonNet: number; members: MemberSplit[] };

/** Répartit `total` selon `weights` au centime (troncature) ; reliquat à `lead` (somme exacte). */
function allocate(total: number, weights: number[], lead: number) {
  const sum = weights.reduce((t, w) => t + w, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[lead] += total - parts.reduce((t, p) => t + p, 0);
  return parts;
}

/**
 * Partage du mois au prorata des revenus (pur). Revenu retenu : réel ; aucun revenu → parts égales.
 * Reliquat d'arrondi au plus gros revenu (le premier à égalité).
 */
export function splitMonth(i: SplitInput): Split {
  const commonNet = Math.max(i.plannedCommon - i.commonIncome, 0);
  if (!i.members.length) return { commonNet, members: [] };
  const get = (r: PerMember, id: string) => r[id] ?? 0;
  const incomes = i.members.map((m) => get(i.income, m.id));
  const weights = incomes.some((x) => x > 0) ? incomes : incomes.map(() => 1);
  const lead = incomes.indexOf(Math.max(...incomes));
  const shares = allocate(10000, weights, lead);
  const dues = allocate(commonNet, weights, lead);
  return {
    commonNet,
    members: i.members.map((m, k) => {
      const contribution = get(i.paidCommon, m.id);
      return {
        userId: m.id, name: m.name, income: incomes[k], shareBp: shares[k],
        due: dues[k], contribution, toTransfer: dues[k] - contribution, personalLeft: incomes[k] - dues[k] - get(i.spentPersonal, m.id),
      };
    }),
  };
}

/** Partage du mois du foyer : chaque opération est attribuée à son « payé par ». Recettes sans catégorie ignorées. */
export async function getSplit(householdId: string, month: Date): Promise<Split> {
  const [members, rows, budget] = await Promise.all([
    prisma.user.findMany({ where: { householdId, disabledAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({
      where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      select: { paidById: true, kind: true, amount: true, shared: true, categoryId: true },
    }),
    getBudget(householdId, month),
  ]);
  const add = (r: PerMember, id: string, n: number) => { r[id] = (r[id] ?? 0) + n; };
  const input: SplitInput = { members, income: {}, commonIncome: 0, plannedCommon: 0, paidCommon: {}, spentPersonal: {} };
  for (const t of rows) {
    if (t.kind === "INCOME") {
      if (t.categoryId === null) continue;
      if (t.shared) input.commonIncome += t.amount;
      else add(input.income, t.paidById, t.amount);
    } else add(t.shared ? input.paidCommon : input.spentPersonal, t.paidById, t.amount);
  }
  for (const n of budget?.tree ?? []) if (n.kind === "EXPENSE" && n.included && n.shared) input.plannedCommon += n.total;
  return splitMonth(input);
}
