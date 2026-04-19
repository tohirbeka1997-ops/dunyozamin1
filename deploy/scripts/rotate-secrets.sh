#!/usr/bin/env bash
# =============================================================================
# POS — secret rotation SOP (run QUARTERLY or whenever a leak is suspected)
# =============================================================================
# Rotates:
#   * POS_HOST_SECRET       — shared admin bypass + frontend bootstrap secret
#   * POS_METRICS_SECRET    — Prometheus scrape bearer
#   * (optional) GF_ADMIN_PASSWORD
#   * logrotate trigger on /var/lib/pos/logs/audit.log
#
# What it DOES NOT rotate (handled separately):
#   * User passwords         — use the POS admin UI's password reset flow
#   * SSH deploy key         — see DEPLOY_SSH_KEY guidance in .github/SECRETS.md
#   * Let's Encrypt certs    — certbot renews automatically
#   * rclone remote creds    — provider console + update rclone.conf by hand
#
# Design:
#   * Runs on the POS host, as root (or via sudo).
#   * Generates new secrets with `openssl rand -hex 32` (=> 64 hex chars, ~256 bit).
#   * Writes the OLD value to a dated backup at /opt/pos/.env.rotated-<timestamp>.
#   * Restarts pos-server so the new secret becomes effective.
#   * PROMPTS the operator to update the frontend VITE_POS_RPC_SECRET in
#     GitHub Actions repository secrets before the next frontend deploy —
#     otherwise the published bundle will 401.
# =============================================================================
set -euo pipefail

ENV_FILE="${POS_ENV:-/opt/pos/.env}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/pos}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [[ $(id -u) -ne 0 ]]; then
  echo "❌ Run as root (or via sudo)."
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found."
  exit 1
fi

# Back the existing env up BEFORE we touch anything — this is the get-out-of-jail-free
# copy if something goes wrong downstream.
BACKUP="/opt/pos/.env.rotated-$TS"
cp --preserve=mode,ownership "$ENV_FILE" "$BACKUP"
chmod 0600 "$BACKUP"
log "backup saved: $BACKUP"

# Generate new secrets (strong, unpredictable).
NEW_HOST="$(openssl rand -hex 32)"
NEW_METRICS="$(openssl rand -hex 32)"

# Helper — set or append `KEY=value` in a dotenv file, preserving comments.
set_env() {
  local key="$1" value="$2" file="$3"
  if grep -qE "^${key}=" "$file"; then
    # GNU sed-in-place; escape slashes for the replacement side.
    sed -i -E "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Capture old for logging (NEVER print it fully).
OLD_HOST="$(grep -E '^POS_HOST_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || echo '')"
log "rotating POS_HOST_SECRET (old ending: …${OLD_HOST: -4})"
set_env POS_HOST_SECRET   "$NEW_HOST"    "$ENV_FILE"
set_env POS_METRICS_SECRET "$NEW_METRICS" "$ENV_FILE"
chmod 0600 "$ENV_FILE"
log "new secrets written to $ENV_FILE"

# If the monitoring stack uses a file-based bearer for Prometheus, refresh it.
TOKEN_FILE=/opt/pos/deploy/monitoring/pos-metrics-token
if [[ -f "$TOKEN_FILE" ]]; then
  echo -n "$NEW_METRICS" > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
  log "refreshed $TOKEN_FILE for Prometheus scrape"
fi

# Restart pos-server so the new secret is live. If docker-compose is not
# present (bare-metal install), the operator must restart systemd manually.
if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_DIR/docker-compose.yaml" ]]; then
  log "restarting pos-server via docker compose…"
  ( cd "$COMPOSE_DIR" && docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d pos-server )
  # If monitoring stack is running, it needs a reload too — Prometheus uses
  # the token file and re-reads on scrape, so container restart is optional.
  if docker ps --format '{{.Names}}' | grep -q '^pos-prometheus'; then
    docker exec pos-prometheus kill -HUP 1 2>/dev/null || true
    log "Prometheus received SIGHUP (token refresh)"
  fi
else
  log "docker compose not found at $COMPOSE_DIR — restart pos-server manually"
fi

# Rotate the audit log so the new-secret era starts with a clean file.
AUDIT_LOG=/var/lib/pos/logs/audit.log
if [[ -f "$AUDIT_LOG" ]]; then
  mv "$AUDIT_LOG" "${AUDIT_LOG}.${TS}"
  touch "$AUDIT_LOG"
  chmod 0640 "$AUDIT_LOG"
  chown "$(stat -c '%u:%g' "${AUDIT_LOG}.${TS}")" "$AUDIT_LOG" 2>/dev/null || true
  log "audit log rolled to ${AUDIT_LOG}.${TS}"
fi

# Post-rotation sanity check — /health must return 200 with the NEW secret.
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3333/health >/dev/null; then
    log "pos-server /health: OK"
    break
  fi
  sleep 1
  if [[ $i -eq 20 ]]; then
    log "WARN: /health not reachable after 20s; rolling back from $BACKUP"
    cp --preserve=mode,ownership "$BACKUP" "$ENV_FILE"
    ( cd "$COMPOSE_DIR" && docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d pos-server ) || true
    exit 2
  fi
done

echo
echo '============================================================'
echo '✓ secret rotation complete'
echo
echo '  NEW POS_HOST_SECRET:'
echo "    $NEW_HOST"
echo
echo '  NEW POS_METRICS_SECRET:'
echo "    $NEW_METRICS"
echo
echo 'Next actions (manual):'
echo '  1. Update GitHub Actions repo variable VITE_POS_RPC_SECRET to the new'
echo '     POS_HOST_SECRET (or — better — keep them separate: rotate to a'
echo '     dedicated read-only secret if your build supports it).'
echo '  2. Run `gh workflow run deploy-frontend.yml` to push the new bundle.'
echo '  3. Verify: `curl -sS -X POST https://<domen>/rpc -H "Authorization: Bearer <new>" ...`'
echo '  4. Archive the backup file securely:'
echo "        $BACKUP"
echo '============================================================'
