# Partage au prorata — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lier comptes et budget : propriétaire des comptes, charges/opérations/lignes communes ou personnelles, partage des dépenses communes au prorata des salaires, enveloppes avec réserve, ajustement de solde.

**Architecture:** Migrations additives. Calculs dans des fonctions pures (`src/lib/split.ts`, `envelopes` dans `src/lib/budget.ts`) testées sans base ; chargeurs Prisma à côté, testés contre la base de test. Le calcul du partage tourne en portée foyer complète, l'affichage est filtré selon les droits du lecteur.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Prisma 6 + Postgres 17, Vitest (base `db-test` : `docker compose --profile test up -d db-test`), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-29-budget-comptes-partage-design.md` (phase A uniquement ; phase B = plan séparé).

## Écarts au spec (constatés dans le code)

- Les charges fixes et crédits ne sont **pas** des lignes de budget : la page budget les lit en direct (`listMonthCharges`). Donc **pas de `BudgetItem.accountId`** : le lien compte ↔ budget passe par `FixedCharge.accountId` (existant), `Account.ownerId` et les drapeaux `shared`.
- `getScope` ignore aujourd'hui le rôle : l'admin n'a pas accès à tout. L'utilisateur l'exige → tâche 1.

## Global Constraints

- Montants en centimes `Int` ; aucun flottant stocké.
- Textes d'interface en français, ton existant (« Charge commune », « Dépense commune », « Réserve imprévus », « Ajuster le solde », « Reste à virer »).
- Aucune nouvelle dépendance npm.
- Migrations additives avec défauts ; sans réglage, comportement identique à aujourd'hui (tous comptes `ownerId = null` → tout commun).
- Compte commun (`ownerId = null`) ⇒ toute charge / opération dessus est `shared = true` (forcé côté serveur, case masquée côté formulaire).
- Commentaires : densité et style des fichiers existants (JSDoc courte en français).
- Tests : `npm test` ; typage : `npm run typecheck`.

## Review Focus

1. Foyer sans aucun revenu saisi ni prévu (total revenus = 0) → partage à parts égales, pas de division par zéro.
2. Recettes communes > dépenses communes → `commonNet = 0`, chacun « a avancé » sa contribution (reste à virer négatif), pas de part négative.
3. Arrondi : Σ dus = `commonNet` exactement au centime (ex. 100,01 € à 1/3–2/3).
4. Ligne de revenu du budget : son réel ne doit pas tomber à 0 parce que les salaires arrivent sur un compte perso (`shared = false`) — le filtre `shared` ne s'applique qu'aux lignes de dépense.
5. Membre non-admin qui ne lit pas les comptes perso de l'autre → ne voit ni son revenu ni son reste perso (champs `null`), mais voit part %, dû, contribution, reste à virer.

---

### Task 1: L'admin voit et gère tous les comptes

**Files:**
- Modify: `src/lib/access.ts:26-34` (`getScope`)
- Test: `src/lib/access.test.ts`

**Interfaces:**
- Produces: `getScope(user: { id: string; householdId: string; role?: Role }): Promise<Scope>` — `role === "ADMIN"` → `fullScope(user.householdId)`. Les appelants existants passent déjà l'utilisateur de session (qui porte `role`).

- [ ] **Step 1: Test** `it("Admin : portée complète, même sur un compte privé d'un membre")` — un membre crée un compte (`createAccount(await member(), memberId, …)`, partage `SELECTED`) ; `getScope({ id: adminId, householdId: hh, role: "ADMIN" })` → `read`, `write`, `manage` valent `null` ; `getAccount(adminScope, compteMembre)` ne lève pas.
- [ ] **Step 2:** `npm test -- access` → FAIL.
- [ ] **Step 3:** Implémenter (première ligne de `getScope`).
- [ ] **Step 4:** `npm test` → PASS (vérifier qu'aucun test existant ne supposait l'inverse ; s'il y en a, il appelait `getScope` sans `role` et reste valide).
- [ ] **Step 5: Commit** `feat: l'admin du foyer a accès à tous les comptes`

### Task 2: Schéma — propriétaire et drapeaux commun / réserve

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261105000000_shared_split/migration.sql`

**Interfaces:**
- Produces (Prisma) :
  - `Account.ownerId String?` → `User` (relation `owner`, `onDelete: SetNull`), `User.ownedAccounts Account[]`, `@@index([ownerId])`
  - `FixedCharge.shared Boolean @default(true)`
  - `Transaction.shared Boolean @default(true)`
  - `BudgetItem.shared Boolean @default(true)`, `BudgetItem.reserve Boolean @default(false)`
  - SQL : `CREATE UNIQUE INDEX "BudgetItem_one_reserve" ON "BudgetItem"("budgetId") WHERE "reserve";`

- [ ] **Step 1:** Modifier le schéma, commentaire d'une ligne par champ (style existant : « // null = compte commun (joint) ; distinct des droits »).
- [ ] **Step 2:** `npx prisma migrate dev --create-only --name shared_split`, renommer le dossier en `20261105000000_shared_split`, ajouter l'index partiel à la main.
- [ ] **Step 3:** `npx prisma migrate dev` puis `npm run typecheck` → OK ; `npm test` → PASS (aucun comportement changé).
- [ ] **Step 4: Commit** `feat: schéma — propriétaire de compte, drapeaux commun et réserve`

### Task 3: Règles d'écriture commun / personnel

**Files:**
- Modify: `src/lib/ledger.ts` (`createAccount`, `updateAccount`, `EntryInput`, `createEntryTx`, `updateEntry`)
- Modify: `src/lib/charges.ts` (`ChargeInput`, `createCharge`, `updateCharge`, `payCharge`)
- Test: `src/lib/ledger.test.ts`, `src/lib/charges.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `AccountData` gagne `ownerId?: string | null`. `createAccount` : `ownerId` absent → créateur (`userId`) ; `null` explicite → commun. `ownerId` non-null doit être un utilisateur du foyer, sinon `NotFoundError`.
  - `updateAccount(scope, id, data, month: Date)` : si `ownerId` change, dans la même transaction SQL, les opérations du compte `occurredOn ∈ [month, month+1)`, `kind ∈ {INCOME, EXPENSE}`, **sans** `fixedPayment` passent à `shared = (nouveau ownerId === null)`. Mois antérieurs inchangés.
  - `EntryInput` gagne `shared?: boolean`. Écriture : `shared = account.ownerId === null ? true : (input.shared ?? false)`. Lire `ownerId` dans `lockActiveAccounts` (ajouter la colonne au `SELECT … FOR UPDATE`).
  - `ChargeInput` gagne `shared: boolean` ; forcé `true` si le compte est commun (lire `ownerId` dans `checkRefs`).
  - `payCharge` : l'opération créée a `shared = charge.shared`.

- [ ] **Step 1: Tests (ledger)** :
  - `"Compte créé : propriétaire = créateur par défaut, null si commun"`.
  - `"Dépense sur compte commun : toujours commune, même avec shared=false"`.
  - `"Dépense sur compte perso : personnelle par défaut, commune si demandé"`.
  - `"Changer le propriétaire : opérations du mois en cours basculent, mois précédent et paiements de charge inchangés"` — compte commun, dépense oct. + dépense nov. + paiement de charge nov. ; `updateAccount(…, { ownerId: adminId }, nov)` → nov. `shared=false`, oct. `shared=true`, paiement `shared=true`.
- [ ] **Step 2: Tests (charges)** : `"Charge sur compte commun : shared forcé à true"` ; `"Paiement d'une charge personnelle : opération shared=false"`.
- [ ] **Step 3:** `npm test -- ledger charges` → FAIL.
- [ ] **Step 4:** Implémenter. Mettre à jour les appelants de `createCharge`/`updateCharge` dans les tests existants (`shared: true`) et de `updateAccount` (passer le mois).
- [ ] **Step 5:** `npm test` → PASS ; `npm run typecheck` → OK.
- [ ] **Step 6: Commit** `feat: dépenses et charges communes ou personnelles selon le propriétaire du compte`

### Task 4: Budget — réel filtré par commun/perso, réserve, enveloppes

**Files:**
- Modify: `src/lib/budget.ts` (`Item`, `strip`, `ItemFields`, `getBudget`, nouvelle `envelopes`)
- Test: `src/lib/budget.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `Item` gagne `shared: boolean; reserve: boolean`. `strip` les recopie (reprise du mois). `fromTemplates` : `shared: true, reserve: false`. `ItemFields` gagne `shared`, `reserve` (sous-ligne : forcés aux valeurs du parent dans `saveItems` ; deux réserves → `LedgerError("Une seule réserve par budget.")` via `P2002`).
  - `getBudget` : `groupBy(["categoryId", "shared"])` ; réel d'une ligne **EXPENSE** = sommes de sa catégorie avec `shared === ligne principale.shared` ; ligne **INCOME** = toutes (comportement actuel).
  - `envelopes(tree: (Node & { actual: number })[]): { lines: Envelope[]; reserve: Reserve | null }` avec `Envelope = { id: string; label: string; planned: number; actual: number; left: number }`, `Reserve = Envelope & { overrun: number }`. Lignes = principales `EXPENSE`, `included`, `shared`, catégorie non fixe, non réserve. `overrun = Σ max(actual − planned, 0)` ; `reserve.left = planned − actual − overrun`.

- [ ] **Step 1: Tests purs** : `"enveloppes : dépassement absorbé par la réserve"` — Courses 300 €/réel 250 €, Sorties 0 €/réel 50 €, Réserve 88,56 € → Courses `left 5000`, Sorties `left -5000`, réserve `overrun 5000`, `left 3856`. `"enveloppes : lignes perso, fixes et exclues ignorées"`. `"reprise : shared et reserve recopiés"`.
- [ ] **Step 2: Test base** : `"réel : courses perso ne débordent pas l'enveloppe commune ; revenu perso compté sur la ligne de revenu"`.
- [ ] **Step 3:** `npm test -- budget` → FAIL.
- [ ] **Step 4:** Implémenter.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat: budget — réel commun/perso, réserve imprévus, enveloppes`

### Task 5: Calcul du partage au prorata

**Files:**
- Create: `src/lib/split.ts`, `src/lib/split.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`listMonthCharges`, `getBudget`, `fullScope`, `canRead`).
- Produces:
  ```ts
  export type SplitInput = {
    members: { id: string; name: string }[];      // utilisateurs actifs propriétaires d'au moins un compte non archivé
    income: Record<string, number>;               // INCOME catégorisées du mois sur ses comptes
    forecast: Record<string, number>;             // charges INCOME du mois sur ses comptes (si income = 0)
    commonIncome: number;                         // INCOME catégorisées du mois sur comptes communs
    plannedCommon: number;                        // charges EXPENSE shared du mois + lignes EXPENSE principales incluses shared (total)
    toCommon: Record<string, number>;             // virements OUT de ses comptes vers un compte commun
    paidCommon: Record<string, number>;           // EXPENSE shared sur ses comptes
    spentPersonal: Record<string, number>;        // EXPENSE non shared sur ses comptes
  };
  export type MemberSplit = {
    userId: string; name: string; income: number | null; forecast: boolean; shareBp: number; // 0–10000
    due: number; contribution: number; toTransfer: number; personalLeft: number | null;
  };
  export type Split = { commonNet: number; members: MemberSplit[] };
  export function splitMonth(i: SplitInput): Split;
  export async function getSplit(householdId: string, month: Date): Promise<Split>;          // portée complète
  export function visibleSplit(split: Split, viewer: { id: string; role: Role }, scope: Scope, ownedBy: Record<string, string[]>): Split;
  ```
  Règles : revenu retenu = `income` si > 0 sinon `forecast` (`forecast: true`). `commonNet = max(plannedCommon − commonIncome, 0)`. Total revenus 0 → parts égales. `due` arrondi au centime, reliquat au plus gros revenu (premier en ordre de `members` à égalité). `contribution = toCommon + paidCommon`. `toTransfer = due − contribution`. `personalLeft = revenu retenu − due − spentPersonal`. `visibleSplit` : admin ou soi-même → tout ; autre membre dont tous les comptes (`ownedBy[userId]`) sont lisibles (`canRead`) → tout ; sinon `income` et `personalLeft` à `null`.

- [ ] **Step 1: Tests purs** :
  - `"prorata 60/40 avec facture commune payée en perso"` — revenus 3000/2000 €, commun 2400 € → dus 1440/960 € ; A a payé 110 € en perso → `toTransfer` 1330 €.
  - `"arrondi : somme des dus exacte"` — commun 100,01 €, revenus 1000/2000 € → Σ due = 10001.
  - `"sans revenu : parts égales"`.
  - `"recettes communes > dépenses : commonNet 0, reste à virer négatif"`.
  - `"revenu prévisionnel utilisé tant qu'aucun salaire n'est saisi"` (`forecast: true`).
  - `"visibleSplit : membre sans lecture des comptes de l'autre → revenu et reste perso masqués"`.
- [ ] **Step 2: Test base** `"getSplit : virement perso → commun compté en contribution ; ajustements sans catégorie ignorés"`.
- [ ] **Step 3:** `npm test -- split` → FAIL.
- [ ] **Step 4:** Implémenter `splitMonth` (pur), `getSplit` (requêtes Prisma `fullScope`, réutilise `listMonthCharges` et `getBudget`), `visibleSplit`.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat: partage des dépenses communes au prorata des revenus`

### Task 6: Ajuster le solde

**Files:**
- Modify: `src/lib/ledger.ts`
- Test: `src/lib/ledger.test.ts`

**Interfaces:**
- Produces: `adjustBalance(scope: Scope, userId: string, accountId: string, target: number, occurredOn: Date): Promise<Transaction | null>` — écart nul → `null` ; sinon `createEntryTx` (INCOME si target > solde, EXPENSE sinon), montant = |écart|, `note: "Ajustement de solde"`, `categoryId: null`, `shared` selon la règle de Task 3. Verrou du compte avant lecture du solde (dans la même transaction).

- [ ] **Step 1: Tests** `"ajuster le solde : crée l'écart, rien si égal"` (solde 1000 €, cible 950 € → EXPENSE 5000, `accountBalance` = 95000 ; seconde fois → `null`).
- [ ] **Step 2:** FAIL → implémenter → `npm test` PASS.
- [ ] **Step 3: Commit** `feat: ajustement du solde d'un compte`

### Task 7: Formulaires — propriétaire, commun, ajustement

**Files:**
- Modify: `src/app/accounts/account-form.tsx`, `src/app/accounts/[id]/edit/page.tsx`, `src/app/accounts/[id]/page.tsx`, `src/app/accounts/[id]/tx-forms.tsx`, `src/app/charges/charge-form.tsx`, `src/app/actions.ts`

**Interfaces:**
- Consumes: Tasks 3, 6.
- Produces:
  - `AccountForm({ account, members, canSetOwner })` : `<select name="ownerId">` « Commun (joint) » + membres actifs ; défaut à la création = utilisateur courant. Modifiable si admin ou `canManage`.
  - `EntryForm` : case `name="shared"` « Dépense commune » affichée si le compte choisi a un propriétaire (passer `ownerId` des comptes ; masquage côté client par `data-owner` + CSS `:has()`, pas de JS).
  - `ChargeForm` : case « Charge commune » (cochée par défaut), même masquage.
  - Page compte : `<details>` « Ajuster le solde » (champ `target` montant, date du jour) → `adjustBalanceAction`.
  - Page compte : `?virement=<toAccountId>&montant=<centimes>` ouvre `TransferForm` pré-rempli (`from` = ce compte, `to`, `v.amount`).
  - Actions : `entryFields` lit `shared: fd.has("shared")` ; `chargeFields` idem ; `updateAccountAction` passe `parseMonth(todayIn(tz).slice(0, 7))` ; nouvelle `adjustBalanceAction`.

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npm run typecheck` → OK ; `npm test` → PASS.
- [ ] **Step 3: Vérification manuelle** (`npm run dev`) : créer un compte perso, saisir une dépense avec et sans « Dépense commune », vérifier en base (`npx prisma studio`) ; ajuster un solde ; changer le propriétaire d'un compte.
- [ ] **Step 4: Commit** `feat: formulaires — propriétaire du compte, dépense et charge communes, ajustement de solde`

### Task 8: Page budget et tableau de bord — Partage et Enveloppes

**Files:**
- Modify: `src/app/budget/page.tsx`, `src/app/tableau-de-bord/page.tsx`, `src/app/actions.ts` (`budgetAction` : champs `shared`, `reserve` par ligne)

**Interfaces:**
- Consumes: Tasks 4, 5.
- Produces:
  - Ligne de budget dépense (principale) : cases « Commune » (`${id}:shared`) et « Réserve » (`${id}:reserve`).
  - Bloc **Partage** (après les `Stat`) : `getSplit` → `visibleSplit` ; par membre : revenu (ou « — » si masqué, mention « prévu » si `forecast`), part %, dû, déjà contribué, reste à virer ; si `toTransfer > 0` et le lecteur peut écrire sur un compte perso du membre, lien « Préparer le virement » → `/accounts/<son premier compte perso>?virement=<premier compte commun>&montant=<toTransfer>`. Masqué s'il n'y a ni compte commun ni deux membres propriétaires.
  - Bloc **Enveloppes** : `envelopes(budget.tree)` ; tableau libellé / prévu / réel / restant (négatif en `text-neg`) + ligne réserve (« dont dépassements absorbés »).
  - Tableau de bord : carte « Reste à virer » par membre (même données, `visibleSplit`), masquée si aucun budget.

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npm run typecheck` → OK ; `npm test` → PASS.
- [ ] **Step 3: Vérification manuelle** avec deux utilisateurs (admin + membre) : compte joint commun, un compte perso chacun, salaires saisis, une charge commune payée en perso → le bloc Partage affiche les montants de l'exemple du spec ; connecté en membre sans accès au compte perso de l'admin → revenu et reste perso de l'admin masqués.
- [ ] **Step 4: Commit** `feat: budget — blocs Partage et Enveloppes, reste à virer au tableau de bord`
