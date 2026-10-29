-- AlterTable
ALTER TABLE "Account" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "BudgetItem" ADD COLUMN "reserve" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "FixedCharge" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une seule ligne « Réserve imprévus » par budget (index partiel, inexprimable dans Prisma)
CREATE UNIQUE INDEX "BudgetItem_one_reserve" ON "BudgetItem"("budgetId") WHERE "reserve";
