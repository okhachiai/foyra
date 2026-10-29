-- CreateTable
CREATE TABLE "FixedCharge" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "startMonth" DATE NOT NULL,
    "endMonth" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedChargePayment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fixedChargeId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedChargePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedCharge_householdId_idx" ON "FixedCharge"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedChargePayment_transactionId_key" ON "FixedChargePayment"("transactionId");

-- CreateIndex
CREATE INDEX "FixedChargePayment_householdId_month_idx" ON "FixedChargePayment"("householdId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "FixedChargePayment_fixedChargeId_month_key" ON "FixedChargePayment"("fixedChargeId", "month");

-- AddForeignKey
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedChargePayment" ADD CONSTRAINT "FixedChargePayment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedChargePayment" ADD CONSTRAINT "FixedChargePayment_fixedChargeId_fkey" FOREIGN KEY ("fixedChargeId") REFERENCES "FixedCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedChargePayment" ADD CONSTRAINT "FixedChargePayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes métier (SQL brut, non exprimables dans le schéma Prisma)
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_dueDay_range" CHECK ("dueDay" BETWEEN 1 AND 31);
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_startMonth_first_day" CHECK (EXTRACT(DAY FROM "startMonth") = 1);
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_endMonth_first_day" CHECK (EXTRACT(DAY FROM "endMonth") = 1);
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_endMonth_after_start" CHECK ("endMonth" >= "startMonth");
ALTER TABLE "FixedChargePayment" ADD CONSTRAINT "FixedChargePayment_month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);
