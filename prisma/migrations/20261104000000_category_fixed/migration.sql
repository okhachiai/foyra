-- AlterTable
ALTER TABLE "Category" ADD COLUMN "fixed" BOOLEAN NOT NULL DEFAULT false;

-- Modèles existants : charges fixes
UPDATE "Category" SET "fixed" = true
WHERE "kind" = 'EXPENSE' AND "parentId" IS NULL
  AND "name" IN ('Logement', 'Crédits', 'Assurances', 'Factures', 'Abonnements', 'Famille au Maroc');
