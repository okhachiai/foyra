-- Catégorie d'épargne : dépense (déduite des revenus), suivie mois par mois sur /epargne.
ALTER TABLE "Category" ADD COLUMN "savings" BOOLEAN NOT NULL DEFAULT false;
