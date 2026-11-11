import type { CategoryKind } from "@prisma/client";
import { prisma, type Db } from "./db";
import { isCode, LedgerError, NotFoundError } from "./ledger";
import { parseCents } from "./money";

export type CategoryFields = { name: string; enabled: boolean; recurring: boolean; isTemplate: boolean; sortOrder: number; fixed?: boolean };
export type CategoryInput = CategoryFields & { kind: CategoryKind; parentId: string | null };

/** Montant prévisionnel saisi : vide → 0, montant ≥ 0 en centimes, sinon undefined (invalide). */
export function parseForecast(raw: string): number | undefined {
  if (raw === "") return 0;
  const cents = parseCents(raw, { allowSigned: true });
  return cents === null || cents < 0 ? undefined : cents;
}

/** Modèles de catégories : [nom, sous-catégories]. Inclus, repris le mois suivant. */
export const DEFAULT_CATEGORIES: Record<CategoryKind, [string, string[]][]> = {
  INCOME: [["Income", ["Salary 1", "Salary 2", "Other income"]]],
  EXPENSE: [
    ["Housing", ["Rent", "Service charges"]],
    ["Loans", ["Loan repayments"]],
    ["Insurance", ["Home", "Car", "Health insurance"]],
    ["Bills", ["Electricity", "Gas", "Water", "Internet", "Phones"]],
    ["Subscriptions", ["Streaming", "Software", "Other"]],
    ["School and children", ["School meals", "Supplies", "Activities", "Nappies and care"]],
    ["Family in Morocco", ["Regular transfers", "Transfer fees"]],
    ["Food", ["Market", "Supermarket", "Other groceries"]],
    ["Transport", ["Fuel", "Public transport"]],
    ["Health and hygiene", ["Pharmacy", "Family hygiene"]],
    ["Miscellaneous and unexpected", []],
  ],
};

/** Modèles de dépenses classés en charges fixes ; les autres sont variables. */
export const FIXED_DEFAULTS = new Set(["Housing", "Loans", "Insurance", "Bills", "Subscriptions", "Family in Morocco"]);

/** Crée les modèles absents (nom insensible à la casse, par parent) ; les catégories existantes ne sont pas modifiées. */
export async function createDefaultCategories(tx: Db, householdId: string) {
  for (const [kind, list] of Object.entries(DEFAULT_CATEGORIES) as [CategoryKind, [string, string[]][]][]) {
    for (const [i, [name, subs]] of list.entries()) {
      const existing = await tx.category.findFirst({ where: { householdId, kind, parentId: null, name: { equals: name, mode: "insensitive" } } });
      const parent = existing ?? (await tx.category.create({ data: { householdId, kind, name, sortOrder: i + 1, fixed: FIXED_DEFAULTS.has(name) } }));
      await tx.category.createMany({
        data: subs.map((n, j) => ({ householdId, kind, name: n, parentId: parent.id, sortOrder: j + 1 })),
        skipDuplicates: true, // index unique (foyer, parent, lower(nom))
      });
    }
  }
}

/** Ajoute les modèles manquants (double clic : l'index unique écarte les doublons). */
export async function addDefaultCategories(householdId: string) {
  try {
    await prisma.$transaction((tx) => createDefaultCategories(tx, householdId));
  } catch (e) {
    if (!isCode(e, "P2002")) throw e;
  }
}

async function uniqueName<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError("This name already exists.", "name");
    throw e;
  }
}

const ORDER = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

/** Catégories de premier niveau du foyer avec leurs sous-catégories ; archivées exclues sauf `withArchived`. */
export function listCategories(householdId: string, { withArchived = false } = {}) {
  const archived = withArchived ? {} : { archivedAt: null };
  return prisma.category.findMany({
    where: { householdId, parentId: null, ...archived },
    orderBy: ORDER,
    include: { children: { where: archived, orderBy: ORDER } },
  });
}

export async function getCategory(householdId: string, id: string) {
  const c = await prisma.category.findFirst({ where: { id, householdId }, include: { parent: true, _count: { select: { children: true } } } });
  if (!c) throw new NotFoundError();
  return c;
}

/** Une sous-catégorie hérite du sens de son parent, qui doit être une catégorie active de premier niveau du foyer. */
export function createCategory(householdId: string, input: CategoryInput) {
  return uniqueName(() =>
    prisma.$transaction(async (tx) => {
      let kind = input.kind;
      if (input.parentId) {
        // FOR SHARE : le parent ne peut pas changer avant la fin de la création.
        const [parent] = await tx.$queryRaw<{ kind: CategoryKind; parentId: string | null; archivedAt: Date | null }[]>`
          SELECT "kind", "parentId", "archivedAt" FROM "Category" WHERE "id" = ${input.parentId} AND "householdId" = ${householdId} FOR SHARE`;
        if (!parent) throw new NotFoundError();
        if (parent.parentId) throw new LedgerError("A subcategory cannot have a subcategory.", "parentId");
        if (parent.archivedAt) throw new LedgerError("This category is archived.", "parentId");
        kind = parent.kind;
      }
      return tx.category.create({ data: { ...input, kind, householdId } });
    }),
  );
}

/** Sens et parent sont figés ; les budgets déjà créés ne sont jamais modifiés (copies indépendantes). */
export async function updateCategory(householdId: string, id: string, input: CategoryFields) {
  const { count } = await uniqueName(() => prisma.category.updateMany({ where: { id, householdId }, data: input }));
  if (!count) throw new NotFoundError();
}

/**
 * Archive (ou réactive) une catégorie ; archiver un parent archive ses sous-catégories.
 * Opérations, récurrences et budgets passés gardent leur catégorie.
 */
export async function setCategoryArchived(householdId: string, id: string, archived: boolean) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.category.findFirst({ where: { id, householdId }, include: { parent: true } });
    if (!c) throw new NotFoundError();
    if (!archived && c.parent?.archivedAt) throw new LedgerError("Reactivate the parent category first.");
    const archivedAt = archived ? new Date() : null;
    await tx.category.updateMany({ where: { householdId, OR: [{ id }, ...(archived ? [{ parentId: id }] : [])] }, data: { archivedAt } });
  });
}

/**
 * Supprime définitivement une catégorie et ses sous-catégories ; refusé si une récurrence les utilise.
 * Opérations et lignes de budget sont conservées, sans catégorie.
 */
export async function deleteCategory(householdId: string, id: string) {
  try {
    await prisma.$transaction(async (tx) => {
      // FOR UPDATE : bloque la création d'une sous-catégorie (FOR SHARE sur le parent) pendant la suppression.
      const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Category" WHERE "id" = ${id} AND "householdId" = ${householdId} FOR UPDATE`;
      if (!c) throw new NotFoundError();
      const ids = [id, ...(await tx.category.findMany({ where: { householdId, parentId: id }, select: { id: true } })).map((s) => s.id)];
      if (await tx.fixedCharge.count({ where: { householdId, categoryId: { in: ids } } })) throw new LedgerError(IN_USE);
      await tx.category.deleteMany({ where: { householdId, parentId: id } });
      await tx.category.deleteMany({ where: { householdId, id } });
    });
  } catch (e) {
    if (isCode(e, "P2003")) throw new LedgerError(IN_USE); // récurrence créée entre-temps
    throw e;
  }
}

const IN_USE = "A recurring charge uses this category: edit or delete it first, or archive the category.";
