-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "planned" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetLine_householdId_month_idx" ON "BudgetLine"("householdId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_categoryId_month_key" ON "BudgetLine"("categoryId", "month");

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;




-- Contraintes métier (SQL brut, non exprimables dans le schéma Prisma)
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_planned_nonneg" CHECK ("planned" >= 0);
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);
