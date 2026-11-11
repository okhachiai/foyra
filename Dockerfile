FROM node:22-trixie-slim AS base
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
ARG APP_URL=""
ENV APP_URL=$APP_URL
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# Outillage de développement : dépendances complètes pour la vérification de types et les tests (service `tests`).
FROM base AS dev
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .

# CLI Prisma autonome pour `migrate deploy` au démarrage (le build standalone ne l'embarque pas).
FROM base AS prisma-cli
WORKDIR /prisma-cli
RUN npm init -y >/dev/null && npm pkg set 'overrides.deepmerge-ts=^8.0.0' \
  && npm install --omit=dev --no-audit --no-fund prisma@6.19.3

# Runtime distroless : ni shell, ni gestionnaire de paquets, ni npm (surface d'attaque et CVE minimales).
# Node est /nodejs/bin/node (hors PATH) ; utilisateur nonroot (uid 65532).
FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=prisma-cli /prisma-cli /prisma-cli
COPY --from=build --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
# `docker compose exec app /nodejs/bin/node scripts/reset-password.mjs` (dépendances tracées dans le standalone).
COPY --from=build /app/scripts ./scripts
COPY docker-entrypoint.mjs ./docker-entrypoint.mjs
USER nonroot
EXPOSE 3000
CMD ["docker-entrypoint.mjs"]
