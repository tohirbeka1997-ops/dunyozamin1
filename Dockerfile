# syntax=docker/dockerfile:1.6

# =============================================================================
# POS Server — Docker image (Hetzner / Linux VPS uchun)
# =============================================================================
# Multi-stage build:
#   1) deps-builder  — native build tools bilan better-sqlite3 ni kompilyatsiya qiladi
#   2) runtime       — toza slim image, faqat runtime uchun kerakli fayllar
#
# Ishlatish:
#   docker build -t pos-server:latest .
#   docker run --rm -p 3333:3333 \
#     -e POS_HOST_SECRET="$(openssl rand -hex 32)" \
#     -e POS_HOST_BIND=0.0.0.0 \
#     -v pos-data:/var/lib/pos \
#     pos-server:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: native dependencies builder
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps-builder

# native build tools (better-sqlite3 uchun)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# faqat manifestlarni ko'chirib, cache layer qilish
COPY package.json package-lock.json* ./

# Production'da kerak bo'lmagan devDependencies'sis + Electron'siz:
#   - POSTINSTALL'ni o'chiramiz, chunki `electron-builder install-app-deps`
#     bu serverda ishlamaydi (electron mavjud emas).
#   - better-sqlite3 Linux x64 ABI uchun source'dan build bo'ladi.
ENV npm_config_build_from_source=true \
    npm_config_sqlite_debug=false \
    CI=1 \
    HUSKY=0

RUN npm pkg delete scripts.postinstall \
    && npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps

# better-sqlite3'ni aniq shu Node versiyasi uchun qaytadan kompilyatsiya qilish
RUN npm rebuild better-sqlite3 --build-from-source


# -----------------------------------------------------------------------------
# Stage 2: runtime (slim, no build tools)
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

# tini — signal forwarding (PID 1 muammolarini hal qiladi); ca-certificates — HTTPS outbound
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# non-root user (xavfsizlik)
RUN groupadd --system --gid 1001 pos \
    && useradd --system --uid 1001 --gid pos --home /app --shell /bin/bash pos

WORKDIR /app

# build stage'dan kompilyatsiya qilingan node_modules
COPY --from=deps-builder --chown=pos:pos /build/node_modules ./node_modules
COPY --from=deps-builder --chown=pos:pos /build/package.json  ./package.json

# faqat server ishlashi uchun kerakli manba fayllar
COPY --chown=pos:pos electron ./electron
COPY --chown=pos:pos .env.server.example ./.env.server.example

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# data volume mount point
RUN mkdir -p /var/lib/pos && chown -R pos:pos /var/lib/pos
VOLUME ["/var/lib/pos"]

# Root: entrypoint volume huquqlarini tuzatadi, keyin `pos` ga tushadi (docker-entrypoint.sh).

# default env (compose/deploy bilan ustiga yozish mumkin)
ENV NODE_ENV=production \
    POS_SERVER_MODE=1 \
    POS_DATA_DIR=/var/lib/pos \
    POS_HOST_BIND=0.0.0.0 \
    POS_HOST_PORT=3333

EXPOSE 3333

# healthcheck — /health endpoint'iga so'rov (root: USER pos emas, entrypoint dan keyin ham root healthcheck ishlashi uchun)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.POS_HOST_PORT||3333)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "electron/server.cjs"]
