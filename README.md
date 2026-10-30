# Foyra

Gestion des comptes d'un foyer, auto-hébergée : comptes (courant, épargne, espèces, autre), recettes, dépenses, virements, soldes par compte et solde global. Un foyer par instance, plusieurs membres.

## Installation (Docker)

```sh
cp .env.example .env   # changez POSTGRES_PASSWORD
docker compose up -d
```

Ouvrez `http://<hôte>:3000/` : la première visite mène à `/setup` (création du foyer et du compte admin). L'admin crée ensuite les autres membres dans **Membres** ; il n'y a pas d'inscription publique.

Au démarrage, le conteneur `app` attend que PostgreSQL soit prêt, applique les migrations (`prisma migrate deploy`) puis lance le serveur. Les données vivent dans le volume `pgdata` : `docker compose down` puis `up -d` les conserve (seul `down -v` les efface).

### Derrière un reverse proxy HTTPS

Dans `.env` : `COOKIE_SECURE=true`, `APP_URL=https://foyra.example.org` (lu au build : relancez `docker compose up -d --build`), et `APP_BIND=127.0.0.1` si le proxy tourne sur la même machine.

### Mise à jour

```sh
docker compose up -d --build
```

### Mot de passe oublié

Chacun change son mot de passe dans **Mon compte**. Un mot de passe perdu (y compris celui de l'unique admin) se réinitialise depuis le serveur :

```sh
docker compose exec app npm run reset-password admin@exemple.fr
```

Un mot de passe provisoire aléatoire s'affiche une seule fois ; toutes les sessions de l'utilisateur sont fermées. Un compte désactivé reste désactivé (un admin le réactive dans **Membres**). Sans email en argument, il est demandé.

## Rapport LLM

Un rapport (dépenses du jour, répartition du budget, planning, conseil) est généré à la demande ou chaque soir. Un fournisseur n'est proposé que si ses variables sont renseignées dans `.env` : `ANTHROPIC_API_KEY` (+ `CLAUDE_MODEL`) pour Claude, `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` / `LOCAL_LLM_API_KEY` pour un modèle local compatible OpenAI.

Le service `cron` appelle `POST /api/reports/daily` avec `Authorization: Bearer $CRON_TOKEN` à l'heure `REPORT_CRON` (défaut `0 20 * * *`, fuseau Europe/Paris). Renseignez un `CRON_TOKEN` secret : s'il est vide, la route refuse tout. Un seul rapport quotidien par foyer et par jour ; un nouvel appel ne le régénère pas.

## Sauvegarde et restauration

```sh
# Sauvegarde
docker compose exec -T db pg_dump -U foyra -Fc foyra > foyra-$(date +%F).dump

# Restauration (sur une base vide ou à écraser)
docker compose exec -T db pg_restore -U foyra -d foyra --clean --if-exists < foyra-AAAA-MM-JJ.dump
```

Adaptez `-U` / `-d` si vous avez changé `POSTGRES_USER` / `POSTGRES_DB`.

## Tests et vérification de types (dans Docker)

```sh
docker compose --profile test up -d db-test
docker compose --profile test run --rm tests   # npm run typecheck && npm test (migrations appliquées à la base de test)
```

## Migrations

Appliquées automatiquement au démarrage du conteneur `app` (`prisma migrate deploy`), sans jamais réinitialiser la base.
`20261103000100_budget_v2` reprend les anciennes lignes de budget dans des budgets mensuels indépendants (montant saisi
sur une catégorie parente → sous-ligne « Autres ») et donne la gestion explicite des comptes existants aux admins.
Faites une sauvegarde (ci-dessus) avant toute mise à jour.

## Développement

```sh
npm install
docker compose --profile test up -d db-test   # PostgreSQL de test sur localhost:5433
npm test                                       # applique les migrations puis lance Vitest
npm run build
```

`npm run dev` nécessite `DATABASE_URL` vers une base PostgreSQL (par ex. celle de test).

### Rechargement à chaud (Docker)

```sh
make dev        # chaque modification du code est visible sans reconstruction
make dev-logs   # suivre les logs
make dev-stop   # arrêter (la base locale est conservée)
```

`make dev` combine `docker-compose.yml` et `docker-compose.dev.yml` : sources montées, `next dev`, migrations appliquées au démarrage, même base et même `.env`. Après un changement de `package.json`, relancer `make dev`. `make up` remet l'image de production. La production n'utilise jamais `docker-compose.dev.yml`.

## Déploiement SSH sur le Mac mini

Première fois, sur le Mac mini : créer le dossier (`/Users/sofia/Sites/foyra-project`) et son `.env` de production (copie de `.env.example`), avec un **`APP_PORT` différent de l'autre application Foyra** (ex. `3001`). Puis, sur le Mac de développement :

```sh
cp .deploy.env.example .deploy.env   # REMOTE_HOST, REMOTE_DIR, REMOTE_PROJECT (jamais « foyra »)
INIT=1 make deploy-remote            # première installation (crée la base)
make deploy-remote                   # déploiements suivants
```

Une clé SSH doit permettre une connexion sans mot de passe. Le code local, y compris non commité, est envoyé dans un nouveau dossier `releases/` (sans `.git`, `node_modules`, secrets ni sauvegardes). Typecheck et tests tournent sur le serveur dans une base jetable ; en cas d'échec rien n'est remplacé. Avant de remplacer le conteneur, une sauvegarde `pg_dump` vérifiée est écrite dans `backups/` (les migrations s'appliquent au démarrage). Le script refuse un projet Compose appartenant à un autre dossier, et un déploiement ordinaire sans base active. Les versions restent sur le serveur, sans nettoyage ni retour arrière automatique ; en cas de verrou `.deploy-lock` résiduel, vérifier qu'aucun déploiement ne tourne avant de le retirer.

## Règles métier

- Membres : l'admin change le rôle et désactive / réactive un utilisateur (jamais de suppression). Désactivé : sessions fermées, connexion refusée, accès aux comptes conservés. Le foyer garde toujours au moins un admin actif ; on ne peut pas désactiver son propre compte. Rétrogradé en membre : aucun accès aux comptes tant que l'admin n'en donne pas.
- Montants en centimes entiers, toujours > 0 (contrainte CHECK) ; le sens découle du type.
- Solde = solde initial + somme signée des opérations, jamais stocké. Le découvert est autorisé.
- Un virement = deux lignes liées (`transferId`, côté `OUT`/`IN`), créées, modifiées et supprimées ensemble.
- Un compte ne s'archive qu'à solde nul ; archivé, il est en lecture seule et sort du solde global ; un gestionnaire peut le réactiver.
- Accès aux comptes : explicites (lecture / écriture / gestion) ou partage « tout le foyer » (écriture). Le rôle admin ne donne aucun accès aux comptes privés.
- Budget mensuel : au plus un par mois, créé explicitement (reprise des lignes récurrentes du précédent ou modèles, selon le réglage du foyer), brouillon ou validé. Lignes copiées : modifier le catalogue ne change jamais un budget existant. Un parent avec sous-lignes vaut la somme de ses sous-lignes incluses. Le budget ne crée aucune opération et ne touche aucun solde.
- Récurrences : échéances indicatives (revenu ou dépense) ; seule l'action « marquer payée / reçu » enregistre l'opération.
- Opérations : clé d'idempotence par formulaire (double clic sans doublon).
