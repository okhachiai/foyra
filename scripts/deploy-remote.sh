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
[[ "$REMOTE_DIR" == /* && "$REMOTE_DIR" != / ]] || { echo 'REMOTE_DIR must be an existing absolute directory' >&2; exit 1; }
[[ "$REMOTE_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'REMOTE_PROJECT invalide' >&2; exit 1; }
image="${DEPLOY_IMAGE:-ghcr.io/okhachiai/foyra:latest}"
[[ "$image" =~ ^ghcr\.io/okhachiai/foyra(:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|@sha256:[a-f0-9]{64})$ ]] || { echo 'DEPLOY_IMAGE doit désigner une version de ghcr.io/okhachiai/foyra' >&2; exit 1; }
init="${INIT:-0}"
[[ "$init" == 0 || "$init" == 1 ]] || { echo 'INIT doit valoir 0 ou 1' >&2; exit 1; }

# Protéger les arguments transmis au shell SSH, notamment les chemins avec espaces.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
release="$REMOTE_DIR/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote_args="$(quote "$REMOTE_DIR") $(quote "$REMOTE_PROJECT") $(quote "$release") $(quote "$init") $(quote "$image")"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10)

echo 'Uploading the deployment configuration…'
# Seule la configuration Compose est envoyée : ni code source, ni secrets.
ssh "${ssh_options[@]}" "$REMOTE_HOST" \
  "umask 077; mkdir -p $(quote "$release") && cat > $(quote "$release/docker-compose.yml")" < compose.remote.yml

ssh "${ssh_options[@]}" "$REMOTE_HOST" "bash -s -- $remote_args" <<'REMOTE'
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
root=$1; project=$2; release=$3; init=$4; image=$5
mkdir "$root/.deploy-lock" 2>/dev/null || { echo 'A deployment is already in progress (.deploy-lock).' >&2; exit 1; }
env_tmp=""
trap '[ -z "$env_tmp" ] || rm -f "$env_tmp"; rmdir "$root/.deploy-lock"' EXIT
test -f "$root/.env" || { echo "The production .env is missing: $root/.env" >&2; exit 1; }
docker info >/dev/null
docker compose version >/dev/null
# Vérifier l'appartenance du projet, y compris les chemins contenant des espaces.
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  case "$dir" in "$root"|"$root"/*) ;; *) echo "Compose project $project belongs to $dir: change REMOTE_PROJECT." >&2; exit 1;; esac
done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u)
db=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=db')
export FOYRA_DB_VOLUME="${project}_pgdata"
if [ -n "$db" ]; then
  # Réutiliser le volume réellement monté, même si son nom a été personnalisé.
  mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' "$db")
  case "$mount" in volume:?*) export FOYRA_DB_VOLUME="${mount#volume:}" ;; *) echo 'Database storage is not a named PostgreSQL volume; deployment refused.' >&2; exit 1;; esac
else
  [ "$init" = 1 ] || { echo 'No active database. Check REMOTE_PROJECT. INIT=1 is only for a first install.' >&2; exit 1; }
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=db')" ] || {
    echo 'An existing database is stopped. Start it before deploying.' >&2; exit 1;
  }
  if docker volume inspect "$FOYRA_DB_VOLUME" >/dev/null 2>&1; then
    echo 'A database volume already exists. Restore the existing database service before deploying.' >&2; exit 1
  fi
fi
cd "$release"
export FOYRA_DEPLOY_IMAGE="$image"
compose=(docker compose --env-file "$root/.env" -p "$project" -f "$release/docker-compose.yml")
"${compose[@]}" config --quiet </dev/null
"${compose[@]}" pull app worker </dev/null
# Figer le digest téléchargé pour éviter qu'un tag mutable change entre pull et up.
FOYRA_DEPLOY_IMAGE=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")
[ -n "$FOYRA_DEPLOY_IMAGE" ] || { echo 'No image digest found.' >&2; exit 1; }
export FOYRA_DEPLOY_IMAGE
printf '%s\n' "$FOYRA_DEPLOY_IMAGE" > "$release/image.txt"
printf 'Release prepared: %s\n' "$release"
if [ -n "$db" ]; then
  # Les migrations s'appliquent au démarrage du conteneur : sauvegarder avant chaque remplacement.
  umask 077; mkdir -p "$root/backups"
  backup=$(mktemp "$root/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).XXXXXX")
  "${compose[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null > "$backup"
  "${compose[@]}" exec -T db pg_restore --list < "$backup" >/dev/null
  printf 'Sauvegarde : %s\n' "$backup"
fi
# Initialiser seulement les secrets absents, sans les afficher ni remplacer une valeur existante.
# L'image vérifiée contient cet utilitaire ; aucun accès réseau ou montage de données n'est nécessaire.
umask 077
env_tmp=$(mktemp "$root/.env.ai.XXXXXX")
docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint /nodejs/bin/node "$FOYRA_DEPLOY_IMAGE" scripts/prepare-ai-env.mjs < "$root/.env" > "$env_tmp"
test -s "$env_tmp"
if ! cmp -s "$root/.env" "$env_tmp"; then
  env_backup=$(mktemp "$root/.env.before-ai.XXXXXX")
  cat "$root/.env" > "$env_backup"
  mv "$env_tmp" "$root/.env"
  echo 'Missing AI secrets initialized; existing values preserved. Previous .env kept privately.'
fi
rm -f "$env_tmp"; env_tmp=""
"${compose[@]}" config --quiet </dev/null
if [ -n "$db" ]; then
  # Ne jamais recréer ni mettre à jour PostgreSQL lors d'une mise à jour de l'app.
  "${compose[@]}" up -d --no-deps app worker cron </dev/null
else
  "${compose[@]}" up -d app worker cron </dev/null
fi
for attempt in {1..30}; do
  if "${compose[@]}" exec -T app /nodejs/bin/node -e 'fetch("http://127.0.0.1:3000/login").then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))' </dev/null >/dev/null 2>&1; then
    printf 'Deployment finished: %s\n' "$release"
    "${compose[@]}" ps app
    exit 0
  fi
  sleep 2
done
echo 'The container does not respond on /login. Check the logs; no automatic rollback was done.' >&2
"${compose[@]}" logs --tail=50 app
exit 1
REMOTE
