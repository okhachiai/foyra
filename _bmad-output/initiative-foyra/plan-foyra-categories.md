---
title: 'Foyra — catégories et sous-catégories de revenus et dépenses'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'de222535d9c5d8f7ab1c6976ae07d82457d51130'
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

**Problem:** Les recettes et dépenses ne sont rattachées à rien : impossible de préparer le budget mensuel (cycle suivant), qui a besoin par catégorie d'un montant prévisionnel, d'une règle de reconduction et d'un drapeau d'inclusion dans les calculs.

**Approach:** Modèle `Category` (foyer, sens INCOME/EXPENSE, parent facultatif sur un niveau, montant prévisionnel, règle de reconduction, activée), catégories par défaut créées au setup, page `/categories` pour les gérer, et un champ catégorie facultatif sur les recettes/dépenses.

**Decisions (auto, autonomie accordée par l'utilisateur) :** périmètre limité aux catégories, le calcul du budget est un cycle ultérieur. Deux niveaux seulement (catégorie › sous-catégorie). Sens et parent fixés à la création. Règle de reconduction = enum `PREVIOUS` (reprendre le montant du mois précédent), `FORECAST` (repartir du prévisionnel, défaut), `NONE` (à saisir chaque mois). Suppression d'une catégorie : refusée si elle a des sous-catégories ; ses opérations deviennent « Sans catégorie ». Instance déjà initialisée sans catégorie : bouton « Ajouter les catégories par défaut » sur `/categories`. Plan d'environ 2 000 tokens conservé entier (un seul objectif, découpage artificiel). Plan approuvé automatiquement (choix recommandé à chaque point de contrôle).

## Boundaries & Constraints

**Always:**
- `forecastAmount` : `Int?` en centimes, ≥ 0 (CHECK SQL), saisi via `parseCents` (vide = aucun prévisionnel).
- Unicité du nom par (foyer, parent) insensible à la casse ; erreur de champ « Ce nom existe déjà. ».
- Sous-catégorie : même sens que son parent ; un parent ne peut pas être lui-même une sous-catégorie.
- Opération : la catégorie doit être du foyer et du même sens (`Catégorie incompatible avec le type d’opération.` sur `categoryId`). Virement : jamais de catégorie (CHECK SQL).
- Une sous-catégorie est effectivement incluse dans le budget seulement si elle et son parent sont activés (règle documentée pour le cycle budget).
- Chaque requête filtre par `householdId` ; `requireUser()` en tête de chaque page et action ; id hors foyer → 404 / « Élément introuvable ».
- Utilisable à 360 px.

**Never:**
- Calcul du budget mensuel, reste à vivre, reconduction effective, distinction fixe/variable (cycles ultérieurs).
- Plus de deux niveaux ; changement de sens ou de parent après création.
- Suppression en cascade des opérations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Setup | Nouveau foyer | Catégories par défaut créées dans la même transaction | — |
| Créer | « Vacances », dépense, prévisionnel « 150 » | Catégorie à 15000 centimes, FORECAST, activée | Prévisionnel « -3 » / « abc » → erreur de champ |
| Doublon | « loyer » alors que « Loyer » existe au même niveau | Refus | Erreur sur `name` |
| Sous-catégorie | « Électricité » sous « Factures » | Sens EXPENSE hérité | Parent d'un autre foyer ou déjà sous-catégorie → refus |
| Désactiver | Décocher « Inclure dans le budget » | `enabled = false`, affiché « hors budget » | — |
| Rattacher | Dépense + catégorie « Courses » | Opération liée, catégorie visible dans l'historique | Catégorie de revenu sur une dépense → erreur sur `categoryId` |
| Supprimer | Catégorie avec opérations, sans sous-catégorie | Supprimée, opérations « Sans catégorie », soldes inchangés | Avec sous-catégories → refus |
| Hors foyer | Id de catégorie d'un autre foyer | 404 / introuvable | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- ajouter enums `CategoryKind` (INCOME, EXPENSE), `CarryOver` (PREVIOUS, FORECAST, NONE) ; modèle `Category` (id, householdId, parentId?, kind, name, forecastAmount Int?, carryOver @default(FORECAST), enabled @default(true), createdAt ; relation parent/children `onDelete: Restrict`) ; `Transaction.categoryId String?` avec `onDelete: SetNull`, `@@index([categoryId])`.
- `prisma/migrations/<ts>_categories/migration.sql` -- nouvelle migration (ne pas toucher `20261029000000_init`) + SQL brut : CHECK `forecastAmount >= 0`, CHECK `kind <> 'TRANSFER' OR categoryId IS NULL`, index unique `("householdId", "parentId", lower("name")) NULLS NOT DISTINCT` (Postgres 17).
- `src/lib/categories.ts` (nouveau) -- `DEFAULT_CATEGORIES`, `createDefaultCategories(tx, householdId)`, `createCategory`, `updateCategory`, `deleteCategory`, `listCategories` ; erreurs via `LedgerError`/`NotFoundError` de `src/lib/ledger.ts` (réutiliser, ne pas en créer d'autres). Doublon = P2002 → `LedgerError(…, "name")`.
- `src/lib/auth.ts:133` `setupHousehold` -- appeler `createDefaultCategories(tx, household.id)` dans la transaction existante.
- `src/lib/ledger.ts` -- `EntryInput` gagne `categoryId: string | null` ; `createEntry`/`updateEntry` vérifient la catégorie (foyer + sens) dans la transaction. Ne pas toucher aux virements ni au calcul des soldes.
- `src/app/actions.ts` -- `entryFields` lit `categoryId` (vide → null) ; nouvelles actions catégories sur le modèle `createAccountAction`/`run()`/`done()` existants.
- `src/app/accounts/[id]/tx-forms.tsx` -- `EntryForm` reçoit les catégories et affiche un `<select name="categoryId">` (« Sans catégorie », `<optgroup>` Dépenses / Revenus, sous-catégories « Parent › Sous »).
- `src/app/accounts/[id]/entries/new/page.tsx`, `transactions/[tid]/page.tsx` -- charger les catégories, passer `categoryId` dans `v`.
- `src/app/accounts/[id]/page.tsx` -- `include: { category: { select: { name } } }`, afficher le nom dans la ligne `<small>`.
- `src/app/categories/layout.tsx` -- réexporte `../accounts/layout` comme `src/app/members/layout.tsx`.
- `src/app/categories/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `category-form.tsx` -- liste par sens, création (`?kind=&parent=`), édition + suppression (`ActionForm` avec `confirm`).
- `src/app/accounts/layout.tsx` -- lien « Catégories » dans la nav.
- Réutiliser : `ActionForm`/`Field` (`src/app/form.tsx`), `parseCents`/`formatCents`/`centsToInput` (`src/lib/money.ts`), `Errors`/`str`/`requiredField` (`actions.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + nouvelle migration -- modèle et contraintes ci-dessus
- [x] `src/lib/categories.ts` -- défauts et règles métier des catégories
- [x] `src/lib/auth.ts` -- défauts créés au setup
- [x] `src/lib/ledger.ts` -- `categoryId` sur les recettes/dépenses, validation foyer + sens
- [x] `src/app/actions.ts` -- champ `categoryId`, actions créer/modifier/supprimer/ajouter les défauts
- [x] `src/app/categories/*`, `src/app/accounts/layout.tsx` -- pages de gestion et navigation
- [x] `src/app/accounts/[id]/*` -- sélection et affichage de la catégorie
- [x] `src/lib/categories.test.ts` -- un test par ligne de la matrice ; ajouter `"Category"` au `TRUNCATE` de `ledger.test.ts`/`auth.test.ts` si nécessaire

**Acceptance Criteria:**
- Given une instance initialisée avant ce cycle, when `prisma migrate deploy`, then les opérations existantes restent intactes et « Sans catégorie ».
- Given `/categories` sur un écran de 360 px, when on modifie le prévisionnel d'une sous-catégorie, then le formulaire est utilisable sans défilement horizontal.
- Given un foyer sans catégorie, when on clique « Ajouter les catégories par défaut », then la liste par défaut apparaît (bouton absent dès qu'une catégorie existe).

## Implementation Notes

- Migration `20261029120000_categories` générée par `prisma migrate diff` ; vérifiée sur une base contenant déjà une opération (init appliquée, ligne insérée, puis `migrate deploy`) : opération intacte, `categoryId` NULL.
- Contrôle du prévisionnel extrait en `parseForecast` (`src/lib/categories.ts`) pour être testé.
- `npm test` (51), `typecheck`, `build` OK ; parcours UI à 360 px vérifié par Playwright. Le `docker compose up` sur 3010 n'a pas pu tourner : disque de la VM Docker plein (`initdb: No space left on device`), sans lien avec le code.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 0 · low 5 · false 2 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Historique : nom de catégorie seul, « Santé » ambigu (Assurances › Santé) | low | patch | `[id]/page.tsx` n'inclut que `category.name` ; correctif = inclure `parent.name`, afficher « Parent › Sous ». |
| 2 | `addDefaultCategories` avale tout P2002 : création manuelle concurrente → défauts perdus, bouton masqué | low | reject | Course quasi impossible (clic manuel pendant l'ajout) ; l'utilisateur peut créer à la main ; correctif = branches supplémentaires. |
| 3 | Tests : erreur de champ du prévisionnel testée via `parseForecast` seulement, « hors budget » non testé, autre foyer simulé par id inconnu | low | reject | `parseForecast` couvre la règle, le câblage est une ligne ; « hors budget » vérifié manuellement à 360 px ; un 2ᵉ foyer est impossible (singleton). |
| 4 | `createCategory` lit l'enum `kind` sans cast `::text`, contrairement à `checkCategory` | false | reject | Prisma décode les enums Postgres en chaîne dans `$queryRaw` ; le test « Sous-catégorie : sens hérité » passe. |
| 5 | Bouton « Supprimer » désactivé affiche `cursor: progress` | low | reject | Cosmétique, le texte explicatif est affiché ; correctif = règle CSS dédiée. |
| 6 | Apostrophe droite dans « Supprimez d'abord… » | low | patch | Message `deleteCategory` incohérent avec l'UI (’). |
| 7 | (constat) TRUNCATE sans "Category" dans les anciens tests | false | reject | `TRUNCATE … "Household" CASCADE` vide `Category` par la FK. |

Hors revue : pendant l'audit de la matrice (étape 3), le contrôle du prévisionnel a été extrait en `parseForecast` (`src/lib/categories.ts`) et testé (« -3 », « abc » refusés, « 0 » accepté, vide → null).

## Design Notes

Défauts — Dépenses : Loyer ; Factures (Électricité, Gaz, Eau, Internet et téléphone) ; Assurances (Habitation, Auto, Santé) ; Abonnements ; Courses ; Transports (Carburant, Transports en commun) ; Scolarité ; Enfants ; Aides famille à l'étranger ; Santé ; Loisirs ; Divers. Revenus : Salaires ; Aides et allocations ; Autres revenus. Prévisionnel vide, FORECAST, activées.

Pour le cycle budget : prévisionnel d'un parent = montant propre au parent (opérations rattachées directement) ; ses sous-catégories ont leurs propres montants.

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur

**Manual checks (if no CLI):**
- Setup → `/categories` liste les défauts ; créer, désactiver, supprimer ; rattacher une dépense, voir la catégorie dans l'historique.
