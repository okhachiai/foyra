ALTER TABLE "Household" ADD COLUMN "aiLocale" TEXT NOT NULL DEFAULT 'en', ADD COLUMN "aiAutomatic" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "aiMinimizeData" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Report" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY', ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en', ADD COLUMN "requestKey" TEXT, ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "startedAt" TIMESTAMP(3), ADD COLUMN "finishedAt" TIMESTAMP(3), ADD COLUMN "inputTokens" INTEGER, ADD COLUMN "outputTokens" INTEGER, ADD COLUMN "appliedAt" TIMESTAMP(3), ADD COLUMN "previousAmounts" JSONB, ADD COLUMN "appliedFingerprint" TEXT;
UPDATE "Report" SET "status" = 'ERROR' WHERE "error" IS NOT NULL;
CREATE UNIQUE INDEX "Report_requestKey_key" ON "Report"("requestKey");
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
ALTER TABLE "Report" ADD COLUMN "minimizeData" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "destination" TEXT;
ALTER TABLE "Report" ADD CONSTRAINT "Report_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'READY', 'ERROR'));
ALTER TABLE "Report" ADD COLUMN "appliedAmounts" JSONB;
