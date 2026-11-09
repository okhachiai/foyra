import type { BudgetStatus, CategoryKind, Prisma } from "@prisma/client";
import { addMonths } from "./amortization";
import { prisma } from "./db";
import { isCode, LedgerError, NotFoundError, parseDay } from "./ledger";

type Db = Prisma.TransactionClient;

/** « AAAA-MM » (années 2000–2099) → Date UTC du 1er du mois (colonne @db.Date), ou null si invalide. */
export const parseMonth = (s: string | undefined) => (s && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s) ? parseDay(`${s}-01`) : null);
export const formatMonth = (month: Date) => month.toISOString().slice(0, 7);

// --- Calculs (purs) ---

export type Item = {
  id: string; parentId: string | null; categoryId: string | null; kind: CategoryKind;
  label: string; amount: number; included: boolean; recurring: boolean; sortOrder: number;
  shared: boolean; reserve: boolean; // ligne commune (sinon personnelle) ; « Réserve imprévus »
  category?: { fixed: boolean; savings?: boolean } | null; // charge fixe, variable ou épargne : lue sur la catégorie d'une ligne principale
};

export type Group = "income" | "fixed" | "savings" | "variable";
/** Groupe d'une ligne principale : l'épargne (catégorie d'épargne, toujours fixe) est sortie des charges fixes ; sans catégorie : variable. */
export const groupOf = (n: Pick<Item, "kind" | "category">): Group =>
  n.kind === "INCOME" ? "income" : n.category?.savings ? "savings" : n.category?.fixed ? "fixed" : "variable";

export type Node = Item & { children: Item[]; total: number };

const byOrder = (a: Item, b: Item) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "fr");

/**
 * Arbre d'un budget. Total d'une ligne principale : sans enfants, son propre montant ;
 * avec enfants, la somme de ses enfants inclus (son montant direct n'est jamais ajouté).
 */
export function buildTree(items: Item[]): Node[] {
  return items
    .filter((i) => !i.parentId)
    .sort(byOrder)
    .map((top) => {
      const children = items.filter((i) => i.parentId === top.id).sort(byOrder);
      const total = children.length ? children.reduce((s, c) => s + (c.included ? c.amount : 0), 0) : top.amount;
      return { ...top, children, total };
    });
}

/**
 * Lignes fixes incluses du budget (montant > 0) sans charge récurrente ni crédit de même catégorie : échéances prévues du mois.
 * Une charge sur la catégorie d'une ligne principale couvre toute sa branche (plannedAmount en prend le total).
 */
export function uncoveredFixedLines(tree: Node[], chargeCategoryIds: Set<string>) {
  const covered = (i: Item) => !!i.categoryId && chargeCategoryIds.has(i.categoryId);
  return tree
    .filter((n) => n.included && groupOf(n) === "fixed" && !covered(n))
    .flatMap((n) => (n.children.length ? n.children.filter((c) => c.included && !covered(c)) : [n]))
    .filter((l) => l.amount > 0);
}

/**
 * Totaux prévus : une branche exclue (parent non inclus) ne compte pas, ses enfants non plus.
 * Dépenses réparties en charges fixes / épargne / variables (voir groupOf).
 * Épargne = max(prévu, `saved` déjà versé ce mois) : un versement hors budget n'est plus disponible.
 * Reste = revenus − charges fixes − charges variables − épargne.
 */
export function budgetTotals(items: Item[], saved = 0) {
  const t: Record<Group, number> = { income: 0, fixed: 0, savings: 0, variable: 0 };
  for (const n of buildTree(items)) if (n.included) t[groupOf(n)] += n.total;
  t.savings = Math.max(t.savings, saved);
  const expense = t.fixed + t.variable + t.savings;
  return { ...t, expense, remaining: t.income - expense };
}

/** Ligne à créer dans un nouveau budget (sans identifiant : chaque mois a ses propres lignes). */
export type Seed = Omit<Item, "id" | "parentId" | "category"> & { children: Omit<Item, "id" | "parentId" | "category">[] };

/** Valeurs recopiées d'une ligne : jamais son identifiant, son parent ni son budget. */
const strip = ({ categoryId, kind, label, amount, included, recurring, sortOrder, shared, reserve }: Item) =>
  ({ categoryId, kind, label, amount, included, recurring, sortOrder, shared, reserve });

/**
 * Reprise du budget précédent : seules les lignes récurrentes, avec leur structure et leurs valeurs.
 * Un parent non récurrent revient s'il a au moins un enfant récurrent (la structure est conservée).
 */
export function carryOver(items: Item[]): Seed[] {
  return buildTree(items).flatMap((n) => {
    const children = n.children.filter((c) => c.recurring).map(strip);
    if (!n.recurring && !children.length) return [];
    return [{ ...strip(n), amount: children.length ? 0 : n.amount, children }];
  });
}

type TemplateCategory = {
  id: string; kind: CategoryKind; name: string; enabled: boolean; recurring: boolean;
  isTemplate: boolean; sortOrder: number; archivedAt: Date | null;
  children: Omit<TemplateCategory, "children">[];
};

/** Budget depuis les modèles : catégories actives marquées « modèle », montants à 0 (saisis dans le budget). */
export function fromTemplates(categories: TemplateCategory[]): Seed[] {
  const seed = (c: Omit<TemplateCategory, "children">) => ({
    categoryId: c.id, kind: c.kind, label: c.name, amount: 0, included: c.enabled, recurring: c.recurring, sortOrder: c.sortOrder, shared: true, reserve: false,
  });
  return categories
    .filter((c) => c.isTemplate && !c.archivedAt)
    .map((c) => {
      const children = c.children.filter((s) => s.isTemplate && !s.archivedAt).map(seed);
      return { ...seed(c), children };
    });
}

export type Envelope = { id: string; label: string; planned: number; actual: number; left: number };
export type Reserve = Envelope & { overrun: number };

/**
 * Enveloppes communes : lignes principales de dépense incluses, communes, variables, hors réserve.
 * Leurs dépassements sont absorbés par la réserve (reste = prévu − réel − dépassements).
 */
export function envelopes(tree: (Node & { actual: number })[]): { lines: Envelope[]; reserve: Reserve | null } {
  const env = (n: Node & { actual: number }) => ({ id: n.id, label: n.label, planned: n.total, actual: n.actual, left: n.total - n.actual });
  const lines = tree.filter((n) => n.kind === "EXPENSE" && n.included && n.shared && !n.category?.fixed && !n.reserve).map(env);
  const overrun = lines.reduce((s, l) => s + Math.max(-l.left, 0), 0);
  const r = tree.find((n) => n.reserve && n.kind === "EXPENSE" && n.included);
  return { lines, reserve: r ? { ...env(r), left: r.total - r.actual - overrun, overrun } : null };
}

// --- Lecture ---

/** Versé dans le mois sur les catégories d'épargne (et leurs sous-catégories), opérations communes et personnelles. */
export async function savedIn(householdId: string, month: Date) {
  const r = await prisma.transaction.aggregate({
    where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) }, category: { OR: [{ savings: true }, { parent: { savings: true } }] } },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

/**
 * Réel du mois par groupe (voir groupOf) : toutes les opérations du foyer, budgétées ou non ; une sous-catégorie suit son parent,
 * sans catégorie : variable. Reste réel = revenus − charges fixes − charges variables − épargne enregistrées.
 */
export async function actualTotals(householdId: string, month: Date) {
  const [sums, categories] = await Promise.all([
    prisma.transaction.groupBy({ by: ["kind", "categoryId"], where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } }, _sum: { amount: true } }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, fixed: true, savings: true, parent: { select: { fixed: true, savings: true } } } }),
  ]);
  const top = new Map(categories.map((c) => [c.id, c.parent ?? c]));
  const t: Record<Group, number> = { income: 0, fixed: 0, savings: 0, variable: 0 };
  for (const s of sums) t[groupOf({ kind: s.kind, category: s.categoryId ? top.get(s.categoryId) : null })] += s._sum.amount ?? 0;
  const expense = t.fixed + t.variable + t.savings;
  return { ...t, expense, remaining: t.income - expense };
}

const ITEM_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

/**
 * Budget d'un mois (null s'il n'est pas encore créé : jamais créé implicitement), son arbre, ses totaux prévus,
 * et le réel par ligne (opérations du foyer rattachées à la catégorie d'origine).
 * Dépense : seules les opérations communes ou personnelles selon la ligne principale ; revenu : toutes.
 */
export async function getBudget(householdId: string, month: Date) {
  const budget = await prisma.budget.findUnique({
    where: { householdId_month: { householdId, month } },
    include: { items: { orderBy: ITEM_ORDER, include: { category: { select: { fixed: true, savings: true } } } } },
  });
  if (!budget) return null;
  const sums = await prisma.transaction.groupBy({
    by: ["categoryId", "shared"],
    where: { householdId, occurredOn: { gte: month, lt: addMonths(month, 1) } },
    _sum: { amount: true },
  });
  const sum = new Map(sums.map((s) => [`${s.categoryId}:${s.shared}`, s._sum.amount ?? 0]));
  const at = (categoryId: string, shared: boolean) => sum.get(`${categoryId}:${shared}`) ?? 0;
  const actual = (i: Item, top: Item) =>
    !i.categoryId ? 0 : top.kind === "INCOME" ? at(i.categoryId, true) + at(i.categoryId, false) : at(i.categoryId, top.shared);
  const tree = buildTree(budget.items).map((n) => ({
    ...n,
    actual: actual(n, n) + n.children.reduce((s, c) => s + actual(c, n), 0),
    children: n.children.map((c) => ({ ...c, actual: actual(c, n) })),
  }));
  return { ...budget, tree, totals: budgetTotals(budget.items, await savedIn(householdId, month)) };
}

// --- Écriture ---

/** Crée les lignes d'un budget (parents puis enfants : nouveaux identifiants). */
async function insertSeeds(tx: Db, householdId: string, budgetId: string, seeds: Seed[]) {
  for (const { children, ...top } of seeds) {
    const parent = await tx.budgetItem.create({ data: { ...top, householdId, budgetId } });
    if (children.length) {
      await tx.budgetItem.createMany({ data: children.map((c) => ({ ...c, kind: parent.kind, householdId, budgetId, parentId: parent.id })) });
    }
  }
}

/** Lignes de départ d'un nouveau budget selon le réglage du foyer : reprise du dernier budget antérieur, sinon modèles. */
export async function budgetSeeds(db: Db, householdId: string, month: Date): Promise<Seed[]> {
  const household = await db.household.findUniqueOrThrow({ where: { id: householdId } });
  if (household.budgetSource === "PREVIOUS") {
    const previous = await db.budget.findFirst({ where: { householdId, month: { lt: month } }, orderBy: { month: "desc" }, include: { items: true } });
    if (previous) return carryOver(previous.items);
  }
  return fromTemplates(await db.category.findMany({ where: { householdId, parentId: null }, include: { children: true } }));
}

export type IncomeLine = { label: string; amount: number; categoryId: string | null };

/** Revenus proposés à la création : lignes de revenu des seeds, à plat (sous-lignes à la place de leur parent). */
export const incomeLines = (seeds: Seed[]): IncomeLine[] =>
  seeds.filter((s) => s.kind === "INCOME" && s.included).flatMap((s) => (s.children.length ? s.children.filter((c) => c.included) : [s]))
    .map(({ label, amount, categoryId }) => ({ label, amount, categoryId }));

/**
 * Création explicite du budget d'un mois selon le réglage du foyer : reprise des lignes récurrentes
 * du dernier budget antérieur, sinon (ou à défaut de budget antérieur) modèles de catégories.
 * `incomes` : revenus saisis à la création, ils remplacent les lignes de revenu reprises (catégories hors foyer ignorées).
 * Déjà créé (double clic, autre membre) : renvoie l'existant.
 */
export async function createBudget(householdId: string, month: Date, incomes?: IncomeLine[]) {
  const existing = () => prisma.budget.findUniqueOrThrow({ where: { householdId_month: { householdId, month } } });
  try {
    return await prisma.$transaction(async (tx) => {
      let seeds = await budgetSeeds(tx, householdId, month);
      if (incomes) {
        const own = new Set((await tx.category.findMany({ where: { householdId, kind: "INCOME" }, select: { id: true } })).map((c) => c.id));
        seeds = [
          ...incomes.map((i, sortOrder) => ({
            ...i, categoryId: i.categoryId && own.has(i.categoryId) ? i.categoryId : null,
            kind: "INCOME" as const, included: true, recurring: true, shared: true, reserve: false, sortOrder, children: [],
          })),
          ...seeds.filter((s) => s.kind !== "INCOME"),
        ];
      }
      const budget = await tx.budget.create({ data: { householdId, month } });
      await insertSeeds(tx, householdId, budget.id, seeds);
      return budget;
    });
  } catch (e) {
    if (isCode(e, "P2002")) return existing();
    throw e;
  }
}

const VALIDATED = "Ce budget est validé : repassez-le en brouillon pour le modifier.";

/** Verrouille le budget du foyer (FOR UPDATE) ; `draft` : refuse s'il est validé. */
export async function lockBudget(tx: Db, householdId: string, budgetId: string, draft = true) {
  const [b] = await tx.$queryRaw<{ status: BudgetStatus }[]>`
    SELECT "status" FROM "Budget" WHERE "id" = ${budgetId} AND "householdId" = ${householdId} FOR UPDATE`;
  if (!b) throw new NotFoundError();
  if (draft && b.status !== "DRAFT") throw new LedgerError(VALIDATED);
}

export async function setBudgetStatus(householdId: string, budgetId: string, status: BudgetStatus) {
  await prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId, false);
    await tx.budget.update({ where: { id: budgetId }, data: { status } });
  });
}

/** `shared` / `reserve` absents : inchangés (valeurs par défaut à la création). */
export type ItemFields = { label: string; amount: number; included: boolean; recurring: boolean; shared?: boolean; reserve?: boolean };

/** Empreinte des valeurs affichées d'une ligne : identique à la soumission = ligne non modifiée (cases non affichées : undefined). */
export const itemSignature = (f: ItemFields) => JSON.stringify([f.label, f.amount, f.included, f.recurring, f.shared, f.reserve]);

const ONE_RESERVE = "Une seule réserve par budget.";
const RESERVE_TOP = "La réserve doit être une ligne principale de dépense.";
const RESERVE_INCLUDED = "La réserve doit être une ligne incluse au budget.";

/** Une deuxième réserve (index SQL partiel) → message lisible. */
async function oneReserve<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError(ONE_RESERVE);
    throw e;
  }
}

/** Catégorie active du foyer de même nom (casse ignorée) sous le même parent, créée hors modèles à défaut : la ligne suit son réel. */
async function categoryFor(tx: Db, householdId: string, kind: CategoryKind, name: string, parentId: string | null) {
  const where = { householdId, kind, parentId, archivedAt: null, name: { equals: name, mode: "insensitive" as const } };
  const found = await tx.category.findFirst({ where, select: { id: true } });
  return (found ?? await tx.category.create({ data: { householdId, kind, name, parentId, isTemplate: false }, select: { id: true } })).id;
}

/**
 * Ajoute une ligne, rattachée à sa catégorie (existante ou créée ; parent sans catégorie rattaché aussi). Sous-ligne : le parent doit être une ligne principale du même budget ; elle prend son type et son
 * caractère commun (une réserve est refusée), et le montant direct du parent repasse à 0 (son total devient la somme de ses enfants).
 * Elle se place en dernier.
 */
export async function addItem(householdId: string, budgetId: string, input: ItemFields & { kind: CategoryKind; parentId: string | null }) {
  return oneReserve(() => prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    let kind = input.kind;
    let categoryId: string;
    if (input.reserve && (input.parentId || kind === "INCOME")) throw new LedgerError(RESERVE_TOP);
    if (input.reserve && !input.included) throw new LedgerError(RESERVE_INCLUDED);
    if (input.parentId) {
      const parent = await tx.budgetItem.findFirst({ where: { id: input.parentId, budgetId, householdId } });
      if (!parent) throw new NotFoundError();
      if (parent.parentId) throw new LedgerError("Une sous-catégorie ne peut pas avoir de sous-catégorie.", "parentId");
      kind = parent.kind;
      input = { ...input, shared: parent.shared };
      const parentCategory = parent.categoryId ?? await categoryFor(tx, householdId, kind, parent.label, null);
      await tx.budgetItem.update({ where: { id: parent.id }, data: { amount: 0, categoryId: parentCategory } });
      categoryId = await categoryFor(tx, householdId, kind, input.label, parentCategory);
    } else {
      categoryId = await categoryFor(tx, householdId, kind, input.label, null);
    }
    const last = await tx.budgetItem.aggregate({ where: { budgetId, parentId: input.parentId, kind }, _max: { sortOrder: true } });
    return tx.budgetItem.create({ data: { ...input, kind, categoryId, householdId, budgetId, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  }));
}

/**
 * Enregistre les lignes modifiées ; le montant d'une ligne qui a des enfants reste 0 (total calculé). Ids hors budget ignorés.
 * Sous-lignes : caractère commun du parent (le changer sur le parent l'applique à ses enfants). Réserve : ligne principale de dépense incluse seulement.
 * Réserves retirées avant d'être posées : la déplacer d'une ligne à l'autre passe en un seul enregistrement.
 */
export async function saveItems(householdId: string, budgetId: string, items: Map<string, ItemFields>) {
  await oneReserve(() => prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    const all = await tx.budgetItem.findMany({ where: { budgetId, householdId }, select: { id: true, parentId: true, kind: true, included: true, reserve: true } });
    const subs = all.filter((i) => i.parentId);
    const parents = new Set(subs.map((p) => p.parentId));
    const children = new Set(subs.map((c) => c.id));
    if (all.some((i) => items.get(i.id)?.reserve && (i.parentId || i.kind === "INCOME"))) throw new LedgerError(RESERVE_TOP);
    // Réserve après enregistrement (absente = inchangée) sur une ligne exclue : refusée.
    if (all.some((i) => { const f = items.get(i.id); return (f?.reserve ?? i.reserve) && !(f?.included ?? i.included); })) throw new LedgerError(RESERVE_INCLUDED);
    const entries = [...items].sort(([, a], [, b]) => Number(!!a.reserve) - Number(!!b.reserve));
    for (const [id, { shared, reserve, ...data }] of entries) {
      const own = children.has(id) ? data : { ...data, shared, reserve, ...(parents.has(id) && { amount: 0 }) };
      await tx.budgetItem.updateMany({ where: { id, budgetId, householdId }, data: own });
      if (parents.has(id) && shared !== undefined) await tx.budgetItem.updateMany({ where: { parentId: id, budgetId, householdId }, data: { shared } });
    }
  }));
}

/** Retire une ligne ; retirer une ligne principale retire ses sous-lignes (FK en cascade). */
export async function removeItem(householdId: string, budgetId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    const { count } = await tx.budgetItem.deleteMany({ where: { id, budgetId, householdId } });
    if (!count) throw new NotFoundError();
  });
}

const isFixed = async (tx: Db, categoryId: string | null) =>
  !!categoryId && !!(await tx.category.findUnique({ where: { id: categoryId }, select: { fixed: true } }))?.fixed;

/** Monte ou descend une ligne parmi ses sœurs (même parent, même type), puis renumérote les sœurs 0…n-1. */
export async function moveItem(householdId: string, budgetId: string, id: string, dir: "up" | "down") {
  await prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    const item = await tx.budgetItem.findFirst({ where: { id, budgetId, householdId } });
    if (!item) throw new NotFoundError();
    // Lignes principales de dépense : on ne se déplace qu'au sein de son groupe (charges fixes ou variables).
    const fixed = item.parentId || item.kind === "INCOME" ? undefined : await isFixed(tx, item.categoryId);
    const siblings = (await tx.budgetItem.findMany({ where: { budgetId, parentId: item.parentId, kind: item.kind }, include: { category: { select: { fixed: true } } } }))
      .filter((s) => fixed === undefined || !!s.category?.fixed === fixed)
      .sort(byOrder);
    const from = siblings.findIndex((s) => s.id === id);
    const to = from + (dir === "up" ? -1 : 1);
    if (to < 0 || to >= siblings.length) return;
    [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
    for (const [i, s] of siblings.entries()) {
      if (s.sortOrder !== i) await tx.budgetItem.update({ where: { id: s.id }, data: { sortOrder: i } });
    }
  });
}
