---
title: 'Foyra — permissions d’accès par compte pour chaque membre du foyer'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: 'e29caa2b25b7d9a263f29a16ff527741019e1a88'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tout membre voit et modifie tous les comptes du foyer, leurs opérations et tout ce qui en découle (budget, charges, crédits, calendrier, tableau de bord) : aucune confidentialité entre membres.

**Approach:** Table `AccountAccess` (membre, compte, `READ`/`WRITE` ; absence = aucun accès). L’admin voit et gère tout et règle l’accès de chaque membre sur `/members/[id]`. Un unique helper serveur (`src/lib/access.ts`) produit la portée (`Scope`) de l’utilisateur ; toutes les fonctions de lecture et d’écriture de `src/lib` qui touchent un compte prennent cette portée à la place de `householdId` et filtrent / refusent en conséquence.

**Decisions (auto, autonomie accordée par l’utilisateur) :** « gestion avancée des membres » séparée au contrôle multi-objectif (choix recommandé « Split ») et traitée dans un second cycle. Migration : chaque membre `MEMBER` existant reçoit `WRITE` sur chaque compte existant du foyer (choix recommandé). Nouveau compte : accès `WRITE` pour son créateur s’il est membre, aucun pour les autres membres (l’admin l’ouvre ensuite). Nouveau membre : aucun accès tant que l’admin n’en donne pas. Tout utilisateur peut encore créer un compte. Pas d’accès → 404 / « Élément introuvable » (aucune fuite d’existence) ; accès en lecture seule → erreur « Accès en lecture seule sur ce compte. ». Catégories et montants prévus du budget restent communs au foyer (non liés à un compte), modifiables par tous. Charge fixe / crédit visibles si leur compte est lisible, modifiables, supprimables, payables et remboursables par anticipation seulement si leur compte est en écriture. Page d’édition (opération, virement, saisie, compte) d’un compte en lecture seule → 404 ; liens d’écriture masqués. Nom du compte d’en face d’un virement non lisible affiché « compte non partagé ». Plan ≈ 2 300 tokens (> 1 600) conservé entier : « Keep full plan » (un seul objectif transverse, découpage artificiel). Aucune question ouverte. Plan approuvé automatiquement (« Approve and continue »).

## Boundaries & Constraints

**Always:**
- Vérification côté serveur dans la couche `src/lib` (lecture et écriture), via le seul helper `src/lib/access.ts` ; aucune vérification ad hoc dans les pages ou actions, aucun accès Prisma direct aux comptes / opérations depuis `src/app` sans passer par la portée.
- Admin = portée complète (tous les comptes du foyer). Écriture ⇒ lecture.
- Écriture refusée hors comptes `WRITE` : saisie, modification (compte d’origine ET compte cible), suppression, virement (les deux comptes), archivage / modification de compte, marquer payé, remboursement anticipé, création / modification / suppression de charge ou de crédit.
- Soldes, solde global, budget (effectué, hors calcul), charges, crédits, calendrier (opérations, échéances, à venir, prévisionnel) et tableau de bord ne comptent que les comptes lisibles.
- Toujours filtrer aussi par `householdId` ; montants, verrous et transactions SQL existants inchangés.

**Never:** désactivation de membre, changement de rôle, mot de passe (cycle suivant) ; permissions sur catégories ou montants prévus ; vérification seulement côté UI ; modification des migrations existantes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration | Base avec 1 admin, 1 membre, 2 comptes, opérations | Le membre a `WRITE` sur les 2 comptes ; rien ne change pour lui | — |
| Aucun accès | Membre sans accès à Épargne | Épargne absente de `/accounts`, solde global, tableau de bord, prévisionnel ; `/accounts/{épargne}` et ses opérations → 404 | Action sur Épargne → « Élément introuvable » |
| Lecture | Membre `READ` sur Courant | Courant, son solde et son historique visibles ; pas de boutons d’écriture | Saisie / modification / suppression / archivage → « Accès en lecture seule sur ce compte. » |
| Virement | `WRITE` Courant, `READ` Épargne | Virement Courant → Épargne refusé | Erreur sur le champ du compte concerné |
| Déplacer une opération | Opération de Courant (`WRITE`) vers Épargne (aucun accès) | Refus | « Élément introuvable » |
| Budget | Dépenses 50 € sur Courant (lisible) et 80 € sur Épargne (non lisible), même catégorie | Effectué de la catégorie = 50 € pour le membre, 130 € pour l’admin | — |
| Charges / crédits | Loyer et crédit prélevés sur Épargne (non lisible) | Absents de `/charges`, `/credits`, `/calendrier`, budget (fixe, à payer) et tableau de bord du membre ; `/charges/{id}`, `/credits/{id}` → 404 | Marquer payé / anticipé / suppression → « Élément introuvable » |
| Charge en lecture | Charge sur Courant `READ` | Visible, statut affiché | Marquer payée / modifier → « Accès en lecture seule sur ce compte. » |
| Nouveau compte | Membre crée « Perso » | Le membre a `WRITE` ; les autres membres ne le voient pas ; l’admin le voit | — |
| Réglage admin | Admin passe un membre de `WRITE` à aucun accès sur Courant | Au rechargement suivant, Courant disparaît pour ce membre | Membre cible admin ou d’un autre foyer → 404 |
| Non-admin | Membre ouvre `/members/{id}` ou appelle l’action de réglage | Redirection `/tableau-de-bord` / refus | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- enum `AccessLevel { READ WRITE }` ; modèle `AccountAccess` (userId, accountId, level ; `@@id([userId, accountId])` ; relations `User`/`Account` `onDelete: Cascade` ; `@@index([accountId])`) ; back-relations `User.accountAccess`, `Account.access`.
- `prisma/migrations/20261101000000_account_access/migration.sql` -- via `prisma migrate diff` (modèle : migrations précédentes) + `INSERT … SELECT` des paires (membre `MEMBER`, compte du même foyer) en `WRITE`. Ne pas toucher les migrations existantes.
- `src/lib/access.ts` (nouveau, seul point de contrôle) -- `type Scope = { householdId; read: string[] | null; write: string[] | null }` (null = tous) ; `fullScope(householdId)` (admin, tests) ; `getScope(user)` (admin → complet, sinon lit `AccountAccess`) ; `readable(scope)` / `writable(scope)` → fragment Prisma `{}` ou `{ in: ids }` à poser sur `accountId` / `id` ; `assertWritable(scope, accountId, field)` → `NotFoundError` si illisible, `LedgerError("Accès en lecture seule sur ce compte.", field)` si lecture seule ; `getAccess(householdId, memberId)` et `setAccess(householdId, memberId, Map<accountId, AccessLevel | null>)` (membre `MEMBER` du foyer, comptes du foyer, sinon `NotFoundError`).
- `src/lib/ledger.ts` -- remplacer `householdId: string` par `scope: Scope` dans `balances`, `accountBalance`, `listAccounts`, `householdTotal`, `getAccount`, `lockActiveAccounts` (+ `assertWritable` pour chaque compte : couvre `createEntryTx`, `updateEntry`, `deleteTransaction`, virements, `archiveAccount`, `payCharge`, `prepay`), `getTransaction` / `getTransfer` (opération d’un compte lisible), `createEntry`, `updateEntry`, `deleteTransaction`, `create/update/deleteTransfer`, `archiveAccount`. Nouveaux : `createAccount(scope, userId, data)` (créateur `MEMBER` → `WRITE`, même transaction), `updateAccount(scope, id, data)` (écriture, non archivé), `writableAccounts(scope)` (actifs en écriture, pour les `<select>`).
- `src/lib/charges.ts` -- `checkRefs`, `listMonthCharges`, `getCharge`, `createCharge`, `updateCharge`, `deleteCharge`, `payCharge` prennent `scope` ; filtre `accountId` lisible ; `checkRefs` exige l’écriture sur le compte saisi ; `updateCharge` / `deleteCharge` : `where` avec `accountId` en écriture.
- `src/lib/loans.ts` -- même traitement (`fixedCharge.accountId`) pour `createLoan`, `updateLoan` (compte actuel et nouveau en écriture), `deleteLoan`, `getLoan`, `listLoans`, `prepay`.
- `src/lib/budget.ts` -- `getBudget(scope, month)` : `groupBy` des opérations filtrés sur comptes lisibles, `listMonthCharges(scope, …)`. `ensureMonth`, `savePlanned`, `summarize` inchangés (householdId).
- `src/lib/calendar.ts` -- `getCalendar(scope, …)` : opérations des comptes lisibles ; un virement apparaît une fois (côté OUT si lisible, sinon côté IN) ; compte d’en face non lisible → `null` affiché « compte non partagé ».
- `src/lib/dashboard.ts` -- `getDashboard(scope, today)` ; passe la portée.
- `src/app/actions.ts` -- chaque action : `const scope = await getScope(await requireUser())` puis appels lib avec `scope` ; `createAccountAction` / `updateAccountAction` → `createAccount` / `updateAccount` ; nouvelle `saveAccessAction` (`requireAdmin`, champs `access:<accountId>` = `NONE|READ|WRITE`) → `done("/members")`.
- `src/app/**/page.tsx` -- remplacer `user.householdId` par la portée pour tout appel lib et tout `prisma.account.findMany` (→ `writableAccounts`) ; `accounts/[id]/load.ts` : `loadAccount(scope, id, "READ" | "WRITE")` (404) — `WRITE` pour `edit`, `entries/new`, `transfers/new`, `transactions/[tid]` ; `accounts/[id]/page.tsx` : boutons et liens d’édition seulement si écriture ; requête de l’historique inchangée (compte déjà vérifié), nom du compte d’en face filtré par lecture ; `transactions/[tid]` : virement dont l’autre côté n’est pas en écriture → affiché en lecture seule comme le cas « compte archivé » existant ; `/charges`, `/calendrier`, `/credits/[id]` : « Marquer payée », modification, anticipé masqués sans écriture (le serveur refuse de toute façon).
- `src/app/members/page.tsx` (lien par membre `MEMBER`) ; `src/app/members/[id]/page.tsx` (nouveau, `requireAdmin`) -- un `<select>` Aucun accès / Lecture / Écriture par compte (archivés compris), `ActionForm` vers `saveAccessAction`.
- Tests existants (`src/lib/*.test.ts`) : passer `fullScope(hh)` à la place de `hh` pour les fonctions modifiées ; comportement inchangé pour l’admin.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma`, `prisma/migrations/20261101000000_account_access/migration.sql` -- modèle + migration avec accès par défaut
- [x] `src/lib/access.ts` -- portée, contrôles, réglage des accès
- [x] `src/lib/ledger.ts`, `charges.ts`, `loans.ts`, `budget.ts`, `calendar.ts`, `dashboard.ts` -- portée dans toutes les lectures et écritures liées à un compte
- [x] `src/app/actions.ts` -- portée dans chaque action, `createAccount`/`updateAccount`, `saveAccessAction`
- [x] `src/app/**` -- pages sur la portée, 404 en écriture, liens d’écriture masqués, `/members/[id]`
- [x] `src/lib/access.test.ts` -- un test par ligne de la matrice (sauf « Non-admin », vérifiée au navigateur) : membre sans accès → `NotFoundError` / exclusion pour comptes, opérations, virements, budget, charges, crédits, calendrier, tableau de bord ; lecture seule → refus d’écriture ; migration testée en rejouant son `INSERT … SELECT` ; tests existants adaptés et verts

**Acceptance Criteria:**
- Given un membre connecté sans accès à un compte, when il ouvre chaque page (`/tableau-de-bord`, `/accounts`, `/budget`, `/charges`, `/calendrier`, `/credits`) ou l’URL directe du compte, de ses opérations, charges et crédits, then le compte et ses montants n’apparaissent nulle part et les URL directes renvoient 404.
- Given un admin, when il règle les accès d’un membre sur `/members/{id}` à 360 px, then le formulaire est utilisable sans défilement horizontal et le réglage est appliqué au rechargement du membre.
- Given une base existante, when `docker compose up` applique la migration, then les membres existants voient et modifient tous les comptes comme avant.

## Implementation Notes

- `access.ts` exporte aussi `canRead` / `canWrite` (affichage conditionnel des liens d’écriture dans les pages) et `READ_ONLY`.
- Le contrôle d’accès de `lockActiveAccounts` passe avant la lecture SQL : un compte illisible ne révèle pas son état archivé.
- Calendrier : champ `toAccount` renommé `otherAccount` (vaut le compte d’en face côté OUT comme côté IN ; null si non lisible).
- Charge / crédit en lecture seule : `/charges/{id}` affiche un message au lieu du formulaire ; `/credits/{id}` masque anticipé, modification, suppression ; liens « voir la dépense » masqués sans écriture (la page d’édition renverrait 404).
- Migration testée en rejouant son `INSERT … SELECT` (access.test.ts) ; `docker compose up` sur base neuve : migration appliquée.
- Navigateur à 360 px (Playwright, `docker compose` sur 3010) : `/members/{id}` sans défilement horizontal, niveaux enregistrés relus ; membre « Bob » (lecture Courant, rien sur Épargne) : Épargne absente des six pages, URL directes Épargne et pages d’édition Courant → 404, aucun bouton d’écriture ; Bob sur `/members/{id}` → `/tableau-de-bord`.
- Après revue : migration complète appliquée (`prisma migrate deploy`) sur une base au schéma précédent contenant 1 admin, 1 membre, 2 comptes → le membre reçoit `WRITE` sur les 2 comptes, l’admin aucune ligne. `npm test` (115), `typecheck`, `build` OK.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 0 · low 3 · false 1 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `deleteCategory` sans portée : remet à « Sans catégorie » des opérations de comptes illisibles ; message « utilisée par une charge fixe » compte les charges de tout le foyer | low | reject | Réel, mais décision gelée : catégories communes au foyer, modifiables par tous ; le détachement (`SetNull`) est la règle de suppression de catégorie, aucun montant ni solde exposé. Correctif = branches de contrôle par compte dans `categories.ts` ; cas rare. |
| 2 | Critère « base existante » non démontré (test rejoue seulement l’`INSERT`, Docker sur base neuve) | low | reject | Lacune de vérification, pas de défaut : migration complète appliquée par `prisma migrate deploy` sur une base au schéma précédent avec données → membre `WRITE` sur chaque compte (voir Implementation Notes). |
| 3 | Portée lue avant la transaction : une écriture en cours peut aboutir juste après une révocation | low | reject | Course étroite (révocation pendant la requête) ; le plan promet l’effet « au rechargement suivant ». Correctif = relire `AccountAccess` sous verrou dans chaque écriture. |
| 4 | 360 px de `/members/{id}` et ligne « Non-admin » non vérifiés | false | reject | Vérifiés au navigateur par l’implémenteur (pas de défilement horizontal, membre redirigé vers `/tableau-de-bord`) ; consigné dans Implementation Notes. |

## Design Notes

Portée passée explicitement (pas de contexte implicite) : une fonction lib qui touche un compte ne peut pas être appelée sans elle, le typage empêche l’oubli. Le contrôle d’écriture vit dans `lockActiveAccounts` (déjà appelé, sous verrou, par toutes les écritures du grand livre) et `checkRefs` (charges / crédits) ; les lectures filtrent par `readable(scope)`.

```ts
// access.ts
export const readable = (s: Scope) => (s.read ? { in: s.read } : undefined); // where: { householdId, accountId: readable(s) }
```

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur
- `grep -rn "householdId" src/app` -- expected: plus aucun appel lib touchant comptes / opérations avec `user.householdId` (seulement catégories, budget prévu, membres)
- Docker : `.env` temporaire `APP_PORT=3010`, `docker compose up -d --build` (migration appliquée), puis supprimer `.env`, `docker compose down -v`, `docker compose --profile test down -v` ; ne jamais toucher aux autres projets ni faire de prune.

**Manual checks (if no CLI):**
- Navigateur (Playwright, soumission via `element.click()` en evaluate) : admin crée un membre, lui donne Courant en lecture et rien sur Épargne ; connecté en membre : pages listées ci-dessus, 404 directs, refus d’écriture, 360 px.
