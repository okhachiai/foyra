import { Prisma, type CarryOver, type CategoryKind } from "@prisma/client";
import { prisma } from "./db";
import { isCode, LedgerError, NotFoundError } from "./ledger";
import { parseCents } from "./money";

type Db = Prisma.TransactionClient;

export type CategoryFields = { name: string; forecastAmount: number | null; carryOver: CarryOver; enabled: boolean };
export type CategoryInput = CategoryFields & { kind: CategoryKind; parentId: string | null };

/** Prévisionnel saisi : vide → null (aucun), montant ≥ 0 en centimes, sinon undefined (invalide). */
export function parseForecast(raw: string): number | null | undefined {
  if (raw === "") return null;
  const cents = parseCents(raw, { allowSigned: true });
  return cents === null || cents < 0 ? undefined : cents;
}

/** Catégories créées au setup : [nom, sous-catégories]. Prévisionnel vide, FORECAST, activées. */
export const DEFAULT_CATEGORIES: Record<CategoryKind, [string, string[]][]> = {
  EXPENSE: [
    ["Loyer", []],
    ["Factures", ["Électricité", "Gaz", "Eau", "Internet et téléphone"]],
    ["Assurances", ["Habitation", "Auto", "Santé"]],
    ["Abonnements", []],
    ["Courses", []],
    ["Transports", ["Carburant", "Transports en commun"]],
    ["Scolarité", []],
    ["Enfants", []],
    ["Aides famille à l'étranger", []],
    ["Santé", []],
    ["Loisirs", []],
    ["Divers", []],
  ],
  INCOME: [
    ["Salaires", []],
    ["Aides et allocations", []],
    ["Autres revenus", []],
  ],
};

export async function createDefaultCategories(tx: Db, householdId: string) {
  for (const [kind, list] of Object.entries(DEFAULT_CATEGORIES) as [CategoryKind, [string, string[]][]][]) {
    for (const [name, subs] of list) {
      await tx.category.create({
        data: { householdId, kind, name, children: { create: subs.map((n) => ({ householdId, kind, name: n })) } },
      });
    }
  }
}

/** Ajoute les défauts si le foyer n'a encore aucune catégorie (instance initialisée avant les catégories). */
export async function addDefaultCategories(householdId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      if (await tx.category.count({ where: { householdId } })) return;
      await createDefaultCategories(tx, householdId);
    });
  } catch (e) {
    if (!isCode(e, "P2002")) throw e; // double clic : l'autre requête les a déjà créées
  }
}

async function uniqueName<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (isCode(e, "P2002")) throw new LedgerError("Ce nom existe déjà.", "name");
    throw e;
  }
}

/** Catégories de premier niveau du foyer, avec leurs sous-catégories. */
export function listCategories(householdId: string) {
  return prisma.category.findMany({
    where: { householdId, parentId: null },
    orderBy: { name: "asc" },
    include: { children: { orderBy: { name: "asc" } } },
  });
}

export async function getCategory(householdId: string, id: string) {
  const c = await prisma.category.findFirst({ where: { id, householdId }, include: { parent: true, _count: { select: { children: true } } } });
  if (!c) throw new NotFoundError();
  return c;
}

/** Une sous-catégorie hérite du sens de son parent, qui doit être une catégorie de premier niveau du foyer. */
export function createCategory(householdId: string, input: CategoryInput) {
  return uniqueName(() =>
    prisma.$transaction(async (tx) => {
      let kind = input.kind;
      if (input.parentId) {
        // FOR SHARE : le parent ne peut pas être supprimé avant la fin de la création.
        const [parent] = await tx.$queryRaw<{ kind: CategoryKind; parentId: string | null }[]>`
          SELECT "kind", "parentId" FROM "Category" WHERE "id" = ${input.parentId} AND "householdId" = ${householdId} FOR SHARE`;
        if (!parent) throw new NotFoundError();
        if (parent.parentId) throw new LedgerError("Une sous-catégorie ne peut pas avoir de sous-catégorie.", "parentId");
        kind = parent.kind;
      }
      return tx.category.create({ data: { ...input, kind, householdId } });
    }),
  );
}

/** Seuls nom, prévisionnel, reconduction et activation sont modifiables. */
export async function updateCategory(householdId: string, id: string, input: CategoryFields) {
  const { count } = await uniqueName(() => prisma.category.updateMany({ where: { id, householdId }, data: input }));
  if (!count) throw new NotFoundError();
}

/** Refusée s'il reste des sous-catégories ; les opérations rattachées passent « Sans catégorie » (FK SET NULL). */
export async function deleteCategory(householdId: string, id: string) {
  const hasChildren = new LedgerError("Supprimez d’abord ses sous-catégories.");
  const hasCharges = new LedgerError("Cette catégorie est utilisée par une charge fixe.");
  if (await prisma.category.count({ where: { parentId: id, householdId } })) throw hasChildren;
  if (await prisma.fixedCharge.count({ where: { categoryId: id, householdId } })) throw hasCharges;
  try {
    const { count } = await prisma.category.deleteMany({ where: { id, householdId } });
    if (!count) throw new NotFoundError();
  } catch (e) {
    // Sous-catégorie ou charge fixe créée entre-temps (FK RESTRICT).
    if (isCode(e, "P2003")) throw (await prisma.fixedCharge.count({ where: { categoryId: id, householdId } })) ? hasCharges : hasChildren;
    throw e;
  }
}
