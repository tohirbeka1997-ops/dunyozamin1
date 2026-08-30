# Mijoz Telegram hisobotlari (alohida bot)

Mijoz **shaxsiy chat**da do‘kon operatsiyalari haqida qisqa hisobot oladi. Xodimlar kanali (`TELEGRAM_REPORTS_*`) va Mini App botiga **aralashmaydi**.

## Qaysi bot?

| Bot | Env | Vazifa |
|-----|-----|--------|
| **Mijoz hisobotlari** (yangi, alohida) | `TELEGRAM_CUSTOMER_BOT_TOKEN` | `/start` bog‘lash + xarid/to‘lov/nasiya DM |
| Mini App | `TELEGRAM_BOT_TOKEN` | Do‘kon Web App |
| Hisobotlar (xodimlar) | `TELEGRAM_REPORTS_BOT_TOKEN` | Smena, staff digest |

Tokenni gitga yozmang. Faqat gitignore qilingan `.env` / server `/opt/pos/.env`.

Ixtiyoriy fallback (tavsiya etilmaydi): `TELEGRAM_CUSTOMER_BOT_FALLBACK=1` bo‘lsa, token bo‘sh qolganda `TELEGRAM_BOT_TOKEN` ishlatiladi. Default: **faqat** `TELEGRAM_CUSTOMER_BOT_TOKEN`.

## Mijoz qanday ulanadi

1. Yangi hisobotlar botini ochadi → **`/start`**
2. **📱 Telefonni yuborish** (o‘z kontaktini)
3. Telefon POS mijoziga moslashadi, `telegram_id` saqlanadi
4. Bot: «Ulandi» — endi operatsiyalar **shu** botga keladi

Qayta bog‘lash: `/link` · Holat: `/status`

## Qaysi voqealar

- Xarid (to‘liq to‘langan ham)
- Nasiya sotuv
- To‘lov (`payment_in`) / pul berish (`payment_out`)
- Qaytarish, hisob tuzatish

Xabar: nima bo‘ldi, summa, yangi balans, buyurtma/to‘lov raqami. Faqat mijoz DM.

## Yoqish

1. [@BotFather](https://t.me/BotFather) da yangi bot → token
2. Server `.env`:
   ```
   TELEGRAM_CUSTOMER_BOT_TOKEN=
   TELEGRAM_BOT_INTERNAL_SECRET=
   TELEGRAM_PUBLIC_API_URL=http://127.0.0.1:3334
   ```
3. Xizmatlar:
   ```bash
   npm run telegram:customer-bot
   # yoki systemd: telegram/telegram-customer-bot.service.example
   ```
   POS sotuvlari `pos-server` (Docker) orqali o‘tadi — konteynerda ham
   `customerOpsNotify` + `TELEGRAM_CUSTOMER_BOT_TOKEN` bo‘lishi shart
   (`docker-compose.prod.yaml` bind-mount / env). Yangilash:
   `node scripts/deploy-customer-bot-once.cjs`
4. POS: Sozlamalar → Qarz eslatmalari → «Hisob o‘zgarganda xabar» yoqilgan

## Kod

- Bot: `telegram/customerOpsBot.cjs`
- Notify: `public-api/lib/customerOpsNotify.cjs` → `resolveCustomerBotToken()`
- Sotuv / to‘lov / qaytarish hooklari: `salesService` / `customersService` / `returnsService`

```bash
node --test public-api/lib/customerOpsNotify.smoke.test.cjs
```
