import type { Role } from "@prisma/client";
import { canRead, fullScope, getScope, readable } from "./access";
import { addMonths, envelopes, formatMonth, getBudget, type Envelope } from "./budget";
import { listMonthCharges } from "./charges";
import { prisma } from "./db";
import { formatDay, LedgerError, listAccounts, parseDay } from "./ledger";
import { accountsByOwner, getSplit, visibleSplit, type Split } from "./split";

type Kind = "INCOME" | "EXPENSE";

/** Opération transmise au LLM : libellé = note, sinon nom de catégorie. */
export type Op = { id: string; label: string; amount: number; kind: Kind; account: string; categoryId: string | null };

/** Tout ce que reçoit le LLM ; chaque montant est calculé par l'app (centimes). */
export type ReportInput = {
  today: string; daysLeft: number; month: string; split: Split;
  envelopes: (Envelope & { allocatable: boolean })[];
  reserve: (Envelope & { overrun: number; allocatable: boolean }) | null;
  available: number; // reste commun à répartir
  todayOps: Op[]; uncategorized: Op[];
  categories: { id: string; name: string; kind: Kind }[];
  upcoming: { name: string; amount: number; due: string; account: string }[];
  members: { id: string; name: string }[];
};

export type ReportOutput = {
  allocations: { budgetItemId: string; amount: number }[];
  categorize: { transactionId: string; categoryId: string }[];
  plan: { date: string; budgetItemId: string; label: string; amount: number }[];
  balancing: { fromUserId: string; toUserId: string; amount: number; reason: string }[];
  advice: string;
};

type Schema = { type: string; items?: Schema; properties?: Record<string, Schema> };
const str = { type: "string" }, int = { type: "integer" };
const arr = (items: Schema) => ({ type: "array", items });
const obj = (properties: Record<string, Schema>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

/** JSON Schema de `ReportOutput` : tous champs requis, aucun champ en trop. */
export const OUTPUT_SCHEMA = obj({
  allocations: arr(obj({ budgetItemId: str, amount: int })),
  categorize: arr(obj({ transactionId: str, categoryId: str })),
  plan: arr(obj({ date: str, budgetItemId: str, label: str, amount: int })),
  balancing: arr(obj({ fromUserId: str, toUserId: str, amount: int, reason: str })),
  advice: str,
});

/** Conformité au schéma ; un nombre non entier passe ici pour être refusé ensuite avec l'id en cause. */
function conforms(v: unknown, s: Schema): boolean {
  if (s.type === "string") return typeof v === "string";
  if (s.type === "integer") return typeof v === "number";
  if (s.type === "array") return Array.isArray(v) && v.every((x) => conforms(x, s.items!));
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(s.properties!);
  return Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => conforms((v as Record<string, unknown>)[k], s.properties![k]));
}

/** Première incohérence de la sortie, ou null. */
function check(i: ReportInput, o: ReportOutput): string | null {
  const allocatable = new Set([...i.envelopes, ...(i.reserve ? [i.reserve] : [])].filter((e) => e.allocatable).map((e) => e.id));
  const amounts: [string, number][] = [
    ...o.allocations.map((a) => [a.budgetItemId, a.amount] as [string, number]),
    ...o.plan.map((p) => [p.budgetItemId, p.amount] as [string, number]),
    ...o.balancing.map((b) => [b.fromUserId, b.amount] as [string, number]),
  ];
  for (const [id, n] of amounts) if (!Number.isInteger(n) || n < 0) return `Montant invalide pour ${id} : ${n} (entier ≥ 0 en centimes attendu).`;

  const allocated = new Map<string, number>();
  for (const a of o.allocations) {
    if (!allocatable.has(a.budgetItemId)) return `Ligne non allouable ou inconnue : ${a.budgetItemId}.`;
    if (allocated.has(a.budgetItemId)) return `Ligne allouée deux fois : ${a.budgetItemId}.`;
    allocated.set(a.budgetItemId, a.amount);
  }
  const total = o.allocations.reduce((s, a) => s + a.amount, 0);
  if (allocatable.size && total !== i.available) return `Somme des allocations ${total} ≠ reste commun disponible ${i.available} (centimes).`;

  const ops = new Map([...i.todayOps, ...i.uncategorized].map((t) => [t.id, t.kind]));
  const cats = new Map(i.categories.map((c) => [c.id, c.kind]));
  for (const c of o.categorize) {
    if (!ops.has(c.transactionId)) return `Opération inconnue : ${c.transactionId}.`;
    if (cats.get(c.categoryId) !== ops.get(c.transactionId)) return `Catégorie inconnue ou de mauvais sens pour ${c.transactionId} : ${c.categoryId}.`;
  }

  const planned = new Map<string, number>();
  for (const p of o.plan) {
    if (!allocatable.has(p.budgetItemId)) return `Ligne non allouable ou inconnue dans le plan : ${p.budgetItemId}.`;
    // Jours restants du mois, aujourd'hui compris.
    if (!parseDay(p.date) || p.date < i.today || !p.date.startsWith(`${i.month}-`)) return `Date hors du reste du mois : ${p.date}.`;
    planned.set(p.budgetItemId, (planned.get(p.budgetItemId) ?? 0) + p.amount);
  }
  for (const [id, sum] of planned) if (sum > (allocated.get(id) ?? 0)) return `Plan de ${id} (${sum}) supérieur à son allocation (${allocated.get(id) ?? 0}).`;

  const members = new Set(i.members.map((m) => m.id));
  for (const b of o.balancing) {
    for (const id of [b.fromUserId, b.toUserId]) if (!members.has(id)) return `Membre inconnu : ${id}.`;
    if (b.fromUserId === b.toUserId) return `Rééquilibrage d'un membre vers lui-même : ${b.fromUserId}.`;
  }
  return null;
}

/** Valide au centime la réponse du LLM contre l'entrée (pur). */
export function validateOutput(input: ReportInput, text: string): { ok: true; output: ReportOutput } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "Réponse non JSON." };
  }
  if (!conforms(v, OUTPUT_SCHEMA)) return { ok: false, error: "Réponse non conforme au schéma." };
  const error = check(input, v as ReportOutput);
  return error ? { ok: false, error } : { ok: true, output: v as ReportOutput };
}

// Note posée par adjustBalance (ledger.ts) sur ses opérations sans catégorie.
const ADJUSTMENT = "Ajustement de solde";

/**
 * Entrée du rapport du mois de `today` (Date UTC minuit, jour du foyer) vue par `viewer`.
 * Partage : agrégats seuls pour les membres dont il ne lit pas tous les comptes. Enveloppes et disponible : portée complète
 * (argent commun, identique pour tous). Opérations et échéances : comptes lisibles seulement ; ajustements de solde exclus.
 * Aucun e-mail ni identifiant de session : seuls ids, noms et libellés partent au LLM.
 */
export async function buildInput(viewer: { id: string; role: Role; householdId: string }, today: Date): Promise<{ budgetId: string; input: ReportInput }> {
  const householdId = viewer.householdId;
  const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const all = fullScope(householdId);
  const scope = await getScope(viewer);
  const [budget, split, accounts, charges, ops, categories] = await Promise.all([
    getBudget(all, month),
    getSplit(householdId, month),
    listAccounts(all),
    listMonthCharges(all, month),
    prisma.transaction.findMany({
      where: {
        householdId, accountId: readable(scope), kind: { in: ["INCOME", "EXPENSE"] }, occurredOn: { gte: month, lt: addMonths(month, 1) },
        OR: [{ occurredOn: today }, { categoryId: null }],
      },
      include: { account: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({ where: { householdId, archivedAt: null }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!budget) throw new LedgerError("Aucun budget pour ce mois.");
  // Filtré ici : en SQL, NOT (… AND note = …) écarterait aussi les notes nulles.
  const kept = ops.filter((t) => !(t.categoryId === null && t.note === ADJUSTMENT));

  // Allouable : ligne sans sous-ligne (le plan porte sur une ligne précise).
  const leaf = new Set(budget.tree.filter((n) => !n.children.length).map((n) => n.id));
  const { lines, reserve } = envelopes(budget.tree);
  const common = new Set(accounts.filter((a) => a.ownerId === null && !a.archivedAt).map((a) => a.id));
  const unpaid = charges.filter((c) => c.kind === "EXPENSE" && !c.payment);
  const available = Math.max(
    accounts.filter((a) => common.has(a.id)).reduce((s, a) => s + a.balance, 0) - unpaid.filter((c) => common.has(c.accountId)).reduce((s, c) => s + c.amount, 0),
    0,
  );
  const op = (t: (typeof ops)[number]): Op => ({
    id: t.id, label: t.note ?? t.category?.name ?? "", amount: t.amount, kind: t.kind as Kind, account: t.account.name, categoryId: t.categoryId,
  });
  const day = formatDay(today);
  // Jours restants, aujourd'hui compris (le 30 d'un mois de 30 jours : 1).
  const daysLeft = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate() - today.getUTCDate() + 1;

  return {
    budgetId: budget.id,
    input: {
      today: day, daysLeft, month: formatMonth(month),
      split: visibleSplit(split, viewer, scope, accountsByOwner(accounts)),
      envelopes: lines.map((l) => ({ ...l, allocatable: leaf.has(l.id) })),
      reserve: reserve && { ...reserve, allocatable: leaf.has(reserve.id) },
      available,
      todayOps: kept.filter((t) => t.occurredOn.getTime() === today.getTime()).map(op),
      uncategorized: kept.filter((t) => t.categoryId === null).map(op),
      categories: categories.map((c) => ({ ...c, kind: c.kind as Kind })),
      // Dépenses prévues seulement : `upcoming` ne porte pas de sens.
      upcoming: unpaid.filter((c) => formatDay(c.due) >= day && canRead(scope, c.accountId))
        .map((c) => ({ name: c.name, amount: c.amount, due: formatDay(c.due), account: c.account.name })),
      members: split.members.map((m) => ({ id: m.userId, name: m.name })),
    },
  };
}
