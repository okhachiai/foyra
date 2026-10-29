---
title: 'Foyra — gestion avancée des membres : désactivation, rôle, dernier admin, mot de passe, réinitialisation CLI'
type: 'feature'
ticket: ''
created: '2026-10-29'
status: 'built'
baseline_revision: '51e42af69c4dd82b5bf44ad5fc6385519ad0b582'
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

**Problem:** L’admin peut seulement créer des membres : impossible de couper l’accès d’un membre qui quitte le foyer, de changer un rôle, ni de garantir qu’il reste un admin. Un utilisateur ne peut pas changer son mot de passe et un mot de passe perdu (y compris celui de l’unique admin) ne se récupère pas.

**Approach:** Sur `/members/[id]`, l’admin change le rôle et désactive / réactive un utilisateur, sans jamais laisser le foyer sans admin actif. Page « Mon compte » (`/profil`) pour changer son propre mot de passe. Script CLI `npm run reset-password` (utilisable via `docker compose exec app npm run reset-password`) qui génère un nouveau mot de passe provisoire.

**Decisions (auto, autonomie accordée par l’utilisateur) :** objectif unique (séparé des permissions par compte au cycle précédent). « Retirer » = désactiver (pas de suppression d’utilisateur, règle du socle). Désactivation : sessions supprimées, connexion refusée (message neutre habituel), réactivation possible, accès aux comptes conservés. Interdit : désactiver ou rétrograder le dernier admin actif ; désactiver son propre compte. Rétrograder soi-même autorisé s’il reste un autre admin actif. Rétrogradé en membre → aucun accès aux comptes tant que l’admin n’en donne pas (comme un nouveau membre). Changement de mot de passe : mot de passe actuel exigé, nouveau ≥ 8 caractères + confirmation ; les autres sessions de l’utilisateur sont supprimées, la session courante est conservée. Script CLI : email en argument ou demandé, nouveau mot de passe aléatoire affiché une seule fois, toutes les sessions supprimées, compte non réactivé. Pas de réinitialisation par l’admin dans l’interface. Plan ≈ 2 100 tokens (> 1 600) conservé entier : « Keep full plan » (un seul objectif). Aucune question ouverte. Plan approuvé automatiquement (« Approve and continue »).

## Boundaries & Constraints

**Always:**
- Contrôle du dernier admin dans une transaction qui verrouille les admins actifs du foyer (`FOR UPDATE`) : deux rétrogradations simultanées ne peuvent pas laisser zéro admin.
- Utilisateur désactivé refusé partout côté serveur : `checkCredentials` (temps comparable), `findSession` / `requireUser`.
- Mots de passe argon2 via `hashPassword` / `verifyPassword` ; jamais journalisés ni stockés en clair.
- Actions admin via `requireAdmin()` ; utilisateur cible du foyer sinon 404 / « Élément introuvable » ; filtre `householdId`.
- Utilisable à 360 px ; interface en français.

**Never:** suppression d’utilisateur ; réinitialisation de mot de passe par l’admin dans l’interface ; changement d’email ; e-mail de récupération ; modification des migrations existantes ou du contrôle d’accès par compte.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Désactiver | Admin désactive le membre Bob (connecté) | Session de Bob supprimée ; prochaine requête → `/login` ; connexion refusée | Message neutre de connexion |
| Réactiver | Admin réactive Bob | Bob se reconnecte avec son mot de passe ; ses accès aux comptes sont intacts | — |
| Dernier admin | Un seul admin actif, il se rétrograde | Refus | « Le foyer doit garder au moins un admin actif. » |
| Deux admins | A rétrograde B | B devient membre sans accès aux comptes ; `/members` lui est refusé | — |
| Soi-même | Admin désactive son propre compte | Refus | « Vous ne pouvez pas désactiver votre propre compte. » |
| Concurrence | Deux admins se rétrogradent l’un l’autre en même temps | Une seule réussit | L’autre reçoit le refus « dernier admin » |
| Mot de passe | Actuel correct, nouveau « nouveau123 » ×2 | Enregistré ; autres sessions supprimées, session courante conservée | Actuel faux → erreur sur le champ ; < 8 ou confirmation différente → erreur sur le champ |
| CLI | `reset-password bob@x.fr` | Nouveau mot de passe affiché ; sessions supprimées ; connexion OK avec lui | Email inconnu → message d’erreur, code de sortie ≠ 0, rien modifié |
| Hors foyer | Id inconnu sur `/members/{id}` ou dans les actions | 404 / « Élément introuvable » | — |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- `User.disabledAt DateTime?`. Migration `prisma/migrations/20261102000000_member_management/migration.sql` via `prisma migrate diff` (modèle : migrations précédentes).
- `src/lib/auth.ts` -- `findSession` : session d’un utilisateur désactivé → supprimée, null ; `checkCredentials` : désactivé → null après vérification (temps comparable) ; nouveaux `setRole(householdId, actorId, userId, role)`, `setDisabled(householdId, actorId, userId, disabled)` (transaction : verrou des admins actifs, refus dernier admin / soi-même en `LedgerError`, cible hors foyer `NotFoundError` de `ledger.ts` ; désactivation supprime les sessions ; rétrogradation supprime les `AccountAccess` de l’utilisateur), `changePassword(userId, current, next)` (vérifie l’actuel, supprime les autres sessions en gardant celle du cookie courant ; `LedgerError(…, "current")`). Réutiliser `hashPassword`, `verifyPassword`, `sha256`, `SESSION_COOKIE`.
- `src/lib/access.ts` -- `getAccess` / `findMember` : la page doit charger tout utilisateur du foyer ; garder l’exigence `MEMBER` pour `setAccess`. Ne rien changer d’autre.
- `src/app/actions.ts` -- `setRoleAction`, `setDisabledAction` (`requireAdmin`, `run()`, `done("/members/{id}")`) ; `changePasswordAction` (`requireUser`, champs `current`, `password`, `confirm` ; réutiliser `passwordField`, `Errors`, `run`) → `done("/profil?ok=1")` ou message de succès.
- `src/app/members/page.tsx` -- lien vers `/members/{id}` pour chaque utilisateur ; mention « désactivé ». `src/app/members/[id]/page.tsx` -- bloc rôle (select + bouton), bloc désactiver / réactiver (`ActionForm` avec `confirm`), section accès aux comptes seulement si `MEMBER` (existante).
- `src/app/profil/layout.tsx` (réexporte `../accounts/layout`), `src/app/profil/page.tsx` -- nom, email, formulaire de mot de passe (`autocomplete` `current-password` / `new-password`). `src/app/accounts/layout.tsx` -- lien « Mon compte ».
- `scripts/reset-password.mjs` (nouveau) -- `@prisma/client` + `hash` de `@node-rs/argon2` (mêmes options que `hashPassword`), `randomBytes` → mot de passe provisoire ; email via `process.argv[2]` ou `readline`. `package.json` : `"reset-password": "node scripts/reset-password.mjs"`. `Dockerfile` (runner) : `COPY --from=build /app/scripts ./scripts` ; vérifier que le `package.json` du standalone contient le script, sinon le copier. `README.md` : section « Mot de passe oublié ».
- Tests : `src/lib/members.test.ts` sur le modèle de `auth.test.ts` (mock `next/headers`, TRUNCATE … CASCADE).

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration -- `disabledAt`
- [x] `src/lib/auth.ts`, `src/lib/access.ts` -- désactivation, rôle, dernier admin, mot de passe
- [x] `src/app/actions.ts`, `src/app/members/*`, `src/app/profil/*`, `src/app/accounts/layout.tsx` -- actions et écrans
- [x] `scripts/reset-password.mjs`, `package.json`, `Dockerfile`, `README.md` -- CLI de réinitialisation
- [x] `src/lib/members.test.ts` -- un test par ligne de la matrice (CLI : logique testée ou vérifiée dans Docker) ; tests existants verts

**Acceptance Criteria:**
- Given l’instance Docker, when `docker compose exec app npm run reset-password admin@x.fr`, then un nouveau mot de passe s’affiche et permet de se connecter, l’ancien non.
- Given `/profil` et `/members/{id}` à 360 px, when on change son mot de passe ou un rôle, then les formulaires sont utilisables sans défilement horizontal et les erreurs s’affichent sous le champ.
- Given un membre (non admin), when il ouvre `/members/{id}` ou appelle `setRoleAction` / `setDisabledAction`, then il est redirigé vers `/tableau-de-bord` sans effet.

## Implementation Notes

- Après revue : verrou `FOR UPDATE` de l’utilisateur cible et acteur exigé parmi les admins actifs verrouillés. `npm test` (132), `typecheck`, `build` OK.

## Plan Change Log

## Review Triage Log

**Passe 1 (quick)** — high 0 · medium 1 · low 2 · false 1 · maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `updateUser` lit la cible sans verrou puis réécrit rôle ET `disabledAt` : désactivation + changement de rôle concurrents peuvent réactiver un utilisateur désactivé | medium | patch | Seuls les admins actifs étaient verrouillés ; une cible `MEMBER` était lue sans verrou. Correctif : `SELECT … FOR UPDATE` de la cible après celui des admins (ordre constant). |
| 2 | Acteur non revérifié sous verrou : un admin rétrogradé en même temps peut encore agir | low | patch | Correction directe : l’acteur doit figurer parmi les admins actifs verrouillés, sinon « Élément introuvable » sans écriture (vérifié après le contrôle « dernier admin » pour garder le message de la ligne Concurrence). Test ajouté. |
| 3 | Validation < 8 / confirmation et refus `/members` du rétrogradé non testés ; actions non-admin sans test | low | reject | Validation dans l’action (pas de tests d’actions depuis le socle) ; vérifié au navigateur (erreurs sous les champs, membre redirigé) ; `requireAdmin()` en tête des deux actions. |
| 4 | Script CLI dans Docker repose sur une hypothèse de traçage non vérifiée | false | reject | Exécuté dans le conteneur : `docker compose exec app npm run reset-password admin@x.fr` a affiché le mot de passe, connexion réussie avec lui ; email inconnu → code 1. |

## Verification

**Commands:**
- `docker compose --profile test up -d db-test && npm test` -- expected: tous les tests passent
- `npm run typecheck && npm run build` -- expected: sans erreur
- Docker : `.env` temporaire `APP_PORT=3010`, `docker compose up -d --build`, setup, `docker compose exec app npm run reset-password <email>`, connexion avec le nouveau mot de passe ; puis supprimer `.env`, `docker compose down -v`, `docker compose --profile test down -v` ; ne jamais toucher aux autres projets ni faire de prune.

**Manual checks (if no CLI):**
- Navigateur (Playwright, soumission via `element.click()` en evaluate) à 360 px : désactivation / réactivation, refus dernier admin, `/profil`.
