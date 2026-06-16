#!/bin/bash
# Fix split-DB: public-api (systemd) writes /var/lib/pos/pos.db on the host,
# but docker pos-server used an isolated named volume. Bind-mount host data dir.
set -euo pipefail
APP_PATH="${APP_PATH:-/opt/pos}"
cd "$APP_PATH"

echo "[fix] backing up docker volume DB (if present)..."
VOL_DB="/var/lib/docker/volumes/pos-data/_data/pos.db"
if [ -f "$VOL_DB" ]; then
  cp -a "$VOL_DB" "/var/lib/pos/pos.db.docker-volume-backup-$(date +%Y%m%d-%H%M%S)"
fi

echo "[fix] ensuring host data dir exists..."
mkdir -p /var/lib/pos/logs /var/lib/pos/backups
chown -R 1001:1001 /var/lib/pos 2>/dev/null || true

echo "[fix] disabling conflicting systemd pos-rpc (docker owns :3333)..."
systemctl disable --now pos-rpc.service 2>/dev/null || true

COMPOSE_FILES="-f docker-compose.yaml"
if [ -f docker-compose.prod.yaml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.yaml"
else
  cat > docker-compose.bind-host-data.yaml <<'EOF'
services:
  pos-server:
    volumes:
      - /var/lib/pos:/var/lib/pos
EOF
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.bind-host-data.yaml"
fi

echo "[fix] recreating pos-server with host bind mount..."
docker compose $COMPOSE_FILES up -d --force-recreate pos-server

echo "[fix] waiting for health..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 http://127.0.0.1:3333/health >/dev/null 2>&1; then
    echo "[fix] pos-server healthy"
    break
  fi
  sleep 2
done

echo "[fix] verifying web_orders via RPC..."
node scripts/test-rpc-weborders.cjs || true

echo "[fix] host web_orders count:"
node -e "const B=require('better-sqlite3');const db=new B('/var/lib/pos/pos.db',{readonly:true});console.log(db.prepare('SELECT COUNT(*) n FROM web_orders').get());db.close();"

echo "[fix] done"
