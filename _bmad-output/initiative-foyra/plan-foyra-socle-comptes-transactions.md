---
title: 'Foyra — socle auto-hébergé : foyer, utilisateurs, comptes, transactions, virements'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: '7f1a4c4026a18f72953fb670999103ff9e6dff16'
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

**Problem:** Foyra n'existe pas encore. Tous les modules prévus (catégories, budget, crédits, calendrier, tableau de bord, permissions) reposent sur un socle commun : un foyer, ses membres, ses comptes et leurs transactions.

**Approach:** Application web auto-hébergée (Docker Compose + PostgreSQL), responsive. Un foyer unique par instance, plusieurs utilisateurs authentifiés, des comptes (courant, épargne, espèces, autre), des revenus/dépenses/virements, les soldes par compte et le solde global.

**Decisions:** stack Next.js + TypeScript + Prisma + PostgreSQL. Pas d'inscription publique : l'admin crée les membres. Une devise par foyer (EUR par défaut). Interface en français uniquement. Un seul foyer par instance. L'utilisateur a demandé de valider automatiquement les plans avec les choix recommandés.

## Boundaries & Constraints

**Always:**
- Montants en `Int` (centimes), toujours > 0 (contrainte CHECK en base) ; le sens découle de `kind`. Jamais de flottant.
- Solde = solde initial (peut être négatif) + somme signée des transactions. Jamais stocké. Découvert autorisé et affiché.
- Date d'opération `occurredOn` (`@db.Date`, saisie, défaut = aujourd'hui dans `Household.timezone`, Europe/Paris). Jamais dériver un mois de `createdAt`.
- Virement : deux lignes liées par `transferId`, même montant ; création, modification et suppression toujours en bloc dans `prisma.$transaction`, jamais un seul côté.
- Compte archivé : aucune nouvelle saisie ni virement ; archivage refusé si solde ≠ 0.
- Sessions : jeton aléatoire stocké haché en base, expiration 30 j renouvelée, déconnexion supprime la session, cookie httpOnly `SameSite=Lax`, `Secure` piloté par `COOKIE_SECURE`. Mots de passe argon2. Connexion limitée par IP et email.
- `requireUser()` (lecture en base) au début de chaque page, Server Action et route handler ; le middleware ne fait que rediriger en l'absence de cookie.
- Chaque requête filtre par `householdId`.
- `docker compose up` : Postgres avec healthcheck, app démarrée après `service_healthy`, `prisma migrate deploy` puis `node server.js`, données dans un volume.
- Utilisable à 360 px de large.

**Never:**
- Catégories, budget mensuel, crédits, calendrier, tableau de bord avancé, permissions par compte, gestion avancée des membres (voir `deferred-work.md`).
- Aucun service externe au runtime (auth SaaS, télémétrie, CDN).
- Suppression d'un compte ou d'un utilisateur qui a des transactions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Premier démarrage | Base vide | `/` redirige vers `/setup` : création foyer + admin | Une fois initialisé, `/setup` redirige vers `/login` ; deux setups simultanés → un seul foyer |
| Dépense | Courant 1 000,00 €, dépense 45,50 € | Solde 954,50 € | Montant ≤ 0, vide ou > 2 décimales → erreur sur le champ |
| Saisie montant | « 1 234,56 », « 12.5 », « 12,5 » | 123456, 1250, 1250 centimes | « abc », « -3 », « 1,234 » → refus |
| Découvert | Courant 10 €, dépense 30 € | Solde -20,00 € affiché | — |
| Virement | Courant 954,50 €, 200 € vers Épargne | Courant 754,50 €, Épargne +200 €, total inchangé | Même compte source/cible → refus |
| Virement en échec | 2ᵉ insertion échoue (compte cible invalide) | Aucune ligne enregistrée | Rollback, message d'erreur |
| Modifier un virement | Montant 200 → 150 | Les deux côtés passent à 150 | — |
| Supprimer un virement | Suppression depuis un des comptes | Les deux côtés supprimés | — |
| Modifier une dépense | 45,50 → 50,00 | Solde recalculé | — |
| Archiver | Compte à 0 € | Masqué des listes et du total, historique conservé | Solde ≠ 0 → refus |
| Saisie sur archivé | Dépense ou virement vers un compte archivé | Refus | Message d'erreur |
| Hors foyer | Id d'un objet inexistant ou d'un autre foyer | 404 | Pas de fuite d'existence |
| Non connecté | Page ou action sans session valide | Redirection `/login` / 401 | — |
| Connexion | 10 échecs rapprochés | Connexion bloquée temporairement | Message neutre |

</frozen-after-approval>

## Code Map

Projet vierge. Arborescence prévue :

- `docker-compose.yml`, `Dockerfile` (node Debian-slim, CLI Prisma copié dans l'image), `docker-entrypoint.sh`, `.env.example`
- `prisma/schema.prisma` -- Household (name, currency, timezone), User (email, passwordHash, role ADMIN/MEMBER), Session (tokenHash, expiresAt), Account (kind, name, initialBalance, archivedAt), Transaction (kind INCOME/EXPENSE/TRANSFER, amount, occurredOn, note, transferId?, accountId, householdId, createdById, createdAt, updatedAt) ; `categoryId`/`status` ajoutés plus tard par migration
- `prisma/migrations/*` -- migration initiale + SQL brut : CHECK amount > 0
- `src/lib/money.ts` -- `parseCents`, `formatCents` (fr-FR, U+202F)
- `src/lib/auth.ts` -- argon2, sessions, `requireUser()`, `requireAdmin()`, limitation des tentatives (en mémoire)
- `src/middleware.ts` -- redirection si pas de cookie, rien d'autre
- `src/lib/ledger.ts` -- `accountBalance`, `householdTotal`, `createTransfer`, `updateTransfer`, `deleteTransfer`, `archiveAccount`
- `src/app/setup`, `src/app/login` -- initialisation, connexion, déconnexion
- `src/app/accounts/*` -- liste + total, détail + historique paginé (50, `occurredOn desc, createdAt desc`), formulaires
- `src/app/members` -- l'admin crée un membre

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig.json`, `next.config.ts` -- Next.js (output standalone, `serverActions.allowedOrigins` via `APP_URL`), Prisma, argon2, Vitest
- [x] `prisma/schema.prisma` + migration initiale -- modèle ci-dessus, CHECK en SQL brut
- [x] `src/lib/money.ts` -- parse/format en centimes
- [x] `src/lib/auth.ts`, `src/middleware.ts` -- sessions, gardes, limitation
- [x] `src/lib/ledger.ts` -- règles financières et virements atomiques
- [x] `src/app/setup`, `src/app/login` -- setup transactionnel (refus si un foyer existe), connexion, déconnexion
- [x] `src/app/accounts/*` -- CRUD comptes, archivage, saisie/modification/suppression des transactions et virements, historique
- [x] `src/app/members` -- création de membre par l'admin
- [x] `src/lib/*.test.ts` -- un test par ligne de la matrice, sur un vrai Postgres (`DATABASE_URL_TEST`, service `db-test` dans compose)
- [x] `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`, `.env.example`, `README.md` -- déploiement, sauvegarde `pg_dump`

**Acceptance Criteria:**
- Given une machine avec Docker, when `cp .env.example .env && docker compose up -d`, then `/` redirige vers `/setup`.
- Given des données saisies, when `docker compose down && docker compose up -d`, then les données sont intactes.
- Given un écran de 360 px, when on saisit une dépense, then le formulaire est utilisable sans zoom ni défilement horizontal.
- Given deux membres du foyer, when l'un ajoute une transaction, then l'autre la voit après rechargement.
- Given une session expirée ou supprimée, when on appelle une Server Action avec l'ancien cookie, then elle est refusée.

## Implementation Notes

- Versions figées : Next.js 15.5.28, React 19.2.9, Prisma 6.19.3 (Prisma 7/8 et Next 16 écartés : changements de rupture), `@node-rs/argon2` (binaires précompilés, pas de node-gyp), Vitest 3.2.7.
- Sens des virements : colonne `transferSide` (OUT/IN) en plus de `kind = TRANSFER`, indispensable puisque `amount` est toujours > 0. CHECK SQL : `kind = TRANSFER` ⇔ `transferId` non nul ⇔ `transferSide` non nul ; `@@unique([transferId, transferSide])`.
- Foyer unique : colonne `Household.singleton` unique + CHECK = true ; un setup concurrent échoue en P2002 → redirection `/login`.
- Écritures du grand livre dans des transactions interactives qui verrouillent les comptes (`SELECT … FOR UPDATE`, ordre trié) : pas de saisie concurrente pendant un archivage. Un compte archivé est en lecture seule (ni saisie, ni modification, ni suppression de ses lignes).
- Renouvellement de session (< 15 j restants) uniquement quand le cookie peut être réécrit (Server Action), pour garder cookie et base alignés.
- Pas de route handler : la déconnexion est une Server Action. Les Server Actions renvoient « Élément introuvable » (sans distinction) pour un id hors foyer ; les pages renvoient 404.
- Formulaires : `useActionState` + soumission via `onSubmit` pour conserver la saisie en cas d'erreur de champ.
- Compose : `POSTGRES_PASSWORD` par défaut `foyra` (base non exposée sur l'hôte) ; ports `APP_PORT`/`APP_BIND` configurables ; `db-test` sous le profil `test` (tmpfs, port 5433).

## Plan Change Log

- 2026-10-29 : ajout de `Transaction.transferSide` et `User.name` au modèle (non listés dans la Code Map, nécessaires au calcul du solde et à l'affichage).

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 3 · low 2 · false 0 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Erreur « compte archivé » invisible (champ sans `<Field>`) | medium | patch | `run()` renvoie `fields.accountId`, `ActionForm` n'affiche que `state.error` ; EntryForm/archive/suppression n'ont pas ce champ. |
| 2 | Virement dont l'autre côté est archivé reste modifiable | medium | patch | `[tid]/page.tsx:15` ne teste que le compte courant ; `TransferForm` reçoit seulement les comptes actifs. |
| 3 | Limite par IP contournable / clé `unknown` partagée | medium | patch | `actions.ts:104` prend la 1ʳᵉ entrée X-Forwarded-For (fournie par le client), repli `unknown` commun. Correctif : entrée la plus à droite, pas de clé IP si inconnue. Résiduel différé (proxy de confiance). |
| 4 | Ligne lue avant le verrou des comptes | low | patch | `deleteTransaction` lit hors `$transaction`, les autres avant `lockActiveAccounts` ; correctif = relire après verrou, trivial. |
| 5 | Renouvellement de session absent en simple navigation | low | reject | Conforme au plan (renouvelé quand le cookie peut être réécrit) ; 30 j sans aucune action = rare, correctif ajoute de la complexité. |

## Verification

**Commands:**
- `npm test` -- expected: tous les tests passent (Postgres de test démarré)
- `npm run build` -- expected: build sans erreur
- `docker compose up -d --build && curl -sI localhost:3000/` -- expected: redirection vers `/setup`

**Manual checks (if no CLI):**
- Parcours : setup, 2 comptes, dépense, virement, modification du virement, archivage refusé puis accepté à 0 €, soldes et total corrects
