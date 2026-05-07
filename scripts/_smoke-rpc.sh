#!/usr/bin/env bash
set -e
set -a
. /opt/pos/.env
set +a

SECRET="${POS_HOST_SECRET:-}"
if [ -z "$SECRET" ]; then
  echo "[smoke] POS_HOST_SECRET yo'q" >&2
  exit 1
fi

echo "--- pos:health ---"
curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:health","args":[]}' 2>&1 | head -c 400
echo
echo

echo "--- pos:reports:dailySales (2026-05-03) ---"
curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:reports:dailySales","args":["2026-05-03"]}' 2>&1 | head -c 600
echo
echo

echo "--- pos:reports:topProducts (limit=3) ---"
curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:reports:topProducts","args":[{"limit":3}]}' 2>&1 | head -c 600
echo
