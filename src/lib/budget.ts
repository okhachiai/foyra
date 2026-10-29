import type { BudgetStatus, CategoryKind, Prisma } from "@prisma/client";
import { readable, type Scope } from "./access";
import { prisma } from "./db";
import { isCode, LedgerError, NotFoundError, parseDay } from "./ledger";

type Db = Prisma.TransactionClient;

/** « AAAA-MM » (années 2000–2099) → Date UTC du 1er du mois (colonne @db.Date), ou null si invalide. */
export const parseMonth = (s: string | undefined) => (s && /^20\d{2}-(0[1-9]|1[0-2])$/.test(s) ? parseDay(`${s}-01`) : null);
export const formatMonth = (month: Date) => month.toISOString().slice(0, 7);
export const addMonths = (month: Date, n: number) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1));

// --- Calculs (purs) ---

export type Item = {
  id: string; parentId: string | null; categoryId: string | null; kind: CategoryKind;
  label: string; amount: number; included: boolean; recurring: boolean; sortOrder: number;
  shared: boolean; reserve: boolean; // ligne commune (sinon personnelle) ; « Réserve imprévus »
  category?: { fixed: boolean } | null; // charge fixe ou variable : lue sur la catégorie d'une ligne principale
};

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
 * Totaux prévus : une branche exclue (parent non inclus) ne compte pas, ses enfants non plus.
 * Dépenses réparties en charges fixes / variables selon la catégorie de la ligne principale (sans catégorie : variable).
 */
export function budgetTotals(items: Item[]) {
  let income = 0, fixed = 0, variable = 0;
  for (const n of buildTree(items)) {
    if (!n.included) continue;
    if (n.kind === "INCOME") income += n.total;
    else if (n.category?.fixed) fixed += n.total;
    else variable += n.total;
  }
  const expense = fixed + variable;
  return { income, expense, fixed, variable, remaining: income - expense };
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
  id: string; kind: CategoryKind; name: string; forecastAmount: number; enabled: boolean; recurring: boolean;
  isTemplate: boolean; sortOrder: number; archivedAt: Date | null;
  children: Omit<TemplateCategory, "children">[];
};

/** Budget depuis les modèles : catégories actives marquées « modèle », montant par défaut (0 pour un parent avec enfants). */
export function fromTemplates(categories: TemplateCategory[]): Seed[] {
  const seed = (c: Omit<TemplateCategory, "children">) => ({
    categoryId: c.id, kind: c.kind, label: c.name, amount: c.forecastAmount, included: c.enabled, recurring: c.recurring, sortOrder: c.sortOrder, shared: true, reserve: false,
  });
  return categories
    .filter((c) => c.isTemplate && !c.archivedAt)
    .map((c) => {
      const children = c.children.filter((s) => s.isTemplate && !s.archivedAt).map(seed);
      return { ...seed(c), amount: children.length ? 0 : c.forecastAmount, children };
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

const ITEM_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }];

/**
 * Budget d'un mois (null s'il n'est pas encore créé : jamais créé implicitement), son arbre, ses totaux prévus,
 * et le réel par ligne (opérations des comptes lisibles rattachées à la catégorie d'origine).
 * Dépense : seules les opérations communes ou personnelles selon la ligne principale ; revenu : toutes.
 */
export async function getBudget(scope: Scope, month: Date) {
  const householdId = scope.householdId;
  const budget = await prisma.budget.findUnique({
    where: { householdId_month: { householdId, month } },
    include: { items: { orderBy: ITEM_ORDER, include: { category: { select: { fixed: true } } } } },
  });
  if (!budget) return null;
  const sums = await prisma.transaction.groupBy({
    by: ["categoryId", "shared"],
    where: { householdId, accountId: readable(scope), kind: { in: ["INCOME", "EXPENSE"] }, occurredOn: { gte: month, lt: addMonths(month, 1) } },
    _sum: { amount: true },
  });
  const actual = (i: Item, top: Item) => sums.reduce((t, s) =>
    i.categoryId && s.categoryId === i.categoryId && (top.kind === "INCOME" || s.shared === top.shared) ? t + (s._sum.amount ?? 0) : t, 0);
  const tree = buildTree(budget.items).map((n) => ({
    ...n,
    actual: actual(n, n) + n.children.reduce((s, c) => s + actual(c, n), 0),
    children: n.children.map((c) => ({ ...c, actual: actual(c, n) })),
  }));
  return { ...budget, tree, totals: budgetTotals(budget.items) };
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
 * Revenus proposés + revenus fixes du mois (charges de type revenu), en tête avec leur montant actuel.
 * Retirées des lignes proposées : celles du même libellé (reprises du mois précédent) et les lignes à 0 de la même catégorie (modèles vides).
 */
export function mergeIncomes(proposed: IncomeLine[], fixed: { name: string; amount: number; categoryId: string }[]): IncomeLine[] {
  const names = new Set(fixed.map((f) => f.name.toLocaleLowerCase("fr")));
  const cats = new Set(fixed.map((f) => f.categoryId));
  return [
    ...fixed.map((f) => ({ label: f.name, amount: f.amount, categoryId: f.categoryId })),
    ...proposed.filter((p) => !names.has(p.label.toLocaleLowerCase("fr")) && !(p.amount === 0 && p.categoryId && cats.has(p.categoryId))),
  ];
}

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
async function lockBudget(tx: Db, householdId: string, budgetId: string, draft = true) {
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

const ONE_RESERVE = "Une seule réserve par budget.";
const RESERVE_TOP = "La réserve doit être une ligne principale de dépense.";

/** Une deuxième réserve (index SQL partiel) → message lisible. */
async function oneReserve<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError(ONE_RESERVE);
    throw e;
  }
}

/**
 * Ajoute une ligne. Sous-ligne : le parent doit être une ligne principale du même budget ; elle prend son type et son
 * caractère commun (une réserve est refusée), et le montant direct du parent repasse à 0 (son total devient la somme de ses enfants).
 * Elle se place en dernier.
 */
export async function addItem(householdId: string, budgetId: string, input: ItemFields & { kind: CategoryKind; parentId: string | null }) {
  return oneReserve(() => prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    let kind = input.kind;
    if (input.reserve && (input.parentId || kind === "INCOME")) throw new LedgerError(RESERVE_TOP);
    if (input.parentId) {
      const parent = await tx.budgetItem.findFirst({ where: { id: input.parentId, budgetId, householdId } });
      if (!parent) throw new NotFoundError();
      if (parent.parentId) throw new LedgerError("Une sous-catégorie ne peut pas avoir de sous-catégorie.", "parentId");
      kind = parent.kind;
      input = { ...input, shared: parent.shared };
      await tx.budgetItem.update({ where: { id: parent.id }, data: { amount: 0 } });
    }
    const last = await tx.budgetItem.aggregate({ where: { budgetId, parentId: input.parentId, kind }, _max: { sortOrder: true } });
    return tx.budgetItem.create({ data: { ...input, kind, householdId, budgetId, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
  }));
}

/**
 * Enregistre les lignes modifiées ; le montant d'une ligne qui a des enfants reste 0 (total calculé). Ids hors budget ignorés.
 * Sous-lignes : caractère commun du parent (le changer sur le parent l’applique à ses enfants). Réserve : ligne principale de dépense seulement.
 * Réserves retirées avant d'être posées : la déplacer d'une ligne à l'autre passe en un seul enregistrement.
 */
export async function saveItems(householdId: string, budgetId: string, items: Map<string, ItemFields>) {
  await oneReserve(() => prisma.$transaction(async (tx) => {
    await lockBudget(tx, householdId, budgetId);
    const all = await tx.budgetItem.findMany({ where: { budgetId, householdId }, select: { id: true, parentId: true, kind: true } });
    const subs = all.filter((i) => i.parentId);
    const parents = new Set(subs.map((p) => p.parentId));
    const children = new Set(subs.map((c) => c.id));
    if (all.some((i) => items.get(i.id)?.reserve && (i.parentId || i.kind === "INCOME"))) throw new LedgerError(RESERVE_TOP);
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
