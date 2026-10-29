-- Budget mensuel v2 : budgets indépendants par mois (lignes copiées), partage des comptes, récurrences,
-- idempotence des opérations. Aucune donnée supprimée : les anciennes lignes de budget sont recopiées.
BEGIN;

CREATE TYPE "AccountSharing" AS ENUM ('HOUSEHOLD', 'SELECTED');
CREATE TYPE "BudgetSource" AS ENUM ('PREVIOUS', 'TEMPLATES');
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'VALIDATED');

-- Foyers : plus de singleton (isolation par householdId), réglage de création des budgets.
DROP INDEX "Household_singleton_key";
ALTER TABLE "Household" DROP COLUMN "singleton",
ADD COLUMN "budgetSource" "BudgetSource" NOT NULL DEFAULT 'PREVIOUS';

-- Comptes : notes et partage. Les comptes existants restent « membres sélectionnés » (accès explicites inchangés).
ALTER TABLE "Account" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN "sharing" "AccountSharing" NOT NULL DEFAULT 'SELECTED';

-- L'admin n'a plus d'accès implicite : les admins actuels gardent leurs comptes, désormais en gestion explicite.
INSERT INTO "AccountAccess" ("userId", "accountId", "level")
SELECT u."id", a."id", 'MANAGE'::"AccessLevel"
FROM "User" u JOIN "Account" a ON a."householdId" = u."householdId"
WHERE u."role" = 'ADMIN'
ON CONFLICT ("userId", "accountId") DO UPDATE SET "level" = 'MANAGE';

-- Opérations : clé d'idempotence.
ALTER TABLE "Transaction" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Transaction_householdId_idempotencyKey_key" ON "Transaction"("householdId", "idempotencyKey");

-- Récurrences : revenu ou dépense, activables.
ALTER TABLE "FixedCharge" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "kind" "CategoryKind" NOT NULL DEFAULT 'EXPENSE';

-- Catégories : la reconduction devient « reprendre le mois suivant » (NONE → non), montant par défaut obligatoire.
ALTER TABLE "Category"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
UPDATE "Category" SET "recurring" = ("carryOver" <> 'NONE');
UPDATE "Category" SET "forecastAmount" = 0 WHERE "forecastAmount" IS NULL;
UPDATE "Category" c SET "sortOrder" = o.n
FROM (SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "householdId", "kind", "parentId" ORDER BY lower("name")))::int AS n FROM "Category") o
WHERE o."id" = c."id";
ALTER TABLE "Category" DROP COLUMN "carryOver",
ALTER COLUMN "forecastAmount" SET NOT NULL,
ALTER COLUMN "forecastAmount" SET DEFAULT 0;
DROP TYPE "CarryOver";

-- Sous-catégorie : même foyer et même sens que son parent (FK composite).
ALTER TABLE "Category" DROP CONSTRAINT "Category_parentId_fkey";
CREATE UNIQUE INDEX "Category_id_householdId_kind_key" ON "Category"("id", "householdId", "kind");
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_householdId_kind_fkey" FOREIGN KEY ("parentId", "householdId", "kind") REFERENCES "Category"("id", "householdId", "kind") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Budgets et lignes
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "parentId" TEXT,
    "categoryId" TEXT,
    "kind" "CategoryKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Budget_householdId_month_key" ON "Budget"("householdId", "month");
CREATE INDEX "BudgetItem_budgetId_idx" ON "BudgetItem"("budgetId");
CREATE INDEX "BudgetItem_parentId_idx" ON "BudgetItem"("parentId");
CREATE INDEX "BudgetItem_categoryId_idx" ON "BudgetItem"("categoryId");
CREATE UNIQUE INDEX "BudgetItem_id_budgetId_kind_key" ON "BudgetItem"("id", "budgetId", "kind");
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_parentId_budgetId_kind_fkey" FOREIGN KEY ("parentId", "budgetId", "kind") REFERENCES "BudgetItem"("id", "budgetId", "kind") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise des anciennes lignes (une par catégorie et par mois ouvert) : un budget brouillon par mois.
INSERT INTO "Budget" ("id", "householdId", "month", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "householdId", "month", 'DRAFT', MIN("createdAt"), CURRENT_TIMESTAMP
FROM "BudgetLine" GROUP BY "householdId", "month";

-- Lignes principales ; montant direct à 0 si la catégorie a des sous-lignes ce mois-là.
INSERT INTO "BudgetItem" ("id", "householdId", "budgetId", "parentId", "categoryId", "kind", "label", "amount", "included", "recurring", "sortOrder")
SELECT gen_random_uuid()::text, b."householdId", b."id", NULL, c."id", c."kind", c."name",
  CASE WHEN sub.n > 0 THEN 0 ELSE COALESCE(l."planned", 0) END, c."enabled", c."recurring", c."sortOrder"
FROM "Budget" b
JOIN "Category" c ON c."householdId" = b."householdId" AND c."parentId" IS NULL
LEFT JOIN "BudgetLine" l ON l."categoryId" = c."id" AND l."month" = b."month"
CROSS JOIN LATERAL (
  SELECT COUNT(*) AS n FROM "BudgetLine" x JOIN "Category" s ON s."id" = x."categoryId"
  WHERE s."parentId" = c."id" AND x."month" = b."month"
) sub
WHERE l."id" IS NOT NULL OR sub.n > 0;

-- Sous-lignes
INSERT INTO "BudgetItem" ("id", "householdId", "budgetId", "parentId", "categoryId", "kind", "label", "amount", "included", "recurring", "sortOrder")
SELECT gen_random_uuid()::text, b."householdId", b."id", p."id", s."id", s."kind", s."name", COALESCE(l."planned", 0), s."enabled", s."recurring", s."sortOrder"
FROM "BudgetLine" l
JOIN "Category" s ON s."id" = l."categoryId" AND s."parentId" IS NOT NULL
JOIN "Budget" b ON b."householdId" = l."householdId" AND b."month" = l."month"
JOIN "BudgetItem" p ON p."budgetId" = b."id" AND p."categoryId" = s."parentId";

-- Montant saisi directement sur une catégorie qui a des sous-lignes : conservé dans une sous-ligne « Autres ».
INSERT INTO "BudgetItem" ("id", "householdId", "budgetId", "parentId", "categoryId", "kind", "label", "amount", "included", "recurring", "sortOrder")
SELECT gen_random_uuid()::text, b."householdId", b."id", p."id", c."id", c."kind", 'Autres', l."planned", true, c."recurring", 999
FROM "BudgetLine" l
JOIN "Category" c ON c."id" = l."categoryId" AND c."parentId" IS NULL
JOIN "Budget" b ON b."householdId" = l."householdId" AND b."month" = l."month"
JOIN "BudgetItem" p ON p."budgetId" = b."id" AND p."categoryId" = c."id" AND p."parentId" IS NULL
WHERE l."planned" > 0 AND EXISTS (SELECT 1 FROM "BudgetItem" k WHERE k."parentId" = p."id");

DROP TABLE "BudgetLine";

-- Contraintes métier (SQL brut, non exprimables dans le schéma Prisma)
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);
CREATE UNIQUE INDEX "Budget_id_householdId_key" ON "Budget"("id", "householdId");
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budget_household_fkey" FOREIGN KEY ("budgetId", "householdId") REFERENCES "Budget"("id", "householdId") ON DELETE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_label_not_blank" CHECK (length(btrim("label")) > 0);
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "Category" ADD CONSTRAINT "Category_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Un seul niveau de sous-lignes : le parent n'a pas de parent, et une ligne qui a des enfants n'en devient pas un.
-- Sans second niveau, aucun cycle n'est possible.
CREATE FUNCTION "foyra_one_level"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad boolean;
BEGIN
  IF NEW."parentId" IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "parentId" IS NOT NULL) OR EXISTS (SELECT 1 FROM %I WHERE "parentId" = $2)', TG_TABLE_NAME, TG_TABLE_NAME)
    INTO bad USING NEW."parentId", NEW."id";
  IF bad THEN RAISE EXCEPTION 'Un seul niveau de sous-catégories (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Category_one_level" BEFORE INSERT OR UPDATE OF "parentId" ON "Category" FOR EACH ROW EXECUTE FUNCTION "foyra_one_level"();
CREATE TRIGGER "BudgetItem_one_level" BEFORE INSERT OR UPDATE OF "parentId" ON "BudgetItem" FOR EACH ROW EXECUTE FUNCTION "foyra_one_level"();

COMMIT;
