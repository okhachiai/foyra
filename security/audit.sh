#!/usr/bin/env bash
# Audit de sécurité LOCAL de Foyra, sur une instance jetable à données fictives (projet compose « foyra-audit »).
#   security/audit.sh up          construit et lance l'instance (127.0.0.1:3100) puis insère les données fictives
#   security/audit.sh scan        gitleaks, semgrep, trivy, ZAP baseline, vitest → security-audit/<date>/
#   security/audit.sh scan --full idem, avec scan ZAP actif (attaques) au lieu du baseline passif
#   security/audit.sh down        arrête et supprime l'instance et ses volumes
# Ne lit ni .env ni .deploy.env ; ZAP (service compose « zap », profil audit) ne cible que http://app:3000 du réseau foyra-audit.
set -uo pipefail
cd "$(dirname "$0")/.."

AUDIT=(docker compose -p foyra-audit --env-file security/audit.env)
NET=foyra-audit_default
OUT="security-audit/$(date +%Y-%m-%d_%H%M%S)"

up() {
  "${AUDIT[@]}" up -d --build db app || exit 1
  echo "Attente de l'application…"
  for _ in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:3100/login && break; sleep 2; done
  "${AUDIT[@]}" exec -T app /nodejs/bin/node --input-type=module < security/seed-fake.mjs
  echo "Instance d'audit : http://127.0.0.1:3100"
}

scan() {
  docker network inspect "$NET" >/dev/null 2>&1 || { echo "Instance absente : lancez d'abord « security/audit.sh up »." >&2; exit 1; }
  mkdir -p "$OUT/zap"
  local failed=()
  step() { local name=$1; shift; echo "== $name"; "$@" || failed+=("$name"); }

  step gitleaks-git gitleaks git --redact --no-banner --report-format json --report-path "$OUT/gitleaks-git.json"
  step gitleaks-dir gitleaks dir . --redact --no-banner --report-format json --report-path "$OUT/gitleaks-dir.json"
  step semgrep semgrep scan --metrics=off --disable-version-check --error \
    --config p/typescript --config p/nextjs --config p/react --config p/owasp-top-ten \
    --exclude .next --exclude node_modules --exclude _bmad --exclude _bmad-output --exclude security-audit \
    --sarif-output "$OUT/semgrep.sarif" --text
  step trivy-fs trivy fs --scanners vuln,misconfig,secret --skip-dirs node_modules --skip-dirs .next \
    --exit-code 1 --severity HIGH,CRITICAL --format table --output "$OUT/trivy-fs.txt" .
  step trivy-image trivy image --exit-code 1 --severity HIGH,CRITICAL --format table --output "$OUT/trivy-image.txt" foyra-audit-app

  local zap=zap-baseline.py
  [[ ${1:-} == --full ]] && zap=zap-full-scan.py
  chmod 777 "$OUT/zap"
  step "zap ($zap)" env ZAP_SCRIPT="$zap" ZAP_OUT="$PWD/$OUT/zap" "${AUDIT[@]}" --profile audit run --rm --no-deps zap

  "${AUDIT[@]}" --profile test up -d --wait db-test
  step vitest env DATABASE_URL_TEST=postgresql://foyra:foyra@localhost:5433/foyra_test npx vitest run

  echo "Rapports : $OUT"
  if ((${#failed[@]})); then echo "Échecs / constats : ${failed[*]}"; exit 1; fi
}

case ${1:-} in
  up) up ;;
  scan) shift; scan "$@" ;;
  down) "${AUDIT[@]}" --profile test down -v ;;
  *) sed -n '2,7p' "$0"; exit 2 ;;
esac
