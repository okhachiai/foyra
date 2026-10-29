---
title: 'Foyra — calendrier financier du mois : échéances payées / à payer / en retard, opérations, à venir, solde prévisionnel'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'b923fd618a754f6c6372ad33adfb196ddd0c77c8'
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

**Problem:** Le foyer ne voit nulle part, jour par jour, ce qui tombe dans le mois (charges fixes, échéances de crédit) ni ce qui a réellement été payé : risque d’oubli et trésorerie difficile à anticiper.

**Approach:** Page `/calendrier?m=AAAA-MM` en vue agenda (jours du mois ayant au moins un élément, aujourd’hui mis en évidence) : échéances issues de `listMonthCharges` avec statut payée / à payer / en retard et « Marquer payée » via `payChargeAction`, opérations réelles du jour ; navigation mois précédent / suivant ; bloc « À venir » (7 prochains jours) ; solde prévisionnel de fin de mois par compte pour le mois courant.

**Decisions (auto, autonomie accordée par l’utilisateur) :** un seul objectif, pas de découpage. Vue agenda (liste par jour) à toutes les largeurs, pas de grille. « Dates importantes » = dates d’échéance des charges et crédits ; des dates/rappels libres saisis par l’utilisateur demandent un nouveau modèle → reportés (deferred-work). Statut d’une échéance : payée = paiement du mois existe ; sinon en retard si échéance < aujourd’hui (fuseau du foyer), sinon à payer. Opérations réelles = transactions du foyer datées dans le mois, sauf celles liées à un paiement de charge (déjà affichées sous l’échéance « payée ») ; un virement apparaît une fois (côté sortant). « À venir » = échéances non payées dont la date est entre aujourd’hui et aujourd’hui + 7 jours inclus (mois courant et suivant), plus les échéances en retard du mois courant ; affiché quel que soit le mois consulté. Solde prévisionnel (seulement pour le mois courant) par compte actif = solde actuel − échéances non payées du mois sur ce compte (en retard comprises) ; pas de solde jour par jour. « Marquer payée » depuis le calendrier revient sur `/calendrier?m=`. Plan d’environ 2 000 tokens (> 1 600) conservé entier : « Keep full plan », un seul objectif, découpage artificiel. Aucune question ouverte. Plan approuvé automatiquement (« Approve and continue »).

## Boundaries & Constraints

**Always:**
- Aucune logique d’échéance dupliquée : dates, montants (crédits compris) et paiements viennent de `listMonthCharges` / `dueDate` / `payCharge`.
- Lecture seule hors `payCharge` : aucune migration, aucun modèle, aucun total stocké.
- Filtre `householdId` partout ; `requireUser()` en tête ; utilisable à 360 px sans défilement horizontal de la page.

**Never:** tableau de bord, permissions par compte, rappels/notifications, dates libres, grille mensuelle, solde prévisionnel jour par jour ou pour un mois futur, modification de `/charges` ou `/budget`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Statuts | Aujourd’hui 10/11 ; Loyer jour 5 payé, Assurance jour 8 non payée, Internet jour 20 non payée | 05/11 payée (lien dépense), 08/11 en retard, 20/11 à payer | — |
| Crédit | Crédit, 1ʳᵉ échéance 05/11 | Échéance du crédit au 05/11, montant = échéance du mois (assurance incluse) | — |
| Fin de mois | Charge jour 31, février 2027 | Affichée au 28/02 | — |
| Opérations | Courses 40 € le 12/11 ; virement Courant → Épargne le 12/11 ; dépense du Loyer | 12/11 : Courses et le virement une seule fois ; dépense du Loyer non répétée | — |
| À venir | Aujourd’hui 28/11 ; charge jour 2 non payée, mois suivant | Listée dans « À venir » (02/12) avec l’en retard du mois | — |
| Marquer payée | Depuis le calendrier, montant/date préremplis | Retour `/calendrier?m=2026-11`, échéance payée | Date hors mois / déjà payée → message de `payCharge` |
| Prévisionnel | Courant 1 000 €, Assurance 80 € en retard + Internet 30 € à payer sur Courant | Courant : 1 000 € → 890 € fin de mois ; non affiché sur un autre mois | — |
| Vide | Mois sans charge ni opération | « Rien de prévu ce mois-ci. » | — |

</frozen-after-approval>

## Code Map

- `src/lib/charges.ts` -- `listMonthCharges(householdId, month)` (date `due`, `amount`, `payment.transaction`, `loanId`, `account`, `category`) et `payCharge` : réutiliser tels quels, ne pas modifier.
- `src/lib/budget.ts` -- `parseMonth`, `formatMonth`, `addMonths`. `src/lib/ledger.ts` -- `todayIn`, `parseDay`, `formatDay`, `listAccounts` (solde de tous les comptes, `archivedAt`).
- `src/lib/calendar.ts` (nouveau) -- `chargeStatus(c, today)` pur → `"paid" | "late" | "due"` ; `getCalendar(householdId, month, today)` → `{ days: { day, charges, transactions }[] trié, upcoming, forecast | null }` : charges du mois (+ mois suivant pour « À venir »), transactions du mois (`fixedPayment: null`, `OR transferSide null | OUT`, compte, catégorie, compte d’en face d’un virement si simple), forecast seulement si `month` = mois de `today`.
- `src/app/actions.ts` `payChargeAction` -- champ caché `back=calendar` (valeur fixe, liste blanche) → `done("/calendrier?m=…")`, sinon inchangé.
- `src/app/calendrier/layout.tsx` (réexporte `../accounts/layout`), `page.tsx` -- pager comme `/charges` ; bloc « À venir » ; bloc prévisionnel (`.totals`) ; `<ul className="list">` par jour (`<h2>` « mercredi 12 novembre », marqué « Aujourd’hui ») ; échéance : nom (lien `/charges/{id}`, qui redirige vers le crédit), montant, statut `.pos`/`.neg`/`.muted`, `<details>` « Marquer payée » copié de `/charges/page.tsx` (+ `back`) ; opération : note ou catégorie, compte, montant signé, lien `/accounts/{accountId}/transactions/{id}`.
- `src/app/accounts/layout.tsx` -- lien « Calendrier » ; commentaire de la liste des pages. `src/app/globals.css` -- au plus quelques règles (jour courant).
- Tests : `src/lib/calendar.test.ts` sur le modèle de `charges.test.ts` (TRUNCATE … CASCADE, `today` passé en argument).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/calendar.ts` -- statut, regroupement par jour, à venir, prévisionnel -- logique testable hors page
- [x] `src/app/actions.ts` -- retour au calendrier après paiement
- [x] `src/app/calendrier/*`, `src/app/accounts/layout.tsx`, `src/app/globals.css` -- page et navigation
- [x] `src/lib/calendar.test.ts` -- un test par ligne de la matrice ; tests existants verts

**Acceptance Criteria:**
- Given `/calendrier` à 360 px, when on marque une échéance payée, then la page se recharge sur le même mois avec l’échéance « payée », sans défilement horizontal.
- Given un mois quelconque, when on clique Précédent / Suivant, then le calendrier du mois voisin s’affiche et « À venir » ne change pas.
- Given un non-connecté, when il ouvre `/calendrier`, then il est redirigé vers `/login`.

## Implementation Notes

- `src/lib/calendar.ts` (`chargeStatus`, `getCalendar`) ; `payChargeAction` : `back=calendar` (liste blanche) ; page `/calendrier` en agenda ; lien « Calendrier » ; 2 règles CSS. Aucune modification de `charges.ts`, aucune migration.
- Opération d’un compte archivé affichée sans lien (comme la page du compte) ; compte d’en face d’un virement lu sur le côté IN.
- `npm test` (99), `typecheck`, `build` OK ; `/calendrier` vérifié à 360 px (Playwright, `next dev` sur 3010) : statuts, à venir, prévisionnel, « Marquer payée » → retour au même mois, non-connecté → `/login`.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 0 · low 4 · false 0 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | « voir la dépense » d’une échéance payée → 404 si le compte a été archivé depuis | low | reject | Réel (`transactions/[tid]/page.tsx` : `notFound()` si archivé), lien identique déjà sur `/charges` ; rare (archivage d’un compte portant une charge payée du mois) ; correctif = ajouter `archivedAt` au select de `listMonthCharges`, hors périmètre du calendrier. |
| 2 | Prévisionnel : échéance non payée sur un compte archivé déduite d’aucun compte | low | reject | Réel mais rare (archivage exige solde 0, charge laissée sur le compte) ; correctif = branche supplémentaire ; décision gelée « par compte actif ». |
| 3 | Retour `back=calendar` de `payChargeAction` non testé automatiquement | low | reject | Actions sans tests depuis le socle (même décision qu’aux cycles précédents) ; vérifié au navigateur (retour `/calendrier?m=`). |
| 4 | Aujourd’hui mis en évidence seulement s’il a des éléments | low | reject | Conforme à la lecture gelée (agenda des jours ayant un élément) ; ajouter un jour vide changerait l’état « Rien de prévu » ; « À venir » donne le contexte du jour. |

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur
- Ports 3000/3001 appartiennent à d’autres projets : pour un essai Docker/navigateur, `.env` temporaire avec `APP_PORT=3010`, puis supprimer `.env` et `docker compose down -v` / `docker compose --profile test down -v` (ne jamais toucher aux autres projets ni faire de prune).

**Manual checks (if no CLI):**
- `/calendrier` à 360 px : statuts, opérations, à venir, prévisionnel, « Marquer payée » ; navigation mois.
