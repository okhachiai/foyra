#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .deploy.env ]]; then
  # Configuration locale écrite par le développeur, jamais envoyée au serveur.
  source .deploy.env
fi
: "${REMOTE_HOST:?Configurer REMOTE_HOST dans .deploy.env}"
: "${REMOTE_DIR:?Configurer REMOTE_DIR dans .deploy.env}"
: "${REMOTE_PROJECT:?Configurer REMOTE_PROJECT dans .deploy.env}"
[[ "$REMOTE_HOST" != -* && "$REMOTE_HOST" != *[[:space:]]* ]] || { echo 'REMOTE_HOST invalide' >&2; exit 1; }
[[ "$REMOTE_DIR" == /* && "$REMOTE_DIR" != / ]] || { echo 'REMOTE_DIR doit être un dossier absolu existant' >&2; exit 1; }
[[ "$REMOTE_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'REMOTE_PROJECT invalide' >&2; exit 1; }
init="${INIT:-0}"
[[ "$init" == 0 || "$init" == 1 ]] || { echo 'INIT doit valoir 0 ou 1' >&2; exit 1; }

# Protéger les arguments transmis au shell SSH, notamment les chemins avec espaces.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
release="$REMOTE_DIR/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote_args="$(quote "$REMOTE_DIR") $(quote "$REMOTE_PROJECT") $(quote "$release") $(quote "$init")"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10)

echo 'Vérification du serveur…'
ssh "${ssh_options[@]}" "$REMOTE_HOST" "bash -s -- $remote_args" <<'REMOTE'
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
root=$1; project=$2; init=$4
test -d "$root" || { echo "Dossier absent sur le serveur : $root (le créer avec son .env de production)" >&2; exit 1; }
test -f "$root/.env" || { echo "Le .env de production est absent : $root/.env" >&2; exit 1; }
docker info >/dev/null
docker compose version >/dev/null
# Refuser un projet Compose appartenant à une autre application (ex. « foyra »).
for dir in $(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u); do
  case "$dir" in "$root"/*) ;; *) echo "Le projet Compose $project appartient à $dir : changer REMOTE_PROJECT." >&2; exit 1;; esac
done
# Hors installation initiale (INIT=1), la base doit déjà tourner : évite de repartir d'un volume vide.
if [ "$init" = 0 ]; then
  test -n "$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=db')" || {
    echo 'Aucune base active pour ce projet Compose. Vérifier REMOTE_PROJECT, ou lancer INIT=1 make deploy-remote pour la première installation.' >&2
    exit 1
  }
fi
REMOTE

echo 'Envoi du code dans un nouveau dossier de version…'
# Ne pas synchroniser les secrets, données, dépendances ou fichiers de travail.
COPYFILE_DISABLE=1 tar \
  --exclude='./.git' --exclude='./node_modules' --exclude='./.next' \
  --exclude='./.env' --exclude='./.env.*' --exclude='./.deploy.env' \
  --exclude='./backups' --exclude='./releases' --exclude='./.deploy-lock' \
  --exclude='./.agents' --exclude='./.claude' --exclude='./_bmad' --exclude='./_bmad-output' \
  --exclude='./.playwright-mcp' --exclude='./tsconfig.tsbuildinfo' \
  --exclude='*.dump' --exclude='*.log' --exclude='*.zip' --exclude='.DS_Store' \
  -cf - . | ssh "${ssh_options[@]}" "$REMOTE_HOST" \
  "mkdir -p $(quote "$release") && tar -xf - -C $(quote "$release")"

ssh "${ssh_options[@]}" "$REMOTE_HOST" "bash -s -- $remote_args" <<'REMOTE'
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
root=$1; project=$2; release=$3; init=$4
mkdir "$root/.deploy-lock" 2>/dev/null || { echo 'Un déploiement est déjà en cours (.deploy-lock).' >&2; exit 1; }
trap 'rmdir "$root/.deploy-lock"' EXIT
cd "$release"
# Typecheck + tests dans une base jetable, sous un projet Compose séparé.
check=(docker compose -p "$project-check" -f "$release/docker-compose.yml")
export DB_TEST_PORT=0
status=0
"${check[@]}" --profile test run --rm --build tests </dev/null || status=$?
"${check[@]}" --profile test down -v </dev/null >/dev/null 2>&1 || true
[ "$status" = 0 ] || { echo 'Vérification échouée : rien n’est déployé.' >&2; exit 1; }
compose=(docker compose --env-file "$root/.env" -p "$project" -f "$release/docker-compose.yml")
"${compose[@]}" config --quiet </dev/null
"${compose[@]}" build app </dev/null
printf 'Version préparée : %s\n' "$release"
if [ "$init" = 0 ]; then
  # Les migrations s'appliquent au démarrage du conteneur : sauvegarder avant chaque remplacement.
  umask 077; mkdir -p "$root/backups"
  backup=$(mktemp "$root/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).XXXXXX")
  "${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null > "$backup"
  "${compose[@]}" exec -T db pg_restore --list < "$backup" >/dev/null
  printf 'Sauvegarde : %s\n' "$backup"
fi
"${compose[@]}" up -d app </dev/null
for attempt in {1..30}; do
  if "${compose[@]}" exec -T app node -e 'fetch("http://127.0.0.1:3000/login").then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))' </dev/null >/dev/null 2>&1; then
    printf 'Déploiement terminé : %s\n' "$release"
    "${compose[@]}" ps app
    exit 0
  fi
  sleep 2
done
echo 'Le conteneur ne répond pas sur /login. Consulter les logs ; aucun retour arrière automatique effectué.' >&2
"${compose[@]}" logs --tail=50 app
exit 1
REMOTE
