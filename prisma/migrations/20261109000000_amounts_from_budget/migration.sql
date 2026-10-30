-- Les montants ne vivent plus que dans les budgets du mois : paramétrage = configuration seulement.
ALTER TABLE "Category" DROP CONSTRAINT "Category_forecastAmount_nonneg";
ALTER TABLE "Category" DROP COLUMN "forecastAmount";
ALTER TABLE "FixedCharge" DROP CONSTRAINT "FixedCharge_amount_positive";
ALTER TABLE "FixedCharge" DROP COLUMN "amount";
