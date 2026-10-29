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

## Sauvegarde et restauration

```sh
# Sauvegarde
docker compose exec -T db pg_dump -U foyra -Fc foyra > foyra-$(date +%F).dump

# Restauration (sur une base vide ou à écraser)
docker compose exec -T db pg_restore -U foyra -d foyra --clean --if-exists < foyra-AAAA-MM-JJ.dump
```

Adaptez `-U` / `-d` si vous avez changé `POSTGRES_USER` / `POSTGRES_DB`.

## Développement

```sh
npm install
docker compose --profile test up -d db-test   # PostgreSQL de test sur localhost:5433
npm test                                       # applique les migrations puis lance Vitest
npm run build
```

`npm run dev` nécessite `DATABASE_URL` vers une base PostgreSQL (par ex. celle de test).

## Règles métier

- Membres : l'admin change le rôle et désactive / réactive un utilisateur (jamais de suppression). Désactivé : sessions fermées, connexion refusée, accès aux comptes conservés. Le foyer garde toujours au moins un admin actif ; on ne peut pas désactiver son propre compte. Rétrogradé en membre : aucun accès aux comptes tant que l'admin n'en donne pas.
- Montants en centimes entiers, toujours > 0 (contrainte CHECK) ; le sens découle du type.
- Solde = solde initial + somme signée des opérations, jamais stocké. Le découvert est autorisé.
- Un virement = deux lignes liées (`transferId`, côté `OUT`/`IN`), créées, modifiées et supprimées ensemble.
- Un compte ne s'archive qu'à solde nul ; archivé, il est en lecture seule et sort du solde global.
