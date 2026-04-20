# Telegram + Mini App — to‘liq ketma-ketlik

Loyihadagi `.env` da `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEB_APP_URL` va `VITE_APP_PUBLIC_URL` (HTTPS, bir xil ildiz) bo‘lishi kerak.

## 1. Mahalliy tekshiruv

```bash
npm run telegram:verify
```

Bot token to‘g‘ri bo‘lsa, `@username` chiqadi.

## 2. Botni ishga tushirish

```bash
npm run telegram:bot
```

Bitta jarayon: ikkinchi nusxa **409** beradi. Serverda `systemd` yoki PM2 — bitta xizmat.

## 3. Mini App production build

```bash
cd mini-app
copy .env.production.example .env.production
npm ci
npm run build
```

Bir domen (Nginx `/v1` → public-api) uchun `VITE_PUBLIC_API_URL` bo‘sh qoladi.

## 4. Server (Hetzner / VPS)

| Qadam | Hujjat |
|-------|--------|
| Public API (`3334`), `POS_DATA_DIR`, `.env` | `mini-app/DEPLOY-UZ.md`, `deploy/public-api.service.example` |
| Nginx SPA + `/v1` + SSL | `deploy/nginx-mini-app-same-origin.example.conf` |
| Telegram bot xizmati | `telegram/SERVER-UZ.md`, `telegram/telegram-bot.service.example` |
| Umumiy migratsiya | `MIGRATION_TO_HETZNER.md` |

**Muhim:** `TELEGRAM_WEB_APP_URL`, BotFather dagi Web App URL va brauzerdagi `https://app...` **bir xil** HTTPS bo‘lsin. `public-api` va `telegram-bot` **bir xil** `pos.db` (`POS_DATA_DIR`) ni ko‘rsatsin.

## 5. Xavfsizlik

Token suhbatda yoki logda ochiq bo‘lsa, [@BotFather](https://t.me/BotFather) orqali **yangi token** oling va `.env` ni yangilang.
