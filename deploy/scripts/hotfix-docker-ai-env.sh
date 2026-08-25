#!/usr/bin/env bash
# One-shot: pass GEMINI/OPENAI/marketing keys into Docker pos-server and recreate.
# Run ON the server after docker-compose.yaml + docker-compose.prod.yaml are updated.
set -euo pipefail
cd /opt/pos

if [[ ! -f .env ]]; then
  echo "ERROR: /opt/pos/.env topilmadi" >&2
  exit 1
fi

COMPOSE_FILES=(-f docker-compose.yaml)
[[ -f docker-compose.prod.yaml ]] && COMPOSE_FILES+=(-f docker-compose.prod.yaml)

echo "==> Recreate pos-server with AI env vars from .env"
docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate pos-server

echo "==> Verify keys visible inside container (values masked)"
docker exec pos-server node -e "
  const g = !!(process.env.GEMINI_API_KEY || '').trim();
  const o = !!(process.env.OPENAI_API_KEY || '').trim();
  const m = !!(process.env.TELEGRAM_MARKETING_BOT_TOKEN || '').trim();
  const r = !!(process.env.TELEGRAM_REPORTS_CHAT_ID || '').trim();
  const a = !!(process.env.TELEGRAM_ADMIN_IDS || '').trim();
  const c = !!(process.env.TELEGRAM_MARKETING_CHANNEL_ID || '').trim();
  console.log(JSON.stringify({ gemini: g, openai: o, marketingBot: m, reportsChatId: r, adminIds: a, marketingChannel: c, posEnvFile: process.env.POS_ENV_FILE || null }));
"

echo "==> Health"
curl -fsS --max-time 5 "http://127.0.0.1:${POS_HOST_PORT:-3333}/health" || true
echo
echo "Done. Admin UI: Sozlamalar → Telegram hisobotlar → Yangilash → Gemini — Ha"
