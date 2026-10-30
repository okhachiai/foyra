-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('CLAUDE', 'LOCAL');

-- CreateEnum
CREATE TYPE "ReportTrigger" AS ENUM ('MANUAL', 'DAILY');

-- AlterTable
ALTER TABLE "Household" ADD COLUMN "llmProvider" "LlmProvider";

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "userId" TEXT,
    "day" DATE NOT NULL,
    "trigger" "ReportTrigger" NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_householdId_createdAt_idx" ON "Report"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un seul rapport quotidien par foyer et par jour (index partiel, inexprimable dans Prisma)
CREATE UNIQUE INDEX "Report_one_daily" ON "Report"("householdId", "day") WHERE "trigger" = 'DAILY';
