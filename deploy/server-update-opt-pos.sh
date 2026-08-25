#!/usr/bin/env bash
# /opt/pos da kod yangilash + mini-app + staff web build + xizmatlarni qayta ishga tushirish
set -euo pipefail
cd /opt/pos

echo "==> git pull"
git pull origin main

echo "==> root deps (server / electron RPC)"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps || npm ci --no-audit --no-fund --legacy-peer-deps
else
  npm install --omit=dev --no-audit --no-fund --legacy-peer-deps
fi
npm rebuild better-sqlite3 --build-from-source || true

echo "==> public-api deps"
npm ci --prefix public-api --omit=dev --no-audit --no-fund --legacy-peer-deps || npm ci --prefix public-api
npm rebuild better-sqlite3 --prefix public-api || true

echo "==> mini-app build"
npm ci --prefix mini-app
npm run build --prefix mini-app

echo "==> sales-mobile (staff) web export"
npm ci --prefix sales-mobile
npm run export-web --prefix sales-mobile

echo "==> restart services"
sudo systemctl restart public-api
sudo systemctl restart telegram-bot || true
# Host systemd RPC — faqat Docker :3333 ni egallamagan bo'lsa
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'pos-server'; then
  echo "==> Docker pos-server ishlayapti — image qayta build (host /opt/pos manbasi)"
  COMPOSE_FILES=(-f docker-compose.yaml)
  [[ -f docker-compose.prod.yaml ]] && COMPOSE_FILES+=(-f docker-compose.prod.yaml)
  docker compose "${COMPOSE_FILES[@]}" build pos-server
  docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate pos-server
  sudo systemctl disable --now pos-rpc 2>/dev/null || true
else
  sudo systemctl restart pos-rpc || true
fi

echo "==> health + version"
RPC_HEALTH="$(curl -sS --max-time 5 http://127.0.0.1:3333/health || true)"
API_HEALTH="$(curl -sS --max-time 5 http://127.0.0.1:3334/health || true)"
echo "RPC :3333 → ${RPC_HEALTH}"
echo "API :3334 → ${API_HEALTH}"

echo "==> DB unity checklist"
if [[ -f scripts/deploy-db-unity-check.cjs ]]; then
  node scripts/deploy-db-unity-check.cjs || {
    echo "WARN: DB unity check failed — bind-mount / :3333 egasini tekshiring (deploy/scripts/fix-docker-db-bind-mount.sh)"
    exit 1
  }
else
  echo "WARN: scripts/deploy-db-unity-check.cjs yo'q — o'tkazib yuborildi"
fi

# Dual :3333 egasi — erta ogohlantirish
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'pos-server'; then
  if systemctl is-active --quiet pos-rpc 2>/dev/null; then
    echo "ERROR: pos-server (docker) VA pos-rpc (systemd) birga — :3333 conflict"
    exit 1
  fi
  MOUNTS="$(docker inspect pos-server --format '{{json .Mounts}}' 2>/dev/null || true)"
  if echo "$MOUNTS" | grep -q 'pos-data' && ! echo "$MOUNTS" | grep -q '/var/lib/pos'; then
    echo "ERROR: pos-server named volume (pos-data) — dual DB xavfi. Bind-mount /var/lib/pos kerak."
    exit 1
  fi
fi

echo "Update finished."
