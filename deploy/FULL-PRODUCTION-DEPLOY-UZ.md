# To'liq production deploy — VPS (Hetzner / Linux)

Bu hujjat **barcha komponentlarni** bir VPS'ga chiqarish uchun yagona yo'riqnoma:
Electron POS (kassalar), public-api, mijoz Mini App, sotuvchi Staff POS, Telegram botlar.

---

## 1. Domen tuzilmasi (tavsiya)

| Subdomen | Vazifa | Port (ichki) |
|----------|--------|--------------|
| `app.dunyozamin.com` | Mijoz Telegram Mini App (SPA + `/v1`) | nginx → 3334 |
| `api.dunyozamin.com` | Admin web RPC (`/rpc`) + ixtiyoriy API | nginx → 3333 |
| `staff.dunyozamin.com` | Sotuvchi POS WebApp (@dunyozaminbot) | nginx → 3334 |
| `admin.dunyozamin.com` | Admin panel (ixtiyoriy) | static yoki nginx → 3333 |

**Minimal variant (2 domen):**
- `app.example.com` — Mini App + `/v1` (bir origin)
- `staff.example.com` — Staff POS (alohida bot)

DNS: har subdomen uchun **A-record** → VPS IP.

---

## 2. Blokerlar (deploy oldin)

Quyidagilar bo'lmasa deploy to'xtaydi:

- [ ] VPS IP va SSH kirish (`DEPLOY_SERVER=user@IP`)
- [ ] Domenlar DNS'da VPS'ga yo'naltirilgan
- [ ] `@BotFather` — mijoz bot tokeni (`TELEGRAM_BOT_TOKEN`)
- [ ] `@BotFather` — **alohida** staff bot (`STAFF_BOT_TOKEN`, masalan @dunyozaminbot)
- [ ] Secretlar: `POS_HOST_SECRET`, `JWT_SECRET`, `STAFF_JWT_SECRET` (har biri ≥16 belgi)
- [ ] SQLite yo'li: `POS_DATA_DIR=/var/lib/pos` (Electron kassa bilan **bir xil** DB)

Lokal `deploy/deploy.env` **yo'q** — quyidagi namunadan nusxa oling:

```bash
cp deploy/deploy.env.example deploy/deploy.env
# DEPLOY_SERVER, SSH_IDENTITY_FILE ni to'ldiring
```

---

## 3. Birinchi marta — VPS (serverda)

SSH orqali serverga kiring:

```bash
# Loyiha katalogi (deploy:server ham /opt/pos ga yuboradi)
sudo mkdir -p /opt/pos /var/lib/pos

# Birinchi sozlash (Node 20, systemd, migratsiya)
sudo POS_ROOT=/opt/pos POS_DATA_DIR=/var/lib/pos \
  bash /opt/pos/deploy/scripts/vps-first-time-setup.sh
```

`.env` to'ldiring:

```bash
sudo nano /opt/pos/.env
# .env.server.example dagi barcha STAFF_*, TELEGRAM_*, JWT_*, POS_* qatorlar
```

**Muhim staff o'zgaruvchilari:**

```env
STAFF_BOT_TOKEN=<BotFather staff bot>
STAFF_WEB_APP_URL=https://staff.dunyozamin.com/
STAFF_JWT_SECRET=<32+ hex>
STAFF_BOT_MODE=polling
PUBLIC_API_TRUST_PROXY=1
PUBLIC_API_DB_PATH=/var/lib/pos/tenants/default/pos.db
# yoki POS_DATA_DIR=/var/lib/pos
```

Xizmatlarni ishga tushiring:

```bash
sudo systemctl enable --now public-api telegram-bot
curl -fsS http://127.0.0.1:3334/health
```

Staff foydalanuvchi (birinchi login):

```bash
cd /opt/pos
STAFF_SEED_USERNAME=sotuvchi STAFF_SEED_PASSWORD='YangiParol#2026' \
  node public-api/scripts/ensure-staff-user.cjs
```

---

## 4. Nginx + HTTPS (serverda)

### 4a. Staff POS (`staff.example.com`)

```bash
sudo STAFF_DOMAIN=staff.dunyozamin.com \
     EMAIL=admin@example.com \
     bash /opt/pos/deploy/scripts/setup-staff-nginx.sh
```

### 4b. Mini App (`app.example.com`)

`deploy/nginx-mini-app-same-origin.example.conf` ni moslang:

```bash
sudo nano /etc/nginx/sites-available/mini-app.conf
# root /opt/pos/mini-app/dist;
# server_name app.dunyozamin.com;
sudo ln -sf /etc/nginx/sites-available/mini-app.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d app.dunyozamin.com
sudo nginx -t && sudo systemctl reload nginx
```

Yoki mavjud `deploy/nginx-pos.dunyozamin.com.example.conf` bo'yicha `app` + `api` birlashtiring.

### 4c. Admin web (ixtiyoriy)

`deploy/scripts/setup-nginx.sh` — POS RPC `:3333` uchun (admin SPA `/var/www/pos`).

---

## 5. Lokal deploy (Windows — Git Bash / PowerShell)

Loyiha ildizida:

### 5a. Preflight

```powershell
cd "d:\cod\new wersiya\222\tttt\app01"
$env:NODE_OPTIONS="--max-old-space-size=8192"
npm run deploy:preflight
```

Xotira yetmasa: `$env:PREFLIGHT_SKIP_BUILD=1`

### 5b. `deploy/deploy.env` sozlash

```env
DEPLOY_SERVER=root@YOUR_VPS_IP
SSH_IDENTITY_FILE=C:/Users/You/.ssh/id_ed25519
DEPLOY_APP_PATH=/opt/pos
DEPLOY_RESTART_SERVICES=public-api.service telegram-bot.service
STAFF_WEB_REMOTE_PATH=/opt/pos/sales-mobile/dist
STAFF_WEB_APP_URL=https://staff.dunyozamin.com/
TELEGRAM_WEB_APP_URL=https://app.dunyozamin.com
```

### 5c. Bosqichma-bosqich deploy

```powershell
# 1) Backend kod + npm + restart
npm run deploy:server

# 2) Mijoz Mini App
npm run deploy:mini-app

# 3) Sotuvchi Staff WebApp (build + rsync + public-api restart)
npm run deploy:staff

# 4) Admin SPA (ixtiyoriy)
npm run deploy:web
```

**Hammasi bir buyruqda:**

```powershell
npm run deploy:full
# Admin skip: $env:DEPLOY_SKIP_WEB=1; npm run deploy:full
```

---

## 6. Telegram sozlash

| Bot | Token env | Web App URL |
|-----|-----------|-------------|
| Mijoz | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_WEB_APP_URL=https://app.../` |
| Staff (@dunyozaminbot) | `STAFF_BOT_TOKEN` | `STAFF_WEB_APP_URL=https://staff.../` |

Staff bot **public-api ichida** avtomatik polling qiladi (`STAFF_BOT_TOKEN` bo'lsa).
`npm run telegram:staff-bot` **alohida ishlamasin** — 409 Conflict.

BotFather → Bot Settings → Menu Button / Web App URL = `STAFF_WEB_APP_URL`.

---

## 7. Tekshiruv ro'yxati

```bash
# Server ichida
curl -fsS http://127.0.0.1:3334/health
curl -fsS http://127.0.0.1:3333/health   # agar pos-rpc ishlayotgan bo'lsa

# Tashqaridan (HTTPS)
curl -fsS https://staff.dunyozamin.com/health
curl -fsS https://app.dunyozamin.com/health
curl -fsS https://app.dunyozamin.com/v1/categories | head -c 200
```

Brauzer / Telegram:
- [ ] `https://staff.../` — login sahifasi
- [ ] Staff bot → «POS ochish» → WebApp
- [ ] Mijoz bot → Mini App → katalog
- [ ] Test web buyurtma → POS admin «Onlayn buyurtmalar»

Journal:

```bash
journalctl -u public-api -n 50 --no-pager
journalctl -u telegram-bot -n 50 --no-pager
```

---

## 8. Env checklist (server `/opt/pos/.env`)

### Deploy / infrastruktura (lokal `deploy/deploy.env`)

| O'zgaruvchi | Majburiy | Izoh |
|-------------|----------|------|
| `DEPLOY_SERVER` | Ha | `user@host` |
| `SSH_IDENTITY_FILE` | Tavsiya | SSH private key |
| `DEPLOY_APP_PATH` | Yo'q | Default `/opt/pos` |
| `STAFF_WEB_REMOTE_PATH` | Yo'q | Default `/opt/pos/sales-mobile/dist` |

### Server runtime (`/opt/pos/.env`)

| O'zgaruvchi | Majburiy | Izoh |
|-------------|----------|------|
| `POS_DATA_DIR` | Ha | `/var/lib/pos` |
| `PUBLIC_API_DB_PATH` | Ha* | Tenant DB yo'li |
| `POS_HOST_SECRET` | Ha | Admin RPC |
| `JWT_SECRET` | Ha | Mini App auth |
| `TELEGRAM_BOT_TOKEN` | Ha | Mijoz bot |
| `TELEGRAM_WEB_APP_URL` | Ha | `https://app.../` |
| `STAFF_BOT_TOKEN` | Ha | Staff bot |
| `STAFF_WEB_APP_URL` | Ha | `https://staff.../` |
| `STAFF_JWT_SECRET` | Ha | Staff API JWT |
| `PUBLIC_API_TRUST_PROXY` | Tavsiya | `1` (nginx ortida) |
| `PUBLIC_API_CORS_ORIGINS` | Shart* | Alohida API domen bo'lsa |

### Docker (ixtiyoriy)

Agar `docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up` ishlatsangiz:
- `POS_HOST_DATA_DIR=/var/lib/pos` — public-api bilan **bir xil** SQLite
- `pos-rpc.service` va Docker `:3333` **bir vaqtda emas** (EADDRINUSE)

---

## 9. Yangilash (routine)

Serverda (`deploy/server-update-opt-pos.sh` kengaytirilgan):

```bash
cd /opt/pos && git pull
npm ci --prefix public-api
npm run build --prefix mini-app
npm run export-web --prefix sales-mobile
sudo systemctl restart public-api telegram-bot
```

Yoki lokal:

```powershell
npm run deploy:full
```

---

## 10. Muammolar

| Belgi | Sabab | Yechim |
|-------|-------|--------|
| Staff bot javob bermaydi | `STAFF_WEB_APP_URL` http yoki bo'sh | HTTPS URL + `systemctl restart public-api` |
| 409 Telegram | Ikki polling | `telegram:staff-bot` o'chiring, faqat public-api |
| 502 nginx | public-api down | `systemctl status public-api` |
| Bo'sh staff sahifa | `sales-mobile/dist` yo'q | `npm run deploy:staff` |
| Buyurtmalar admin'da yo'q | DB yo'li farq qiladi | `PUBLIC_API_DB_PATH` = Electron `pos.db` |
| CORS xato | Origin ro'yxatda yo'q | `PUBLIC_API_CORS_ORIGINS` |

---

## Bog'liq fayllar

| Fayl | Vazifa |
|------|--------|
| `deploy/deploy.env.example` | Lokal deploy SSH |
| `deploy/STAFF-MOBILE-DEPLOY.md` | Staff batafsil |
| `mini-app/DEPLOY-UZ.md` | Mini App |
| `deploy/DEPLOY-READINESS-CHECKLIST.md` | Preflight |
| `scripts/deploy-full.cjs` | To'liq orchestrator |
| `scripts/deploy-staff-web.cjs` | Staff static deploy |
| `deploy/scripts/setup-staff-nginx.sh` | Staff HTTPS |
| `deploy/scripts/vps-first-time-setup.sh` | Birinchi VPS setup |
