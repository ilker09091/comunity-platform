# syntax=docker/dockerfile:1.7

# ---------- Dependencies ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Build ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- Runtime ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd  --system --uid 1001 --gid nodejs --home /app nextjs

# Next.js standalone bundle contains server.js + minimal node_modules.
COPY --chown=nextjs:nodejs --from=build /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=build /app/.next/static    ./.next/static
COPY --chown=nextjs:nodejs --from=build /app/public          ./public

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
