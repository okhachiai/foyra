FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
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

# CLI Prisma autonome pour `migrate deploy` au démarrage (le build standalone ne l'embarque pas).
FROM base AS prisma-cli
WORKDIR /prisma-cli
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund prisma@6.19.3

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=prisma-cli /prisma-cli /prisma-cli
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
