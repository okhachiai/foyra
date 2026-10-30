-- Plus de comptes bancaires : l'application ne gère que les budgets du mois et les opérations réelles.
-- Opération : « payé par » = propriétaire de son ancien compte, sinon son auteur ; recette d'un compte commun = recette commune.
ALTER TABLE "Transaction" ADD COLUMN "paidById" TEXT;
UPDATE "Transaction" t SET "paidById" = COALESCE(a."ownerId", t."createdById"),
  "shared" = CASE WHEN t."kind" = 'INCOME' THEN a."ownerId" IS NULL ELSE t."shared" END
FROM "Account" a WHERE a."id" = t."accountId";
ALTER TABLE "Transaction" ALTER COLUMN "paidById" SET NOT NULL;

-- Virements et ajustements de solde n'ont plus de sens sans compte.
DELETE FROM "Transaction" WHERE "kind" = 'TRANSFER' OR ("categoryId" IS NULL AND "note" = 'Ajustement de solde');

ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_transfer_shape";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_transfer_no_category";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_accountId_fkey";
DROP INDEX "Transaction_transferId_transferSide_key";
DROP INDEX "Transaction_accountId_occurredOn_idx";
DROP INDEX "Transaction_householdId_idx";
ALTER TABLE "Transaction" DROP COLUMN "accountId", DROP COLUMN "transferId", DROP COLUMN "transferSide";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Transaction_householdId_occurredOn_idx" ON "Transaction"("householdId", "occurredOn");
CREATE INDEX "Transaction_paidById_idx" ON "Transaction"("paidById");

ALTER TYPE "TransactionKind" RENAME TO "TransactionKind_old";
CREATE TYPE "TransactionKind" AS ENUM ('INCOME', 'EXPENSE');
ALTER TABLE "Transaction" ALTER COLUMN "kind" TYPE "TransactionKind" USING ("kind"::text::"TransactionKind");
DROP TYPE "TransactionKind_old";

ALTER TABLE "FixedCharge" DROP CONSTRAINT "FixedCharge_accountId_fkey";
ALTER TABLE "FixedCharge" DROP COLUMN "accountId";

DROP TABLE "AccountAccess";
DROP TABLE "Account";
DROP TYPE "TransferSide";
DROP TYPE "AccessLevel";
DROP TYPE "AccountSharing";
DROP TYPE "AccountKind";
