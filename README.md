<div align="center">

<img src="src/app/icon0.svg" alt="Logo Foyra" width="112" height="112">

# Foyra

**Le budget mensuel du foyer, auto-hébergé et privé.**

Prévoyez le budget du mois, suivez le réel et partagez équitablement les dépenses communes,<br>
sans jamais connecter de compte bancaire.

[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-147D69)](LICENSE)

[Démarrage rapide](#démarrage-rapide) ·
[Configuration](#configuration) ·
[Exploitation](#exploitation) ·
[Contribuer](#contribuer) ·
[Sécurité](#sécurité)

</div>

---

## Pourquoi Foyra ?

La plupart des applications de budget exigent un accès à vos comptes bancaires et hébergent vos données chez un tiers. Foyra prend le parti inverse :

- **Vos données restent chez vous** : une seule instance Docker, une base PostgreSQL, aucun service externe obligatoire.
- **Pensé pour le foyer, pas pour un individu** : plusieurs membres, des dépenses communes et une répartition au prorata des revenus.
- **Prévu contre réel** : on planifie le mois, on saisit ce qui se passe, on compare.
- **Sécurisé par défaut** : image distroless non-root, mots de passe Argon2, sessions côté serveur, aucune inscription publique.

> Interface en français, montants en euros, fuseau Europe/Paris par défaut.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Démarrage rapide](#démarrage-rapide)
- [Homelab](#homelab-image-prête-sans-cloner) : image prête, `docker compose` ou `docker run`
- [Configuration](#configuration)
- [Exploitation](#exploitation) : HTTPS, mise à jour, sauvegarde, mot de passe oublié
- [Rapports IA](#rapports-ia)
- [Développement](#développement)
- [Règles métier](#règles-métier)
- [Contribuer](#contribuer)
- [Sécurité](#sécurité)
- [Licence](#licence)

## Fonctionnalités

- **Budget mensuel** : un budget par mois, brouillon ou validé, repris du mois précédent ou de modèles.
- **Recettes et dépenses réelles** saisies à la main : aucune connexion bancaire, aucune donnée envoyée à un tiers.
- **Charges récurrentes et crédits**, avec échéances à marquer « payée » ou « reçue ».
- **Partage équitable** des dépenses communes au prorata des revenus de chaque membre.
- **Plusieurs membres par foyer**, rôles admin / membre, pas d'inscription publique.
- **Rapports IA optionnels** (Claude ou modèle local compatible OpenAI) : suivi quotidien, bilan mensuel, proposition de répartition du budget.
- **Import / export JSON** du budget.
- Thème clair et sombre (suit le système).

## Architecture

```mermaid
flowchart LR
    U[Navigateur] -- HTTPS via proxy --> A[app<br/>Next.js 15 · Server Actions]
    A -- Prisma 6 --> D[(db<br/>PostgreSQL 17)]
    C[cron] -- POST /api/reports/daily --> A
    A -. optionnel .-> L[Claude ou LLM local<br/>compatible OpenAI]
```

| Couche | Technologie |
| --- | --- |
| Interface | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Logique serveur | Server Actions, TypeScript strict |
| Données | Prisma 6, PostgreSQL 17 |
| Authentification | Sessions maison, Argon2 |
| Exécution | Docker Compose, image distroless, utilisateur non-root |
| Qualité | Vitest, typecheck, audit local (gitleaks, semgrep, trivy, ZAP) |

## Démarrage rapide

Prérequis : [Docker](https://docs.docker.com/get-docker/) avec Docker Compose v2.

```sh
git clone https://github.com/okhachiai/foyra.git
cd foyra
cp .env.example .env        # changez au moins POSTGRES_PASSWORD
docker compose up -d
```

1. Ouvrez `http://localhost:3000/`. La première visite mène à `/setup`.
2. Saisissez le jeton d'installation : `SETUP_TOKEN` du `.env`, ou à défaut celui affiché par `docker compose logs app`.
3. Créez le foyer et le compte admin.
4. Ajoutez les autres membres dans **Membres**.

Au démarrage, le conteneur `app` attend PostgreSQL, applique les migrations (`prisma migrate deploy`) puis lance le serveur. Les données vivent dans le volume `pgdata` : `docker compose down` les conserve, seul `docker compose down -v` les efface.

## Homelab (image prête, sans cloner)

L'image `ghcr.io/okhachiai/foyra` est publiée pour `amd64` et `arm64` (PC, NAS, Raspberry Pi 4/5, Mac). Tags : `latest` (branche `main`) ou une version (`0.1.0`).

### Docker Compose (recommandé)

```sh
mkdir foyra && cd foyra
curl -O https://raw.githubusercontent.com/okhachiai/foyra/main/compose.homelab.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose -f compose.homelab.yml up -d
docker compose -f compose.homelab.yml logs app   # jeton d'installation
```

Ouvrez `http://<ip-du-serveur>:3000/`. Ce fichier écoute sur toutes les interfaces (`APP_BIND=0.0.0.0`) pour être joignable depuis le réseau local. Toutes les variables de [Configuration](#configuration) s'ajoutent au `.env`, plus `TZ` (fuseau, défaut `Europe/Paris`) et `FOYRA_VERSION` (tag d'image, défaut `latest`). Mise à jour : `docker compose -f compose.homelab.yml pull && docker compose -f compose.homelab.yml up -d`. Fonctionne tel quel dans Portainer, Dockge, CasaOS (pile « compose »).

### `docker run`

Foyra a besoin de PostgreSQL. Avec une base existante, un seul conteneur suffit :

```sh
docker run -d --name foyra --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URL=postgresql://foyra:MOTDEPASSE@hote-postgres:5432/foyra \
  -e TZ=Europe/Paris \
  ghcr.io/okhachiai/foyra:latest
```

Sans base existante, créez-la à côté :

```sh
docker network create foyra
docker run -d --name foyra-db --network foyra --restart unless-stopped \
  -e POSTGRES_USER=foyra -e POSTGRES_PASSWORD=MOTDEPASSE -e POSTGRES_DB=foyra \
  -v foyra-db:/var/lib/postgresql/data postgres:17-alpine
docker run -d --name foyra --network foyra --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URL=postgresql://foyra:MOTDEPASSE@foyra-db:5432/foyra \
  ghcr.io/okhachiai/foyra:latest
docker logs foyra   # jeton d'installation
```

Le conteneur redémarre tant que la base n'est pas prête, puis applique les migrations. Les autres variables passent en `-e NOM=valeur`.

> **Reverse proxy et image publiée** : `APP_URL` est lu au build pour autoriser l'origine des Server Actions. Avec l'image publiée, le proxy doit transmettre l'en-tête `Host` d'origine (comportement par défaut de Caddy, Traefik, Nginx Proxy Manager). Sinon, construisez l'image depuis les sources avec `APP_URL`.

## Configuration

Toute la configuration passe par `.env` (voir [`.env.example`](.env.example), commenté).

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `change-me-please` | **À changer.** Lettres et chiffres uniquement (inséré dans une URL). |
| `POSTGRES_USER` / `POSTGRES_DB` | `foyra` | Utilisateur et base PostgreSQL. |
| `APP_PORT` | `3000` | Port publié sur l'hôte. |
| `APP_BIND` | `127.0.0.1` | Interface d'écoute. `0.0.0.0` pour exposer sur le réseau (de préférence derrière un proxy TLS). |
| `APP_URL` | vide | URL publique derrière un reverse proxy. Lue au build. |
| `COOKIE_SECURE` | déduit de `APP_URL` | Force le cookie « Secure » (`true` / `false`). |
| `SETUP_TOKEN` | aléatoire | Jeton exigé par `/setup`. Vide : généré et affiché dans les journaux. |
| `LLM_ALLOWED_HOSTS` | vide | Hôtes autorisés pour un modèle local (`nom:port`, séparés par des virgules). Vide : modèle local désactivé. |
| `LLM_KEY_SECRET` | vide | Clé de chiffrement AES-256-GCM des clés API en base (`openssl rand -hex 32`). **Ne plus la changer ensuite.** |
| `CRON_TOKEN` | vide | Jeton du rapport automatique, **hexadécimal** (`openssl rand -hex 32`). Vide : rapport automatique refusé. |
| `REPORT_CRON` | `0 20 * * *` | Horaire du rapport automatique (fuseau Europe/Paris). |

Générer les secrets :

```sh
openssl rand -hex 32   # pour LLM_KEY_SECRET, CRON_TOKEN, SETUP_TOKEN
```

## Exploitation

### Derrière un reverse proxy HTTPS

Dans `.env` :

```sh
APP_URL=https://foyra.example.org
APP_BIND=127.0.0.1   # si le proxy tourne sur la même machine
```

Puis reconstruisez : `docker compose up -d --build` (`APP_URL` est lu au build). `APP_URL` rend le cookie « Secure » et fait lire l'IP client dans `X-Forwarded-For` (limitation des tentatives de connexion). L'app ne doit alors être joignable **que** par le proxy, sinon cet en-tête peut être falsifié.

### Mise à jour

```sh
git pull
docker compose up -d --build
```

Les migrations s'appliquent automatiquement au démarrage, sans jamais réinitialiser la base. **Faites une sauvegarde avant chaque mise à jour.**

### Sauvegarde et restauration

```sh
# Sauvegarde
docker compose exec -T db pg_dump -U foyra -Fc foyra > foyra-$(date +%F).dump

# Restauration (écrase la base)
docker compose exec -T db pg_restore -U foyra -d foyra --clean --if-exists < foyra-AAAA-MM-JJ.dump
```

Adaptez `-U` / `-d` si vous avez changé `POSTGRES_USER` / `POSTGRES_DB`.

### Mot de passe oublié

Chacun change son mot de passe dans **Mon compte**. Un mot de passe perdu (y compris celui de l'unique admin) se réinitialise depuis le serveur :

```sh
docker compose exec app /nodejs/bin/node scripts/reset-password.mjs admin@exemple.fr
```

Un mot de passe provisoire s'affiche une seule fois et toutes les sessions de l'utilisateur sont fermées. Sans email en argument, il est demandé. Un compte désactivé reste désactivé : un admin le réactive dans **Membres**.

## Rapports IA

Fonction **optionnelle** : sans fournisseur configuré, l'application fonctionne normalement.

Un rapport (dépenses du jour, répartition du budget, planning, conseils) est généré à la demande ou chaque soir. Les fournisseurs se règlent dans l'application (admin), **Paramètres → Rapport LLM** :

- **Claude** : clé API et modèle.
- **Modèle local compatible OpenAI** (Ollama, LM Studio…) : URL, modèle, clé facultative. L'hôte doit figurer dans `LLM_ALLOWED_HOSTS` (ex. `host.docker.internal:11434`), pour qu'un admin ne puisse pas faire appeler une adresse interne quelconque par le serveur.

**Rapport automatique** : le service `cron` appelle `POST /api/reports/daily` avec `Authorization: Bearer $CRON_TOKEN` à l'heure `REPORT_CRON`. Chaque appel produit le rapport du jour et, le 1er du mois, le bilan du mois écoulé (prévu contre réel). Un seul rapport automatique par foyer, jour et type. Journaux : `docker compose logs cron`.

## Développement

Prérequis : Node.js 22 LTS et Docker.

```sh
npm install
docker compose --profile test up -d db-test   # PostgreSQL de test sur localhost:5433
npm test                                       # applique les migrations puis lance Vitest
npm run typecheck
```

`npm run dev` nécessite `DATABASE_URL` vers une base PostgreSQL (par ex. celle de test).

### Avec Docker et rechargement à chaud

```sh
make dev        # sources montées, next dev, migrations au démarrage
make dev-logs   # suivre les logs
make dev-stop   # arrêter (la base est conservée)
make up         # revenir à l'image de production
make help       # toutes les commandes
```

Après un changement de `package.json`, relancez `make dev`. La production n'utilise jamais `docker-compose.dev.yml`.

### Tests dans Docker

```sh
docker compose --profile test up -d db-test
docker compose --profile test run --rm tests   # typecheck + tests
```

### Audit de sécurité local

```sh
make audit-up   # instance jetable (127.0.0.1:3100) + données fictives
make audit      # gitleaks, semgrep, trivy, ZAP baseline, vitest (FULL=1 : ZAP actif)
make audit-down
```

### Déploiement distant par SSH (optionnel)

`make deploy-remote` envoie le code sur un serveur, y lance typecheck et tests dans une base jetable, écrit une sauvegarde `pg_dump` vérifiée dans `backups/`, puis remplace le conteneur. Rien n'est remplacé en cas d'échec.

```sh
cp .deploy.env.example .deploy.env   # REMOTE_HOST, REMOTE_DIR, REMOTE_PROJECT
INIT=1 make deploy-remote            # première installation (crée la base)
make deploy-remote                   # déploiements suivants
```

Prérequis : connexion SSH par clé, dossier `REMOTE_DIR` existant avec son `.env` de production. Si un verrou `.deploy-lock` subsiste, vérifiez qu'aucun déploiement ne tourne avant de le retirer.

## Règles métier

- **Membres** : l'admin change les rôles et désactive / réactive les comptes (jamais de suppression). Un compte désactivé perd ses sessions mais ses opérations sont conservées. Le foyer garde toujours au moins un admin actif. Tout membre gère budgets, opérations, récurrences et crédits ; catégories, membres et réglages sont réservés aux admins.
- **Montants** en centimes entiers, toujours > 0 (contrainte `CHECK`) ; le sens découle du type.
- **Pas de comptes bancaires** : chaque opération porte un « payé / reçu par » et une case « commune ». Le net du mois (recettes − dépenses) est calculé, jamais stocké.
- **Partage** : dépenses communes prévues moins recettes communes, réparties au prorata des revenus personnels.
- **Budget mensuel** : au plus un par mois, créé explicitement. Les lignes sont copiées : modifier le catalogue ne change jamais un budget existant. Un parent avec sous-lignes vaut la somme de ses sous-lignes. Le budget ne crée aucune opération.
- **Récurrences** : échéances indicatives ; seule l'action « marquer payée / reçue » enregistre l'opération.
- **Opérations** : clé d'idempotence par formulaire (un double clic ne crée pas de doublon).

## Contribuer

Les contributions sont les bienvenues.

1. Ouvrez une issue pour discuter d'un changement important avant de coder.
2. Forkez, créez une branche (`feat/…`, `fix/…`).
3. Vérifiez que `npm run typecheck` et `npm test` passent.
4. Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scope): …`, `fix(scope): …`).
5. Ouvrez une pull request en décrivant le changement et comment le tester.

Toute migration Prisma doit être non destructive et reprendre les données existantes.

## Sécurité

**Ne signalez pas une vulnérabilité dans une issue publique.** Utilisez le [signalement privé de GitHub](https://github.com/okhachiai/foyra/security/advisories/new).

Bonnes pratiques de déploiement : changez `POSTGRES_PASSWORD`, gardez `APP_BIND=127.0.0.1` derrière un proxy HTTPS, renseignez `LLM_KEY_SECRET` si vous enregistrez des clés API, et sauvegardez régulièrement.

## Licence

[MIT](LICENSE) © 2026 KHACHIAI Oussama.
