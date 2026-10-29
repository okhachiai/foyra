---
title: 'Foyra — tableau de bord : combien avons-nous, combien reste-t-il à payer, combien pouvons-nous dépenser'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'b49b5e714291558b3ea310a5845b4fb906e72d2e'
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

**Problem:** Après connexion, le foyer arrive sur la liste des comptes : pour savoir ce qu’il a, ce qu’il doit encore payer ce mois et ce qu’il peut encore dépenser, il doit croiser Comptes, Charges, Calendrier et Budget.

**Approach:** Page `/tableau-de-bord` (page d’accueil après connexion, mois courant du foyer) en trois blocs — « Combien avons-nous ? » (solde global + par compte actif), « Combien devons-nous encore payer ? » (échéances non payées du mois : charges fixes et crédits, retards en tête), « Combien pouvons-nous dépenser ? » (reste à vivre, disponible par catégorie de dépense, dépassements) — plus un formulaire rapide « Nouvelle opération » (compte, dépense/recette, catégorie, montant, date) qui revient au tableau de bord. Tout est recalculé côté serveur à chaque affichage en réutilisant `listAccounts`, `getBudget`, `listMonthCharges` (via `getBudget`) et `chargeStatus`.

**Decisions (auto, autonomie accordée par l’utilisateur) :** un seul objectif, pas de découpage. Route `/tableau-de-bord` ; `/`, la connexion et la création du foyer y mènent ; lien de marque et premier lien de nav « Tableau de bord ». Mois = mois courant du foyer (`todayIn`), pas de navigation de mois. Reste à payer = Σ montants des échéances non payées du mois (en retard + à payer), toutes charges confondues (catégorie exclue du budget comprise) ; retards = statut `late` de `chargeStatus`. Disponible par catégorie = prévu − effectué (même règle que `/budget`, extraite en une fonction partagée) ; affichées : catégories de dépense incluses ayant un prévu ou un effectué non nul, dépassements (disponible < 0) en tête et en rouge. Reste à vivre = `totals.restToLive` de `getBudget`. Saisie rapide : formulaire `EntryForm` existant avec choix du compte (comptes actifs) et retour `back=dashboard` (liste blanche) ; aucun compte actif → lien « Créer un compte ». Pas de websocket. Plan d’environ 2 400 tokens (> 1 600) conservé entier : « Keep full plan », un seul objectif, découpage artificiel. Aucune question ouverte. Plan approuvé automatiquement (« Approve and continue »).

## Boundaries & Constraints

**Always:**
- Aucune logique d’argent dupliquée : soldes de `listAccounts`, budget/totaux de `getBudget`, échéances de `listMonthCharges` (renvoyées par `getBudget`), statut de `chargeStatus`.
- Lecture seule hors saisie via `createEntryAction` ; aucune migration, aucun total stocké.
- `requireUser()` en tête, filtre `householdId` ; utilisable à 360 px sans défilement horizontal.

**Never:** permissions par compte, websocket/polling, graphiques, navigation de mois, « Marquer payée » sur le tableau de bord (lien vers `/calendrier`), modification des règles de calcul de `/budget`, `/charges`, `/calendrier`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Soldes | Courant 1 000 €, Épargne 500 €, compte archivé (0 €) | Global 1 500 € ; deux comptes listés, l’archivé absent | — |
| À payer | Aujourd’hui 10/11 ; Loyer 950 € jour 5 payé, Assurance 80 € jour 8, Internet 30 € jour 20 | Reste à payer 110 € ; 1 retard (Assurance 80 €) en tête, Internet « à payer » | — |
| Crédit | Crédit, échéance du mois non payée | Compté dans le reste à payer avec le montant de l’échéance (assurance incluse) | — |
| Disponible | Courses prévu 400 €, effectué 450 € ; Transport prévu 100 €, effectué 20 € ; Loisirs prévu vide, rien dépensé | Courses −50 € « dépassement » en tête, Transport 80 € ; Loisirs absent | — |
| Reste à vivre | Budget du mois | Égal au reste à vivre affiché sur `/budget` du même mois | — |
| Saisie rapide | Dépense 40 € Courses sur Courant depuis le tableau de bord | Retour `/tableau-de-bord`, solde Courant et disponible Courses recalculés | Montant invalide → erreur sous le champ, saisie conservée |
| Vide | Foyer neuf sans compte | Solde 0 €, « Rien à payer ce mois-ci », lien « Créer un compte » à la place du formulaire | — |

</frozen-after-approval>

## Code Map

- `src/lib/ledger.ts` -- `listAccounts` (soldes, `archivedAt`), `todayIn`, `parseDay`, `formatDay` : réutiliser, ne pas modifier.
- `src/lib/budget.ts` -- `getBudget(householdId, month)` : ajouter `charges` (le résultat de `listMonthCharges` déjà chargé) à l’objet renvoyé ; exporter `available(r: BudgetRow) = (r.planned ?? 0) - r.actual`. Ne rien changer d’autre.
- `src/lib/calendar.ts` -- `chargeStatus(c, today)` : réutiliser tel quel.
- `src/lib/dashboard.ts` (nouveau) -- `getDashboard(householdId, today)` : comptes actifs + total ; `getBudget` du mois de `today` → `unpaid` (échéances non payées avec statut, ordre de `listMonthCharges`), `toPay`, `late` (nombre + montant), `restToLive`, `categories` (lignes EXPENSE avec prévu ou effectué non nul, `available`, triées : dépassements d’abord).
- `src/app/budget/page.tsx` -- remplacer le calcul inline du disponible par `available(r)`.
- `src/app/accounts/[id]/tx-forms.tsx` `EntryForm` -- prop optionnelle `accounts` : `<select name="accountId">` des comptes actifs au lieu du champ caché + `<input type="hidden" name="back" value="dashboard">`.
- `src/app/actions.ts` -- `createEntryAction` : `back === "dashboard"` → `done("/tableau-de-bord")` ; `setupAction`/`loginAction` → `done("/tableau-de-bord")`.
- `src/app/page.tsx` -- redirection `/tableau-de-bord` si le foyer existe.
- `src/app/tableau-de-bord/layout.tsx` (réexporte `../accounts/layout`), `page.tsx` -- trois sections `.total` / `.list` (modèles : `accounts/page.tsx`, `calendrier/page.tsx` pour `STATUS`/date, `budget/page.tsx`), liens vers `/accounts/{id}`, `/calendrier`, `/budget` ; `<details>` « Nouvelle opération » avec `EntryForm` (catégories de `listCategories`, date du jour).
- `src/app/accounts/layout.tsx` -- marque → `/tableau-de-bord`, lien « Tableau de bord » en tête ; mettre à jour le commentaire.
- Tests : `src/lib/dashboard.test.ts` sur le modèle de `calendar.test.ts` (TRUNCATE … CASCADE, `today` passé en argument).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/budget.ts`, `src/app/budget/page.tsx` -- `charges` dans le retour de `getBudget`, `available` partagé
- [x] `src/lib/dashboard.ts` -- agrégation des trois questions
- [x] `src/app/accounts/[id]/tx-forms.tsx`, `src/app/actions.ts` -- choix du compte et retour au tableau de bord ; redirections après connexion/création
- [x] `src/app/tableau-de-bord/*`, `src/app/page.tsx`, `src/app/accounts/layout.tsx` -- page et navigation
- [x] `src/lib/dashboard.test.ts` -- un test par ligne de la matrice couvrable en lib ; tests existants verts

**Acceptance Criteria:**
- Given un utilisateur qui se connecte, when la connexion réussit, then il arrive sur `/tableau-de-bord` ; `/` y mène aussi.
- Given `/tableau-de-bord` à 360 px, when on saisit une dépense via « Nouvelle opération », then la page se recharge avec soldes et disponibles à jour, sans défilement horizontal.
- Given un non-connecté, when il ouvre `/tableau-de-bord`, then il est redirigé vers `/login`.

## Implementation Notes

- `getBudget` renvoie aussi `charges` ; `available(r)` partagé avec `/budget` ; `src/lib/dashboard.ts` (`getDashboard`) n’agrège que `listAccounts`, `getBudget`, `chargeStatus`. `EntryForm` : prop `accounts` (choix du compte + `back=dashboard`). Connexion, création du foyer, `/` et `requireAdmin` mènent à `/tableau-de-bord`.
- Formulaire rapide indexé sur le solde global (`key={d.total}`) : vidé après une saisie réussie, conservé sur erreur.
- `npm test` (104), `typecheck`, `build` OK ; vérifié à 360 px (Playwright, `next start` sur 3010) : non-connecté → `/login`, état vide, saisie 40 € → soldes/disponible/reste à vivre à jour, erreur de champ, connexion et `/` → tableau de bord, pas de défilement horizontal. `docker compose up` sur 3010 : `/tableau-de-bord` non connecté → `/login`, `/` → `/setup`.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 0 · low 7 · false 0 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `requireAdmin` (`auth.ts:75`) renvoie encore un membre vers `/accounts` au lieu de l’accueil | low | patch | Réel ; correction directe d’une chaîne → `/tableau-de-bord`. |
| 2 | Le tableau de bord crée les lignes du mois (`ensureMonth` via `getBudget`) : pas strictement en lecture seule | low | reject | Conséquence voulue de la réutilisation de `getBudget` (décision gelée) ; création idempotente, identique à l’ouverture de `/budget`. |
| 3 | `monthLabel`, `frDay`, `STATUS` copiés de `calendrier/page.tsx` | low | reject | Affichage, pas de logique d’argent ; extraire un module pour 3 lignes ajoute plus qu’il n’enlève. |
| 4 | Solde global recalculé par `reduce` au lieu de `householdTotal` | low | reject | Même règle (actifs), même résultat que `/accounts` ; `householdTotal` relancerait `listAccounts`. |
| 5 | Remise à zéro du formulaire liée à `key={d.total}` : saisie concurrente qui annule exactement le total → valeurs conservées | low | reject | Cas improbable (deux saisies simultanées de sens opposé au centime près) ; correctif = état supplémentaire. |
| 6 | Ligne « Saisie rapide » de la matrice sans test automatique | low | reject | Actions sans tests depuis le socle ; vérifiée au navigateur (retour, soldes et disponible recalculés, erreur de champ). |
| 7 | Test « Vide » ne vérifie pas `categories` ni `restToLive` | low | reject | Lacune de test, aucun défaut ; les deux valeurs viennent de `getBudget`, déjà testé. |

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur
- Ports 3000/3001 appartiennent à d’autres projets : pour un essai Docker/navigateur, `.env` temporaire avec `APP_PORT=3010`, puis supprimer `.env` et `docker compose down -v` / `docker compose --profile test down -v` (ne jamais toucher aux autres projets ni faire de prune).

**Manual checks (if no CLI):**
- `/tableau-de-bord` à 360 px : trois blocs cohérents avec `/accounts`, `/calendrier`, `/budget` ; saisie rapide ; connexion → tableau de bord.
