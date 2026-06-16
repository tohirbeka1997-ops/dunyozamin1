#!/usr/bin/env bash
# =============================================================================
# Staff POS WebApp — Nginx + Let's Encrypt (alohida subdomain)
# =============================================================================
# Serverda (root):
#
#   chmod +x deploy/scripts/setup-staff-nginx.sh
#   sudo STAFF_DOMAIN=staff.example.com \
#        EMAIL=admin@example.com \
#        deploy/scripts/setup-staff-nginx.sh
#
# Env:
#   STAFF_DOMAIN   — majburiy (masalan staff.dunyozamin.com)
#   EMAIL          — Let's Encrypt email (majburiy)
#   UPSTREAM_PORT  — public-api port (default 3334)
#   SKIP_CERTBOT   — 1 = faqat HTTP vhost (test)
# =============================================================================

set -Eeuo pipefail

BLU=$'\e[1;34m'; GRN=$'\e[1;32m'; RED=$'\e[1;31m'; CLR=$'\e[0m'
log() { printf "%s[staff-nginx]%s %s\n" "$BLU" "$CLR" "$*"; }
ok()  { printf "%s[ ok ]%s %s\n" "$GRN" "$CLR" "$*"; }
err() { printf "%s[ERR]%s %s\n" "$RED" "$CLR" "$*" >&2; }

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  err "Root bo'lib ishga tushiring: sudo $0"
  exit 1
fi

: "${STAFF_DOMAIN:?STAFF_DOMAIN majburiy, masalan staff.example.com}"
: "${EMAIL:?EMAIL majburiy (Let's Encrypt)}"
UPSTREAM_PORT="${UPSTREAM_PORT:-3334}"
SKIP_CERTBOT="${SKIP_CERTBOT:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../nginx-staff-pos.conf.template"
OUT="/etc/nginx/sites-available/staff-pos.conf"

if [[ ! -f "$TEMPLATE" ]]; then
  err "Shablon topilmadi: $TEMPLATE"
  exit 1
fi

log "STAFF_DOMAIN=$STAFF_DOMAIN UPSTREAM=127.0.0.1:$UPSTREAM_PORT"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx >/dev/null 2>&1 || true

sed -e "s/__STAFF_DOMAIN__/${STAFF_DOMAIN}/g" \
    -e "s/__UPSTREAM_PORT__/${UPSTREAM_PORT}/g" \
    "$TEMPLATE" > "$OUT"

ln -sf "$OUT" /etc/nginx/sites-enabled/staff-pos.conf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl reload nginx
ok "nginx vhost: $OUT"

if [[ "$SKIP_CERTBOT" != "1" ]]; then
  certbot --nginx -d "$STAFF_DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
    err "certbot xato — DNS A-record $STAFF_DOMAIN → server IP ni tekshiring"
    exit 1
  }
  ok "HTTPS faollashtirildi: https://${STAFF_DOMAIN}/"
else
  log "SKIP_CERTBOT=1 — faqat HTTP"
fi

echo
echo "Keyingi qadamlar:"
echo "  1. /opt/pos/.env da STAFF_WEB_APP_URL=https://${STAFF_DOMAIN}/"
echo "  2. STAFF_BOT_TOKEN, STAFF_JWT_SECRET to'ldiring"
echo "  3. npm run deploy:staff (lokal) yoki sales-mobile/dist ni serverga nusxalang"
echo "  4. sudo systemctl restart public-api"
echo "  5. BotFather → Web App URL = https://${STAFF_DOMAIN}/"
echo "  6. curl -fsS https://${STAFF_DOMAIN}/health"
