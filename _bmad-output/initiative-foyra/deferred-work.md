- source_plan: none
  summary: Catégories et sous-catégories personnalisables, avec montant prévisionnel, règle de reconduction et activation dans les calculs.
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui repose sur le socle comptes/transactions.
- source_plan: none
  summary: Budget mensuel avec reconduction automatique du mois précédent, montants modifiables, et calcul des revenus/dépenses prévus et réels, du reste à payer, du budget par catégorie et du reste à vivre.
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui dépend des catégories.
- source_plan: none
  summary: Distinction entre charges fixes et dépenses variables (loyer, factures, assurances, abonnements, courses, transports, scolarité, enfants, aides à la famille à l'étranger).
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui s'appuie sur les catégories et le budget.
- source_plan: none
  summary: Suivi des crédits (mensualités, échéances, taux, capital restant dû, remboursements anticipés), avec échéances intégrées au budget mensuel.
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant.
- source_plan: none
  summary: Calendrier financier des paiements à venir, des charges récurrentes et des dates importantes du mois.
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui dépend des charges récurrentes et des crédits.
- source_plan: none
  summary: Tableau de bord temps réel répondant à « combien avons-nous, combien reste-t-il à payer, combien pouvons-nous dépenser ».
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui agrège les autres modules.
- source_plan: none
  summary: Permissions d'accès par compte pour chaque membre du foyer.
  evidence: Séparé de l'intention initiale « application Foyra complète » ; livrable indépendant qui s'ajoute au socle multi-utilisateurs.
- source_plan: `/Users/oktech/Sites/foyra-project/_bmad-output/initiative-foyra/plan-foyra-socle-comptes-transactions.md`
  summary: Gestion avancée des membres : désactivation, interdiction de retirer le dernier admin, changement de mot de passe par l'utilisateur, script CLI de réinitialisation du mot de passe.
  evidence: Sorti du plan socle à la relecture pour rester proche de la cible de taille ; le socle garde le rôle ADMIN/MEMBER et la création des membres par l'admin.
- source_plan: `/Users/oktech/Sites/foyra-project/_bmad-output/initiative-foyra/plan-foyra-socle-comptes-transactions.md`
  summary: Limite de connexion par IP fiable derrière un reverse proxy (réglage de proxy de confiance, ex. TRUST_PROXY).
  evidence: Sans proxy de confiance déclaré, l'en-tête X-Forwarded-For reste contrôlable par le client ; seule la limite par email est garantie.
- source_plan: `/Users/oktech/Sites/foyra-project/_bmad-output/initiative-foyra/plan-foyra-calendrier.md`
  summary: Dates importantes libres dans le calendrier (rappels saisis par l’utilisateur : renouvellement, impôts, échéances ponctuelles), avec leur propre modèle.
  evidence: Le calendrier couvre les échéances des charges fixes et crédits ; des dates libres demandent un nouveau modèle et des écrans de saisie, hors cible du cycle.
- source_plan: none
  summary: Gestion avancée des membres (désactivation d'un membre, interdiction de retirer/rétrograder le dernier admin, changement de son propre mot de passe, script CLI `npm run reset-password`).
  evidence: Séparé de l'intention « permissions d'accès par compte » au contrôle multi-objectif (livrable indépendant) ; traité dans un second cycle bmad-build immédiatement après.
