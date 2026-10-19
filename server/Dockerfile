# syntax=docker/dockerfile:1.7

# ---------- Base ----------
FROM node:24-bookworm-slim AS base
WORKDIR /app
# Build stages need devDependencies — only the runtime stage sets production.
ENV NODE_ENV=development

# Native dependencies required by sharp (libvips) and argon2 at build time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        libvips-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---------- Dependencies ----------
FROM base AS deps
COPY package.json package-lock.json ./
# argon2 needs its install script (native build); allow all scripts under npm 11+.
RUN npm config set script-shell /bin/sh \
    && npm ci --include=dev --foreground-scripts

# ---------- Build ----------
FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ---------- Runtime ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3002 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# Runtime libraries for sharp (libvips) and ffmpeg (video compression: every upload becomes H.264/AAC MP4).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libvips \
        ffmpeg \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd  --system --uid 1001 --gid nodejs --home /app nestjs \
    && mkdir -p /app/storage/media /app/storage/importer-control /app/storage/turn-control \
    && chown -R nestjs:nodejs /app

COPY --chown=nestjs:nodejs --from=build /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=build /app/dist         ./dist
COPY --chown=nestjs:nodejs package.json package-lock.json ./

USER nestjs
EXPOSE 3002

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
