#!/usr/bin/env bash
# VPS (root) da bir marta: Mini App nginx + build
#   cd /opt/pos && git pull && bash deploy/apply-miniapp-nginx-on-server.sh
set -euo pipefail

CONF="${1:-/etc/nginx/sites-enabled/pos.conf}"
ROOT="/opt/pos"
cd "$ROOT"

if [[ ! -f "$CONF" ]]; then
  echo "Fayl yo'q: $CONF"
  exit 1
fi

# MUHIM: zaxira sites-enabled ichida bo'lmasin — nginx *.bak fayllarni ham o'qiydi (duplicate upstream)
BACKUP_DIR="${BACKUP_DIR:-/root/nginx-pos-backups}"
mkdir -p "$BACKUP_DIR"
cp -a "$CONF" "$BACKUP_DIR/pos.conf.bak.$(date +%s)"
echo "Zaxira: $BACKUP_DIR/pos.conf.bak.*"

python3 "$ROOT/deploy/scripts/patch-nginx-miniapp.py" "$CONF"

nginx -t
systemctl reload nginx

echo "mini-app build..."
npm ci --prefix "$ROOT/mini-app"
npm run build --prefix "$ROOT/mini-app"

echo ""
echo "Tekshiruv:"
curl -sS -o /dev/null -w "https app: HTTP %{http_code}\n" "https://127.0.0.1/" -k -H "Host: app.dunyozamin.com" || true
curl -sS "http://127.0.0.1:3334/health" | head -c 120
echo ""

echo "Tayyor. Telegramda Web App ni qayta oching."
