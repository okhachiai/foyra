---
title: 'Foyra — budget mensuel : reconduction, montants prévus modifiables, totaux et reste à vivre'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'ea3ded0a635fca75f98305a96f2ad4387b25703d'
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

**Problem:** Les catégories portent un prévisionnel et une règle de reconduction, mais rien ne construit le budget d'un mois ni ne compare le prévu au réel : impossible de savoir ce qui reste à payer et ce qui reste pour vivre.

**Approach:** Une ligne de budget par (catégorie, mois) avec le montant prévu, créée automatiquement à la première ouverture du mois selon la règle de reconduction ; page `/budget?m=AAAA-MM` qui affiche et permet de modifier les montants prévus, et calcule à chaque affichage les totaux, le disponible par catégorie et le reste à vivre.

**Decisions (auto, autonomie accordée par l'utilisateur) :** un seul objectif, pas de découpage. Le mois est « matérialisé » (lignes créées) à sa première ouverture, quel que soit le mois ; les lignes déjà créées ne sont jamais réécrites par la reconduction (instantané). Reconduction : `PREVIOUS` = montant prévu de la ligne la plus récente avant ce mois, sinon le prévisionnel ; `FORECAST` = prévisionnel ; `NONE` = vide (« à saisir »). Montant prévu vide compte pour 0. Calculs côté serveur à chaque affichage et après chaque enregistrement (pas de recalcul JavaScript pendant la saisie). Opérations sans catégorie ou de catégories exclues : hors calculs, leur total est seulement signalé. Reste à vivre = Σ revenus max(prévu, perçu) − Σ dépenses max(prévu, effectué) (fin de mois projetée). Plan d'environ 2 300 tokens conservé entier (un seul objectif, découpage artificiel). Plan approuvé automatiquement (« Approve and continue », choix recommandé à chaque point de contrôle).

## Boundaries & Constraints

**Always:**
- Mois M = opérations avec `occurredOn` dans [1ᵉʳ M, 1ᵉʳ M+1[ (colonne date, déjà jour calendaire du foyer) ; mois courant par défaut = `todayIn(household.timezone)`. Jamais `createdAt`.
- Catégorie incluse = `enabled` et (pas de parent ou parent `enabled`). Seules les incluses entrent dans les totaux et s'affichent avec un champ de saisie.
- Réel d'une catégorie = somme des recettes/dépenses de cette catégorie (pas les sous-catégories : chacune a sa ligne) ; virements jamais comptés. Comptes archivés compris.
- Montants en centimes `Int`, prévu ≥ 0 (CHECK SQL), saisie via `parseForecast` (vide = à saisir).
- Création des lignes idempotente et sûre en concurrence (unique (catégorie, mois) + `skipDuplicates`).
- Chaque requête filtre par `householdId` ; `requireUser()` en tête de page et d'action ; id de catégorie hors foyer ignoré à l'enregistrement.
- Utilisable à 360 px.

**Never:**
- Charges fixes/variables, crédits, calendrier, tableau de bord, permissions par compte.
- Modifier le prévisionnel ou la règle de la catégorie depuis le budget ; réécrire un mois déjà créé lors de la reconduction.
- Stocker un total calculé.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| FORECAST | Courses, prévisionnel 400 €, ouverture de novembre | Prévu 400 € | — |
| PREVIOUS | Loyer PREVIOUS, octobre prévu 950 € (modifié), prévisionnel 900 € | Novembre prévu 950 € | Aucune ligne antérieure → 900 € |
| NONE | Énergie NONE, prévisionnel 80 € | Prévu vide « à saisir », compte 0 | — |
| Instantané | Novembre déjà ouvert, puis prévisionnel modifié | Novembre inchangé | Double ouverture simultanée → une seule ligne |
| Modifier | Prévu Courses « 450 » | 45000 centimes, totaux recalculés | « -3 », « abc » → erreur sur le champ |
| Bornes du mois | Dépense le 31/10 et le 01/11 | Comptées respectivement en octobre et novembre | — |
| Exclusion | Catégorie désactivée, ou sous-catégorie d'un parent désactivé | Absente des totaux et du formulaire | — |
| Totaux | Revenus prévus 3 000 / perçus 2 500 ; dépenses Loyer prévu 950 effectué 950, Courses prévu 400 effectué 150 | Restant à payer 250 ; disponible Courses 250 ; reste à vivre 3 000 − 1 350 = 1 650 | Dépassement : disponible négatif affiché en rouge, restant à payer 0 |
| Hors calcul | Dépense sans catégorie, virement | Hors totaux ; total sans catégorie signalé | — |
| Mois invalide | `?m=2026-13` | Mois courant | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- modèle `BudgetLine` (id, householdId, categoryId, month `@db.Date` = 1ᵉʳ du mois, planned `Int?`, `@@unique([categoryId, month])`, `@@index([householdId, month])`) ; relation `Category` `onDelete: Cascade` (la suppression d'une catégorie emporte ses lignes) ; back-relations sur `Household`/`Category`.
- `prisma/migrations/<ts>_budget/migration.sql` -- via `prisma migrate diff` + SQL brut : CHECK `planned >= 0`, CHECK `EXTRACT(DAY FROM month) = 1`. Ne pas toucher les migrations existantes.
- `src/lib/budget.ts` (nouveau) -- `parseMonth("AAAA-MM")`, `ensureMonth(householdId, month)` (création des lignes manquantes selon la règle), `getBudget(householdId, month)` (catégories incluses + prévu + réel + totaux), `savePlanned(householdId, month, Map<categoryId, number|null>)`, et une fonction pure `summarize(...)` testable. Réel : un `groupBy` Prisma ou `$queryRaw` sur `Transaction` (`categoryId`, `occurredOn` dans le mois).
- `src/lib/categories.ts` -- réutiliser `listCategories` (parents + enfants), `parseForecast`. `src/lib/ledger.ts` -- `todayIn`, `parseDay`, `LedgerError`. `src/lib/money.ts` -- `formatCents`, `centsToInput`.
- `src/app/actions.ts` -- `saveBudgetAction` : champs `planned:<categoryId>`, erreurs de champ via `Errors`, puis `done("/budget?m=…")`.
- `src/app/budget/layout.tsx` -- réexporte `../accounts/layout` (comme `categories/layout.tsx`). `src/app/budget/page.tsx` -- navigation mois précédent/suivant, bloc totaux (classe `.total`), sections Revenus/Dépenses en `.list`, `ActionForm` avec un champ prévu par catégorie (« Parent › Sous »), réel, disponible.
- `src/app/accounts/layout.tsx` -- lien « Budget » dans la nav. `src/app/globals.css` -- seulement si nécessaire pour la grille 360 px.
- Tests : modèle `src/lib/categories.test.ts` (TRUNCATE … CASCADE vide aussi `BudgetLine` via la FK foyer).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + nouvelle migration -- modèle et contraintes ci-dessus
- [x] `src/lib/budget.ts` -- reconduction, enregistrement, calculs
- [x] `src/app/actions.ts` -- action d'enregistrement du budget
- [x] `src/app/budget/*`, `src/app/accounts/layout.tsx` -- page budget et navigation
- [x] `src/lib/budget.test.ts` -- un test par ligne de la matrice

**Acceptance Criteria:**
- Given une instance avec catégories et opérations existantes, when `prisma migrate deploy`, then rien n'est modifié et le premier affichage de `/budget` crée le mois courant.
- Given `/budget` à 360 px, when on modifie un montant prévu et enregistre, then la page se recharge sur le même mois avec les totaux recalculés, sans défilement horizontal.
- Given deux membres, when l'un modifie un prévu, then l'autre voit le nouveau montant après rechargement.

## Implementation Notes

- Migration `20261029180000_budget` (via `prisma migrate diff`). Lignes créées pour toutes les catégories (désactivées comprises) ; seules les incluses sont affichées et comptées. PREVIOUS : si la ligne antérieure la plus récente est vide, le mois reste vide.
- `npm test` (61), `typecheck`, `build` OK ; page vérifiée à 360 px par Playwright (erreur de champ, enregistrement, navigation, `?m=2026-13`).
- Après revue : champs inchangés ignorés à l'enregistrement (`orig:<id>`), `parseMonth` borné à 2000–2099 / 01–12. 61 tests, typecheck, build OK ; `docker compose up` sur 3010 : 3 migrations appliquées, `/budget` → `/login`.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 1 · low 6 · false 1 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Enregistrement d'une page périmée : toutes les valeurs chargées sont réécrites, l'édition d'un autre membre est perdue | medium | patch | `savePlanned` fait un `updateMany` par champ reçu, sans comparer ; correctif = champ caché `orig:<id>`, valeurs inchangées ignorées. |
| 2 | `parseMonth` accepte toute année : `?m=0000-01` → 500, `?m=0050-03` crée des lignes et `addMonths` saute à 1950 | low | patch | Regex `^\d{4}-\d{2}$` + `parseDay` ; `Date.UTC` lit 0–99 comme 1900+ ; correctif = regex bornée (2000–2099, mois 01–12). |
| 3 | Erreur de champ « -3 »/« abc » testée via `parseForecast` seulement, pas via `saveBudgetAction` | low | reject | Règle couverte par `parseForecast` ; câblage d'une ligne, comme au cycle catégories. |
| 4 | « Id hors foyer ignoré » sans assertion ni second foyer réel | low | reject | Instance à foyer unique (`Household.singleton`) ; le filtre `householdId` est dans le `where` de `updateMany`. |
| 5 | Disponible par catégorie (prévu − effectué) non testé | low | reject | Calcul d'une ligne dans `page.tsx`, vérifié dans le navigateur ; restant à payer et dépassement testés via `summarize`. |
| 6 | Repli sur le mois courant pour `?m` invalide non testé | low | reject | Une expression dans `page.tsx` ; vérifié dans le navigateur (`?m=2026-13`). |
| 7 | PREVIOUS reconduit un prévu vide au lieu du prévisionnel | false | reject | Conforme à la décision figée : « ligne la plus récente avant ce mois, sinon le prévisionnel » — le repli ne vaut qu'en l'absence de ligne ; un montant effacé reste effacé. |
| 8 | Lignes vides parasites dans la migration | low | reject | Cosmétique, même forme que la migration catégories générée par `prisma migrate diff`. |

## Design Notes

Totaux affichés : revenus prévus / perçus ; dépenses prévues / effectuées ; restant à payer = Σ dépenses max(prévu − effectué, 0) ; reste à vivre (formule affichée en petit). Par catégorie de dépense : prévu, effectué, disponible = prévu − effectué. Par catégorie de revenu : prévu, perçu.

Reconduction PREVIOUS, requête indicative :
```sql
SELECT DISTINCT ON ("categoryId") "categoryId", "planned" FROM "BudgetLine"
WHERE "householdId" = $1 AND "month" < $2 ORDER BY "categoryId", "month" DESC
```

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur

**Manual checks (if no CLI):**
- `/budget` : totaux cohérents avec la matrice, navigation mois, modification d'un prévu, affichage à 360 px.
