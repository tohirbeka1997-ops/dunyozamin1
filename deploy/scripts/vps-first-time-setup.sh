#!/usr/bin/env bash
# =============================================================================
# VPS birinchi marta sozlash — Node 20, kataloglar, systemd, migratsiya
# =============================================================================
# Serverda (root yoki sudo):
#
#   git clone <repo> /opt/pos   # yoki rsync deploy:server dan keyin
#   chmod +x deploy/scripts/vps-first-time-setup.sh
#   sudo POS_ROOT=/opt/pos POS_DATA_DIR=/var/lib/pos \
#        deploy/scripts/vps-first-time-setup.sh
#
# Keyin: cp .env.server.example → /opt/pos/.env va to'ldiring
# =============================================================================

set -Eeuo pipefail

POS_ROOT="${POS_ROOT:-/opt/pos}"
POS_DATA_DIR="${POS_DATA_DIR:-/var/lib/pos}"
NODE_MAJOR_MIN="${NODE_MAJOR_MIN:-20}"

log() { echo "[vps-setup] $*"; }
err() { echo "[vps-setup] ERROR: $*" >&2; exit 1; }

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  err "Root/sudo kerak"
fi

log "POS_ROOT=$POS_ROOT POS_DATA_DIR=$POS_DATA_DIR"

# --- Node.js 20+ ---
if ! command -v node >/dev/null 2>&1; then
  log "Node.js o'rnatilmoqda (NodeSource 20.x)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "${NODE_MAJOR:-0}" -lt "$NODE_MAJOR_MIN" ]]; then
  err "Node.js ${NODE_MAJOR_MIN}+ kerak, hozir: $(node -v)"
fi
log "Node $(node -v)"

# --- Kataloglar ---
mkdir -p "$POS_ROOT" "$POS_DATA_DIR"
if [[ -d "$POS_DATA_DIR/tenants/default" ]]; then
  log "Multi-tenant DB katalogi mavjud"
else
  mkdir -p "$POS_DATA_DIR/tenants/default"
fi

# --- public-api deps ---
if [[ -f "$POS_ROOT/public-api/package.json" ]]; then
  log "public-api npm ci…"
  (cd "$POS_ROOT/public-api" && (npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts))
  log "better-sqlite3 rebuild…"
  (cd "$POS_ROOT/public-api" && npm rebuild better-sqlite3 --build-from-source || true)
else
  log "Ogohlantirish: $POS_ROOT/public-api yo'q — avval kodni joylang (deploy:server)"
fi

# --- Root deps (telegram bot) ---
if [[ -f "$POS_ROOT/package.json" ]]; then
  log "root npm ci (telegram bot runtime)…"
  (cd "$POS_ROOT" && (npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts))
fi

# --- systemd units ---
if [[ -f "$POS_ROOT/deploy/public-api.opt-pos.service.example" ]]; then
  cp "$POS_ROOT/deploy/public-api.opt-pos.service.example" /etc/systemd/system/public-api.service
  log "public-api.service o'rnatildi"
fi
if [[ -f "$POS_ROOT/deploy/telegram-bot.opt-pos.service.example" ]]; then
  cp "$POS_ROOT/deploy/telegram-bot.opt-pos.service.example" /etc/systemd/system/telegram-bot.service
  log "telegram-bot.service o'rnatildi"
fi

# --- .env shablon ---
if [[ ! -f "$POS_ROOT/.env" && -f "$POS_ROOT/.env.server.example" ]]; then
  cp "$POS_ROOT/.env.server.example" "$POS_ROOT/.env"
  log ".env yaratildi — TO'LDIRING: POS_HOST_SECRET, JWT_*, TELEGRAM_*, STAFF_*"
fi

# --- Migratsiya ---
if [[ -f "$POS_ROOT/scripts/migrate-pos-db.cjs" ]]; then
  log "DB migratsiya…"
  export POS_DATA_DIR
  (cd "$POS_ROOT" && node scripts/migrate-pos-db.cjs) || log "WARN: migratsiya xato — DB yo'lini tekshiring"
fi

systemctl daemon-reload
systemctl enable public-api telegram-bot 2>/dev/null || true

log "Tugadi. Keyingi qadamlar:"
echo "  1. nano $POS_ROOT/.env  — barcha secretlar"
echo "  2. systemctl start public-api telegram-bot"
echo "  3. curl http://127.0.0.1:3334/health"
echo "  4. deploy/FULL-PRODUCTION-DEPLOY-UZ.md — nginx + deploy"
