-- Revenus récurrents supprimés : les revenus du mois viennent du budget. Opérations déjà enregistrées conservées (paiements en cascade).
DELETE FROM "FixedCharge" WHERE "kind" = 'INCOME';
ALTER TABLE "FixedCharge" ADD CONSTRAINT "FixedCharge_kind_expense" CHECK ("kind" = 'EXPENSE');
