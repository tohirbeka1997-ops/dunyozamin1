#!/usr/bin/env bash
# =============================================================================
# POS Server — Nginx + SSL bir buyruqli setup (Ubuntu 22.04/24.04)
# =============================================================================
# Ishlatish (serverda, root yoki sudoer bilan):
#
#   chmod +x deploy/scripts/setup-nginx.sh
#   sudo DOMAIN=pos.example.com API_DOMAIN=api.example.com \
#        EMAIL=admin@example.com \
#        deploy/scripts/setup-nginx.sh
#
# Environment:
#   DOMAIN        — asosiy domen (MAJBURIY)
#   API_DOMAIN    — API uchun alohida sub-domen (ixtiyoriy; bo'sh bo'lsa DOMAIN)
#   EMAIL         — Let's Encrypt uchun email (MAJBURIY)
#   WEB_ROOT      — frontend dist manzili (default: /var/www/pos)
#   UPSTREAM_HOST — Node server binding (default: 127.0.0.1)
#   UPSTREAM_PORT — Node server port (default: 3333)
#   CLIENT_MAX_BODY — upload limiti (default: 25m)
#   SKIP_CERTBOT  — 1 bo'lsa faqat HTTP vhost o'rnatadi (test uchun)
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

# ---------- Log funksiyalari --------------------------------------------------
BLU=$'\e[1;34m'; GRN=$'\e[1;32m'; YLW=$'\e[1;33m'; RED=$'\e[1;31m'; CLR=$'\e[0m'
log()  { printf "%s[nginx-setup]%s %s\n" "$BLU" "$CLR" "$*"; }
ok()   { printf "%s[ ok ]%s %s\n" "$GRN" "$CLR" "$*"; }
warn() { printf "%s[warn]%s %s\n" "$YLW" "$CLR" "$*"; }
err()  { printf "%s[ERR]%s %s\n" "$RED" "$CLR" "$*" >&2; }

# ---------- Root tekshiruvi ---------------------------------------------------
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  err "Root bo'lib ishga tushiring: sudo $0"
  exit 1
fi

# ---------- Env validatsiya ---------------------------------------------------
: "${DOMAIN:?DOMAIN majburiy, masalan: DOMAIN=pos.example.com}"
: "${EMAIL:?EMAIL majburiy (Lets Encrypt uchun), masalan: EMAIL=admin@example.com}"
API_DOMAIN="${API_DOMAIN:-$DOMAIN}"
WEB_ROOT="${WEB_ROOT:-/var/www/pos}"
UPSTREAM_HOST="${UPSTREAM_HOST:-127.0.0.1}"
UPSTREAM_PORT="${UPSTREAM_PORT:-3333}"
CLIENT_MAX_BODY="${CLIENT_MAX_BODY:-25m}"
SKIP_CERTBOT="${SKIP_CERTBOT:-0}"

log "DOMAIN=$DOMAIN"
log "API_DOMAIN=$API_DOMAIN"
log "WEB_ROOT=$WEB_ROOT"
log "UPSTREAM=$UPSTREAM_HOST:$UPSTREAM_PORT"
log "CLIENT_MAX_BODY=$CLIENT_MAX_BODY"

# ---------- Paketlarni o'rnatish ---------------------------------------------
log "APT paketlarini o'rnatish…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx ssl-cert >/dev/null
ok "nginx + certbot o'rnatildi"

# ---------- Katalog va default index fayl -------------------------------------
log "Web root yaratish: $WEB_ROOT"
mkdir -p "$WEB_ROOT"
if [[ ! -f "$WEB_ROOT/index.html" ]]; then
  cat > "$WEB_ROOT/index.html" <<EOF
<!doctype html>
<html><head><meta charset="utf-8"><title>POS — hozircha bo'sh</title></head>
<body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto;color:#333">
<h1>POS server tayyor</h1>
<p>Frontend hali yuklanmagan. <code>frontend-build-and-publish.sh</code> skriptini ishga tushiring.</p>
<p>API healthcheck: <a href="/health">/health</a></p>
</body></html>
EOF
  ok "Placeholder index.html yozildi"
fi
chown -R www-data:www-data "$WEB_ROOT"

# Certbot webroot challenge uchun
mkdir -p /var/www/certbot
chown -R www-data:www-data /var/www/certbot

# ---------- Vhost shablonni rendering qilish ----------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$REPO_ROOT/deploy/nginx/pos.conf.template"
TARGET="/etc/nginx/sites-available/pos.conf"

if [[ ! -f "$TEMPLATE" ]]; then
  err "Shablon topilmadi: $TEMPLATE"
  exit 1
fi

log "Vhost shablonini rendering qilish → $TARGET"
# Escape slashlarni sed uchun
esc() { printf '%s\n' "$1" | sed -e 's/[\/&]/\\&/g'; }

sed \
  -e "s/__DOMAIN__/$(esc "$DOMAIN")/g" \
  -e "s/__API_DOMAIN__/$(esc "$API_DOMAIN")/g" \
  -e "s/__WEB_ROOT__/$(esc "$WEB_ROOT")/g" \
  -e "s/__UPSTREAM_HOST__/$(esc "$UPSTREAM_HOST")/g" \
  -e "s/__UPSTREAM_PORT__/$(esc "$UPSTREAM_PORT")/g" \
  -e "s/__CLIENT_MAX_BODY__/$(esc "$CLIENT_MAX_BODY")/g" \
  "$TEMPLATE" > "$TARGET"

# Default Nginx welcome page'ni o'chirish
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
  ok "Default vhost o'chirildi"
fi

# Enable pos.conf
ln -sfn "$TARGET" /etc/nginx/sites-enabled/pos.conf

# ---------- Nginx syntax tekshiruvi -------------------------------------------
log "nginx -t (syntax tekshiruvi)…"
if ! nginx -t 2>/tmp/nginx-check.log; then
  err "Nginx konfiguratsiyasi noto'g'ri:"
  cat /tmp/nginx-check.log >&2
  exit 1
fi
ok "Nginx syntax valid"

systemctl reload nginx
ok "Nginx qayta yuklandi (HTTP vhost aktiv)"

# ---------- Certbot (HTTPS) ---------------------------------------------------
if [[ "$SKIP_CERTBOT" == "1" ]]; then
  warn "SKIP_CERTBOT=1 — Let's Encrypt o'tkazib yuborildi. HTTPS yo'q."
else
  log "Let's Encrypt sertifikat olish…"
  # Har bir -d alohida argument bo'lishi kerak (aks holda certbot bitta nom sifatida
  # "app... -d api..." ni oladi va Let's Encrypt "invalid character" beradi).
  CERTBOT_DOMAINS=(-d "$DOMAIN")
  if [[ "$API_DOMAIN" != "$DOMAIN" ]]; then
    CERTBOT_DOMAINS+=(-d "$API_DOMAIN")
  fi

  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    --no-eff-email \
    "${CERTBOT_DOMAINS[@]}"
  ok "HTTPS yoqildi — sertifikat avtomatik yangilanadi"

  # Timer holati
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  systemctl status certbot.timer --no-pager | head -n 3 || true
fi

# ---------- Firewall ----------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  log "UFW qoidalarini tekshirish…"
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "Firewall: 80/443 ochiq"
fi

# ---------- Yakuniy tekshiruv -------------------------------------------------
log "Yakuniy health tekshiruv…"
sleep 1
if curl -sk --max-time 5 "https://$DOMAIN/health" | grep -q '"ok"'; then
  ok "https://$DOMAIN/health javob beryapti"
elif curl -s --max-time 5 "http://$DOMAIN/health" | grep -q '"ok"'; then
  warn "HTTP ishlaydi lekin HTTPS javob bermadi (certbot xatoni qayta tekshiring)"
else
  warn "Healthcheck javob bermadi — backend ($UPSTREAM_HOST:$UPSTREAM_PORT) ishga tushganligini tekshiring"
fi

ok "Tayyor!"
cat <<EOF

${GRN}════════════════════════════════════════════════════════════════${CLR}
  POS Nginx deploy tayyor

  Frontend:        https://$DOMAIN/
  API (RPC):       https://$API_DOMAIN/rpc
  Health:          https://$DOMAIN/health
  Vhost:           /etc/nginx/sites-available/pos.conf
  Access log:      /var/log/nginx/pos.access.log
  Error log:       /var/log/nginx/pos.error.log

  Keyingi qadamlar:
    1) Backend ishlayotganini tekshiring:
         systemctl status pos-server    # yoki docker ps
    2) Frontend'ni yuklang:
         # Lokaldan:
         deploy/scripts/frontend-build-and-publish.sh
    3) Sertifikat avtomatik yangilanadi (certbot.timer).
${GRN}════════════════════════════════════════════════════════════════${CLR}
EOF
