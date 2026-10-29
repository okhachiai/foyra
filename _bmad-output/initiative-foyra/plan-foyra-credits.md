---
title: 'Foyra — crédits : tableau d’amortissement, capital restant dû, remboursements anticipés, échéances au budget'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'e8cec2d2cf98c9cf13c046203beeea4a5bda8800'
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

**Problem:** Les crédits du foyer ne sont pas suivis : ni tableau d’amortissement, ni capital restant dû, ni intérêts payés/restants, ni effet d’un remboursement anticipé ; leurs échéances n’apparaissent pas au budget mensuel.

**Approach:** Un crédit = une `FixedCharge` (nom, compte, catégorie, jour, mois de début/fin) + un `Loan` 1:1 (capital, taux, durée, mensualité saisie facultative, assurance). L’échéancier est **calculé** (jamais stocké) par une fonction pure ; `listMonthCharges` remplace le montant d’une charge-crédit par l’échéance du mois, donc `/charges`, « Marquer payée » et le budget fonctionnent sans changement. Page `/credits` (liste, création, détail avec tableau, résumé et remboursement anticipé).

**Decisions (auto, autonomie accordée par l’utilisateur) :** un seul objectif, pas de découpage. Montants en centimes `Int` : capital plafonné par `parseCents` (`MAX_CENTS` ≈ 21,47 M€), suffisant pour un foyer ; calculs intermédiaires en `Number` (exacts < 2⁵³). Taux annuel en millièmes de pour cent (`Int`, 3,450 % → 3450 ; 0 accepté = prêt à taux zéro ; CHECK 0–50 000). Durée 1–600 échéances mensuelles. Mensualité calculée = annuité constante arrondie au centime (demi supérieur) ; saisie = utilisée telle quelle, refusée si ≤ intérêts de la 1ʳᵉ échéance. Intérêts de chaque échéance = `round(capital restant × taux / 1 200 000)` ; la dernière échéance solde le capital restant (absorbe tous les arrondis) ; si le capital est soldé avant la n-ième, l’échéancier s’arrête. Assurance = montant mensuel fixe (0 par défaut) ajouté à chaque échéance. Première échéance : une date ; jour d’échéance = son jour, mois de début = son mois (règle `dueDate` des charges). Remboursement anticipé : date, montant, mode (réduction de durée = mensualité inchangée ; réduction de mensualité = annuité recalculée sur les échéances restantes), appliqué après les échéances dues à cette date ou avant, sans prorata d’intérêts ni indemnités ; il crée la dépense réelle (compte et catégorie du crédit) ; montant et date lus sur cette dépense ; la supprimer annule le remboursement ; montant > capital restant dû à cette date refusé. Capital restant dû, intérêts payés/restants = selon les échéances dues au jour J (fuseau du foyer), indépendamment des clics « payée » (statut payé affiché par ligne). Un crédit se modifie entièrement (échéancier recalculé) ; supprimer un crédit = supprimer sa charge (dépenses conservées). Plan d’environ 2 600 tokens (> 1 600) conservé entier : « Keep full plan », un seul objectif, découpage artificiel. Plan approuvé automatiquement (« Approve and continue »).

## Boundaries & Constraints

**Always:**
- Mécanisme des charges fixes réutilisé : paiement d’une échéance = `payCharge` existant (montant prérempli = échéance du mois, assurance incluse) ; aucune table d’échéances.
- Échéancier pur et testé : Σ capital amorti + Σ remboursements appliqués = capital exactement ; solde final 0 ; aucune échéance négative.
- CHECK SQL : capital > 0, taux 0–50 000, durée 1–600, mensualité saisie NULL ou > 0, assurance ≥ 0 ; `Loan.fixedChargeId` unique (`onDelete: Cascade`) ; remboursement : `transactionId` unique (`onDelete: Cascade`), `loanId` `onDelete: Cascade`.
- Remboursement anticipé : contrôle du capital restant dû et création de la dépense dans une seule transaction SQL avec verrou `FOR UPDATE` sur le crédit (via `createEntryTx`).
- Charge-crédit : `updateCharge` refuse (introuvable), `/charges/[id]` redirige vers `/credits/[loanId]` ; la dépense d’un remboursement ne peut pas devenir une recette (`updateEntry`).
- Filtre `householdId` partout ; `requireUser()` en tête ; id hors foyer → 404 / « Élément introuvable ». Utilisable à 360 px (tableau défilant dans son conteneur, pas la page).

**Never:** calendrier, tableau de bord, permissions par compte ; taux variable, différé, prorata d’intérêts, indemnités de remboursement anticipé ; échéances non mensuelles ; stocker l’échéancier ou un total ; dupliquer la logique de paiement des charges.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Annuité | 100 000 €, 1,200 %, 240, 1ʳᵉ échéance 05/01/2027 | Mensualité 468,87 € ; 240ᵉ échéance 469,35 € (12/2046) ; intérêts totaux 12 529,28 € | Capital 0/« abc », taux 50,001, durée 0/601 → erreur de champ |
| Taux zéro | 200 €, 0 %, 3 | 66,67 · 66,67 · 66,66 | — |
| Mensualité saisie | 100 000 €, 1,2 %, 240, saisie 500 € | Échéancier plus court, dernière échéance < 500 € | Saisie ≤ 100 € (intérêts du 1ᵉʳ mois) → « La mensualité ne couvre pas les intérêts. » |
| Assurance | 15 € | Chaque échéance totale = mensualité + 15 € | Montant « abc » → erreur de champ |
| Budget | Crédit sur Courant, catégorie Crédit, janvier 2027 | `/charges` et `/budget` de janvier : 468,87 € (+ assurance) à payer ; « Marquer payée » crée la dépense | — |
| Hors période | Décembre 2026, 01/2047 | Pas d’échéance | — |
| Anticipé durée | 10 000 € le 10/01/2028, réduction de durée | Dépense 10 000 € ; mensualité inchangée ; fin avancée ; capital restant dû −10 000 € | Montant > capital restant dû → erreur de champ |
| Anticipé mensualité | 10 000 € le 10/01/2028, réduction de mensualité | Fin 12/2046 inchangée ; mensualité recalculée plus basse dès 02/2028 | — |
| Soldé | Anticipé = capital restant dû | Plus aucune échéance après cette date | — |
| Annuler anticipé | Suppression de la dépense | Échéancier initial | — |
| Résumé | J = 06/01/2027 | 1 échéance due : capital restant dû = 100 000 € − capital de la 1ʳᵉ ; intérêts payés 100,00 € | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- `Loan` (id, householdId, fixedChargeId `@unique` → `FixedCharge` `onDelete: Cascade`, principal Int, annualRate Int, termMonths Int, payment Int?, insurance Int `@default(0)`, createdAt) ; `LoanPrepayment` (id, householdId, loanId → `Loan` `onDelete: Cascade`, transactionId `@unique` → `Transaction` `onDelete: Cascade`, mode enum `PrepaymentMode { REDUCE_TERM REDUCE_PAYMENT }`, createdAt) ; back-relations `Household`, `FixedCharge.loan Loan?`, `Transaction.prepayment LoanPrepayment?`.
- `prisma/migrations/20261031000000_loans/migration.sql` -- via `prisma migrate diff` + CHECK en SQL brut (modèle : `20261030000000_fixed_charges`). Ne pas toucher les migrations existantes.
- `src/lib/amortization.ts` (nouveau, pur, sans import Prisma/DB) -- déplacer `dueDate` ici (réexporté par `charges.ts`, imports existants intacts). `annuity(principal, annualRate, n)` ; `buildSchedule(terms, prepayments)` → `{ rows: { n, month, due, interest, principal, insurance, total, balance }[], prepayments: { occurredOn, amount, mode, balance }[] }` ; `loanStatus(schedule, principal, today)` → `{ balance, interestPaid, interestRemaining }`.
- `src/lib/loans.ts` (nouveau) -- `LoanInput` ; `createLoan`/`updateLoan` (une transaction : `checkRefs` de `charges.ts` exporté, charge avec `amount` = 1ʳᵉ échéance totale, `dueDay`, `startMonth`, `endMonth = startMonth + n − 1`, + `Loan`) ; `deleteLoan` (supprime la charge) ; `getLoan` (crédit + charge + paiements + remboursements avec leur dépense + échéancier + statut) ; `listLoans` ; `prepay(householdId, userId, loanId, amount, occurredOn, mode)`. Erreurs `LedgerError`/`NotFoundError`.
- `src/lib/charges.ts` -- `listMonthCharges` inclut `loan` (+ remboursements et leur dépense) ; charge-crédit : montant = `total` de la ligne du mois, retirée si aucune ligne. `payCharge` : même contrôle pour une charge-crédit. `updateCharge` : `where` avec `loan: null`. `budget.ts` inchangé.
- `src/lib/ledger.ts` `updateEntry` -- refuser `kind !== "EXPENSE"` si la dépense porte un `LoanPrepayment`.
- `src/app/actions.ts` -- `createLoanAction`, `updateLoanAction`, `deleteLoanAction`, `prepayLoanAction` ; réutiliser `Errors`, `run`, `done`, `amountField`, `dayField`, `requiredField` ; taux « 3,45 » → 3450 (`^\d{1,2}([.,]\d{1,3})?$`) ; mensualité et assurance vides → null / 0.
- `src/app/credits/layout.tsx` (réexporte `../accounts/layout`), `page.tsx` (liste : nom, échéance, capital restant dû, fin), `new/page.tsx`, `[id]/page.tsx` (résumé ; `<details>` modification ; formulaire anticipé ; liste des anticipés avec lien vers la dépense ; tableau n°, date, échéance, intérêts, capital restant, payée/à payer liée à `/charges?m=` ; suppression avec `confirm`), `loan-form.tsx` (sur le modèle de `charge-form.tsx`).
- `src/app/charges/[id]/page.tsx` -- redirection vers `/credits/{loan.id}`. `src/app/accounts/layout.tsx` -- lien « Crédits ». `src/app/globals.css` -- conteneur de tableau défilant si absent.
- Tests : `src/lib/amortization.test.ts` (pur) et `src/lib/loans.test.ts` (modèle `charges.test.ts`, TRUNCATE … CASCADE).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration -- modèles et contraintes
- [x] `src/lib/amortization.ts` -- échéancier pur, arrondis, anticipés
- [x] `src/lib/loans.ts`, `src/lib/charges.ts`, `src/lib/ledger.ts` -- règles métier et intégration charges/budget
- [x] `src/app/actions.ts` -- actions crédits
- [x] `src/app/credits/*`, `src/app/charges/[id]/page.tsx`, `src/app/accounts/layout.tsx`, `globals.css` -- pages et navigation
- [x] `src/lib/amortization.test.ts`, `src/lib/loans.test.ts` -- un test par ligne de la matrice ; tests existants verts

**Acceptance Criteria:**
- Given une instance existante, when `prisma migrate deploy`, then données intactes et `/credits` vide avec « Ajouter ».
- Given `/credits/[id]` à 360 px, when on enregistre un remboursement anticipé, then la page se recharge avec l’échéancier recalculé, sans défilement horizontal de la page.
- Given un crédit, when on ouvre `/charges?m=` d’un mois couvert, then l’échéance y figure avec sa date (utilisable par le futur calendrier via `listMonthCharges`).

## Implementation Notes

- Migration `20261031000000_loans` (via `prisma migrate diff`) ; `dueDate` déplacé dans `amortization.ts`, réexporté par `charges.ts` ; `checkRefs` exporté.
- Après revue : anticipé « mensualité » recalculé sur les échéances restantes de l’échéancier courant (fin inchangée, la dernière absorbe les arrondis) ; montant/date de la dépense d’un anticipé non modifiables ; `prepay` refuse tout anticipé qui serait écrêté (échéancier recalculé avec le nouveau) ; un mois déjà payé reste listé ; « Soldé » sur `/credits` ; CHECK `Loan` testés directement.
- `npm test` (91), `typecheck`, `build` OK ; parcours `/credits` vérifié à 360 px (Playwright) ; `docker compose up` sur 3010 : 5 migrations appliquées, `/credits` → `/login`.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 3 · low 5 · false 0 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Anticipé « réduction de mensualité » recalcule sur `termMonths` : fin repoussée si l’échéancier finissait plus tôt (mensualité saisie, anticipé durée antérieur) | medium | patch | `annuity(b, rate, termMonths − k + 1)` ignore la fin courante ; correctif : nombre d’échéances restantes de l’échéancier courant + test. |
| 2 | Dépense d’un anticipé modifiable (montant/date) sans contrôle ni verrou ; `buildSchedule` l’écrête en silence | medium | patch | `updateEntry` ne gardait que le sens ; refus de modifier montant/date (supprimer et ressaisir) + test. |
| 3 | Anticipé antidaté contrôlé seulement au solde de sa date : un anticipé ultérieur est écrêté (dépenses > capital) | medium | patch | `withSchedule(…, occurredOn)` ignore les anticipés postérieurs ; correctif : échéancier avec le nouvel anticipé, refus si un anticipé est écrêté + test. |
| 4 | Mois déjà payé d’un crédit disparaît de `/charges` et du budget quand l’échéancier n’a plus de ligne | low | patch | `listMonthCharges` filtre sur `loanRow` sans regarder le paiement ; correctif d’une condition + test. |
| 5 | « Soldé » jamais affiché sur `/credits` | low | patch | Repli `?? rows.at(-1)` ; correction directe. |
| 6 | Tests CHECK capital 0 / durée 0 passent pour une autre raison | low | patch | Rejet par `FixedCharge_amount_positive` / `checkRefs` ; tests réécrits via `prisma.loan` direct. |
| 7 | Erreurs de champ de la matrice (« abc », 50,001, 0/601) non testées | low | reject | Parsing d’actions sans tests depuis le socle ; `parseCents` couvert par `money.test.ts`, contraintes SQL testées ; même décision qu’aux cycles précédents. |
| 8 | `payCharge` et `prepay` sans verrou commun : paiement concurrent d’un mois soldé | low | reject | Course improbable (deux membres, même seconde) ; l’effet visible (mois disparu) est neutralisé par #4 ; correctif = verrou supplémentaire. |

## Design Notes

Échéancier : solde `b = principal`, mensualité `M` ; pour k = 1..n : appliquer d’abord les anticipés non encore appliqués datés strictement avant l’échéance k (triés par date puis création ; montant borné à `b`) ; après un anticipé en mode mensualité, `M = annuity(b, taux, n − k + 1)` ; `i = round(b × taux / 1 200 000)` ; `p = (k = n ou b ≤ M − i) ? b : M − i` ; `b −= p` ; arrêt si `b = 0`. Anticipé daté le jour même d’une échéance : appliqué après elle. Taux 0 : `annuity = round(b / n)`.

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur

**Manual checks (if no CLI):**
- `/credits` : créer, voir tableau ; `/charges` du mois : échéance, « Marquer payée » ; anticipé puis suppression de sa dépense → échéancier initial ; 360 px.
