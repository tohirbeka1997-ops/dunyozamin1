#!/usr/bin/env bash
# =============================================================================
# POS — weekly restore drill
# =============================================================================
# Proves that the latest off-site backup is:
#   1. Downloadable from the remote
#   2. A valid SQLite database (PRAGMA integrity_check => "ok")
#   3. Bootable — spins up a disposable pos-server container pointing at the
#      restored DB and hits /health.
#
# NOTHING in production is touched. The drill runs in /tmp/pos-restore-drill
# and cleans up on exit (trap). If ANY step fails the script exits non-zero
# so a cron failure (or a GitHub Actions scheduled workflow) alerts you.
#
# Usage:
#   bash /opt/pos/deploy/scripts/restore-drill.sh
#
# Exit codes:
#   0 — drill passed
#   1 — configuration error
#   2 — remote empty / no backups found
#   3 — downloaded file corrupt or invalid
#   4 — restored server failed /health within timeout
# =============================================================================
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
DRILL_DIR="${DRILL_DIR:-/tmp/pos-restore-drill}"
DRILL_PORT="${DRILL_PORT:-33330}"
DRILL_CONTAINER="pos-restore-drill"
DRILL_IMAGE="${DRILL_IMAGE:-}"

# Load /opt/pos/.env when running via cron / systemd (interactive shells will
# have already exported these).
if [[ -f /opt/pos/.env ]]; then
  set -a; . /opt/pos/.env; set +a
fi

REMOTE="${POS_BACKUP_REMOTE:-offsite}"
REMOTE_PATH="${POS_BACKUP_REMOTE_PATH:-pos-backups}"
TARGET="${REMOTE}:${REMOTE_PATH%/}"

# Locate rclone.conf (same logic as backup-offsite.sh)
if [[ -z "${RCLONE_CONFIG:-}" ]]; then
  for p in \
    /opt/pos/deploy/backup/rclone.conf \
    /etc/rclone/rclone.conf \
    "$HOME/.config/rclone/rclone.conf"; do
    [[ -f "$p" ]] && { RCLONE_CONFIG="$p"; break; }
  done
fi
export RCLONE_CONFIG

if [[ -z "${RCLONE_CONFIG:-}" ]]; then
  log "ERROR: rclone.conf not found."
  exit 1
fi
if ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: rclone not installed."
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  log "ERROR: sqlite3 CLI not installed (apt install -y sqlite3)."
  exit 1
fi

# Auto-detect pos-server image: use whatever the running container uses.
if [[ -z "$DRILL_IMAGE" ]]; then
  if command -v docker >/dev/null 2>&1 && docker inspect pos-server >/dev/null 2>&1; then
    DRILL_IMAGE=$(docker inspect --format '{{.Config.Image}}' pos-server)
  fi
fi
if [[ -z "$DRILL_IMAGE" ]]; then
  log "ERROR: could not determine pos-server image. Set DRILL_IMAGE=ghcr.io/…"
  exit 1
fi

# -----------------------------------------------------------------------------
# Prepare drill dir (clean on every run).
# -----------------------------------------------------------------------------
rm -rf "$DRILL_DIR"
mkdir -p "$DRILL_DIR/data/backups"

# Always clean up disposable resources, even on failure.
cleanup() {
  local rc=$?
  log "cleanup (exit=$rc)…"
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
  # Keep the drill dir if the run failed — aids debugging.
  if [[ $rc -eq 0 ]]; then rm -rf "$DRILL_DIR"; fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# -----------------------------------------------------------------------------
# 1) Pick the newest snapshot on the remote.
# -----------------------------------------------------------------------------
log "listing backups at $TARGET"
NEWEST=$(rclone --config="$RCLONE_CONFIG" lsf "$TARGET/" \
  --include 'pos-*.db' \
  --format 'tp' --separator '|' 2>/dev/null \
  | sort -t'|' -k1,1 | tail -1 | cut -d'|' -f2 || true)

if [[ -z "$NEWEST" ]]; then
  log "ERROR: no pos-*.db files found in $TARGET"
  exit 2
fi
log "newest snapshot: $NEWEST"

# -----------------------------------------------------------------------------
# 2) Download and verify.
# -----------------------------------------------------------------------------
log "downloading to $DRILL_DIR/"
rclone --config="$RCLONE_CONFIG" copyto \
  "$TARGET/$NEWEST" "$DRILL_DIR/data/pos.db"

SIZE=$(stat -c %s "$DRILL_DIR/data/pos.db" 2>/dev/null || stat -f %z "$DRILL_DIR/data/pos.db")
if [[ "$SIZE" -lt 4096 ]]; then
  log "ERROR: downloaded file too small ($SIZE bytes); refuses to proceed"
  exit 3
fi

# Basic integrity: PRAGMA integrity_check.
log "integrity check"
RESULT=$(sqlite3 "$DRILL_DIR/data/pos.db" 'PRAGMA integrity_check;' 2>&1 || true)
if [[ "$RESULT" != "ok" ]]; then
  log "ERROR: integrity_check failed: $RESULT"
  exit 3
fi

# Sanity-check schema: at least one known table must exist.
TABLES=$(sqlite3 "$DRILL_DIR/data/pos.db" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('products','users','sales_orders');" 2>/dev/null | wc -l)
if [[ "$TABLES" -lt 2 ]]; then
  log "ERROR: schema looks wrong (expected products/users/sales_orders, found $TABLES)"
  exit 3
fi
log "✓ integrity + schema OK ($SIZE bytes)"

# -----------------------------------------------------------------------------
# 3) Boot a disposable pos-server and hit /health.
# -----------------------------------------------------------------------------
log "spinning up disposable pos-server on :$DRILL_PORT"
DRILL_SECRET=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | base64)

docker run -d --rm \
  --name "$DRILL_CONTAINER" \
  -p "127.0.0.1:${DRILL_PORT}:3333" \
  -e NODE_ENV=production \
  -e POS_SERVER_MODE=1 \
  -e POS_DATA_DIR=/var/lib/pos \
  -e POS_HOST_BIND=0.0.0.0 \
  -e POS_HOST_PORT=3333 \
  -e POS_HOST_SECRET="$DRILL_SECRET" \
  -e POS_CORS_ORIGINS="*" \
  -e POS_BACKUP_ENABLED=0 \
  -v "$DRILL_DIR/data":/var/lib/pos \
  "$DRILL_IMAGE" \
  >/dev/null

# Poll /health.
OK=0
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DRILL_PORT}/health" || echo 000)
  if [[ "$CODE" == "200" ]]; then OK=1; break; fi
  sleep 1
done

if [[ "$OK" -ne 1 ]]; then
  log "ERROR: /health never returned 200"
  docker logs --tail=50 "$DRILL_CONTAINER" || true
  exit 4
fi

# Bonus: verify we can still read a few rows via RPC.
RPC_RESP=$(curl -s -X POST "http://127.0.0.1:${DRILL_PORT}/rpc" \
  -H "Authorization: Bearer $DRILL_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"channel":"pos:debug:tableCounts","args":[]}' || echo '')
if [[ "$RPC_RESP" == *'"ok":true'* ]]; then
  log "✓ tableCounts RPC returned OK"
else
  log "WARN: tableCounts RPC did not return ok=true (response: ${RPC_RESP:0:200})"
fi

log "✅ RESTORE DRILL PASSED — remote backup '$NEWEST' is usable"
exit 0
