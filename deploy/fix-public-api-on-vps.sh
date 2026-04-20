#!/usr/bin/env bash
# VPS (SSH) da ishga tushiring: bash deploy/fix-public-api-on-vps.sh
# yoki: curl ... | bash  — avval loyihani /opt/pos ga git pull qiling.
set -euo pipefail

POS_ROOT="${POS_ROOT:-/opt/pos}"
API_DIR="$POS_ROOT/public-api"
DB_DIR="${POS_DATA_DIR:-/var/lib/pos}"
DB_FILE="$DB_DIR/pos.db"

echo "[fix-public-api] POS_ROOT=$POS_ROOT API_DIR=$API_DIR DB=$DB_FILE"

if [[ ! -f "$API_DIR/package.json" ]]; then
  echo "[fix-public-api] Xato: $API_DIR/package.json yo'q. POS_ROOT ni tekshiring."
  exit 1
fi

command -v npm >/dev/null || { echo "[fix-public-api] npm kerak"; exit 1; }

echo "[fix-public-api] npm ci (public-api)..."
(cd "$API_DIR" && (npm ci || npm install))

echo "[fix-public-api] better-sqlite3 qayta yig'ilmoqda..."
(cd "$API_DIR" && npm rebuild better-sqlite3)

mkdir -p "$DB_DIR"
if [[ ! -f "$DB_FILE" ]]; then
  echo "[fix-public-api] pos.db yaratilmoqda: $DB_FILE"
  (cd "$API_DIR" && node -e "
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const p = process.argv[1];
    fs.mkdirSync(require('path').dirname(p), { recursive: true });
    if (!fs.existsSync(p)) { const db = new Database(p); db.close(); console.log('created', p); }
  " "$DB_FILE")
fi

if [[ ! -f "$POS_ROOT/scripts/migrate-pos-db.cjs" ]]; then
  echo "[fix-public-api] Ogohlantirish: migrate skripti yo'q, migratsiyasiz davom etamiz."
else
  echo "[fix-public-api] migrate:pos..."
  export POS_DATA_DIR="${POS_DATA_DIR:-/var/lib/pos}"
  export NODE_PATH="$API_DIR/node_modules${NODE_PATH:+:$NODE_PATH}"
  (cd "$POS_ROOT" && node scripts/migrate-pos-db.cjs)
fi

echo "[fix-public-api] systemd qayta ishga tushirilmoqda..."
systemctl restart public-api telegram-bot || true
sleep 2
systemctl --no-pager -l status public-api || true

echo "[fix-public-api] Tekshiruv: curl -sS http://127.0.0.1:3334/v1/categories | head -c 200"
curl -sS http://127.0.0.1:3334/v1/categories | head -c 200 || true
echo
echo "[fix-public-api] Tugadi."
