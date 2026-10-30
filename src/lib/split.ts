import type { Role } from "@prisma/client";
import { canRead, canWrite, fullScope, type Scope } from "./access";
import { addMonths, getBudget } from "./budget";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";

/** Montants du mois par membre (id utilisateur → centimes). */
type PerMember = Record<string, number>;

export type SplitInput = {
  members: { id: string; name: string }[]; // utilisateurs actifs propriétaires d'au moins un compte non archivé
  income: PerMember; // INCOME catégorisées du mois sur ses comptes
  forecast: PerMember; // charges INCOME du mois sur ses comptes (si income = 0)
  commonIncome: number; // INCOME catégorisées du mois sur comptes communs
  plannedCommon: number; // charges EXPENSE shared du mois + lignes EXPENSE principales incluses shared (total)
  toCommon: PerMember; // virements de ses comptes vers un compte commun, moins ceux d'un compte commun vers les siens
  paidCommon: PerMember; // EXPENSE shared sur ses comptes
  spentPersonal: PerMember; // EXPENSE non shared sur ses comptes
};

export type MemberSplit = {
  userId: string; name: string; income: number | null; forecast: boolean; shareBp: number; // 0–10000
  due: number; contribution: number; toTransfer: number; personalLeft: number | null;
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
 * Partage du mois au prorata des revenus (pur). Revenu retenu : réel, sinon prévisionnel ; aucun revenu → parts égales.
 * Reliquat d'arrondi au plus gros revenu (le premier à égalité).
 */
export function splitMonth(i: SplitInput): Split {
  const commonNet = Math.max(i.plannedCommon - i.commonIncome, 0);
  if (!i.members.length) return { commonNet, members: [] };
  const get = (r: PerMember, id: string) => r[id] ?? 0;
  const incomes = i.members.map((m) => get(i.income, m.id) || get(i.forecast, m.id));
  const weights = incomes.some((x) => x > 0) ? incomes : incomes.map(() => 1);
  const lead = incomes.indexOf(Math.max(...incomes));
  const shares = allocate(10000, weights, lead);
  const dues = allocate(commonNet, weights, lead);
  return {
    commonNet,
    members: i.members.map((m, k) => {
      const contribution = get(i.toCommon, m.id) + get(i.paidCommon, m.id);
      return {
        userId: m.id, name: m.name, income: incomes[k], forecast: !get(i.income, m.id) && incomes[k] > 0, shareBp: shares[k],
        due: dues[k], contribution, toTransfer: dues[k] - contribution, personalLeft: incomes[k] - dues[k] - get(i.spentPersonal, m.id),
      };
    }),
  };
}

/**
 * Entrées du partage, toujours en portée complète du foyer (sinon les chiffres seraient faux).
 * Membres : utilisateurs actifs ; les opérations des comptes d'un propriétaire désactivé sont ignorées.
 */
export async function getSplit(householdId: string, month: Date): Promise<Split> {
  const scope = fullScope(householdId);
  const [accounts, users, rows, charges, budget] = await Promise.all([
    prisma.account.findMany({ where: { householdId }, select: { id: true, ownerId: true, archivedAt: true } }),
    prisma.user.findMany({ where: { householdId, disabledAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({
      where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
      select: { accountId: true, kind: true, amount: true, shared: true, categoryId: true, transferId: true, transferSide: true },
    }),
    listMonthCharges(scope, month),
    getBudget(scope, month),
  ]);
  const owner = new Map(accounts.map((a) => [a.id, a.ownerId]));
  const members = users.filter((u) => accounts.some((a) => a.ownerId === u.id && !a.archivedAt));
  const add = (r: PerMember, id: string | null | undefined, n: number) => { if (id) r[id] = (r[id] ?? 0) + n; };
  const input: SplitInput = { members, income: {}, forecast: {}, commonIncome: 0, plannedCommon: 0, toCommon: {}, paidCommon: {}, spentPersonal: {} };
  // Côté commun de chaque virement : IN = versé au commun, OUT = repris du commun (déduit de la contribution).
  const common = new Map(rows.filter((t) => t.transferSide && owner.get(t.accountId) === null).map((t) => [t.transferId, t.transferSide]));
  for (const t of rows) {
    const who = owner.get(t.accountId);
    if (t.kind === "TRANSFER") {
      const side = common.get(t.transferId);
      if (who && side && side !== t.transferSide) add(input.toCommon, who, side === "IN" ? t.amount : -t.amount);
    } else if (t.kind === "INCOME") {
      if (t.categoryId === null) continue; // ajustement de solde : pas un revenu
      if (who === null) input.commonIncome += t.amount;
      else add(input.income, who, t.amount);
    } else add(t.shared ? input.paidCommon : input.spentPersonal, who, t.amount);
  }
  for (const c of charges) {
    if (c.kind === "INCOME") add(input.forecast, owner.get(c.accountId), c.amount);
    else if (c.shared) input.plannedCommon += c.amount;
  }
  for (const n of budget?.tree ?? []) if (n.kind === "EXPENSE" && n.included && n.shared) input.plannedCommon += n.total;
  return splitMonth(input);
}

/** Comptes de chaque propriétaire (archivés compris), pour `visibleSplit`. */
export function accountsByOwner(accounts: { id: string; ownerId: string | null }[]) {
  const owned: Record<string, string[]> = {};
  for (const a of accounts) if (a.ownerId) (owned[a.ownerId] ??= []).push(a.id);
  return owned;
}

/** Admin, soi-même ou membre dont tous les comptes sont lisibles : détail complet ; sinon (comptes inconnus inclus) revenu et reste perso masqués. */
export function visibleSplit(split: Split, viewer: { id: string; role: Role }, scope: Scope, ownedBy: Record<string, string[]>): Split {
  const sees = (userId: string) => viewer.role === "ADMIN" || viewer.id === userId || !!ownedBy[userId]?.length && ownedBy[userId].every((id) => canRead(scope, id));
  return { ...split, members: split.members.map((m) => (sees(m.userId) ? m : { ...m, income: null, personalLeft: null })) };
}

/**
 * Partage du mois tel que `viewer` peut le voir, avec le lien « Préparer le virement » par membre (`transfer`) :
 * de son premier compte perso actif vers le premier compte commun, tous deux modifiables par le lecteur.
 * null si sans objet (aucun membre propriétaire, ou ni compte commun ni deux membres).
 */
export async function getVisibleSplit(viewer: { id: string; role: Role; householdId: string }, scope: Scope, month: Date) {
  const [split, accounts] = await Promise.all([
    getSplit(viewer.householdId, month),
    prisma.account.findMany({ where: { householdId: viewer.householdId }, select: { id: true, ownerId: true, archivedAt: true }, orderBy: { createdAt: "asc" } }),
  ]);
  if (!split.members.length || (!accounts.some((a) => a.ownerId === null && !a.archivedAt) && split.members.length < 2)) return null;
  const common = accounts.find((a) => a.ownerId === null && !a.archivedAt && canWrite(scope, a.id))?.id;
  const transfer: Record<string, string> = {};
  for (const m of split.members) {
    const from = accounts.find((a) => a.ownerId === m.userId && !a.archivedAt && canWrite(scope, a.id));
    if (m.toTransfer > 0 && from && common) transfer[m.userId] = `/accounts/${from.id}?virement=${common}&montant=${m.toTransfer}`;
  }
  return { ...visibleSplit(split, viewer, scope, accountsByOwner(accounts)), transfer };
}
