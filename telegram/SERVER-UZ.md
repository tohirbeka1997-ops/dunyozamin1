# Telegram botni serverda doimiy ishlatish

Bot **alohida Node jarayoni** (`npm run telegram:bot`). Kompyuterda emas, balki **VPS / serverda** uni **systemd** yoki **PM2** orqali ishga tushiring — qayta yoqilganda ham avtomatik ko‘tariladi.

**Hetzner / umumiy migratsiya** bilan bir qatorda: ildizdagi `MIGRATION_TO_HETZNER.md` → **§3.1. Telegram bot**.

**Mini App (Web App) HTTPS deploy:** `mini-app/DEPLOY-UZ.md` — `TELEGRAM_WEB_APP_URL` shu domen bilan mos bo‘lishi kerak.

## Talablar

1. **Bitta joyda bitta bot** — `409 Conflict` bo‘lmasligi uchun serverda **faqat bitta** `telegram/bot.cjs` ishlayotgan bo‘lsin ( boshqa PC yoki ikkinchi terminalda shu token bilan bot ishlamasin ).
2. **HTTPS** — `TELEGRAM_WEB_APP_URL` yoki `VITE_APP_PUBLIC_URL` **https://** bilan (Telegram qoidasi).
3. **Bot internal API** — bot ma’lumotlarni `public-api` ichki endpointlari orqali oladi. Shu sabab `.env`da **`TELEGRAM_BOT_INTERNAL_SECRET`** bir xil bo‘lishi kerak (bot va public-api uchun).
4. **Ma’lumotlar bazasi** — `public-api` `pos.db` bilan ishlaydi. Serverdagi `.env` da **`POS_DATA_DIR`** (yoki **`PUBLIC_API_DB_PATH`**) shu `pos.db` ga ishora qilishi kerak — **xuddi public-api / POS server** bilan bir xil katalog.

## `.env` (serverdagi loyiha ildizi)

| O‘zgaruvchi | Tavsif |
|-------------|--------|
| `TELEGRAM_BOT_TOKEN` | @BotFather dan |
| `TELEGRAM_WEB_APP_URL` yoki `VITE_APP_PUBLIC_URL` | Mini App HTTPS manzili |
| `TELEGRAM_BOT_INTERNAL_SECRET` | Bot ↔ public-api ichki maxfiy kalit |
| `TELEGRAM_PUBLIC_API_URL` | `public-api` manzili (masalan `http://127.0.0.1:3334`) |
| `TELEGRAM_BROADCAST_SECRET` | Admin broadcast endpointi uchun maxfiy kalit |
| `TELEGRAM_BOT_MODE` | `polling` (default) yoki `webhook` |
| `TELEGRAM_WEBHOOK_BASE_URL` | Webhook public HTTPS manzil (`https://...`) |
| `TELEGRAM_WEBHOOK_PATH` | Webhook yo‘li (`/telegram/webhook`) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook secret token (ixtiyoriy, tavsiya) |
| `POS_DATA_DIR` | Masalan `/var/lib/pos` — ichida `pos.db` bo‘ladi |
| `TELEGRAM_CONTACT_TEXT` | Ixtiyoriy — “Bog‘lanish” matni |

Loyiha ildizida `npm install` ( `telegraf` va boshqa paketlar o‘rnatilgan bo‘lsin).

## systemd (tavsiya etiladi)

1. Namuna faylni nusxalang va yo‘llarni tuzating:

   `telegram/telegram-bot.service.example` → `/etc/systemd/system/telegram-bot.service`

   `User`, `WorkingDirectory`, `EnvironmentFile`, `ExecStart` dagi yo‘llarni o‘zgartiring.

2. Ishga tushirish:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now telegram-bot
   sudo systemctl status telegram-bot
   sudo journalctl -u telegram-bot -f
   ```

3. **Muhim:** `pos.db` fayliga o‘qish huquqi shu `User` uchun bo‘lishi kerak.

## PM2 (ixtiyoriy)

```bash
cd /home/pos/app
pm2 start telegram/bot.cjs --name telegram-bot
pm2 save
pm2 startup   # tizim qayta yuklanganda avtomatik
```

`.env` shu katalogda bo‘lishi yoki `pm2` ga `env` berilishi kerak.

## Tekshirish

- `journalctl` da: `[telegram:bot] running — Ctrl+C bilan to‘xtating` ga o‘xshash xabar.
- Telegramda botga `/start` — javob va Web App tugmasi.
- **409** — boshqa joyda shu token bilan bot ishlayapti; bittasini to‘xtating.
- Webhook rejimda: reverse-proxy (`/telegram/webhook`) botning `TELEGRAM_WEBHOOK_PORT` portiga yo‘naltiriladi.

## Bog‘liqlik

- POS HTTP serveri: `MIGRATION_TO_HETZNER.md` §3 (`pos-server.service`).
- Public API alohida ishlayotgan bo‘lsa, **bir xil** `POS_DATA_DIR` / `pos.db` ishlatiladi.
