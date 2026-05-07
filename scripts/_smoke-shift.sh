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

echo "--- pos:shifts:list (oxirgi 1) ---"
LAST=$(curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:shifts:list","args":[{"limit":1}]}')
echo "$LAST" | head -c 400
echo
echo

SHIFT_ID=$(echo "$LAST" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 36)
if [ -z "$SHIFT_ID" ] || [ ${#SHIFT_ID} -lt 36 ]; then
  echo "[smoke] shift_id ajratib olinmadi: $SHIFT_ID"
  exit 1
fi
echo "shift_id = $SHIFT_ID"
echo

echo "--- pos:shifts:getSummary (object payload) ---"
curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"channel\":\"pos:shifts:getSummary\",\"args\":[{\"shiftId\":\"$SHIFT_ID\"}]}" 2>&1 | head -c 700
echo
echo

echo "--- pos:shifts:getSummary (string payload) ---"
curl -fsS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"channel\":\"pos:shifts:getSummary\",\"args\":[\"$SHIFT_ID\"]}" 2>&1 | head -c 700
echo
echo

echo "--- pos:shifts:getSummary (BO'SH payload — VALIDATION_ERROR kutilmoqda) ---"
curl -sS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:shifts:getSummary","args":[]}' 2>&1 | head -c 400
echo
