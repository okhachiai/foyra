-- CreateEnum
CREATE TYPE "PrepaymentMode" AS ENUM ('REDUCE_TERM', 'REDUCE_PAYMENT');

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fixedChargeId" TEXT NOT NULL,
    "principal" INTEGER NOT NULL,
    "annualRate" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "payment" INTEGER,
    "insurance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPrepayment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "mode" "PrepaymentMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPrepayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loan_fixedChargeId_key" ON "Loan"("fixedChargeId");

-- CreateIndex
CREATE INDEX "Loan_householdId_idx" ON "Loan"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPrepayment_transactionId_key" ON "LoanPrepayment"("transactionId");

-- CreateIndex
CREATE INDEX "LoanPrepayment_loanId_idx" ON "LoanPrepayment"("loanId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_fixedChargeId_fkey" FOREIGN KEY ("fixedChargeId") REFERENCES "FixedCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPrepayment" ADD CONSTRAINT "LoanPrepayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contraintes métier (SQL brut, non exprimables dans le schéma Prisma)
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_principal_positive" CHECK ("principal" > 0);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_annualRate_range" CHECK ("annualRate" BETWEEN 0 AND 50000);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_termMonths_range" CHECK ("termMonths" BETWEEN 1 AND 600);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_payment_positive" CHECK ("payment" IS NULL OR "payment" > 0);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_insurance_non_negative" CHECK ("insurance" >= 0);
