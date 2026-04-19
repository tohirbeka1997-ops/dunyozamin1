#!/usr/bin/env bash
# =============================================================================
# POS Frontend — lokalda build + serverga yuklash (rsync)
# =============================================================================
# Ishlatish (lokal mashinada, loyiha rootidan):
#
#   chmod +x deploy/scripts/frontend-build-and-publish.sh
#   SERVER=pos@api.example.com \
#   REMOTE_PATH=/var/www/pos \
#   API_URL=https://api.example.com \
#   API_SECRET="<POS_HOST_SECRET bilan bir xil>" \
#   deploy/scripts/frontend-build-and-publish.sh
#
# Environment:
#   SERVER       — SSH manzil (user@host) (MAJBURIY)
#   REMOTE_PATH  — server'dagi web root (default: /var/www/pos)
#   API_URL      — frontend ishlatadigan RPC URL (MAJBURIY)
#   API_SECRET   — VITE_POS_RPC_SECRET (MAJBURIY; POS_HOST_SECRET bilan bir xil)
#   SKIP_BUILD   — 1 bo'lsa build'siz, mavjud dist/ ni yuboradi
#   NO_RESTART_NGINX — 1 bo'lsa server'da nginx reload bajarilmaydi
#   SSH_OPTS     — qo'shimcha ssh opsiyalar (masalan: "-i ~/.ssh/pos_key -p 22")
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

BLU=$'\e[1;34m'; GRN=$'\e[1;32m'; YLW=$'\e[1;33m'; RED=$'\e[1;31m'; CLR=$'\e[0m'
log()  { printf "%s[publish]%s %s\n" "$BLU" "$CLR" "$*"; }
ok()   { printf "%s[ ok ]%s %s\n" "$GRN" "$CLR" "$*"; }
warn() { printf "%s[warn]%s %s\n" "$YLW" "$CLR" "$*"; }
err()  { printf "%s[ERR]%s %s\n" "$RED" "$CLR" "$*" >&2; }

# ---------- Env validatsiya ---------------------------------------------------
: "${SERVER:?SERVER majburiy, masalan: SERVER=pos@api.example.com}"
: "${API_URL:?API_URL majburiy, masalan: API_URL=https://api.example.com}"
: "${API_SECRET:?API_SECRET majburiy (VITE_POS_RPC_SECRET)}"

REMOTE_PATH="${REMOTE_PATH:-/var/www/pos}"
SKIP_BUILD="${SKIP_BUILD:-0}"
NO_RESTART_NGINX="${NO_RESTART_NGINX:-0}"
SSH_OPTS="${SSH_OPTS:-}"

log "SERVER=$SERVER"
log "REMOTE_PATH=$REMOTE_PATH"
log "API_URL=$API_URL"
log "SKIP_BUILD=$SKIP_BUILD"

# ---------- SSH reachability tekshiruv ---------------------------------------
log "SSH ulanishini tekshirish…"
# shellcheck disable=SC2086
if ! ssh $SSH_OPTS -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" "true" 2>/dev/null; then
  err "SSH ulanib bo'lmadi: $SERVER"
  err "Tekshiring: ssh $SSH_OPTS $SERVER"
  exit 1
fi
ok "SSH OK"

# ---------- Loyiha rootini topish --------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# ---------- Build -------------------------------------------------------------
if [[ "$SKIP_BUILD" == "1" ]]; then
  log "SKIP_BUILD=1 — build'siz, mavjud dist/ ishlatiladi"
else
  log "Frontend build… (Vite, env VITE_POS_RPC_URL/SECRET injektsiya qilinadi)"

  # Vite .env.production.local ni ustunroq o'qiydi — vaqtinchalik yaratamiz
  TMP_ENV=".env.production.local"
  ORIG_BACKUP=""
  if [[ -f "$TMP_ENV" ]]; then
    ORIG_BACKUP="${TMP_ENV}.bak.$$"
    cp "$TMP_ENV" "$ORIG_BACKUP"
    warn "Mavjud $TMP_ENV zaxira: $ORIG_BACKUP"
  fi
  cat > "$TMP_ENV" <<EOF
VITE_POS_RPC_URL=$API_URL
VITE_POS_RPC_SECRET=$API_SECRET
EOF

  set +e
  npm run build
  BUILD_EXIT=$?
  set -e

  # Env fayl va zaxirani qaytarish (secret .env.production.local'da qolmasin)
  rm -f "$TMP_ENV"
  if [[ -n "$ORIG_BACKUP" ]]; then
    mv "$ORIG_BACKUP" "$TMP_ENV"
  fi

  if [[ $BUILD_EXIT -ne 0 ]]; then
    err "npm run build bajarilmadi (exit $BUILD_EXIT)"
    exit $BUILD_EXIT
  fi
  ok "Build muvaffaqiyatli: dist/"
fi

if [[ ! -d dist ]]; then
  err "dist/ katalogi topilmadi — SKIP_BUILD=0 bilan build qiling"
  exit 1
fi

# ---------- Atomic swap uchun releases dir ------------------------------------
REV="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_RELEASES="$REMOTE_PATH/../pos-releases"

log "Releases katalog: $REMOTE_RELEASES/$REV"

# shellcheck disable=SC2086
ssh $SSH_OPTS "$SERVER" "mkdir -p '$REMOTE_RELEASES/$REV'"

# ---------- Upload (rsync) ----------------------------------------------------
if ! command -v rsync >/dev/null 2>&1; then
  err "rsync topilmadi (lokal mashinada). Windows foydalanuvchilari: Git Bash yoki WSL ishlating."
  exit 1
fi

log "Fayllarni yuborish…"
# shellcheck disable=SC2086
rsync -az --delete --info=stats2 \
  -e "ssh $SSH_OPTS" \
  dist/ \
  "$SERVER:$REMOTE_RELEASES/$REV/"
ok "Yuklandi"

# ---------- Server tomonda atomic switch + cleanup ----------------------------
log "Aktiv versiyani yangilash…"
# shellcheck disable=SC2086
ssh $SSH_OPTS "$SERVER" bash -s -- "$REMOTE_PATH" "$REMOTE_RELEASES" "$REV" "$NO_RESTART_NGINX" <<'REMOTE'
set -Eeuo pipefail
WEB_ROOT="$1"
RELEASES="$2"
REV="$3"
NO_RESTART_NGINX="$4"

# WEB_ROOT ni symlink yoki directoryga o'tkazish
NEW="$RELEASES/$REV"

# Agar WEB_ROOT oddiy katalog bo'lsa — bir martalik migratsiya
if [[ -d "$WEB_ROOT" && ! -L "$WEB_ROOT" ]]; then
  BAKUP="${WEB_ROOT}.initial.$(date +%s)"
  echo "[remote] $WEB_ROOT oddiy katalog; zaxira: $BAKUP"
  mv "$WEB_ROOT" "$BAKUP" || true
fi

mkdir -p "$RELEASES"

# Atomic symlink swap
ln -sfn "$NEW" "${WEB_ROOT}.tmp"
mv -T "${WEB_ROOT}.tmp" "$WEB_ROOT"

# www-data ga ruxsat
sudo -n chown -R www-data:www-data "$NEW" 2>/dev/null || chown -R www-data:www-data "$NEW" 2>/dev/null || true

# Faqat eng so'nggi 5 versiyani qoldirish
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
echo "[remote] aktiv: $NEW"

# Nginx reload (fayl cache'lar uchun)
if [[ "$NO_RESTART_NGINX" != "1" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    sudo -n systemctl reload nginx 2>/dev/null \
      || systemctl reload nginx 2>/dev/null \
      || echo "[remote] nginx reload o'tkazib yuborildi (ruxsat yo'q)"
  fi
fi
REMOTE

ok "Deploy yakunlandi (rev=$REV)"

# ---------- Healthcheck -------------------------------------------------------
log "Frontend mavjudligini tekshirish: $API_URL"
HEALTH_URL="${API_URL%/}/health"
if curl -sk --max-time 8 "$HEALTH_URL" | grep -q '"ok"'; then
  ok "$HEALTH_URL → OK"
else
  warn "Healthcheck $HEALTH_URL javob bermadi (backend ishlayotganligini tekshiring)"
fi

cat <<EOF

${GRN}════════════════════════════════════════════════════════════════${CLR}
  Deploy: OK
  Revision: $REV
  Frontend URL: ${API_URL%/}/
  Rollback:
    ssh $SERVER 'ls $REMOTE_RELEASES'
    ssh $SERVER 'ln -sfn $REMOTE_RELEASES/<OLDREV> $REMOTE_PATH.tmp && mv -T $REMOTE_PATH.tmp $REMOTE_PATH'
${GRN}════════════════════════════════════════════════════════════════${CLR}
EOF
