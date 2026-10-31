-- Trois rapports distincts (quotidien, bilan du mois, préparation du budget) : les anciens rapports, d'un format abandonné, sont supprimés.
DELETE FROM "Report";

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('DAILY', 'MONTHLY', 'PLAN');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "kind" "ReportKind" NOT NULL;

-- Déclencheur automatique (cron) : quotidien et, le 1er, bilan du mois écoulé.
ALTER TYPE "ReportTrigger" RENAME VALUE 'DAILY' TO 'AUTO';

-- Un seul rapport automatique par foyer, jour et type (index partiel, inexprimable dans Prisma)
DROP INDEX "Report_one_daily";
CREATE UNIQUE INDEX "Report_one_auto" ON "Report"("householdId", "day", "kind") WHERE "trigger" = 'AUTO';
