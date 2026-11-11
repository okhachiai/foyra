-- Récurrences : toujours des dépenses (CHECK FixedCharge_kind_expense) ; la colonne et sa contrainte disparaissent.
ALTER TABLE "FixedCharge" DROP COLUMN "kind";
