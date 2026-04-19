#!/usr/bin/env bash
# =============================================================================
# POS — off-site backup sync (host cron OR docker sidecar)
# =============================================================================
# Workflow (idempotent, safe to run every hour):
#   1. Force a fresh snapshot via POST /rpc  pos:database:backup
#      (optional — skipped if POS_BACKUP_RPC=0). This makes the remote copy
#      never lag more than one tick behind live data.
#   2. `rclone copy` local /var/lib/pos/backups/  ->  offsite:<path>
#      (copy, not sync — we prefer additive writes over deletions).
#   3. Prune old files on the remote (> POS_BACKUP_REMOTE_RETENTION_DAYS).
#   4. Touch sentinel `.last-offsite-sync` so the Prometheus gauge updates.
#
# ENV (all come from /opt/pos/.env, loaded by the caller or wired via compose):
#   POS_DATA_DIR                 — /var/lib/pos
#   POS_BACKUP_REMOTE            — rclone remote name (e.g. `offsite`)
#   POS_BACKUP_REMOTE_PATH       — remote sub-path (e.g. `pos-backups/prod`)
#   POS_BACKUP_REMOTE_RETENTION_DAYS — how long to keep on remote (days)
#   POS_HOST_SECRET              — used for the optional pre-snapshot RPC
#   POS_HOST_PORT                — default 3333
#   POS_BACKUP_RPC               — 1 to force a snapshot (default 1)
#   RCLONE_CONFIG                — path to rclone.conf (auto-detected below)
#
# Exit codes:
#   0  — success (or nothing to do)
#   1  — configuration/usage error (no retry)
#   2  — rclone failure (transient; caller may retry)
# =============================================================================
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

DATA_DIR="${POS_DATA_DIR:-/var/lib/pos}"
BACKUP_DIR="${POS_BACKUP_DIR:-$DATA_DIR/backups}"
REMOTE="${POS_BACKUP_REMOTE:-offsite}"
REMOTE_PATH="${POS_BACKUP_REMOTE_PATH:-pos-backups}"
RETENTION_DAYS="${POS_BACKUP_REMOTE_RETENTION_DAYS:-30}"
HOST_PORT="${POS_HOST_PORT:-3333}"
FORCE_RPC="${POS_BACKUP_RPC:-1}"

# Locate rclone.conf — prefer RCLONE_CONFIG env, else common paths.
if [[ -z "${RCLONE_CONFIG:-}" ]]; then
  for p in \
    /opt/pos/deploy/backup/rclone.conf \
    /etc/rclone/rclone.conf \
    "$HOME/.config/rclone/rclone.conf"; do
    if [[ -f "$p" ]]; then RCLONE_CONFIG="$p"; break; fi
  done
fi
export RCLONE_CONFIG

if [[ -z "${RCLONE_CONFIG:-}" || ! -f "$RCLONE_CONFIG" ]]; then
  log "ERROR: rclone.conf not found. Create /opt/pos/deploy/backup/rclone.conf or set RCLONE_CONFIG."
  exit 1
fi
if ! command -v rclone >/dev/null 2>&1; then
  log "ERROR: rclone is not installed. apt install rclone  (or use the docker sidecar)."
  exit 1
fi
if [[ ! -d "$BACKUP_DIR" ]]; then
  log "WARN: backup dir does not exist yet ($BACKUP_DIR) — nothing to sync."
  exit 0
fi

# Verify remote reachable before we touch anything.
if ! rclone --config="$RCLONE_CONFIG" lsjson "$REMOTE:" --max-depth 1 >/dev/null 2>&1; then
  log "ERROR: remote '$REMOTE' is unreachable. Check credentials / network."
  exit 2
fi

# -----------------------------------------------------------------------------
# 1) Optional: request a fresh snapshot right now via the running POS server.
# -----------------------------------------------------------------------------
if [[ "$FORCE_RPC" == "1" && -n "${POS_HOST_SECRET:-}" ]]; then
  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE=$(curl -sS -o /tmp/pos-backup-rpc.out -w '%{http_code}' \
      -X POST "http://127.0.0.1:${HOST_PORT}/rpc" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${POS_HOST_SECRET}" \
      --data '{"channel":"pos:database:backup","args":[]}' || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      log "pre-sync snapshot via RPC: OK"
    else
      log "pre-sync snapshot via RPC returned $HTTP_CODE — continuing with existing snapshots"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 2) Push local snapshots to the remote (copy = additive, never deletes on remote).
# -----------------------------------------------------------------------------
TARGET="${REMOTE}:${REMOTE_PATH%/}"
log "rclone copy $BACKUP_DIR -> $TARGET"

rclone --config="$RCLONE_CONFIG" copy "$BACKUP_DIR/" "$TARGET/" \
  --include 'pos-*.db' \
  --transfers 4 \
  --checkers 8 \
  --stats-one-line --stats 30s \
  --log-level INFO \
  || { log "ERROR: rclone copy failed"; exit 2; }

# -----------------------------------------------------------------------------
# 3) Prune remote files older than retention window.
# -----------------------------------------------------------------------------
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  log "rclone delete (age > ${RETENTION_DAYS}d) on $TARGET"
  rclone --config="$RCLONE_CONFIG" delete "$TARGET/" \
    --include 'pos-*.db' \
    --min-age "${RETENTION_DAYS}d" \
    --log-level INFO \
    || log "WARN: remote prune had errors (non-fatal)"
fi

# -----------------------------------------------------------------------------
# 4) Sentinel — Prometheus gauge `pos_backup_offsite_last_age_seconds` reads this.
# -----------------------------------------------------------------------------
SENTINEL="$BACKUP_DIR/.last-offsite-sync"
date -u +%FT%TZ > "$SENTINEL"
log "sentinel touched: $SENTINEL"

REMOTE_COUNT=$(rclone --config="$RCLONE_CONFIG" lsf "$TARGET/" --include 'pos-*.db' 2>/dev/null | wc -l || echo 0)
log "OK — remote now holds $REMOTE_COUNT snapshot(s)"
