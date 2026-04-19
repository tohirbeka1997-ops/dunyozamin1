#!/usr/bin/env bash
# =============================================================================
# Manual "pull latest image & restart" helper for /opt/pos
# =============================================================================
# CI normally does this automatically, but keep a handy one-shot script on the
# server for emergencies / rollbacks.
#
# Usage (as the deploy user):
#   /opt/pos/pos-pull-restart.sh                         # pull :latest
#   POS_IMAGE=ghcr.io/acme/pos:abc1234 \
#     /opt/pos/pos-pull-restart.sh                       # pin specific tag
# =============================================================================
set -euo pipefail

cd /opt/pos

if [[ -n "${POS_IMAGE:-}" ]]; then
  # Replace / append POS_IMAGE in .env so compose picks it up.
  if grep -q '^POS_IMAGE=' .env 2>/dev/null; then
    sed -i "s|^POS_IMAGE=.*|POS_IMAGE=${POS_IMAGE}|" .env
  else
    echo "POS_IMAGE=${POS_IMAGE}" >> .env
  fi
fi

docker compose -f docker-compose.yaml -f docker-compose.prod.yaml pull
docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d

echo "▶ Waiting for healthcheck…"
for i in $(seq 1 15); do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' pos-server 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    echo "✓ pos-server healthy"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "❌ container did not reach 'healthy' in 30s — last logs:"
docker logs --tail=80 pos-server || true
exit 1
