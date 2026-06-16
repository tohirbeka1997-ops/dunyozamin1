# Staff POS (sales-mobile) — VPS + Telegram WebApp deploy

Bu hujjat **sotuvchi mobil POS** (`sales-mobile/`) ni Cloudflare tunnel'siz barqaror VPS'da ishga tushirish uchun qadam-baqadam yo'riqnoma. Mijoz Mini App (`mini-app/`) bilan aralashmaydi — alohida **staff bot** va (ixtiyoriy) alohida domen.

## Arxitektura (tavsiya etiladi)

```
Telegram (staff bot)  →  HTTPS  →  nginx  →  public-api :3334
                                         ├─ GET /v1/*     (staff REST API)
                                         ├─ GET /_expo/*  (static, sales-mobile/dist)
                                         └─ GET /*        (SPA fallback → index.html)
```

`public-api/server.cjs` allaqachon `sales-mobile/dist` ni static xizmat qiladi (`STAFF_WEB_DIR`). Nginx faqat TLS va reverse-proxy vazifasini bajaradi — alohida static server shart emas.

## 1. Lokal build

```bash
cd sales-mobile
npm install
npm run export-web
# Natija: sales-mobile/dist/ (index.html + _expo/...)
```

Yoki loyiha ildizidan:

```bash
npm run sales-mobile:export-web
# yoki: node scripts/build-staff-web.cjs
# serverga yuborish: npm run deploy:staff  (deploy/deploy.env kerak)
```

## 2. Serverga fayllarni joylash

```bash
# Masalan rsync (deploy.env dagi DEPLOY_SERVER dan foydalaning)
rsync -avz --delete sales-mobile/dist/ user@your-server:/opt/pos/sales-mobile/dist/
```

Yoki `public-api` bilan bir katalogda:

```
/opt/pos/
  public-api/server.cjs
  sales-mobile/dist/     ← STAFF_WEB_DIR default yo'li
  data/tenants/default/pos.db
```

## 3. Muhit o'zgaruvchilari (server `.env`)

| O'zgaruvchi | Majburiy | Tavsif |
|---|---|---|
| `STAFF_BOT_TOKEN` | Ha | @BotFather yangi staff bot tokeni (mijoz botidan alohida) |
| `STAFF_WEB_APP_URL` | Ha | Telegram WebApp HTTPS URL, masalan `https://staff.example.com/` |
| `STAFF_JWT_SECRET` | Ha | Kamida 16 belgi; staff JWT imzosi |
| `STAFF_JWT_REFRESH_SECRET` | Tavsiya | Refresh token imzosi (bo'sh bo'lsa `STAFF_JWT_SECRET` ishlatiladi) |
| `PUBLIC_API_DB_PATH` | Ha* | Tenant POS SQLite yo'li, masalan `/var/lib/pos/tenants/default/pos.db` |
| `POS_DATA_DIR` | Ha* | `PUBLIC_API_DB_PATH` bo'lmasa — data ildizi |
| `STAFF_WEB_DIR` | Yo'q | Default: `sales-mobile/dist` (public-api nisbatan) |
| `PUBLIC_API_PORT` | Yo'q | Default `3334` |
| `PUBLIC_API_TRUST_PROXY` | Tavsiya | `1` — nginx orqasida `X-Forwarded-*` ishonchli |
| `STAFF_BOT_MODE` | Yo'q | `polling` (default) yoki `webhook` |

\* Kamida bittasi — POS ma'lumotlar bazasiga yo'naltirish uchun.

`.env.server.example` va `deploy/deploy.env.example` dagi `STAFF_*` qatorlarini to'ldiring.

## 4. systemd — public-api

```bash
sudo cp deploy/public-api.service.example /etc/systemd/system/public-api.service
# WorkingDirectory va EnvironmentFile ni server yo'llariga moslang
sudo systemctl daemon-reload
sudo systemctl enable --now public-api
curl -s http://127.0.0.1:3334/health
```

Staff bot `STAFF_BOT_TOKEN` o'rnatilganda `public-api` ishga tushganda avtomatik polling qiladi (`telegram/staffBot.cjs`). Alohida `npm run telegram:staff-bot` **bir vaqtda ishlamasin** — Telegram 409 Conflict beradi.

## 5. nginx

Ikki variant:

### A) Butun domen → public-api (tavsiya, eng oddiy)

`deploy/nginx-staff-pos.conf.template` + `deploy/scripts/setup-staff-nginx.sh`:

```bash
sudo STAFF_DOMAIN=staff.example.com EMAIL=admin@example.com \
  bash /opt/pos/deploy/scripts/setup-staff-nginx.sh
```

Yoki qo'lda: `deploy/nginx-staff-webapp.conf.example` dagi **Variant A**.

`STAFF_WEB_APP_URL=https://staff.example.com/`

### B) Bir domen, `/staff/` subpath (murakkab)

Expo web export asset yo'llari ildizga (`/_expo/`) bog'langan. Subpath uchun `expo` `baseUrl` sozlash kerak — hozircha **Variant A** tavsiya etiladi.

`/v1/` proxy har ikkala variantda bir xil:

```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:3334;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Nginx tekshiruv:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Telegram bot sozlash

1. @BotFather → yangi bot → token → `STAFF_BOT_TOKEN`
2. Bot profilida Web App URL: `STAFF_WEB_APP_URL` bilan bir xil HTTPS manzil
3. Sotuvchi foydalanuvchi: `npm run staff:ensure-user` (serverda)

## 7. Tekshiruv ro'yxati

- [ ] `curl https://staff.example.com/health` → `{"ok":true,...}`
- [ ] Brauzerda `https://staff.example.com/` — login sahifasi
- [ ] `POST /v1/staff/auth/login` — JWT qaytadi
- [ ] Telegram staff bot → «POS ochish» → WebApp ochiladi
- [ ] Sotuv tabida shtrix-kod skaner (telefonda kamera; vebda qo'lda kiritish)

## 8. Tunnel'siz farqi

| Dev (tunnel) | Prod (VPS) |
|---|---|
| `cloudflared` / ngrok vaqtinchalik URL | Doimiy domen + Let's Encrypt |
| `STAFF_WEB_APP_URL` har restartda yangilanadi | `STAFF_WEB_APP_URL` barqaror |
| `EXPO_PUBLIC_STAFF_API_URL` kerak bo'lishi mumkin | Same-origin — API URL kerak emas |

## Bog'liq fayllar

- `deploy/FULL-PRODUCTION-DEPLOY-UZ.md` — to'liq production deploy
- `deploy/nginx-staff-pos.conf.template` — nginx shablon
- `deploy/scripts/setup-staff-nginx.sh` — HTTPS o'rnatish
- `deploy/nginx-staff-webapp.conf.example` — nginx snippet (qo'lda)
- `scripts/deploy-staff-web.cjs` — build + rsync deploy
