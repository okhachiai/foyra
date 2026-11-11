<div align="center">

<img src="src/app/icon0.svg" alt="Foyra logo" width="112" height="112">

# Foyra

**Self-hosted, private monthly budgeting for your household.**

Plan the month's budget, track what actually happens and split shared expenses fairly,<br>
without ever connecting a bank account.

[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![MIT License](https://img.shields.io/badge/license-MIT-147D69)](LICENSE)

[Quick start](#quick-start) ·
[Configuration](#configuration) ·
[Operations](#operations) ·
[Contributing](#contributing) ·
[Security](#security)

</div>

---

## Why Foyra?

Most budgeting apps want access to your bank accounts and store your data with a third party. Foyra takes the opposite approach:

- **Your data stays with you**: one Docker instance, one PostgreSQL database, no required external service.
- **Built for a household, not an individual**: multiple members, shared expenses and a split proportional to income.
- **Planned vs. actual**: plan the month, record what happens, compare.
- **Secure by default**: distroless non-root image, Argon2 passwords, server-side sessions, no public sign-up.

> The interface is in English by default; French and Arabic (right-to-left) can be chosen in **Settings → General** or on the sign-in page. Amounts are in euros, and the default time zone is Europe/Paris.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Homelab](#homelab-prebuilt-image-no-clone-needed): prebuilt image, `docker compose` or `docker run`
- [Configuration](#configuration)
- [Operations](#operations): HTTPS, updates, backups, forgotten password
- [AI reports](#ai-reports)
- [Development](#development)
- [Business rules](#business-rules)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- **Monthly budget**: one budget per month, draft or approved, carried over from the previous month or from templates.
- **Actual income and expenses** entered by hand: no bank connection, no data sent to a third party.
- **Recurring bills and loans**, with due items to mark as "paid" or "received".
- **Fair split** of shared expenses, proportional to each member's income.
- **Multiple members per household**, admin / member roles, no public sign-up.
- **Optional AI reports** (Claude or a local OpenAI-compatible model): daily tracking, monthly review, suggested budget allocation.
- **JSON import / export** of the budget.
- Light and dark theme (follows the system).

## Architecture

```mermaid
flowchart LR
    U[Browser] -- HTTPS via proxy --> A[app<br/>Next.js 15 · Server Actions]
    A -- Prisma 6 --> D[(db<br/>PostgreSQL 17)]
    C[cron] -- POST /api/reports/daily --> A
    A -. optional .-> L[Claude or local LLM<br/>OpenAI-compatible]
```

| Layer | Technology |
| --- | --- |
| UI | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Server logic | Server Actions, strict TypeScript |
| Data | Prisma 6, PostgreSQL 17 |
| Authentication | Custom sessions, Argon2 |
| Runtime | Docker Compose, distroless image, non-root user |
| Quality | Vitest, typecheck, local audit (gitleaks, semgrep, trivy, ZAP) |

## Quick start

Requirements: [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2.

```sh
git clone https://github.com/okhachiai/foyra.git
cd foyra
cp .env.example .env        # change at least POSTGRES_PASSWORD
docker compose up -d
```

1. Open `http://localhost:3000/`. The first visit takes you to `/setup`.
2. Enter the setup token: `SETUP_TOKEN` from `.env`, or otherwise the one shown by `docker compose logs app`.
3. Create the household and the admin account.
4. Add the other members under **Membres** (Members).

On startup, the `app` container waits for PostgreSQL, applies migrations (`prisma migrate deploy`) and then starts the server. Data lives in the `pgdata` volume: `docker compose down` keeps it, only `docker compose down -v` deletes it.

## Homelab (prebuilt image, no clone needed)

The `ghcr.io/okhachiai/foyra` image is published for `amd64` and `arm64` (PC, NAS, Raspberry Pi 4/5, Mac). Tags: `latest` (`main` branch) or a version (`0.1.0`).

### Docker Compose (recommended)

```sh
mkdir foyra && cd foyra
curl -O https://raw.githubusercontent.com/okhachiai/foyra/main/compose.homelab.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
docker compose -f compose.homelab.yml up -d
docker compose -f compose.homelab.yml logs app   # setup token
```

Open `http://<server-ip>:3000/`. This file listens on all interfaces (`APP_BIND=0.0.0.0`) so it is reachable from the local network. Every variable from [Configuration](#configuration) can be added to `.env`, plus `TZ` (time zone, default `Europe/Paris`) and `FOYRA_VERSION` (image tag, default `latest`). To update: `docker compose -f compose.homelab.yml pull && docker compose -f compose.homelab.yml up -d`. Works as-is in Portainer, Dockge and CasaOS ("compose" stack).

### `docker run`

Foyra needs PostgreSQL. With an existing database, a single container is enough:

```sh
docker run -d --name foyra --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URL=postgresql://foyra:PASSWORD@postgres-host:5432/foyra \
  -e TZ=Europe/Paris \
  ghcr.io/okhachiai/foyra:latest
```

Without an existing database, create one alongside it:

```sh
docker network create foyra
docker run -d --name foyra-db --network foyra --restart unless-stopped \
  -e POSTGRES_USER=foyra -e POSTGRES_PASSWORD=PASSWORD -e POSTGRES_DB=foyra \
  -v foyra-db:/var/lib/postgresql/data postgres:17-alpine
docker run -d --name foyra --network foyra --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URL=postgresql://foyra:PASSWORD@foyra-db:5432/foyra \
  ghcr.io/okhachiai/foyra:latest
docker logs foyra   # setup token
```

The container restarts until the database is ready, then applies migrations. Other variables are passed as `-e NAME=value`.

> **Reverse proxy and the published image**: `APP_URL` is read at build time to allow the Server Actions origin. With the published image, the proxy must forward the original `Host` header (the default for Caddy, Traefik and Nginx Proxy Manager). Otherwise, build the image from source with `APP_URL`.

## Configuration

All configuration goes through `.env` (see the commented [`.env.example`](.env.example)).

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `change-me-please` | **Change it.** Letters and digits only (it is inserted into a URL). |
| `POSTGRES_USER` / `POSTGRES_DB` | `foyra` | PostgreSQL user and database. |
| `APP_PORT` | `3000` | Port published on the host. |
| `APP_BIND` | `127.0.0.1` | Listening interface. `0.0.0.0` to expose it on the network (preferably behind a TLS proxy). |
| `APP_URL` | empty | Public URL behind a reverse proxy. Read at build time. |
| `COOKIE_SECURE` | derived from `APP_URL` | Forces the "Secure" cookie flag (`true` / `false`). |
| `SETUP_TOKEN` | random | Token required by `/setup`. Empty: generated and printed in the logs. |
| `LLM_ALLOWED_HOSTS` | empty | Allowed hosts for a local model (`name:port`, comma-separated). Empty: local model disabled. |
| `LLM_KEY_SECRET` | empty | AES-256-GCM key used to encrypt API keys stored in the database (`openssl rand -hex 32`). **Never change it afterwards.** |
| `CRON_TOKEN` | empty | Token for the automatic report, **hexadecimal** (`openssl rand -hex 32`). Empty: automatic report rejected. |
| `REPORT_CRON` | `0 20 * * *` | Automatic report schedule (Europe/Paris time zone). |

Generate secrets:

```sh
openssl rand -hex 32   # for LLM_KEY_SECRET, CRON_TOKEN, SETUP_TOKEN
```

## Operations

### Behind an HTTPS reverse proxy

In `.env`:

```sh
APP_URL=https://foyra.example.org
APP_BIND=127.0.0.1   # if the proxy runs on the same machine
```

Then rebuild: `docker compose up -d --build` (`APP_URL` is read at build time). `APP_URL` makes the cookie "Secure" and makes the app read the client IP from `X-Forwarded-For` (login rate limiting). The app must then be reachable **only** through the proxy, otherwise that header can be spoofed.

### Updating

```sh
git pull
docker compose up -d --build
```

Migrations are applied automatically on startup and never reset the database. **Back up before every update.**

### Backup and restore

```sh
# Backup
docker compose exec -T db pg_dump -U foyra -Fc foyra > foyra-$(date +%F).dump

# Restore (overwrites the database)
docker compose exec -T db pg_restore -U foyra -d foyra --clean --if-exists < foyra-YYYY-MM-DD.dump
```

Adjust `-U` / `-d` if you changed `POSTGRES_USER` / `POSTGRES_DB`.

### Forgotten password

Each user changes their own password under **Mon compte** (My account). A lost password (including the only admin's) is reset from the server:

```sh
docker compose exec app /nodejs/bin/node scripts/reset-password.mjs admin@example.com
```

A temporary password is shown only once and all of the user's sessions are closed. If no email is given as an argument, the script prompts for it. A deactivated account stays deactivated: an admin reactivates it under **Membres** (Members).

## AI reports

This feature is **optional**: with no provider configured, the app works normally.

A report (today's expenses, budget allocation, schedule, advice) is generated on demand or every evening. Providers are configured in the app (admin), under **Settings → AI**:

- **Claude**: API key and model.
- **Local OpenAI-compatible model** (Ollama, LM Studio…): URL, model, optional key. The host must be listed in `LLM_ALLOWED_HOSTS` (e.g. `host.docker.internal:11434`), so that an admin cannot make the server call an arbitrary internal address.

**Automatic report**: the `cron` service calls `POST /api/reports/daily` with `Authorization: Bearer $CRON_TOKEN` at the `REPORT_CRON` time. Each call produces the daily report and, on the 1st of the month, the review of the previous month (planned vs. actual). At most one automatic report per household, day and type. Logs: `docker compose logs cron`.

## Development

Requirements: Node.js 22 LTS and Docker.

```sh
npm install
docker compose --profile test up -d db-test   # test PostgreSQL on localhost:5433
npm test                                       # applies migrations, then runs Vitest
npm run typecheck
```

`npm run dev` requires `DATABASE_URL` pointing to a PostgreSQL database (e.g. the test one).

### With Docker and hot reload

```sh
make dev        # mounted sources, next dev, migrations on startup
make dev-logs   # follow the logs
make dev-stop   # stop (the database is kept)
make up         # switch back to the production image
make help       # all commands
```

After changing `package.json`, rerun `make dev`. Production never uses `docker-compose.dev.yml`.

### Tests in Docker

```sh
docker compose --profile test up -d db-test
docker compose --profile test run --rm tests   # typecheck + tests
```

### Local security audit

```sh
make audit-up   # throwaway instance (127.0.0.1:3100) + fake data
make audit      # gitleaks, semgrep, trivy, ZAP baseline, vitest (FULL=1: active ZAP scan)
make audit-down
```

### Remote deployment over SSH (optional)

`make deploy-remote` uploads the code to a server, runs typecheck and tests there against a throwaway database, writes a verified `pg_dump` backup to `backups/`, then replaces the container. Nothing is replaced if any step fails.

```sh
cp .deploy.env.example .deploy.env   # REMOTE_HOST, REMOTE_DIR, REMOTE_PROJECT
INIT=1 make deploy-remote            # first install (creates the database)
make deploy-remote                   # subsequent deployments
```

Requirements: key-based SSH access, and an existing `REMOTE_DIR` folder with its production `.env`. If a `.deploy-lock` file is left behind, make sure no deployment is running before removing it.

## Business rules

- **Members**: the admin changes roles and deactivates / reactivates accounts (never deletes them). A deactivated account loses its sessions but its transactions are kept. The household always keeps at least one active admin. Any member manages budgets, transactions, recurring items and loans; categories, members and settings are admin-only.
- **Amounts** are stored as integer cents, always > 0 (`CHECK` constraint); the direction comes from the type.
- **No bank accounts**: each transaction has a "paid / received by" field and a "shared" checkbox. The month's net (income − expenses) is computed, never stored.
- **Split**: planned shared expenses minus shared income, divided in proportion to personal income.
- **Monthly budget**: at most one per month, created explicitly. Lines are copied, so editing the catalog never changes an existing budget. A parent line with sub-lines equals the sum of its sub-lines. The budget never creates transactions.
- **Recurring items**: due dates are indicative; only the "mark as paid / received" action records the transaction.
- **Transactions**: one idempotency key per form (a double click does not create a duplicate).

## Contributing

Contributions are welcome.

1. Open an issue to discuss any significant change before coding.
2. Fork and create a branch (`feat/…`, `fix/…`).
3. Make sure `npm run typecheck` and `npm test` pass.
4. Write commit messages in [Conventional Commits](https://www.conventionalcommits.org/) format (`feat(scope): …`, `fix(scope): …`).
5. Open a pull request describing the change and how to test it.

Every Prisma migration must be non-destructive and preserve existing data.

## Security

**Do not report a vulnerability in a public issue.** Use [GitHub private vulnerability reporting](https://github.com/okhachiai/foyra/security/advisories/new).

Deployment best practices: change `POSTGRES_PASSWORD`, keep `APP_BIND=127.0.0.1` behind an HTTPS proxy, set `LLM_KEY_SECRET` if you store API keys, and back up regularly.

## License

[MIT](LICENSE) © 2026 KHACHIAI Oussama.
