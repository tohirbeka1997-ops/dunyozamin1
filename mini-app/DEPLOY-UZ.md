# Mini App — production (Hetzner / VPS)

Maqsad: Telegram **Web App** HTTPS orqali ochiladi, **bir xil domen**da frontend va `/v1` API (CORS siz ishlash uchun).

## 1. Server `.env` (loyiha ildizi)

Quyidagilar **to‘ldirilgan** bo‘lsin (`.env.server.example` bilan solishtiring):

| O‘zgaruvchi | Tavsif |
|-------------|--------|
| `POS_DATA_DIR` | `pos.db` joyi (masalan `/var/lib/pos`) |
| `TELEGRAM_BOT_TOKEN` | @BotFather — **public-api** `POST /v1/auth/telegram` initData tekshiradi |
| `TELEGRAM_WEB_APP_URL` | `https://app.<domen>` — botdagi Web App tugmasi |
| `PUBLIC_API_PORT` | Odatda `3334` |
| `PUBLIC_API_CORS_ORIGINS` | Agar API alohida domen bo‘lsa kerak. **Bir domen**da bo‘sh qoldirish yoki `https://web.telegram.org` (kamdan-kam) |

Mini App **build** uchun ildizda yoki `mini-app/.env.production`:

```env
# Bir domen (tavsiya) — bo‘sh
VITE_PUBLIC_API_URL=
```

## 2. Public API xizmati

```bash
sudo cp deploy/public-api.service.example /etc/systemd/system/public-api.service
# User, WorkingDirectory, EnvironmentFile ni tuzating
sudo systemctl daemon-reload
sudo systemctl enable --now public-api
curl -sS http://127.0.0.1:3334/health
```

## 3. Frontend build

```bash
cd /home/pos/app/mini-app
cp .env.production.example .env.production   # kerak bo‘lsa VITE_PUBLIC_API_URL ni tahrirlang
npm ci
npm run build
```

`dist/` papkasi Nginx `root` ga ishora qiladi.

## 4. Nginx + HTTPS

`deploy/nginx-mini-app-same-origin.example.conf` ni `server_name` va `root` bilan moslang, SSL uchun:

```bash
sudo certbot --nginx -d app.example.com
```

**Muhim:** `TELEGRAM_WEB_APP_URL` va bot sozlamalaridagi Web App URL **shu HTTPS** manzil bilan bir xil bo‘lsin.

## 5. Telegram bot

`telegram/SERVER-UZ.md` — `telegram-bot.service`, **bir xil** `.env` va `POS_DATA_DIR`.

## 6. Tekshirish

1. Brauzerda `https://app.<domen>/` — SPA yuklanadi.
2. `curl https://app.<domen>/health` yoki `curl http://127.0.0.1:3334/health` — `ok`.
3. Telegramda bot → Web App — katalog va kirish (initData).

## Muammolar

- **401 initData** — serverdagi `TELEGRAM_BOT_TOKEN` bot bilan bir xil emas yoki vaqt noto‘g‘ri.
- **503 database_unavailable** — `pos.db` yo‘li noto‘g‘ri yoki migratsiya yo‘q.
- **Bo‘sh sahifa** — Nginx `root` noto‘g‘ri yoki `try_files` SPA uchun `/index.html`.
