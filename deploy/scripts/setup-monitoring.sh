#!/usr/bin/env bash
# =============================================================================
# POS — bring up the optional monitoring stack (Prometheus + Grafana)
# =============================================================================
# Prerequisites:
#   - server-bootstrap.sh already executed
#   - /opt/pos/.env already contains POS_HOST_SECRET
#   - Repository files synced to /opt/pos (docker-compose.monitoring.yaml,
#     deploy/monitoring/*)
#
# Usage (as the deploy user):
#   cd /opt/pos
#   bash deploy/scripts/setup-monitoring.sh
#
# Inputs (env vars, optional):
#   POS_METRICS_SECRET — token for Prometheus scrape; defaults to POS_HOST_SECRET
#   GF_ADMIN_PASSWORD  — Grafana admin password (generated if unset)
# =============================================================================
set -euo pipefail

cd /opt/pos

if [[ ! -f .env ]]; then
  echo "❌ /opt/pos/.env not found. Run server-bootstrap.sh first."
  exit 1
fi

# Load existing .env so we can reuse/rotate secrets without overwriting.
set -a
. ./.env
set +a

: "${POS_HOST_SECRET:?POS_HOST_SECRET is missing from /opt/pos/.env}"

# 1) Decide/persist POS_METRICS_SECRET
if ! grep -q '^POS_METRICS_SECRET=' .env 2>/dev/null; then
  TOKEN="${POS_METRICS_SECRET:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64)}"
  echo "POS_METRICS_SECRET=${TOKEN}" >> .env
  POS_METRICS_SECRET="${TOKEN}"
  echo "▶ generated POS_METRICS_SECRET"
fi

# 2) Decide/persist GF_ADMIN_PASSWORD
if ! grep -q '^GF_ADMIN_PASSWORD=' .env 2>/dev/null; then
  PW="${GF_ADMIN_PASSWORD:-$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | base64)}"
  echo "GF_ADMIN_PASSWORD=${PW}" >> .env
  GF_ADMIN_PASSWORD="${PW}"
  echo "▶ generated GF_ADMIN_PASSWORD (stored in .env)"
fi

# 3) Drop metrics token file that Prometheus container reads at scrape time.
install -d -m 0750 deploy/monitoring
echo -n "$POS_METRICS_SECRET" > deploy/monitoring/pos-metrics-token
chmod 0640 deploy/monitoring/pos-metrics-token
echo "✓ deploy/monitoring/pos-metrics-token written"

# 3b) Prometheus textfile-collector directory (Bosqich 18) — consumed by
# node-exporter (read-only) and written by deploy/scripts/restore-drill-prom.sh
# and any future ad-hoc Prom gauges. 0755 lets node-exporter read while the
# non-root writers need to be root OR belong to the pos group.
install -d -m 0755 /var/lib/pos/node-exporter-textfile
echo "✓ /var/lib/pos/node-exporter-textfile ready"

# 4) Restart the POS server so it picks up POS_METRICS_SECRET from .env.
docker compose \
  -f docker-compose.yaml \
  -f docker-compose.prod.yaml \
  up -d --no-deps pos-server

# 5) Bring up the monitoring profile.
docker compose \
  -f docker-compose.yaml \
  -f docker-compose.prod.yaml \
  -f docker-compose.monitoring.yaml \
  --profile monitoring \
  up -d

echo
echo "============================================================"
echo "✓ monitoring stack is up"
echo "  Prometheus : http://127.0.0.1:9090   (SSH tunnel required)"
echo "  Grafana    : http://127.0.0.1:3000   user=admin"
[[ -n "${GF_ADMIN_PASSWORD:-}" ]] && echo "  Grafana PW : (see GF_ADMIN_PASSWORD in /opt/pos/.env)"
echo
echo "To tunnel from your laptop:"
echo "  ssh -L 9090:127.0.0.1:9090 -L 3000:127.0.0.1:3000 deploy@HOST"
echo "============================================================"
