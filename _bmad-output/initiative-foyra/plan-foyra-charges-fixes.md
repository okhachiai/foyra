---
title: 'Foyra — charges fixes : échéances mensuelles, payées / à payer, totaux fixes et variables du budget'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: '6f51430a7c1be037e8cd34d6a6eecb4cad82da09'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le budget ne distingue pas les charges fixes (loyer, factures, assurances, abonnements, aides à la famille…) des dépenses variables : impossible de voir chaque mois quelles charges sont payées ou restent à payer, ni de séparer les totaux fixes et variables.

**Approach:** Modèle `FixedCharge` (nom, montant, jour d'échéance 1–31, compte de prélèvement, catégorie de dépense, mois de début, dernier mois facultatif) et `FixedChargePayment` (charge, mois, opération créée). Page `/charges?m=AAAA-MM` : charges du mois triées par échéance, payées / à payer, « Marquer payée » crée la dépense réelle. Le budget affiche les totaux fixes/variables et intègre les charges non payées au restant à payer.

**Decisions (auto, autonomie accordée par l'utilisateur) :** un seul objectif, pas de découpage. Une charge s'applique au mois M si début ≤ M ≤ dernier mois (vide = sans fin). Échéance du mois = min(jour, dernier jour du mois). Payée pour M = une ligne `FixedChargePayment` (charge, M) liée à une dépense ; supprimer la dépense (écran existant de l'opération) la repasse « à payer ». Marquer payée : montant (prérempli, modifiable) et date (préremplie à l'échéance, obligatoirement dans M). Dépenses variables = dépenses des catégories incluses non liées à un paiement de charge. Prévu par catégorie inchangé (lignes de budget) ; une charge non payée garantit au moins son montant comme restant de sa catégorie. Supprimer une charge garde ses dépenses (deviennent variables) ; pour l'arrêter sans perdre l'historique, renseigner le dernier mois. Catégorie utilisée par une charge : suppression refusée. Plan d'environ 2 100 tokens conservé entier (un seul objectif, découpage artificiel). Plan approuvé automatiquement (« Approve and continue », choix recommandé à chaque point de contrôle).

## Boundaries & Constraints

**Always:**
- Montant en centimes `Int` > 0 (CHECK) via `parseCents` ; `dueDay` 1–31 (CHECK) ; `startMonth`/`endMonth`/`month` = 1ᵉʳ du mois (CHECK), `endMonth >= startMonth` (CHECK) ; unique (charge, mois) ; `transactionId` unique.
- Catégorie de la charge : du foyer, sens EXPENSE ; compte : du foyer, non archivé à la création/modification (même message que le grand livre).
- Paiement + dépense dans une seule transaction SQL, via la logique de `createEntry` (verrou du compte, contrôle catégorie) ; double clic / concurrence → un seul paiement, message « Cette charge est déjà payée pour ce mois. ».
- Totaux fixes/variables seulement sur les catégories incluses (règle du budget) ; virements jamais comptés.
- `dueDate(charge, month)` exportée et pure : réutilisable par le futur calendrier.
- Filtre `householdId` partout ; `requireUser()` en tête de page et d'action ; id hors foyer → 404 / « Élément introuvable ». Utilisable à 360 px.

**Never:**
- Crédits, calendrier, tableau de bord, permissions par compte ; prélèvement automatique (aucune dépense créée sans clic).
- Charges non mensuelles (trimestrielles, annuelles).
- Modifier la reconduction ou les lignes de budget existantes ; stocker un total calculé.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Créer | Loyer 950 €, jour 5, compte Courant, catégorie Loyer | Charge active dès le mois courant | Montant « 0 »/« abc », jour 0 ou 32, catégorie de revenu, compte archivé → erreur de champ |
| Échéance | Jour 31, février 2027 | Échéance 28/02/2027 | — |
| Période | Début 2026-11, dernier mois 2027-01 | Absente en octobre et février | Dernier mois < début → erreur de champ |
| Marquer payée | Loyer novembre, 950 €, 05/11 | Dépense 950 € Loyer sur Courant ; charge « payée » | Date hors novembre → erreur ; second paiement → « déjà payée » |
| Annuler | Suppression de la dépense liée | Charge de nouveau « à payer » | — |
| Budget | Loyer prévu 950, payé 950 ; Assurance 80 € non payée, catégorie prévue 0 ; Courses prévu 400, effectué 150 | Fixes 1 030 dont 80 à payer ; variables effectuées 150 ; restant à payer 80 + 250 = 330 | — |
| Exclusion | Charge dans une catégorie désactivée | Listée sur `/charges`, hors totaux du budget | — |
| Supprimer charge | Charge avec paiements | Charge supprimée, dépenses conservées (variables) | — |
| Supprimer catégorie | Catégorie utilisée par une charge | Refus « Cette catégorie est utilisée par une charge fixe. » | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- `FixedCharge` (id, householdId, name, amount Int, dueDay Int, accountId, categoryId, startMonth/endMonth `@db.Date`, createdAt ; `Category` `onDelete: Restrict`, `Account` défaut) ; `FixedChargePayment` (id, householdId, fixedChargeId `onDelete: Cascade`, month `@db.Date`, transactionId `@unique` → `Transaction` `onDelete: Cascade` ; `@@unique([fixedChargeId, month])`) ; back-relations sur `Household`, `Account`, `Category`, `Transaction` (`fixedPayment FixedChargePayment?`).
- `prisma/migrations/20261030000000_fixed_charges/migration.sql` -- via `prisma migrate diff` + CHECK en SQL brut (modèle : migration budget). Ne pas toucher les migrations existantes.
- `src/lib/ledger.ts` -- extraire le corps de `createEntry` en `createEntryTx(tx, householdId, userId, input)` exporté ; `createEntry` l'appelle. Ne rien changer d'autre.
- `src/lib/charges.ts` (nouveau) -- `dueDate`, `appliesTo(charge, month)`, `createCharge`/`updateCharge`/`deleteCharge`/`getCharge`, `listMonthCharges(householdId, month)` (charges applicables + paiement du mois avec sa dépense), `payCharge(householdId, userId, id, month, amount, occurredOn)` (P2002 → `LedgerError`). Erreurs : `LedgerError`/`NotFoundError` existants.
- `src/lib/budget.ts` -- `BudgetRow` gagne `fixed` (Σ charges applicables de la catégorie), `unpaidFixed`, `fixedActual` (dépenses du mois liées à un paiement) ; `summarize` : `remainingToPay += max(prévu − effectué, unpaidFixed)`, reste à vivre dépenses `max(prévu, effectué + unpaidFixed)`, totaux `fixedTotal`, `fixedPaid`, `fixedRemaining`, `variableActual = expenseActual − fixedActual`. `getBudget` alimente via `listMonthCharges` + un `groupBy` des dépenses liées.
- `src/lib/categories.ts` `deleteCategory` -- refuser si `fixedCharge.count` > 0.
- `src/app/actions.ts` -- `createChargeAction`, `updateChargeAction`, `deleteChargeAction`, `payChargeAction` ; réutiliser `Errors`, `run`, `done`, `amountField`, `dayField`, `requiredField`, `parseMonth`.
- `src/app/charges/layout.tsx` (réexporte `../accounts/layout`), `page.tsx` (navigation mois comme `/budget`, total fixe / payé / à payer, liste par échéance ; à payer : `<details>` « Marquer payée » avec montant + date ; payée : lien vers `/accounts/{accountId}/transactions/{tid}`), `new/page.tsx`, `[id]/page.tsx` (édition + suppression avec `confirm`), `charge-form.tsx` (nom, montant, jour `type=number`, compte `<select>` des comptes actifs, catégorie `<select>` des dépenses « Parent › Sous », début/dernier mois `type=month`).
- `src/app/budget/page.tsx` -- dans `.total` : « Charges fixes X dont Y à payer » (lien `/charges?m=`), « Dépenses variables effectuées ». `src/app/accounts/layout.tsx` -- lien « Charges fixes ».
- Tests : `src/lib/charges.test.ts` sur le modèle de `budget.test.ts` (TRUNCATE … CASCADE).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration -- modèles et contraintes
- [x] `src/lib/ledger.ts` -- `createEntryTx`
- [x] `src/lib/charges.ts` -- règles métier des charges et paiement
- [x] `src/lib/budget.ts`, `src/lib/categories.ts` -- totaux fixes/variables, refus de suppression
- [x] `src/app/actions.ts` -- actions charges
- [x] `src/app/charges/*`, `src/app/budget/page.tsx`, `src/app/accounts/layout.tsx` -- pages et navigation
- [x] `src/lib/charges.test.ts` -- un test par ligne de la matrice ; tests budget existants toujours verts

**Acceptance Criteria:**
- Given une instance existante, when `prisma migrate deploy`, then données intactes et `/charges` vide avec « Ajouter ».
- Given `/charges` à 360 px, when on marque une charge payée, then la page se recharge sur le même mois, charge « payée », dépense visible dans l'historique du compte, sans défilement horizontal.
- Given deux membres, when l'un marque une charge payée, then l'autre la voit payée après rechargement.

## Implementation Notes

- Migration `20261030000000_fixed_charges` (via `prisma migrate diff`) ; `createEntryTx` extrait de `createEntry` ; `isCode` exporté par `ledger.ts`.
- Après revue : une dépense liée à un paiement ne peut ni quitter le mois payé ni devenir une recette (`updateEntry`) ; filtre `householdId` ajouté dans `deleteCategory`.
- `npm test` (71), `typecheck`, `build` OK ; parcours `/charges` et `/budget` vérifié à 360 px (Playwright) ; `docker compose up` sur 3010 : 4 migrations appliquées, `/charges` → `/login`.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 1 · low 4 · false 0 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Dépense liée modifiable hors du mois de paiement (ou en recette) : charge « payée » en M, dépense comptée ailleurs, restant à payer de M sous-estimé | medium | patch | `updateEntry` ne connaît pas `FixedChargePayment` ; écran d'édition existant. Correctif = refus dans `updateEntry` (date hors mois, sens INCOME) + test. |
| 2 | Raccourcir la période d'une charge déjà payée : dépense ni fixe ni variable | low | reject | Il faut fixer un dernier mois antérieur à un mois déjà payé (usage normal : mois courant ou futur) ; correctif = garde supplémentaire dans `updateCharge`. |
| 3 | `deleteCategory` (catch) : `fixedCharge.count` sans `householdId` | low | patch | Règle « filtre householdId partout » ; ajout du filtre. |
| 4 | `isCode` dupliqué dans `charges.ts` et `categories.ts` | low | patch | Correction directe : un seul `isCode` exporté par `ledger.ts`. |
| 5 | Montant « abc » non testé sur la charge | low | reject | `parseCents` (via `amountField`) couvert par `money.test.ts` ; câblage d'une ligne, comme aux cycles précédents. |

## Design Notes

Restant d'une catégorie de dépense = `max(prévu − effectué, chargesNonPayées)` : le prévu couvre déjà les charges de la catégorie (pas de double compte), mais une charge non payée reste due même si le prévu est vide ou dépassé. Exemple matrice : Assurances prévu 0, effectué 0, non payée 80 → 80.

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur

**Manual checks (if no CLI):**
- `/charges` : créer, marquer payée, supprimer la dépense → à payer ; `/budget` : totaux fixes/variables cohérents ; 360 px.
