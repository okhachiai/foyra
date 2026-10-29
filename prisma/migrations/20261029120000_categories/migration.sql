-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CarryOver" AS ENUM ('PREVIOUS', 'FORECAST', 'NONE');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" "CategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "forecastAmount" INTEGER,
    "carryOver" "CarryOver" NOT NULL DEFAULT 'FORECAST',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_householdId_idx" ON "Category"("householdId");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Contraintes métier (SQL brut, non exprimables dans le schéma Prisma)
ALTER TABLE "Category" ADD CONSTRAINT "Category_forecastAmount_nonneg" CHECK ("forecastAmount" >= 0);
-- Un virement n'a jamais de catégorie.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transfer_no_category" CHECK ("kind" <> 'TRANSFER' OR "categoryId" IS NULL);
-- Nom unique par (foyer, parent), insensible à la casse ; NULLS NOT DISTINCT : vaut aussi pour les catégories de premier niveau.
CREATE UNIQUE INDEX "Category_householdId_parentId_name_key" ON "Category"("householdId", "parentId", lower("name")) NULLS NOT DISTINCT;
