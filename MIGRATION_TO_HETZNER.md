# Hetzner Cloud'ga Migratsiya — MVP Qo'llanma

Bu qo'llanma POS ilovasini **Electron desktopdan Hetzner Cloud web-SaaS**
rejimiga o'tkazishni tushuntiradi. Electron rejimi saqlanadi; bu qadam faqat
**qo'shimcha** HTTP RPC server ishga tushirish imkonini beradi.

## Arxitektura

```
                                    Hetzner CX22 (€4.5/oy)
                                    ┌────────────────────────────────┐
  Browser ─── HTTPS ──► Cloudflare ─┤ Nginx :443 (SSL)               │
  (remote  (VITE_POS_   (bepul SSL) │   ├─► / → dist/ (SPA static)   │
   posApi)  RPC_URL)                │   └─► /rpc, /health → 127.0.0.1│
                                    │                     :3333      │
                                    │ Node.js:                       │
                                    │   electron/server.cjs          │
                                    │   → services/ → SQLite         │
                                    │                                │
                                    │ /var/lib/pos/                  │
                                    │   ├── pos.db                   │
                                    │   ├── pos-config.json          │
                                    │   ├── backups/                 │
                                    │   └── server.log               │
                                    └────────────────────────────────┘
```

**Diqqat:** Bu MVP rejimi uchun. Thermal printer, USB tarozi, fayl dialog'lari
`node-thermal-printer` va OS API'lariga bog'liq — server'dan ishlamaydi. Ular
uchun kassa tomonda kichik "bridge" kerak (keyinroq).

---

## 1. Lokal test (Windows/Mac/Linux)

### better-sqlite3 ABI haqida ogohlantirish

Loyihada `postinstall: electron-builder install-app-deps` bor — u `better-sqlite3`
ni **Electron ABI** uchun build qiladi. Server rejimida (Node.js plain) bu ABI
mos kelmaydi va `NODE_MODULE_VERSION` xatosi chiqadi.

Lokal sinov uchun vaqtinchalik Node ABI ga qayta build qiling:
```bash
npx prebuild-install -r napi -f --target=$(node -v | cut -c2-) \
  --path ./node_modules/better-sqlite3 --platform=win32 --arch=x64
# yoki oddiy:
npm rebuild better-sqlite3 --build-from-source
```
Electron rejimiga qaytish uchun:
```bash
npm run rebuild
```

**Hetzner (Linux)da muammo YO'Q** — u yerda Electron o'rnatilmaydi, `npm ci`
avtomatik Node ABI uchun build qiladi.

### Lokal dev rejim

Avval lokalda ishlayotganini tekshirib olish:

```bash
# 1. Secret generatsiya qiling
node -e "console.log(require('crypto').randomUUID())"
# misol: 3f5b2a1c-8d4e-4f5a-9b1c-2d3e4f5a6b7c

# 2. .env yarating (root faylda)
cp .env.server.example .env
# POS_HOST_SECRET va VITE_POS_RPC_SECRET ni yuqoridagi qiymatga almashtiring

# 3. Lokal dev rejimda server (./.pos-data-dev/ katalogiga)
npm run server:dev
```

Kutilgan chiqish:
```
[server] ready → http://127.0.0.1:3333   (health: /health, rpc: POST /rpc)
```

Tekshirish:
```bash
curl http://127.0.0.1:3333/health
# {"ok":true,"status":"ok","time":"..."}

curl -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer <POS_HOST_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:products:count","args":[{}]}'
```

Frontend'ni alohida ishga tushirish:
```bash
npm run dev
# http://localhost:5173 — posApi endi remote server orqali chaqiriladi
```

---

## 1.4. Tezkor deploy (Docker + Nginx avtoskriptlar bilan)

Bu sizga kerak bo'lgan minimal ketma-ketlik — barcha bo'limlar pastda batafsil
tushuntirilgan, shu yerda faqat buyruqlar:

```bash
# === SERVER (Ubuntu 22.04/24.04, root yoki sudo) ==========================
# 1) Docker
curl -fsSL https://get.docker.com | sh

# 2) Kodni olish
git clone <sizning-repo-url> /opt/pos
cd /opt/pos

# 3) .env
cp .env.server.example .env
SECRET=$(node -e "console.log(require('crypto').randomUUID())" 2>/dev/null \
        || openssl rand -hex 32)
sed -i "s|^POS_HOST_SECRET=.*|POS_HOST_SECRET=$SECRET|"   .env
sed -i "s|^VITE_POS_RPC_SECRET=.*|VITE_POS_RPC_SECRET=$SECRET|" .env
sed -i "s|^POS_CORS_ORIGINS=.*|POS_CORS_ORIGINS=https://pos.example.com|" .env

# 4) Backend
docker compose up -d --build
curl http://127.0.0.1:3333/health   # {"ok":true,...}

# 5) Nginx + SSL
sudo DOMAIN=pos.example.com \
     API_DOMAIN=api.example.com \
     EMAIL=admin@example.com \
     deploy/scripts/setup-nginx.sh
```

```bash
# === LOKAL (sizning kompyuteringizda) =====================================
# Frontend build + yuklash
SERVER=root@<server-ip> \
API_URL=https://api.example.com \
API_SECRET="<yuqoridagi SECRET qiymati>" \
deploy/scripts/frontend-build-and-publish.sh
```

Tayyor — https://pos.example.com dan brauzer orqali ishlaydi.

Batafsil: `deploy/README.md` faylda.

---

## 1.5. Docker orqali ishga tushirish (TAVSIYA ETILADI)

Bu yo'l tartibsizlikni kamaytiradi: `better-sqlite3` ABI muammolari, Node versiyasi,
qo'lda `npm rebuild` — hammasi Dockerfile ichida hal bo'ladi. Hetznerda ham, lokal
testda ham bir xil image.

### 1.5.1 Old shartlar (lokal yoki server)

- Docker 24+ va Docker Compose v2 (`docker compose`, eski `docker-compose` emas)
- Kompilyatsiya bir marta bo'ladi (~2–3 daqiqa), keyin cache ishlatadi

Linux (Ubuntu 22.04) da:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# logout/login yoki: newgrp docker
```

### 1.5.2 `.env` tayyorlash

```bash
cp .env.server.example .env

# Secret generatsiya qiling (HOST + VITE bir xil qiymat!)
SECRET=$(node -e "console.log(require('crypto').randomUUID())")
# yoki: SECRET=$(openssl rand -hex 32)

# .env ichida bu qatorlarni yangilang:
#   POS_HOST_SECRET=<yuqoridagi SECRET>
#   VITE_POS_RPC_SECRET=<xuddi shu qiymat>
#   POS_CORS_ORIGINS=https://app.example.com
```

### 1.5.3 Build va ishga tushirish

```bash
# Image yig'ish
docker compose build

# Ishga tushirish (detached)
docker compose up -d

# Loglar
docker compose logs -f pos-server

# Sog'liq tekshiruvi
docker compose ps
# STATUS ustunida "(healthy)" bo'lishi kerak

curl http://127.0.0.1:3333/health
# {"ok":true,"status":"ok","time":"..."}
```

### 1.5.4 Lokal development override (ixtiyoriy)

```bash
cp docker-compose.override.yaml.example docker-compose.override.yaml
# endi 3333 port barcha interface'larda ochiq, ma'lumotlar ./.pos-data-docker/ da
docker compose up -d
```

### 1.5.5 Kundalik ishlatish

| Amal | Buyruq |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart pos-server` |
| Loglarni ko'rish | `docker compose logs -f pos-server` |
| Ichiga kirish (debug) | `docker compose exec pos-server sh` |
| Image qayta yig'ish | `docker compose build --no-cache` |
| DB fayliga kirish | `docker compose exec pos-server sqlite3 /var/lib/pos/pos.db` ⚠️ (sqlite3 CLI default'da yo'q — `docker cp` bilan DB'ni olib chiqing) |
| Backuplarni ko'chirish | `docker cp pos-server:/var/lib/pos/backups ./backups-local` |

### 1.5.6 Volume & backup

Ma'lumotlar `pos-data` nomli Docker volume'da:
```bash
# Volume manzilini topish
docker volume inspect pos-data

# Tashqi disk'ga backup
docker run --rm -v pos-data:/src -v $PWD:/dst alpine \
  tar czf /dst/pos-data-backup-$(date +%F).tgz -C /src .

# Restore
docker run --rm -v pos-data:/dst -v $PWD:/src alpine \
  sh -c "rm -rf /dst/* && tar xzf /src/pos-data-backup-YYYY-MM-DD.tgz -C /dst"
```

### 1.5.7 Hetznerga deploy (Docker yo'li)

Oddiy usul — kodni server'ga yuboring va `docker compose up -d` ishlating:
```bash
# serverda
git clone <repo> /opt/pos
cd /opt/pos
cp .env.server.example .env
# .env ni to'ldiring
docker compose up -d --build
```

Nginx'ni TIZIMGA (konteynersiz) o'rnating (3-bo'lim) va `/rpc`, `/health` ni
`127.0.0.1:3333` ga proxylash — konteyner port mappingi allaqachon `127.0.0.1:3333`
ga cheklangan, tashqi internetdan to'g'ridan-to'g'ri kira olmaydi.

> Qachon Docker ishlatmaslik kerak? Agar siz qattiq cheklangan CPU/RAM
> (masalan CX11 eski) ishlatsangiz — to'g'ridan-to'g'ri systemd yo'li (3-bo'lim)
> ~50MB kamroq xotira yeydi. CX22+ uchun Docker farq qilmaydi.

---

## 2. Hetzner CX22 setup

### 2.1 Server yaratish
- Hetzner Cloud Console → "Create Server"
- Image: **Ubuntu 22.04**
- Type: **CX22** (€4.5/oy, 2 vCPU, 4GB RAM, 40GB SSD)
- Location: **Helsinki** (Markaziy Osiyoga yaqinroq)
- SSH key qo'shing

### 2.2 Boshlang'ich o'rnatish
```bash
ssh root@<SERVER_IP>

# System update
apt update && apt upgrade -y
apt install -y curl git ufw nginx certbot python3-certbot-nginx

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Build tools (better-sqlite3 uchun)
apt install -y build-essential python3

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Non-root user
adduser --disabled-password --gecos '' pos
usermod -aG sudo pos
mkdir -p /var/lib/pos
chown pos:pos /var/lib/pos
```

### 2.3 Kod va qaramlik
```bash
su - pos
git clone <your-repo-url> app
cd app
npm ci

# better-sqlite3 ni Linux Node.js uchun qayta build qilish
# (chunki package.json'da `postinstall: electron-builder install-app-deps` bor —
#  u Electron'ga moslaydi. Server uchun Node native ABI kerak.)
npm rebuild better-sqlite3

# Frontend build
npm run build
```

### 2.4 ENV
```bash
nano /home/pos/app/.env
```

```ini
POS_SERVER_MODE=1
POS_DATA_DIR=/var/lib/pos
POS_HOST_BIND=127.0.0.1
POS_HOST_PORT=3333
POS_HOST_SECRET=<generated-uuid>
POS_CORS_ORIGINS=https://app.your-domain.uz
POS_BACKUP_ENABLED=1
POS_BACKUP_INTERVAL_MIN=30
POS_BACKUP_MAX=48

# Frontend build uchun:
VITE_POS_RPC_URL=https://api.your-domain.uz
VITE_POS_RPC_SECRET=<same-as-POS_HOST_SECRET>
```

Build'ni yangi ENV bilan qayta:
```bash
npm run build
```

---

## 3. systemd service

```bash
sudo nano /etc/systemd/system/pos-server.service
```

```ini
[Unit]
Description=POS HTTP RPC Server
After=network.target

[Service]
Type=simple
User=pos
WorkingDirectory=/home/pos/app
EnvironmentFile=/home/pos/app/.env
ExecStart=/usr/bin/node electron/server.cjs
Restart=always
RestartSec=3
StandardOutput=append:/var/log/pos-server.log
StandardError=append:/var/log/pos-server.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo touch /var/log/pos-server.log
sudo chown pos:pos /var/log/pos-server.log
sudo systemctl daemon-reload
sudo systemctl enable --now pos-server
sudo systemctl status pos-server
# jurnal:
sudo journalctl -u pos-server -f
```

Test:
```bash
curl http://127.0.0.1:3333/health
```

---

## 4. Nginx + SSL

Ikki subdomen:
- `app.your-domain.uz` → frontend (SPA)
- `api.your-domain.uz` → RPC backend

```bash
sudo nano /etc/nginx/sites-available/pos
```

```nginx
# Backend (RPC)
server {
  listen 80;
  server_name api.your-domain.uz;

  client_max_body_size 20m;
  proxy_read_timeout 180s;

  location / {
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# Frontend (static SPA)
server {
  listen 80;
  server_name app.your-domain.uz;
  root /home/pos/app/dist;
  index index.html;

  gzip on;
  gzip_types text/plain application/javascript application/json text/css;

  location / {
    try_files $uri /index.html;
  }

  location ~* \.(?:js|css|woff2?|ttf|png|jpg|svg|ico)$ {
    expires 30d;
    access_log off;
    add_header Cache-Control "public, immutable";
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/pos /etc/nginx/sites-enabled/pos
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d app.your-domain.uz -d api.your-domain.uz
```

---

## 5. Frontend'ni Nginx'dan o'qitish

`npm run build` chiqishi `/home/pos/app/dist/` — Nginx shuni xizmat qiladi. Kod
yangilanganda:

```bash
cd /home/pos/app
git pull
npm ci
npm rebuild better-sqlite3
npm run build
sudo systemctl restart pos-server
```

Yoki kichik deploy skript `deploy.sh`:
```bash
#!/bin/bash
set -e
cd /home/pos/app
git pull
npm ci
npm rebuild better-sqlite3
npm run build
sudo systemctl restart pos-server
echo "Deploy done at $(date)"
```

---

## 6. Backup strategiyasi

Server ichki backup (`POS_BACKUP_ENABLED=1`) SQLite'ni `/var/lib/pos/backups/`
ga har 30 daqiqada nusxalaydi. Qo'shimcha — Hetzner Storage Box (€3.5/oy) bilan
off-site backup:

```bash
sudo crontab -e
```
```
0 */6 * * * rsync -az /var/lib/pos/backups/ <user>@<storagebox>:/pos-backups/
```

---

## 7. Ma'lum cheklovlar (MVP)

| Xususiyat | MVP holati | Yechim |
|-----------|-----------|---------|
| Thermal chek printeri | ✅ Kassada `pos-print-agent` Node daemoni orqali | 👉 pastda "Print Agent" bo'limi |
| Barcode skaner (HID keyboard-wedge) | ✅ `useBarcodeScanner` hooki — agent shart emas | 👉 pastda "Kassa qurilmalari" bo'limi |
| USB/serial tarozi | ✅ `pos-print-agent`ning `/scale/read` endpointi | 👉 pastda "Kassa qurilmalari" bo'limi |
| "Save As" dialog | ❌ Browser'da | `<a download>` + blob |
| "Open file" dialog | ❌ Browser'da | `<input type="file">` + upload |
| Mahsulot rasmlari | ⚠️ Lokal fayl tizimiga yozadi | S3/MinIO'ga ko'chirish kerak |
| Session auth | ✅ Login session token (12 soat) | 👉 pastda "Auth model" bo'limini o'qing |
| Concurrent writes | ⚠️ SQLite DELETE mode | ≤50 foydalanuvchi OK, undan ko'pida PostgreSQL |
| Ko'p do'kon (multi-tenant) | ❌ | `tenant_id` refactor kerak |

Bu cheklovlar **Faza 2**ga o'tganda bartaraf qilinadi. MVP dastlabki
foydalanuvchi sinovi va demo uchun yetarli.

---

## 7.5. Auth model (session tokenlar)

Endi `/rpc`ga kirish ikki xil bo'lishi mumkin:

| Turi | Headerda | Kim ishlatadi | Cheklovlar |
|------|----------|---------------|------------|
| **Shared secret** (`POS_HOST_SECRET`) | `Authorization: Bearer <secret>` | CLI skript, migratsiya, admin bypass, **bootstrap login** | Har qanday kanal, shu jumladan `pos:database:wipe*`. **Browser'da ochiq** — faqat HTTPS orqali + ishonchli tarmoqda ishlating. |
| **Session token** | `Authorization: Bearer <session-token>` | Login qilgan kassir/menejer/admin | Role matritsasi bo'yicha cheklangan (pastda). Token 12 soatdan keyin avtomatik yo'q bo'ladi. |

### Oqim

1. Frontend `pos:auth:login` ni **shared secret** bilan chaqiradi:
   ```
   POST /rpc  Authorization: Bearer <POS_HOST_SECRET>
   { "channel": "pos:auth:login", "args": ["cashier01", "password123"] }
   ```
2. Server SQLite'dagi `users` jadvalini tekshiradi, success bo'lsa quyidagini qaytaradi:
   ```json
   { "ok": true, "data": {
       "success": true,
       "user": { "id": "u1", "username": "cashier01", "role": "cashier" },
       "token": "<opaque-session-token>",
       "expiresAt": "2026-04-20 08:00:00"
   } }
   ```
3. Frontend `token`ni `localStorage["pos_session_token"]`ga yozadi (bu `remotePosApi.ts` ichida avtomatik).
4. Keyingi barcha chaqiruvlar **session token** bilan:
   ```
   POST /rpc  Authorization: Bearer <session-token>
   ```
5. `pos:auth:logout` chaqirilganda foydalanuvchining **barcha** sessiyalari serverda o'chiriladi (boshqa brauzer/qurilmalarda ham).
6. Agar token eskirsa yoki yaroqsiz bo'lsa, server `401` qaytaradi; frontend tokenni tozalaydi va `pos:auth:required` DOM event jo'natadi — ilovada bu eventga login sahifasiga yo'naltirish hook qilishingiz mumkin:
   ```ts
   window.addEventListener('pos:auth:required', () => navigate('/login'));
   ```

### Role matritsasi (server tomondan majburlanadi)

| Role | Ruxsat |
|------|--------|
| `admin` | Barcha kanallar (shu jumladan `pos:settings:resetDatabase` faqat **shared secret** orqali) |
| `manager` | Adminnikiga o'xshash, lekin `pos:settings:resetDatabase` va `pos:database:*` taqiqlangan |
| `cashier` | Sotuv/returns/shifts/customers (to'liq), products/pricing/inventory (**faqat o'qish**), dailySales/cashFlow hisobotlar, dashboard:getStats |
| Boshqa/nomaʼlum | Rad etiladi (deny-by-default) |

> **Eslatma:** Electron desktop rejimi session tizimini **ishlatmaydi** — lokal oyna avtomatik ishonchli. `preload.cjs`ga `logout`/`me` proksilari qo'shilgan, renderer kodi bir xil bo'lishi uchun.

### Token xavfsizlik xususiyatlari

- **Xesh qilib saqlanadi**: SQLite'dagi `sessions.token` ustuni SHA-256 xesh, token o'zi DBda emas. Backup o'g'irlansa — qayta o'ynatilmaydi.
- **Xotirada LRU cache**: 512 ta sessiya cache'lanadi, har so'rovda DB'ga bormaydi.
- **Avtomatik tozalash**: 30 daqiqada bir marta eskirganlari o'chiriladi.
- **`is_active=0` foydalanuvchilari**: session darhol bekor qilinadi (DB check).
- **Disable foydalanuvchi holida** barcha sessiyalari avtomatik o'chiriladi.

---

## 7.6. Print Agent (kassa PC'da chek ko'prigi)

Cloud backend kassir kompyuteriga ulangan USB/Windows printerga to'g'ridan-to'g'ri
chiqa olmaydi — brauzer ham bunga ruxsat bermaydi. Shuning uchun har bir kassa
PC'da kichik Node.js daemon **`pos-print-agent`** ishlaydi:

```
[ Brauzer @ pos.example.com ]
          │
          │ POST http://127.0.0.1:9100/print  (Bearer + JSON)
          ▼
[ pos-print-agent (Node) ] ──► ESC/POS ──► [ Thermal printer ]
```

### Kassa PC'da o'rnatish (Windows)

```powershell
# 1) Node.js 18+ o'rnating (https://nodejs.org/)
# 2) Ushbu repodagi print-agent/ jildini C:\pos-print-agent ga nusxalang
cd C:\pos-print-agent
npm install

# 3) Agentni bir marta ishga tushiring — u avtomatik config.json yaratadi
node agent.js
#   [print-agent] Wrote default config to ...
#   [print-agent] Bearer secret: 6f9c...
# Ctrl+C bilan to'xtating.

# 4) config.json ni tahrirlang:
#    - printer.interface  ->  "printer:<Windows printer nomi>"
#    - agent.allowOrigins ->  ["https://pos.example.com"]
# 5) Avtoishga tushishni ro'yxatdan o'tkazing:
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

Linux (systemd) uchun `print-agent/README.md`dagi "Quick start (Linux)" bo'limiga qarang.

### Frontend integratsiyasi

Frontend web buildga quyidagi env o'zgaruvchilarni qo'shing:

```bash
VITE_PRINT_AGENT_URL=http://127.0.0.1:9100
VITE_PRINT_AGENT_SECRET=<agent config.json dan olingan secret>
```

`src/lib/receipts/escposPrint.ts` chek chop etishda:

1. `VITE_POS_RPC_URL` o'rnatilgan bo'lsa (web/SaaS rejimi) **avval lokal agentga** boradi.
2. Desktop Electron buildda agent e'tiborga olinmaydi — mavjud `printService.cjs` IPC orqali ishlaydi.
3. Ikkalasi ham mavjud bo'lmasa — foydalanuvchiga aniq xato ("Install and start pos-print-agent...").

Agent cache qilinadi (30s TTL), shuning uchun har chop etishda probe qilinmaydi.

### Endpoint xulosa

| Endpoint | Auth | Tavsif |
|----------|------|--------|
| `GET /health` | ochiq | Agent tirik va qaysi printer sozlangan |
| `POST /print` | Bearer | `{ lines, options }` — asosiy chek |
| `POST /print/test` | Bearer | Qattiq shakldagi "SALOM" test cheki |
| `GET /config` | Bearer | Joriy konfiguratsiya (secret maskirovka qilingan) |

### Xavfsizlik maslahatlari

- **Har doim `agent.secret` o'rnating** — aks holda bir xil PC'da har qanday
  jarayon chop etishni ishga tushira oladi.
- **Faqat `127.0.0.1` ga bind qiling**. `0.0.0.0`ga faqat butun LAN ishonchli
  bo'lsa o'ting.
- `agent.allowOrigins` ni konkret `https://pos.example.com`ga cheklang —
  `*` dev uchun, prod uchun **emas**.
- Agent secretini kassa decommission qilinganda aylantiring.

Batafsil tarmoq/USB/seriyali interfeyslar, troubleshooting va logging
ko'rsatmalari: [`print-agent/README.md`](./print-agent/README.md).

---

## 7.7. Kassa qurilmalari — barcode skaner + tarozi

### Barcode skaner — agent shart emas

Ko'pchilik USB/Bluetooth POS skanerlar (Honeywell, Zebra, Datalogic, Netum
va h.k.) **"HID keyboard-wedge"** rejimida ishlaydi: skan qilinganda raqamlar
avtomatik klaviaturadan terilganday brauzerga yetkaziladi, oxirida Enter bilan.
Brauzer buni tabiiy qabul qiladi — alohida agent shart emas.

Global `useBarcodeScanner` hooki:

```tsx
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';

function POSTerminal() {
  useBarcodeScanner({
    enabled: true,
    minLength: 4,
    onScan: (code) => handleBarcodeSearch(code),
    // 'auto' — qidiruv maydonida fokus bo'lsa ham tez burst'ni ushlab
    // qoladi, lekin sekin inson yozuvini o'ziga o'tkazmaydi.
    whenInputFocused: 'auto',
  });
  // ...
}
```

Ichki heuristika:

- Tugmalar orasidagi vaqt **40 ms dan kam** bo'lsa → skaner burst deb hisoblanadi.
- **Enter yoki Tab** bilan yakunlansa — darhol `onScan(code)`.
- Enter kelmasa, **60 ms idle**dan so'ng avtomatik flush.
- Editable input'ga fokus bo'lsa va burst sekin bo'lsa — hijack qilmaydi (inson yozayotgan).

### Tarozi — agent orqali

Brauzer USB/serial portlarga to'g'ridan-to'g'ri kira olmaydi, shu bois
`pos-print-agent`ning `/scale/read` endpointidan foydalanamiz (xuddi chek kabi).

Kassada bir martalik sozlash:

```powershell
cd C:\pos-print-agent
npm install serialport      # agent'ning lazy-load native dependensiyasi
```

`config.json`'ga tarozi blokini qo'shing:

```jsonc
"scale": {
  "enabled": true,
  "port": "COM5",
  "baudRate": 9600,
  "protocol": "cas",         // 'cas' | 'generic' | 'poll-ack'
  "timeoutMs": 2500,
  "minStableMs": 300,
  "divisor": null,
  "unit": null
}
```

Frontend:

```tsx
import { useScale } from '@/hooks/useScale';

function WeighButton({ onWeight }) {
  const { read, isReading, error } = useScale();
  return (
    <Button disabled={isReading} onClick={async () => {
      try {
        const r = await read();             // { weight: 0.245, unit: 'kg', stable: true }
        onWeight(r.weight);
      } catch (e) {
        toast.error(e.message);
      }
    }}>
      {isReading ? 'O\'qilmoqda…' : 'Tortish'}
    </Button>
  );
}
```

### Qo'llab-quvvatlangan tarozilar

| Protokol | Odatdagi modellar | Izoh |
|----------|-------------------|------|
| `cas`    | CAS-PD, ACLAS, AND, aksariyat CAS-mos | Doimiy ASCII stream'ni tinglaydi |
| `generic`| Oddiy ASCII tarozilar ("W\r" so'rovi bilan) | Agent ulanishda `W\r` jo'natadi |
| `poll-ack`| Mettler Toledo, Avery | Agent `S\r\n` so'rov, javobni parse qiladi |

Hisobotdagi `raw` maydon ishlaydi — tarozingiz qo'llab-quvvatlanmagan formatda
bo'lsa, shu frame'ni yuborib parse logikasini kengaytirish oson.

---

## 7.9. Monitoring — Prometheus + Grafana + alertlar

POS server `prom-client` bilan instrument qilingan va `GET /metrics` endpointini
ochiq holda (loopback uchun) yoki Bearer token bilan (tashqi uchun) ko'rsatadi.
Mahalliy rejim uchun monitoring ixtiyoriy — `--profile monitoring` bilan
yoqiladi.

### 7.9.1. Qanday metriklar yig'iladi

Default Node.js metriklari (event loop lag, RSS, GC) + loyihaga xos:

| Metric | Tur | Izoh |
|--------|-----|------|
| `pos_http_requests_total{route,method,status}`         | counter   | Har bir HTTP javob |
| `pos_http_request_duration_seconds{route,method}`      | histogram | HTTP javob latency |
| `pos_rpc_calls_total{channel,outcome,auth}`            | counter   | `outcome = ok\|error\|denied`, `auth = session\|admin\|none` |
| `pos_rpc_call_duration_seconds{channel}`               | histogram | Dispatcher ichidagi xizmat layeri latencisi |
| `pos_auth_logins_total{outcome}`                       | counter   | `success\|invalid_credentials\|error` |
| `pos_sessions_active`                                  | gauge     | Muddati o'tmagan sessiyalar |
| `pos_db_size_bytes`                                    | gauge     | SQLite `.db + .db-wal` hajmi |
| `pos_db_query_errors_total{channel}`                   | counter   | DB-ga oid xatolar |
| `pos_sales_today_total`                                | gauge     | Bugungi tugatilgan sotuvlar soni |
| `pos_sales_today_revenue`                              | gauge     | Bugungi revenue |
| `pos_shifts_open`                                      | gauge     | Ochiq smenalar |

### 7.9.2. `/metrics` autentifikatsiyasi

- **Loopback** (`127.0.0.1`, `::1`, shu docker bridge) — token talab qilmaydi.
  Shu tufayli bir xil compose network'dagi Prometheus konteyneri `pos-server:3333`
  ga to'g'ridan-to'g'ri scrape qila oladi.
- **Tashqi** (boshqa IP yoki `X-Forwarded-For`) — `Authorization: Bearer
  $POS_METRICS_SECRET` (default `POS_HOST_SECRET`'ga fallback).

> `POS_METRICS_SECRET`ni `POS_HOST_SECRET`dan ALOHIDA qilib sozlang — shunda
> monitoring tokenini rotate qilsangiz, foydalanuvchi sessiyalari kesilmaydi.

### 7.9.3. Monitoring stack'ni yoqish

```bash
# /opt/pos/.env ichiga qo'shing:
POS_METRICS_SECRET=<uuid>
GF_ADMIN_PASSWORD=<strong-password>
GF_ROOT_URL=https://pos.example.com/grafana   # agar nginx ortida bo'lsa

# Metrics secret faylni Prometheus konteyneri o'qiy oladigan qilib qo'ying:
echo -n "$POS_METRICS_SECRET" | sudo tee \
  /opt/pos/deploy/monitoring/pos-metrics-token > /dev/null
sudo chmod 0640 /opt/pos/deploy/monitoring/pos-metrics-token

# Monitoring profilini ishga tushiring:
cd /opt/pos
docker compose \
  -f docker-compose.yaml \
  -f docker-compose.prod.yaml \
  -f docker-compose.monitoring.yaml \
  --profile monitoring \
  up -d
```

Prometheus UI: `http://127.0.0.1:9090` (SSH tunnel orqali).
Grafana UI: `http://127.0.0.1:3000` (dastlabki login: `admin` + `GF_ADMIN_PASSWORD`).

Avtomatik provisioning:
- Prometheus datasource allaqachon `http://prometheus:9090` ga ishora qiladi.
- `POS / Overview` dashboard `POS` papkasida paydo bo'ladi.
- **`POS / Tenants`** — multi-tenant rejim uchun: yuqoridagi **Tenant** o'zgaruvchisi
  (`label_values(pos_tenant_db_size_bytes, tenant)`), SQLite fayl hajmi (bar gauge),
  va `pos_tenant_rpc_calls_total` bo'yicha tezlik. `POS_MULTI_TENANT=0` bo'lsa
  metrikalar bo'sh, dashboardda "No data" — bu normal.

### 7.9.3.1. Tenant dashboard qisqacha

| Panel | Manba |
|-------|--------|
| Active / disabled tenants | `pos_tenants_total{state=...}` |
| DB hajmi | `pos_tenant_db_size_bytes{tenant}` |
| RPC tezligi | `rate(pos_tenant_rpc_calls_total{tenant=~"$tenant"})` — `mtDispatch` tenant RPClarida hisoblanadi |

**Eslatma:** global `pos_rpc_calls_total` (Overview dashboard) kanal bo'yicha yig'iladi,
lekin **tenant** labeli yo'q; do'kon bo'yicha chuqur tahlil uchun shu `POS / Tenants`
dashboarddan foydalaning.

### 7.9.4. Nginx ortida Grafanani ochish (ixtiyoriy)

```nginx
location /grafana/ {
    proxy_pass         http://127.0.0.1:3000/;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
location /grafana/api/live/ {
    proxy_pass         http://127.0.0.1:3000/api/live/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
}
```

Keyin `GF_ROOT_URL=https://pos.example.com/grafana` qilib qo'ying.

### 7.9.5. Alert qoidalar va notifications

Default `alerts.yml` quyidagi alertlarni o'z ichiga oladi:

| Alert | Severity | Tavsif |
|-------|----------|--------|
| `PosServerDown`           | page    | 2 minut ichida `/metrics` scrape muvaffaqiyatsiz |
| `PosHighHttpErrorRate`    | warning | 5xx > 5% (5 minut) |
| `PosHighRpcLatencyP95`    | warning | Biror kanal p95 > 1s (10 minut) |
| `PosRpcDeniedSpike`       | warning | PERMISSION_DENIED > 20/min |
| `PosLoginFailuresSpike`   | warning | Noto'g'ri login urinishlar spiki |
| `PosDbSizeGrowingFast`    | info    | DB 200MB/soat oshmoqda |
| `HostDiskSpaceLow`        | page    | Biror mount < 10% bo'sh |
| `HostMemoryPressure`      | warning | MemAvailable < 10% |
| `HostLoadHigh`            | warning | load1 > 4×CPU (10 minut) |

MVP'da Alertmanager yo'q — notificationlar uchun:
1. `docker-compose.monitoring.yaml`'ga `alertmanager` servisini qo'shing.
2. Telegram/Slack/Email receiver konfiguratsiyasi: `alertmanager.yml` yarating.
3. `prometheus.yml` ichidagi `alerting:` bloki bilan ulang.

Yoki tashqi hizmat (Uptime Kuma, Better Uptime, Healthchecks.io) bilan:

```bash
# Healthchecks.io uchun cron:
* * * * * curl -fsS --retry 3 -H "Authorization: Bearer $POS_METRICS_SECRET" \
  https://pos.example.com/health >/dev/null && \
  curl -fsS https://hc-ping.com/<uuid>
```

### 7.9.6. Uptime Kuma (eng sodda variant)

Agar Grafana/Prometheus oshiqcha tuyulsa, bitta `louislam/uptime-kuma`
konteynerini ham yuritish mumkin:

```bash
docker run -d --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma louislam/uptime-kuma:1
```

Keyin `https://pos.example.com/health`, `https://pos.example.com/` va
`/metrics`ni monitor sifatida qo'shing. Telegram/email/Discord notifications
to'g'ridan-to'g'ri UI'da sozlanadi.

---

## 7.10. Off-site backup — rclone + haftalik restore drill

Lokal SQLite snapshotlar `POS_BACKUP_INTERVAL_MIN` (default 30 min) bo'yicha
`/var/lib/pos/backups/`da saqlanadi. Ammo agar server diski yoki butun VM yo'q
bo'lsa, ular ham yo'qoladi. Shuning uchun **off-site** (S3/B2/Hetzner Object
Storage) nusxa shart.

### 7.10.1. Arxitektura

```
┌──────────────────────┐   30 min     ┌────────────────┐   hourly   ┌──────────┐
│ pos-server (Docker) │ ───snapshot──▶│ /var/lib/pos/  │ ── rclone ▶│  S3/B2   │
│   backupManager.cjs  │              │   backups/     │            │  bucket  │
└──────────────────────┘              └────────────────┘            └──────────┘
                                              │                          │
                                              │                          │
                                       Prometheus scrapes          weekly restore-drill
                                       pos_backup_* gauges         (docker run + /health)
```

Sinxronlashni **ikki usul bilan** berish mumkin — bittasini tanlang:

| Usul | Afzalligi | Kamchiligi |
|------|-----------|------------|
| **Systemd timer** (host cron) | engil, kam resurs, journald logi qulay | host'da `rclone` o'rnatilishi kerak |
| **Docker sidecar** (compose) | hammasi konteynerda, portable, staging'ga ko'chirish oson | konteyner doim ishlab turadi (bir ozgina ko'proq RAM) |

### 7.10.2. Remote sozlash (rclone)

```bash
cd /opt/pos/deploy/backup
cp rclone.conf.example rclone.conf
chmod 0600 rclone.conf
# Tanlangan provider blokini to'ldiring (B2, S3, Hetzner Object Storage, ...)
# Test:
rclone --config=rclone.conf lsd offsite:
rclone --config=rclone.conf mkdir offsite:pos-backups/prod
```

Keyin `/opt/pos/.env` ichiga qo'shing (namuna: `.env.server.example`):

```dotenv
POS_BACKUP_REMOTE=offsite
POS_BACKUP_REMOTE_PATH=pos-backups/prod
POS_BACKUP_REMOTE_RETENTION_DAYS=30
```

### 7.10.3. A usul — systemd timer

Host'da `rclone`ni o'rnating va timer'ni ulang:

```bash
sudo apt install -y rclone sqlite3
sudo bash /opt/pos/deploy/scripts/install-backup-timer.sh
# tekshirish:
systemctl list-timers pos-backup-offsite.timer
sudo systemctl start pos-backup-offsite.service    # darhol 1 marta ishga tushirish
journalctl -u pos-backup-offsite.service -n 50
```

### 7.10.4. B usul — Docker sidecar

```bash
cd /opt/pos
docker compose \
  -f docker-compose.yaml \
  -f docker-compose.prod.yaml \
  -f docker-compose.backup.yaml \
  --profile backup \
  up -d

# bir martalik run:
docker compose \
  -f docker-compose.yaml -f docker-compose.prod.yaml -f docker-compose.backup.yaml \
  run --rm pos-backup-oneshot

docker logs pos-backup-sync --tail 50
```

### 7.10.5. Qo'l bilan chaqirish (force snapshot)

Off-site skripti `pos:database:backup` RPC'ni chaqirib, yangi snapshot oldidan
yuboradi (shunday qilib remote'dagi eng so'nggi fayl har doim 1 soatdan ortiq
eski bo'lmaydi). Siz ham qo'lda chaqirishingiz mumkin:

```bash
curl -sS -X POST http://127.0.0.1:3333/rpc \
  -H "Authorization: Bearer $POS_HOST_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"channel":"pos:database:backup","args":["manual"]}'
```

Faqat shared secret yoki `admin` session ruxsat etadi. Cashier/menejer
`PERMISSION_DENIED` qaytaradi.

### 7.10.6. Haftalik restore drill

Backup "bor" deyilishi kifoya emas — uni **tiklab bo'lish**ga ishonch kerak.
`restore-drill.sh` eng so'nggi remote snapshot'ni yuklaydi, `sqlite3 PRAGMA
integrity_check` qiladi, muvaqqat `pos-server` konteynerini ko'taradi va
`/health` + `pos:debug:tableCounts` RPC'ni tekshiradi. Muvaffaqiyatli bo'lsa
exit 0, aks holda 2/3/4 bilan yiqiladi.

Qo'lda ishga tushirish:

```bash
sudo apt install -y sqlite3
bash /opt/pos/deploy/scripts/restore-drill.sh
```

Haftalik timer (systemd):

```ini
# /etc/systemd/system/pos-restore-drill.timer
[Timer]
OnCalendar=Sun 04:30
Persistent=true
Unit=pos-restore-drill.service
[Install]
WantedBy=timers.target

# /etc/systemd/system/pos-restore-drill.service
[Service]
Type=oneshot
User=deploy
EnvironmentFile=/opt/pos/.env
ExecStart=/bin/bash /opt/pos/deploy/scripts/restore-drill.sh
SyslogIdentifier=pos-restore-drill
TimeoutStartSec=20m
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pos-restore-drill.timer
```

Yoki GitHub Actions scheduled workflow (`.github/workflows/restore-drill.yml`)
orqali — SSH qilib, skriptni ishga tushirish. CI quvurlari sizga muvaffaqiyatsiz
drill haqida email/Telegram xabar beradi.

### 7.10.7. Prometheus'da backup kuzatuvi

Avtomatik gauge'lar (`/metrics`):

- `pos_backup_local_count` — snapshotlar soni
- `pos_backup_last_age_seconds` — eng so'nggi snapshot yoshi
- `pos_backup_local_bytes` — katalog hajmi
- `pos_backup_offsite_last_age_seconds` — `.last-offsite-sync` sentinel yoshi

Alertlar (`alerts.yml` ichida):

| Alert | Shart | Severity |
|-------|-------|----------|
| `PosBackupStale`          | local snapshot > 2h / yo'q        | warning |
| `PosBackupOffsiteStale`   | off-site sync > 36h / hech qachon | **page** |
| `PosBackupCountLow`       | snapshot soni < 5                 | info |

Grafana `POS / Overview` dashboard'iga backup panel qo'shish uchun yangi panel
yarating va `pos_backup_last_age_seconds / 60` (minutlarda) ko'rsating.

---

## 7.11. CI/CD — GitHub Actions orqali avtomatik deploy

Bu loyihada uchta workflow mavjud (`.github/workflows/`):

| Workflow | Qachon ishlaydi | Nima qiladi |
|----------|-----------------|-------------|
| `ci.yml`               | har PR va har push  | smoke testlar (agent, barcode, sessions, hostServer, authflow), tsc, Docker image build — push qilmaydi |
| `deploy-backend.yml`   | `main`ga push + `electron/**` yoki `Dockerfile` o'zgarsa | image'ni build qiladi, GHCR'ga push qiladi, serverga SSH bilan kirib `docker compose pull && up -d` qiladi, `/health` ni tekshiradi |
| `deploy-frontend.yml`  | `main`ga push + `src/**` yoki Vite config o'zgarsa | `npm run build`, `rsync` bilan `/var/www/pos/releases/<stamp>/` ichiga nusxalaydi, atomik `current` symlink'ni almashtiradi, nginx'ni reload qiladi |

### 7.8.1. Server tayyorlash (bir marta)

`deploy/scripts/server-bootstrap.sh` Docker, deploy user, `/opt/pos` va
`/var/www/pos` kataloglarini yaratadi, UFW'ni yoqadi:

```bash
# serverda, root sifatida
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/scripts/server-bootstrap.sh \
  | DEPLOY_USER=deploy POS_DOMAIN=pos.example.com \
    GHCR_USER=your-gh-user GHCR_TOKEN=ghp_xxx \
    bash
```

Keyin:

1. `scp .env.server.example deploy@HOST:/opt/pos/.env` — tahrirlab to'ldiring.
2. `DOMAIN=pos.example.com EMAIL=admin@example.com bash deploy/scripts/setup-nginx.sh`
   — nginx vhost + SSL sertifikat.
3. GitHub Secrets va Variables to'ldiring (quyiga qarang).

### 7.8.2. GitHub Secrets / Variables

To'liq ro'yxat: [`.github/SECRETS.md`](../.github/SECRETS.md). Qisqacha:

- **Secrets**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT`,
  `GHCR_USER`, `GHCR_TOKEN`.
- **Variables**: `POS_DOMAIN`, `VITE_POS_RPC_URL`, `VITE_PRINT_AGENT_URL`,
  `VITE_PRINT_AGENT_SECRET`, `SKIP_DEPLOY` (bootstrap vaqtida `true`).

> `VITE_POS_RPC_SECRET` ni **CI'ga qo'shmang** — oddiy user session tokenidan
> foydalanadi; shared secret faqat admin bootstrap uchun.

### 7.8.3. Birinchi deploy

1. `main`ga push qiling — `deploy-backend.yml` ishga tushadi.
2. GHCR'da image paydo bo'ladi: `ghcr.io/OWNER/REPO:<short-sha>` va `:latest`.
3. SSH bosqichida `docker compose pull && up -d` ishlaydi.
4. Healthcheck 30s ichida `healthy` holatga o'tadi.
5. `deploy-frontend.yml` alohida ishga tushadi — `dist/` → `/var/www/pos/current`.

### 7.8.4. Qo'lda deploy (rollback uchun)

```bash
# serverda, deploy user sifatida
ssh deploy@HOST
# oldingi stabil image'ga qaytish:
POS_IMAGE=ghcr.io/OWNER/REPO:abc1234 /opt/pos/pos-pull-restart.sh
```

Yoki GitHub Actions UI'da `deploy-backend` workflow'ni "Re-run" qilish va
`force=true` bilan ishga tushirish mumkin.

### 7.8.5. Eng tez-tez uchraydigan muammolar

- **`denied: requested access to the resource is denied`** — `GHCR_TOKEN`
  `read:packages` ruxsatiga ega emas yoki GHCR'da image private. Image
  Settings → "Change visibility" → Public yoki deploy user ga alohida access bering.
- **`rsync: connection unexpectedly closed`** — `DEPLOY_SSH_KEY` public qismi
  `/home/deploy/.ssh/authorized_keys`'da yo'q yoki rubruqsatlar noto'g'ri (`chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`).
- **Healthcheck `unhealthy`** — `docker logs pos-server` ni ko'ring; odatda
  `.env`da `POS_HOST_SECRET` yo'q yoki SQLite migratsiyasi xato beradi.

---

## 8. Tekshirish checklist

- [ ] `/health` 200 OK qaytaradi
- [ ] `/rpc` noto'g'ri token bilan 401 qaytaradi
- [ ] `/rpc` to'g'ri shared secret bilan 200 OK qaytaradi
- [ ] Frontend login qiladi (`pos:auth:login`) va javob ichida `token` bor
- [ ] `localStorage.pos_session_token` to'ldirilgan
- [ ] Login'dan keyingi so'rovlarda `Authorization: Bearer <session-token>` jo'natiladi (DevTools ▶ Network'da tekshirib ko'ring)
- [ ] Cashier role'li foydalanuvchi `pos:users:create` chaqirsa `PERMISSION_DENIED` qaytadi
- [ ] Admin role'li foydalanuvchi `pos:settings:resetDatabase` chaqirsa `PERMISSION_DENIED` qaytadi (faqat shared secret ruxsat etadi)
- [ ] `pos:auth:logout` dan keyingi so'rov `401` qaytaradi
- [ ] Mahsulotlar ro'yxati yuklanadi
- [ ] Yangi sale yaratish ishlaydi
- [ ] SQLite backup'lari `/var/lib/pos/backups/`da paydo bo'ladi
- [ ] systemd qayta yoqilganda server avtomatik ishga tushadi
- [ ] `journalctl -u pos-server` xatosiz
- [ ] Kassada `curl http://127.0.0.1:9100/health` javob beradi
- [ ] `POST /print/test` lokal agentda fizik chek chiqaradi
- [ ] Web buildda chek chop etish tugmasi bosilganda DevTools ▶ Network'da `127.0.0.1:9100/print` so'rovi ko'rinadi va 200 qaytaradi
- [ ] `VITE_PRINT_AGENT_SECRET` ni noto'g'ri qilib ko'rganingizda 401 qaytadi va UI aniq xato xabarini ko'rsatadi
- [ ] Skan qilishda `useBarcodeScanner` hooki `onScan` ni chaqiradi (DevTools ▶ Console'da tekshiring)
- [ ] Tarozi ulangan va yoqilgan bo'lsa, `curl http://127.0.0.1:9100/scale/read` aniq og'irlik qaytaradi
- [ ] `scale.enabled=false` bo'lsa UI tushunarli "Tarozi sozlanmagan" xabarini ko'rsatadi
- [ ] GitHub Actions `ci.yml` yashil (har push uchun)
- [ ] `main`ga push `deploy-backend.yml` ni ishga tushiradi va GHCR'da yangi tag paydo bo'ladi
- [ ] `deploy-frontend.yml` tugagach `https://<domen>/` yangi bundle'ni qaytaradi (DevTools ▶ Sources ▶ `assets/*.js` hash o'zgargan)
- [ ] `docker inspect --format '{{.State.Health.Status}}' pos-server` → `healthy`
- [ ] `/opt/pos/pos-pull-restart.sh` bilan qo'lda rollback ishlaydi
- [ ] `curl http://127.0.0.1:3333/metrics` 200 va `pos_rpc_calls_total` ni qaytaradi
- [ ] Tashqi IP'dan `/metrics` bearer token'siz 401 qaytaradi
- [ ] Prometheus UI (`http://localhost:9090/targets`) `pos-server` ni `UP` ko'rsatadi
- [ ] Grafana'da `POS / Overview` dashboard'i paydo bo'ladi va grafikalar to'ladi
- [ ] MT rejimda `POS / Tenants` dashboard'i `Tenant` filtri bilan ochiladi va `pos_tenant_db_size_bytes` barlari to'ldiriladi
- [ ] Testda: `pos-server` kontrini to'xtatsangiz, `PosServerDown` alert 2 minut ichida `Firing` bo'ladi
- [ ] `rclone --config=/opt/pos/deploy/backup/rclone.conf lsd offsite:` uyquchidan chiqmay ro'yxatni qaytaradi
- [ ] `/opt/pos/deploy/scripts/backup-offsite.sh` qo'lda ishga tushsa exit 0 va `.last-offsite-sync` yangilanadi
- [ ] `pos_backup_last_age_seconds < 7200`, `pos_backup_offsite_last_age_seconds < 129600` (Prometheus)
- [ ] `bash /opt/pos/deploy/scripts/restore-drill.sh` — exit 0, "RESTORE DRILL PASSED"
- [ ] `pos:database:backup` RPC'si faqat `admin` uchun ishlaydi (cashier 403)
- [ ] `npm run load:smoke` lokalda exit 0 (5 VU × 10s)
- [ ] `load-test/k6/rpc-read.js` 30 VU'da p95 < 500 ms
- [ ] `load-test/k6/rpc-mixed.js` 20 VU'da sale success > 95%, p95 reads < 400 ms
- [ ] Grafana "POS / Load test" dashboard test paytida jonli ma'lumot ko'rsatadi
- [ ] `curl -I https://<domen>/` javobida `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY` bor
- [ ] `curl https://<domen>/metrics` tashqi IP'dan 403 qaytaradi (ichki scrape ishlaydi)
- [ ] `/rpc`'ga 1 soniyada 50 POST yuborsangiz 429 + `Retry-After` qaytadi
- [ ] 10 marta noto'g'ri parol bilan login qilsangiz 11-chi 429 (login bucket)
- [ ] `/var/lib/pos/logs/audit.log` ichida `auth.login.failure` va `rate_limit.blocked` rowlari bor
- [ ] Audit log ichida **hech qayerda** plain password ko'rinmaydi
- [ ] `logrotate -d /etc/logrotate.d/pos-audit` muvaffaqiyatli simulate qiladi
- [ ] `PosRateLimitBlockedSpike` va `PosLoginRateLimited` alertlar Prometheus UI'da ko'rinadi (Firing emas, Inactive)
- [ ] `sudo bash /opt/pos/deploy/scripts/rotate-secrets.sh` exit 0, `/health` yangi secret bilan 200
- [ ] Rotation'dan keyin eski bearer 401 qaytaradi
- [ ] `node electron/net/rateLimit.test.cjs` — exit 0
- [ ] `node electron/net/auditLog.test.cjs` — exit 0
- [ ] `node electron/net/security.e2e.test.cjs` — exit 0
- [ ] `POS_MULTI_TENANT=1` bilan restart `tenants=1 active=1 master=…` logini chiqaradi
- [ ] `/var/lib/pos/master.db` va `/var/lib/pos/tenants/default/pos.db` fayllari mavjud
- [ ] `pos:master:login` muvaffaqiyatli token qaytaradi (POS_MASTER_ADMIN_USER/PASS bilan)
- [ ] `pos:tenants:list` masterBypass bilan bo'sh emas (`default` tenant bor)
- [ ] `pos:tenants:create` yangi tenant yaratadi va `tenants/<slug>/pos.db` paydo bo'ladi
- [ ] Tenant-A foydalanuvchisi Tenant-B slug'ini payload'ga qo'yib so'rov jo'natsa `PERMISSION_DENIED` qaytadi
- [ ] `pos:tenants:disable` dan keyin shu tenantning eski tokenlari 401 qaytaradi
- [ ] Backup runner har bir tenant ostida `tenants/<slug>/backups/pos-*.db` yozadi
- [ ] `/metrics`da `pos_tenants_total{state="active"}` va `pos_tenant_db_size_bytes{tenant="…"}` ko'rinadi
- [ ] `node electron/db/tenantRegistry.test.cjs` — exit 0 (CI'da better-sqlite3 qayta quriladi)
- [ ] `node electron/net/mtDispatch.test.cjs` — exit 0 (lokalda ham ishlaydi — mocklar)
- [ ] Brauzer `/health` chaqirsa javobda `multi_tenant: true` keladi (DevTools ▶ Network)
- [ ] `/login` formasida "Do'kon (tenant)" maydoni ko'rinadi (MT rejim yoqilgan serverda)
- [ ] `acme.pos.example.com` subdomeniga kirishda tenant maydoni avtomatik "acme" bilan to'ldiriladi
- [ ] Tenant maydoni bo'shi bilan login bosilsa UI darhol "Do'kon kodini kiriting" xatosini chiqaradi
- [ ] Muvaffaqiyatli login'dan keyin `localStorage`'da `pos_tenant_slug` va `pos_auth_scope=tenant` saqlanadi
- [ ] `/admin/login` master login formasiga olib keladi (tenant foydalanuvchi sessiyasi bilan ham)
- [ ] Master login muvaffaqiyatli bo'lgach avtomatik `/admin/stores`ga o'tadi va `pos_auth_scope=master` bo'ladi
- [ ] Master foydalanuvchi `/` ga kirsa `/admin/stores`ga redirekt bo'ladi
- [ ] Tenant foydalanuvchi `/admin/stores`ga kirsa `/admin/login`ga bounce bo'ladi
- [ ] Stores sahifasida "Yangi do'kon" tugmasi slug + admin seed qiladi, muvaffaqiyatli RPC'dan so'ng ro'yxat yangilanadi
- [ ] Invalid slug (`Acme!`) kiritilsa UI serverga bormasdan xato chiqaradi (client-side regex tekshiruvi)
- [ ] Logout bosilsa `pos_session_token`, `pos_tenant_slug`, `pos_auth_scope` uchchalasi ham tozalanadi
- [ ] `/admin/stores`da **Brend** — logo (https) + 2 ta rang saqlanadi, `pos:tenants:list` javobida `branding` qaytadi
- [ ] `/login`da tenant kiritilgach do'kon nomi va (agar bo'lsa) logo / rang fon ko'rinadi
- [ ] `pos:tenants:publicProfile` brauzer Network'da sessiyasiz chaqiriladi (bootstrap secret bearer)

#### Bosqich 17 — Alertmanager + notifications (§7.16)

- [ ] `.env`da `TELEGRAM_ALERT_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `SMTP_*` to'ldirilgan (placeholder emas)
- [ ] `docker compose --profile monitoring up -d alertmanager` exit 0, konteyner `healthy`
- [ ] `curl -s http://127.0.0.1:9093/-/ready` "OK" qaytaradi
- [ ] Prometheus `/api/v1/status/config` javobida `alertmanagers: ['alertmanager:9093']` ko'rinadi
- [ ] `node electron/net/alertmanagerConfig.test.cjs` — exit 0 (lokalda ham, CI'da ham)
- [ ] `bash deploy/scripts/verify-alertmanager.sh` uchta bosqichni passed bilan yakunlaydi
- [ ] Smoke alert Telegram guruhga keladi (30 soniya ichida, HTML format, runbook havolasi bilan)
- [ ] Smoke alert oncall email'ga keladi (subject `[POS] WARNING: PosAlertmanagerSmokeTest (1)`)
- [ ] `docker stop pos-server` — 2–3 daqiqa ichida Telegram'ga `PosServerDown` PAGE xabari keladi
- [ ] `docker start pos-server` — qayta ishga tushgach Alertmanager "RESOLVED" xabari yuboradi (`send_resolved: true`)
- [ ] `amtool silence add alertname="PosHighRpcLatencyP95" --duration=30m --comment="test"` — silence ro'yxatda paydo bo'ladi va 30 daqiqadan keyin tozalanadi
- [ ] `TELEGRAM_ALERT_BOT_TOKEN`ni bo'shatib ko'rsatish: `docker logs pos-alertmanager`da `401 Unauthorized` ko'rinadi, `AlertmanagerNotificationsFailing` 15 daqiqadan keyin firing bo'ladi
- [ ] GitHub Actions `ci.yml` "Monitoring config lint" jobi yashil (promtool + amtool)

#### Bosqich 18 — Restore-drill CI (§7.17)

- [ ] `/etc/sudoers.d/pos-deploy` da `deploy` user uchun passwordless sudo `restore-drill-prom.sh` ga ruxsat berilgan
- [ ] `/var/lib/pos/node-exporter-textfile/` katalogi mavjud va `0755` huquqlari bilan
- [ ] `sudo bash /opt/pos/deploy/scripts/restore-drill-prom.sh` lokalda exit 0, log `/var/lib/pos/logs/restore-drill/drill-*.log` da paydo bo'ladi
- [ ] `/var/lib/pos/node-exporter-textfile/pos_restore_drill.prom` 3 ta gauge bilan yoziladi
- [ ] `curl -s http://127.0.0.1:9100/metrics | grep pos_backup_restore_drill` node-exporter orqali metrikalarni ko'rsatadi
- [ ] Prometheus UI `pos_backup_restore_drill_last_status == 1` ko'rsatadi
- [ ] Grafana `time() - pos_backup_restore_drill_last_success_timestamp_seconds` paneli yashil
- [ ] GitHub Actions → "Restore drill" workflow ro'yxatda paydo bo'ladi
- [ ] "Run workflow" tugmasi bilan qo'lda ishga tushirish muvaffaqiyatli o'tadi
- [ ] Atayin buzish testi: rclone.conf'ni vaqtinchalik o'chirib qo'ying va drill'ni qayta ishga tushiring — AM'ga `PosRestoreDrillFailed` push keladi, GH workflow red bo'ladi, `pos_backup_restore_drill_last_status=0`
- [ ] `crontab -l`da yoki GitHub schedule'da `0 4 * * 0` cron mavjud
- [ ] `PosRestoreDrillStale` qoidasi Prometheus `/alerts`da ko'rinadi (INACTIVE holatda)

#### Bosqich 19 — fail2ban + audit.log (7.18)

- [ ] `sudo bash /opt/pos/deploy/scripts/install-fail2ban-pos.sh` exit 0, `fail2ban-client status pos-audit` jailed
- [ ] `/etc/fail2ban/filter.d/pos-audit.conf` va `jail.d/pos-audit.local` mavjud
- [ ] `fail2ban-regex` sintetik JSONL bilan ikkala IPni ham topadi (install script chiqishi)
- [ ] `POS_TRUST_PROXY=1` + nginx real IP — audit qatorida `ip` tashqi IP (127.0.0.1 emas)
- [ ] Sinov: `auth.login.failure` qatorlarini tez-tez yozish → `pos-audit` jail `Banned IP` ko'rsatadi
- [ ] `sudo fail2ban-client set pos-audit unbanip <ip>` blokni yechadi
- [ ] `pos-audit-probe` default `enabled = false` (keraksiz yoqilmagan)
- [ ] `npm run test:fail2ban` — CI va lokalda yashil
- [ ] NAT ofis: kerak bo'lsa `ignoreip` yoki `maxretry` oshirilgan

---

## 7.12. Load test — RPC bottleneck topish (k6 + autocannon)

SLA budjetini tasdiqlash va Hetzner VM resurslari 20-30 kassa uchun yetarli
ekanligini **measuredly** bilish uchun `load-test/` katalogida tayyor
skriptlar bor.

### 7.12.1. Arsenal

| Skript | Asbob | Session | Write | Qachon ishlatiladi |
|--------|-------|---------|-------|--------------------|
| `load-test/k6/rpc-read.js`   | k6         | yo'q (admin secret) | yo'q | Baseline o'qish throughput |
| `load-test/k6/rpc-mixed.js`  | k6         | **bor** (token)     | **bor** (sotuv) | Haqiqiy kassa simulatsiyasi |
| `load-test/autocannon-rpc.cjs` | autocannon | yo'q              | yo'q (mixed = read-only) | Tez tekshiruv (binary kerak emas) |

Hammasi bitta `load-test/lib/warmup.cjs` helper bilan ishlaydi — u `/health`
tekshiradi, kerakli `loadtest_cashier` user'ni yaratadi, smena ochadi va
realistic `product_ids` to'plamini qaytaradi.

### 7.12.2. Tezkor smoke (CI uchun)

```bash
export POS_HOST_SECRET=...   # staging .env dan
export LOAD_TARGET=http://127.0.0.1:3333
npm run load:smoke           # 5 ulanish × 10s, faqat read
```

Xato darajasi > 5% bo'lsa exit 3 bilan yiqiladi — CI integration uchun ideal.

### 7.12.3. Read baseline (30 TPS)

```bash
npm run load:autocannon:read
# YOKI (k6 ochroq metrika beradi)
BUNDLE=$(node load-test/lib/warmup.cjs)
k6 run \
  -e TARGET=http://127.0.0.1:3333 \
  -e ADMIN_SECRET=$POS_HOST_SECRET \
  -e PRODUCT_IDS=$(echo "$BUNDLE" | jq -r '.product_ids | join(",")') \
  load-test/k6/rpc-read.js
```

Kutilayotgan chegaralar (Grafana alert'lari bilan birga):

- `http_req_duration p95 < 500 ms` (alert chegarasi)
- `http_req_failed rate < 1%`
- `rpc_errors < 50`

### 7.12.4. Mixed workload (20 VU, sotuv bilan)

```bash
BUNDLE=$(node load-test/lib/warmup.cjs)
k6 run \
  -e TARGET=$(echo "$BUNDLE" | jq -r .url) \
  -e ADMIN_SECRET=$POS_HOST_SECRET \
  -e CASHIER_USER=$(echo "$BUNDLE" | jq -r .cashier.username) \
  -e CASHIER_PASS=$(echo "$BUNDLE" | jq -r .cashier.password) \
  -e PRODUCT_IDS=$(echo "$BUNDLE" | jq -r '.product_ids | join(",")') \
  -e VUS=20 \
  -e WRITE_RATIO=0.20 \
  load-test/k6/rpc-mixed.js
```

Har bir VU **haqiqiy session token** bilan kiradi, 3-5 read qiladi, keyin 20%
ehtimol bilan `createDraftOrder → addItem × N → finalizeOrder`'ni yuboradi.
Hujjatdagi `pos-server` shu traffic ostida p95 writes < 1.2 s, login success
> 98%, sale success > 95% bo'lishi kerak.

> **Ogohlantirish:** mixed scenario real sotuvlarni yaratadi. Hech qachon ish
> soatlarida production'ga urilmang. Buning o'rniga `restore-drill.sh` orqali
> disposable pos-server ishga tushirib, unga urish mumkin.

### 7.12.5. Grafana'da kuzatish

Monitoring stack'ga yangi dashboard — **"POS / Load test"** — o'ylab berildi
(`deploy/monitoring/grafana/dashboards/pos-load-test.json`, provisioner
avtomatik yuklaydi). Panellar:

- RPC throughput per channel
- p50/p95/p99 latency
- Error va denied darajalari (%)
- HTTP 5xx/4xx
- Host load1/load5, memory ishlatilishi
- Active sessions, DB query errors, login success, DB size

Dashboard 10 sekundda auto-refresh qiladi — test davomida ochib qo'ying.

### 7.12.6. Natijalarni talqin qilish

| Belgisi | Ehtimoliy sabab | Keyingi qadam |
|---------|-----------------|----------------|
| p99 reads >> p95 | Node event-loop blokga tushgan (uzun sync SQLite so'rov) | Indeks qo'shish, `NODE_OPTIONS=--cpu-prof` bilan profile olish |
| p95 writes > 1.5 s | SQLite write lock contention | `journal_mode=WAL` aniq, batched insert, disk I/O tekshirish |
| HTTP 5xx spike | Service-layer exception | `pos-server` log va `pos_db_query_errors_total` |
| `denied` spike | Warmup cashier rollari channel ACL'ga mos kelmaydi | Admin secret'ga o'tish yoki yuqoriroq rol |
| Host load > vCPU | CPU-bound (tabiiy) | VM'ni kattalashtirish yoki replica qo'shish |

### 7.12.7. Baseline'ni saqlash

```bash
mkdir -p load-test/baselines
cp load-test/results/rpc-mixed.json \
   load-test/baselines/rpc-mixed-$(git rev-parse --short HEAD).json
```

Keyingi PR'larda p95 > 20% o'sgani code review'da seziladi.

To'liq ma'lumot: [`load-test/README.md`](./load-test/README.md).

---

## 7.13. Xavfsizlik — rate limit + audit log + CSP/HSTS + secret rotation

Bosqich 14 POS'ni haqiqiy public internet sharoitida ushlab turadigan 4 qatlamli
himoyani qo'shadi. Har bir qatlam mustaqil — Biri yiqilsa boshqalari hali ham
jazo yemaydi.

### 7.13.1. Qatlamlar qisqacha

| Qatlam | Qayerda | Nimadan himoya qiladi |
|--------|---------|----------------------|
| **Nginx `limit_req` + `limit_conn`** | `deploy/nginx/pos.conf.template` | Burst DoS, slowloris, amplifikatsiya |
| **Nginx CSP / HSTS / X-Frame-Options** | shu yerda | XSS, clickjacking, MIME sniff, HTTPS downgrade |
| **Node in-process rate limiter** | `electron/net/rateLimit.cjs` | Per-IP /rpc va per-(IP, username) login brute-force |
| **Audit log (append-only JSONL)** | `electron/net/auditLog.cjs` → `/var/lib/pos/logs/audit.log` | Forenzika, bruteforce detektsiyasi, uzoq muddatli audit |

### 7.13.2. Environment (`.env`)

```env
# Nginx ortida siz — X-Forwarded-For'ni ishonish MAJBURIY.
POS_TRUST_PROXY=1

# Rate limit budget — normal fleet uchun zarar qilmaydigan chegaralar.
POS_RATE_LIMIT_RPC_WINDOW_MS=60000
POS_RATE_LIMIT_RPC_MAX=600
POS_RATE_LIMIT_LOGIN_WINDOW_MS=900000
POS_RATE_LIMIT_LOGIN_MAX=10

# Audit log
POS_AUDIT_ENABLED=1
POS_AUDIT_LOG_PATH=/var/lib/pos/logs/audit.log
```

### 7.13.3. Nginx hardening

`setup-nginx.sh`'ni qayta ishga tushiring — shablon yangilandi:

```bash
sudo bash deploy/scripts/setup-nginx.sh pos.example.com api.example.com
```

Qo'shilgan headerlar (barchasi `always` — error sahifalarga ham qo'llanadi):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-site`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), …`
- `Content-Security-Policy` — scriptlar uchun `'unsafe-inline'` YO'Q, faqat
  style uchun (Vite build uchun kerak); `frame-ancestors 'none'`, `object-src
  'none'`.

Rate limit zonalari (Nginx darajasida):

- `pos_rpc`      — 20 r/s, burst 40 (normal fleet uchun)
- `pos_rpc_slow` — 2 r/s (maxsus endpoint'lar uchun zaxira)
- `pos_conn`     — har IP'dan 20 faol ulanish

`/metrics` endpoint **tashqi IP'lar uchun `deny all`** — Prometheus faqat host
loopback yoki ichki tarmoqda scrape qiladi. `allow 10.0.0.0/8;` satrini
kommentariyadan chiqarsangiz, sizning monitoring VPC'ingizga ruxsat beradi.

### 7.13.4. Audit log

Har kecha rotate qilinadi (`deploy/security/pos-audit.logrotate`):

```bash
sudo install -m 0644 /opt/pos/deploy/security/pos-audit.logrotate \
  /etc/logrotate.d/pos-audit
sudo logrotate -d /etc/logrotate.d/pos-audit     # dry-run
```

Log formati — bir voqea bir JSON satri:

```json
{"t":"2026-04-19T06:12:44.512Z","type":"auth.login.failure","username":"admin","ip":"1.2.3.4","reason":"invalid_credentials","ua":"Mozilla/5.0…"}
{"t":"2026-04-19T06:12:44.900Z","type":"rate_limit.blocked","key":"1.2.3.4|admin","kind":"login","ip":"1.2.3.4","channel":"pos:auth:login"}
{"t":"2026-04-19T06:13:01.001Z","type":"auth.denied","channel":"pos:users:delete","ip":"5.6.7.8","auth":"session","role":"cashier","reason":"not_admin"}
```

Xavfsiz fieldlar (password, token, secret, authorization) avtomatik
`[REDACTED]` bilan almashtiriladi. 256 belgidan uzun satrlar kesiladi.

### 7.13.5. Rate limit metrikalari (Grafana'da)

Yangi metrikalar Prometheus'da avtomatik paydo bo'ladi:

- `pos_rate_limit_blocked_total{kind="rpc"|"login"}` — counter
- `pos_audit_events_total{type="auth.login.failure"|…}` — counter

Alert qoidalari (`deploy/monitoring/alerts.yml`'da):

- `PosRateLimitBlockedSpike` — rate limiter 10 daqiqada >1/s → warning
- `PosLoginRateLimited` — login 10 daqiqada >0.1/s → **page** (bruteforce)
- `PosAuditDeniedSpike` — `auth.denied` >0.5/s → warning

### 7.13.6. Secret rotation SOP — har 3 oyda YOKI sizib ketsa darhol

```bash
# 1. Rotate all server-side secrets
sudo bash /opt/pos/deploy/scripts/rotate-secrets.sh

# Output:
#   backup saved: /opt/pos/.env.rotated-20260419T061244Z
#   rotating POS_HOST_SECRET (old ending: …a9f2)
#   new secrets written to /opt/pos/.env
#   restarting pos-server via docker compose…
#   pos-server /health: OK
#
#   NEW POS_HOST_SECRET:  …  (kopyalab oling)
#   NEW POS_METRICS_SECRET: …

# 2. GitHub → Actions → Secrets → VITE_POS_RPC_SECRET ni yangilang
gh secret set VITE_POS_RPC_SECRET --body "$NEW_HOST_SECRET"

# 3. Frontend'ni qayta build qiling (session token ishlayapti, "real" uzilish yo'q)
gh workflow run deploy-frontend.yml

# 4. 10 daqiqa Grafana'da pos_auth_logins_total{outcome!="success"} ni kuzating
```

Skript **rollback bilan** — `/health` 20 s ichida 200 qaytarmasa, eski
`.env`'ga qaytadi va `exit 2`. Eski kalitni boshqa boshqa hech kim bilmaydi
degan kafolat yo'q — shuning uchun ro'yxatdagi sessionlar ham xavfsizlik
nuqtai nazaridan "muddati tugagan" deb hisoblanadi. Foydalanuvchilar
**qayta kirishlari** kerak bo'ladi.

### 7.13.7. Incident response — bruteforce aniqlangan bo'lsa

1. **Tasdiqlash**:
   ```bash
   # Oxirgi 1 soatda 10 martadan ko'p muvaffaqiyatsizlik berganlar
   jq -r 'select(.type=="auth.login.failure") | .ip' \
     /var/lib/pos/logs/audit.log | sort | uniq -c | sort -rn | head
   ```
2. **Hujumchini bloklash** (tezkor choralar):
   ```bash
   sudo iptables -I INPUT -s <ATTACKER_IP> -j DROP
   # YOKI nginx darajasida:  deny <ATTACKER_IP>;  location = /rpc blokida
   ```
3. **Session'larni invalidatsiya** (agar user login bo'lib ulgurgan bo'lsa):
   ```bash
   docker exec pos-server node -e \
     "require('./electron/db/open.cjs').open().prepare('DELETE FROM sessions WHERE user_id=?').run('<user-id>')"
   ```
4. **Parolni majburiy reset** qiling (Admin UI → "Reset password").
5. **SOP'ni to'ldiring** — secret rotate QILING (§7.13.6).

---

## 7.14. Multi-tenant / multi-store (Bosqich 15)

**Maqsad.** Bir `pos-server` instansiyasi ostida **bir nechta alohida do'kon** (tenant)
saqlash. Har bir do'kon uchun alohida SQLite fayl, alohida admin/kassirlar, alohida
backup. Super-admin (operator) esa barcha do'konlarni bitta Admin RPC orqali
boshqara oladi.

> **Eslatma.** Ko'p ijarachi rejim **ixtiyoriy** — `POS_MULTI_TENANT=0` (default)
> qoldirilsa, server avvalgidek bitta `pos.db` bilan ishlaydi. Bu bosqich
> mavjud bir-do'kon ishlaridagi hech qaysi testni buzmasdan qo'shildi.

### 7.14.1. Arxitektura

```
POS_DATA_DIR/
├── master.db                     ← tenants[], master_users[], master_sessions[]
├── tenants/
│   ├── default/pos.db            ← do'kon 1 ning TO'LIQ DB'si
│   ├── store-a/pos.db            ← do'kon 2
│   └── store-b/pos.db            ← …
├── logs/audit.log
└── pos.db                        ← legacy (POS_MULTI_TENANT=1 birinchi ishga tushirishda
                                    avtomatik `default` tenant sifatida COPY qilinadi —
                                    tekshirilgach qo'lda o'chirib tashlasa bo'ladi)
```

**Nega har biriga alohida fayl?** Har bir so'rovda `tenant_id=?` WHERE qo'shish
xavfli — bitta tushib qolgan clause butun do'konlar ma'lumotini chiqarib yuboradi.
Alohida fayl — bu sinfdagi xatolarni **umuman mumkin emas** qiladi; backup/restore
dril har bir do'kon uchun shunchaki bitta fayl.

### 7.14.2. Yoqish

`.env`:

```env
POS_MULTI_TENANT=1

# Birinchi marta ishga tushganda super-admin'ni urug'lash (keyin ENV'dan
# olib tashlab, parolni DB ichida yangilang).
POS_MASTER_ADMIN_USER=superadmin
POS_MASTER_ADMIN_PASS=<kamida 8 belgili parol>
```

Server restart qilinganda quyidagi loglar chiqadi:

```
[server] multi-tenant: adopted legacy DB as tenant "default" (copied to …/tenants/default/pos.db)
[server] multi-tenant: seeded master admin "superadmin" from env
[server] multi-tenant: tenants=1 active=1 master=/var/lib/pos/master.db
```

Mavjud foydalanuvchilar, mahsulotlar, sotuvlar — hammasi `default` tenant ichida
xuddi avvalgidek saqlangan holda qoladi. Sessiyalar invalidlanadi (token format
o'zgardi) — hamma qayta login qiladi.

### 7.14.3. Yangi do'kon qo'shish (operator RPC)

Super-admin login qiladi:

```bash
curl -X POST https://api.example.com/rpc \
  -H "Authorization: Bearer $POS_HOST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:master:login","args":["superadmin","<parol>"]}'
# → { "success": true, "token": "<master-session-token>", "user": { "scope": "master" } }
```

Yangi tenant yaratish:

```bash
curl -X POST https://api.example.com/rpc \
  -H "Authorization: Bearer <master-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"channel":"pos:tenants:create","args":[{
        "slug": "store-chilonzor",
        "display_name": "Chilonzor Filial",
        "admin_username": "admin",
        "admin_password": "TempPass_Change_Me_ASAP"
      }]}'
# → { "tenant": {...}, "admin_user_id": "…" }
```

Slug cheklovlari: `/^[a-z0-9][a-z0-9_-]{1,39}$/`, `master` va `_`-bilan
boshlanadiganlar taqiqlangan. Server `tenants/<slug>/pos.db` yaratadi +
migratsiyalarni yurgizadi + ichida bitta `admin` foydalanuvchisini urug'laydi.

Boshqa admin RPClar:

| Channel                     | Nima qiladi                                              |
| --------------------------- | -------------------------------------------------------- |
| `pos:tenants:list`          | Barcha tenantlar ro'yxati                                |
| `pos:tenants:get`           | Bitta tenant (slug bo'yicha)                             |
| `pos:tenants:create`        | Yuqoridagi                                               |
| `pos:tenants:disable`       | Tenant'ni o'chiradi (DB fayl saqlanadi; sessiyalar bekor)|
| `pos:tenants:enable`        | Qayta yoqadi                                             |
| `pos:master:me`             | Joriy super-admin haqidagi ma'lumot                      |

### 7.14.4. Tenant-ga login qilish (kassir/admin)

Mijoz `pos:auth:login` chaqiradi **`tenant` maydoni bilan** (frontend bu
maydonni login formasidan oladi yoki subdomain/slug orqali avtomatik
to'ldiradi — keyingi bosqich):

```json
{
  "channel": "pos:auth:login",
  "args": ["cash", "secret"],
  "tenant": "store-chilonzor"
}
```

Server `Tsessia` tokenni qaytaradi. Bu token **yagona shu tenant**ga bog'langan
— keyingi hech qanday so'rovda `tenant` maydonini ko'rsatish SHART emas
(server uni `master_sessions` jadvalidan yechadi). Agar mijoz ataylab boshqa
tenant slug'ini payload'ga qo'ysa, server `PERMISSION_DENIED` bilan rad etadi
(anti-spoof himoyasi).

### 7.14.5. Backup — har bir tenant alohida fayl

`backupManager.cjs` avtomatik barcha faol tenantlar ustidan aylanadi:

```
/var/lib/pos/tenants/default/backups/pos-20260419-030000.db
/var/lib/pos/tenants/store-chilonzor/backups/pos-20260419-030000.db
```

Off-site sync (`deploy/backup/backup-offsite.sh`) — keyingi iteratsiyada
tenantlar bo'yicha rekursiv aylanishi uchun yangilanadi; hozircha standart
`find ... -name 'pos-*.db'` pattern barcha tenant backuplarini ham qamrab
oladi (chunki nomlash sxemasi bir xil).

### 7.14.6. Kuzatish (Prometheus)

Yangi low-cardinality gauge/counterlar:

| Metric                              | Labels           | Izoh                                           |
| ----------------------------------- | ---------------- | ---------------------------------------------- |
| `pos_tenants_total{state}`          | active/disabled  | Fleet razmeri                                  |
| `pos_tenant_db_size_bytes{tenant}`  | tenant=slug      | Har bir tenant DB'si hajmi                     |
| `pos_tenant_rpc_calls_total{tenant, outcome}` | tenant + ok/error/denied | Per-tenant QPS (opt-in — fleet katta bo'lsa o'chiring) |

Misol Grafana panel:

```
sum(rate(pos_tenant_rpc_calls_total{outcome="error"}[5m])) by (tenant)
```

### 7.14.7. Xavfsizlik eslatmalari

1. **Session-bound tenant unoverrideable.** Payload'ning `tenant` maydoni faqat
   `adminBypass` holatida (shared secret bilan) o'qiladi. Sessiya tokeni
   tenant'ni o'zi olib yuradi.
2. **Master sessiyalari ajratilgan.** Super-admin `master_sessions` ichida
   `user_scope='master'`, `tenant_id=NULL` — hech qaysi tenant DB'ga
   aralashmaydi.
3. **Disable darhol amal qiladi.** `pos:tenants:disable` — sessiyalar
   o'chiriladi, servis cache olib tashlanadi; keyingi so'rovlar 401 bilan
   qaytariladi.
4. **Rate-limit hali ham bitta global-IP.** Kelajakda per-tenant rate-limit
   kerak bo'lsa, `rateLimit.cjs`ga `tenant` key prefixi qo'shing.
5. **Audit log yagona fayl** — hamma tenantlar uchun bitta `audit.log`,
   har bir yozuv `tenant_slug` bilan belgilanadi (keyingi iteratsiya).

### 7.14.8. Testlar

```bash
npm run test:tenantRegistry   # unit — CRUD + adopt + rollback
npm run test:mtdispatch       # routing — master/tenant/denied branches
```

Ikkalasi ham `npm run test:smoke`ga qo'shilgan va CI'da yuradi.

### 7.14.9. Frontend (Bosqich 16'da yakunlandi — §7.15 qarang)

Frontend to'liq MT-aware. `POS_MULTI_TENANT=0` rejimda eski UX o'zgarmaydi;
`POS_MULTI_TENANT=1` rejimda login formasi tenant maydonini ko'rsatadi va
`/admin/*` super-admin yo'nalishlari ochiladi.

---

## 7.15. Multi-tenant frontend (Bosqich 16)

Backend-side multi-tenant (§7.14) tayyor bo'ldi, endi front-end ham shunga
moslashtirildi. Ushbu bo'lim frontend'ning MT rejimdagi ishlashi, login
oqimi, super-admin paneli va deployment o'zgarishlarini tushuntiradi.

### 7.15.1. Server probe — `pos:health.multi_tenant`

Brauzer har safar yuklanganda `useAuth.init()` avtomatik ravishda
`pos:health`ni chaqiradi va javobdan **`multi_tenant`** bayrog'ini oladi:

- `multi_tenant: true`  → Login formasida "Do'kon (tenant)" maydoni
  paydo bo'ladi, `/admin/login` va `/admin/stores` yo'nalishlari ishlaydi.
- `multi_tenant: false` → eski single-tenant UX; `/admin/*` sahifalari
  "Mavjud emas" yakuniga olib keladi.

Bu yondashuv frontend'ga **alohida `VITE_*` bayroq talab qilmaydi** —
yagona `/health` nuqtasi mo'ljal ishlab beradi, shu bilan birga static
build'ni bir necha server (MT/non-MT) o'rtasida ishlatishni osonlashtiradi.

### 7.15.2. Tenant login oqimi

```
[/login] → POST /rpc
  Authorization: Bearer <VITE_POS_RPC_SECRET>
  { channel: "pos:auth:login",
    args: ["cashier1", "passw0rd"],
    tenant: "acme" }           ← YANGI: brauzer qo'shadi

Server: mtDispatch → resolveTenant(payloadTenant="acme")
      → services[acme].auth.login(…)
      → masterSessions.create({ user, tenantId, scope: "tenant" })
      → { success, token, user:{ tenantSlug:"acme", … }, tenant:{ slug:"acme" } }

Brauzer: localStorage
  pos_session_token         ← har bir keyingi /rpc'ning Authorization bo'ladi
  pos_session_expires_at
  pos_tenant_slug=acme       ← UX uchun (sahifa yangilansa ham saqlanadi)
  pos_auth_scope=tenant
```

Tenant maydoniga qiymat uch manbadan keladi (prioritetlar):

1. **Foydalanuvchi kiritgan qiymat** — ishonchli, har safar override qiladi.
2. **Subdomain** — `extractTenantSlugFromHost()` sinaydi:
   `acme.pos.example.com` → `acme`. Apex (`pos.example.com`), IP,
   `localhost`, `www/admin/api/app` kabi rezerv subdomenlarda `null`.
3. **`localStorage.pos_tenant_slug`** — oldingi muvaffaqiyatli login'dan.

Yomon slug (`^[a-z0-9][a-z0-9_-]{1,39}$`ga mos emas) clientda darhol
rad etiladi, shu regex serverda ham bir xil.

### 7.15.3. Super-admin oqimi (`/admin/*`)

- **`/admin/login`** → `pos:master:login({ username, password })` →
  server `scope: "master"` sessiya yaratadi, `tenantId = null`.
- **`/admin/stores`** → `AdminRoute` guard'i, faqat `scope === 'master'`
  o'tqaziladi; aks holda `/admin/login`ga qaytariladi (location
  preserved → muvaffaqiyatli login'dan so'ng qaytib keladi).

Master sessiyasi **hech qaysi tenant UX**ga kira olmaydi:
`PrivateRoute` faqat `scope === 'tenant'`'ni o'tkazadi; master
foydalanuvchi `/`ga kirsa darhol `/admin/stores`ga redirekt bo'ladi.
Qayta teskari — tenant foydalanuvchi `/admin/stores`ga kirsa
`/admin/login`ga bounce bo'ladi.

Stores sahifasi quyidagilarni qila oladi:

| Amal             | RPC                                       | Effekt                                                           |
|------------------|-------------------------------------------|------------------------------------------------------------------|
| Ro'yxat          | `pos:tenants:list({ includeInactive })`   | faol + o'chirilgan tenant ro'yxati                               |
| Yangi yaratish   | `pos:tenants:create({ slug, display_name, admin_username, admin_password })` | Yangi SQLite fayl + birinchi admin seedlanadi |
| O'chirish        | `pos:tenants:disable(slug)`               | Dispatcher cache'dan chiqadi, tenant sessiyalari yo'q qilinadi   |
| Qayta yoqish     | `pos:tenants:enable(slug)`                | Oddiy RPC oqimiga qaytadi                                        |
| Brend (login UI) | `pos:tenants:setBranding({ slug, branding: { logoUrl, primaryColor, accentColor } })` | `tenants.meta_json` ichida `branding`; super-admin |
| Ochiq profil     | `pos:tenants:publicProfile(slug)`         | Login formasidan sessiyasiz — faqat `display_name` + xavfsiz `branding` |

**Tenant brendi:** logo manzili faqat **https://**; ranglar **#RRGGBB**. Kirish
sahifasi tenant kodi valid bo'lganda avtomatik `publicProfile` chaqiradi.
Nginx CSP shablonida `img-src` uchun `https:` qo'shilgan (tashqi CDN logotipi).

Client-side yana bir qator serverga mos tekshiruvlar:

- Slug: `^[a-z0-9][a-z0-9_-]{1,39}$` (serverda ham aynan shu regex).
- Admin paroli: **kamida 8 belgi** (serverga jo'natilmasdan oldin).

### 7.15.4. Anti-spoofing

Tenant foydalanuvchi brauzer DevTools'dan `tenant: "boshqa"` payload yubora
olmaydi: serverdagi `resolveTenant()` (mtDispatch.cjs) sessiyaga bog'langan
tenant bilan payloadtenant'ni solishtiradi va mos kelmasa `PERMISSION_DENIED`
qaytaradi. Frontend buni yanada mustahkam qiladi:

- `remotePosApi`da **master channel** lar uchun payload'ga `tenant` qo'shilmaydi
  (`MASTER_CHANNELS` setini qarang).
- Logout / 401 → `setSessionToken(null)` avtomatik ravishda
  `pos_tenant_slug` va `pos_auth_scope`ni ham tozalaydi.

### 7.15.5. Frontend deployment o'zgarishi

Bosqich 14'dagi `scripts/deploy-frontend-hetzner.sh` MT rejim uchun
qo'shimcha o'zgarishga muhtoj **emas**. Tavsiyalar:

1. **Wildcard DNS** — `*.pos.example.com` A/AAAA recordlari bir IP'ga
   ishora qiladi, nginx esa hostname'ga qarab server bloka tanlaydi
   (yoki bitta SPA bloki barcha subdomain'larga xizmat qiladi).
2. **SSL** — `certbot` uchun `--cert-name` ni wildcard sertifikat bilan
   to'ldirish tavsiya etiladi (DNS-01 challenge). Agar wildcard qiyin bo'lsa,
   har tenant uchun alohida sertifikat yarating (Let's Encrypt'ning `50`
   ta/hafta chegarasi kichik fleetlar uchun yetarli).
3. **Cache** — SPA assetlari hash'langan, MT rejimga o'tish `index.html`
   kechlashi bilan kesishmasin: `Cache-Control: no-cache` qatori
   `index.html` uchun ostida qoldiring.

### 7.15.6. Tekshirish: brauzer oqimi

```bash
# 1) MT rejim yoqilgan serverga yo'naltiring:
export VITE_POS_RPC_URL="https://pos.example.com"
export VITE_POS_RPC_SECRET="$POS_HOST_SECRET"
npm run build

# 2) Static build'ni deploy qilib, brauzerda sinab ko'ring:
#    a) /login sahifasi "Do'kon (tenant)" maydonini ko'rsatishi kerak.
#    b) acme.pos.example.com ochsangiz — maydon avtomatik "acme" bilan to'ldiriladi.
#    c) tenant=acme, admin/admin → dashboard'ga kiradi.
#    d) /admin/login → POS_MASTER_ADMIN_USER/PASS → /admin/stores'ga yo'l oladi.
#    e) Yangi tenant yarating: slug="test-shop", admin_password="changeme1".
#    f) /admin/stores'da test-shop paydo bo'ladi, faol bayroq bilan.
```

Troubleshooting:

- **"Do'kon kodi majburiy"** xatosi → serverda `POS_MULTI_TENANT=1`ligini
  tekshiring; brauzer `pos:health`dan `multi_tenant: false` oldi.
- **`/admin/stores` Infinite spinner** → master sessiyaning srvdan
  "404" olgan bo'lishi mumkin, `POS_MULTI_TENANT=0` bilan build xato.
- **Cross-tenant leak** → bu bo'lishi mumkin emas: serverdagi
  `resolveTenant()` tokenga bog'langan tenantni majburiy qiladi.

---

## 7.16. Alert notifications — Alertmanager + Telegram + email (Bosqich 17)

Prometheus'da alert qoidalari yozilgan edi, lekin hech kim xabar olmas edi.
Bosqich 17 shu bo'shliqni yopadi: **Alertmanager** servisi Prometheus
firing alertlarini **Telegram botgroup** va **email**ga yo'naltiradi.

### 7.16.1. Arxitektura

```
Prometheus (scrape /metrics) → alerts.yml baholaydi
     ↓ firing
Alertmanager (group + dedupe + route)
     ├─ severity=page    → Telegram + Email  (parallel fan-out)
     ├─ severity=warning → Telegram only
     └─ severity=info    → blackhole (faqat UI'da)
```

Route daraxti `severity` labeliga asoslanadi. Har bir qoidaga (§7.9) endi
uchta label yetkaziladi: `severity`, `service=pos`, `team=ops` —
kelajakda ko'p-jamoali marshrutlash uchun.

**Inhibitsiya:**
- `PosServerDown` boshqa barcha POS alertlarini bosib qo'yadi (ortiqcha
  spam'ni oldini oladi — sabab aniq bo'lgach, oqibatlarini kuzatish
  kerak emas).
- `HostDiskSpaceLow` backup/DB alertlarini bosadi (ular simptom).
- Maxsus `deploy_in_progress=1` labeli deploy paytida watchdog'ni 15
  daqiqaga o'chirib qo'yadi (CI workflow'dan yuboriladi).

### 7.16.2. Telegram bot'ni sozlash

1. Telegramda `@BotFather`ga yozing:
   ```
   /newbot
   → pos-alerts-bot
   → pos_alerts_<unique>_bot
   ```
   Token nusxasini oling (masalan `1234567890:AAAA...`).
2. Bot'ni ops-ikopkach guruhingizga qo'shing va **admin** qiling
   (kamida "Send messages" huquqi).
3. Guruh chat_id'sini oling:
   ```bash
   curl "https://api.telegram.org/bot$BOT_TOKEN/getUpdates" | jq .
   # Qidiring: "chat":{"id":-1001234567890,...}
   ```

### 7.16.3. SMTP hisobini tayyorlash

Tavsiya — `pos-alerts@yourdomain.uz` alohida hisob, cheklangan ruxsatlar.
Gmail uchun [App Password](https://myaccount.google.com/apppasswords)
ishlatiladi (asosiy parol Gmail SMTP'ga ishlamaydi).

### 7.16.4. `.env`ga yozish

`.env.server.example`dan ko'chiring va to'ldiring:

```bash
TELEGRAM_ALERT_BOT_TOKEN=1234567890:AAAA...
TELEGRAM_ALERT_CHAT_ID=-1001234567890
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=pos-alerts@example.com
SMTP_USERNAME=pos-alerts@example.com
SMTP_PASSWORD=<gmail-app-password>
ALERT_EMAIL_TO=oncall@example.com
ALERTMANAGER_EXTERNAL_URL=https://pos.example.com/alertmanager
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=<complex_password>
```

### 7.16.5. Servisni yoqish

Monitoring profile bilan yangi stack:

```bash
# Prometheus konfiguratsiyasida yangi `alerting:` bloki bor — restart:
docker compose \
  -f docker-compose.yaml \
  -f docker-compose.prod.yaml \
  -f docker-compose.monitoring.yaml \
  --profile monitoring up -d --force-recreate prometheus alertmanager

# Healthcheck:
docker ps --format '{{.Names}} {{.Status}}' | grep alertmanager
curl -s http://127.0.0.1:9093/api/v2/status | jq .versionInfo
```

### 7.16.6. Tekshirish — `verify-alertmanager.sh`

```bash
cd /opt/pos
bash deploy/scripts/verify-alertmanager.sh
```

Script quyidagi 3 bosqichni bajaradi:
1. `amtool check-config` — konteyner ichida rendered YAML'ni tekshiradi.
2. Prometheus /api/v1/status/config — `alerting: alertmanager:9093` ni
   ko'rgan-ko'rmaganini tasdiqlaydi.
3. End-to-end — sun'iy `PosAlertmanagerSmokeTest` alert yuboradi;
   ~30 soniyadan keyin Telegram guruhda va email'da xabar kelishi kerak.

Agar Telegram xabari kelmasa:
```bash
docker logs pos-alertmanager | tail -50
# Qidiring: "msg=\"Notify for alerts\" integration=telegram"
# Umumiy xatolar:
#   400 Bad Request — chat_id noto'g'ri yoki bot guruhga qo'shilmagan
#   401 Unauthorized — bot_token noto'g'ri yoki bekor qilingan
```

### 7.16.7. Silencing (xizmat vaqtida)

Rejalashtirilgan ish (masalan DB vacuum, deploy) paytida sahifalanishlarni
to'xtatib turish uchun:

```bash
# UI orqali: https://pos.example.com/alertmanager → Silences → New
# yoki amtool bilan:
docker exec pos-alertmanager amtool silence add \
  alertname="PosHighRpcLatencyP95" \
  --duration=30m \
  --comment="Scheduled index rebuild"
```

Eslatma: `severity=page` uchun silence qo'yilsa, CI/deploy workflow'lari
avtomatik ravishda `deploy_in_progress=1` labeli bilan alert yuborishi
mumkin — bu yo'l ham ishlaydi va `expire:15m` bilan o'z-o'zidan tozalanadi.

### 7.16.8. Alertmanager o'zini kuzatish

`alertmanager.rules` guruhi pipeline'ning o'zi sog'lomligini nazorat qiladi:
- `AlertmanagerDown` — 5 daqiqa scrape yo'q bo'lsa PAGE.
- `AlertmanagerNotificationsFailing` — integration qaytib kelmayotgan
  bo'lsa (expired token, SMTP reject) WARNING.
- `AlertmanagerConfigReloadFailed` — `/-/reload` POST'dan keyin stale config
  bilan ishlayotgan bo'lsa darhol PAGE.

---

## 7.17. Restore-drill CI (Bosqich 18) — haftalik backup verify loop

§7.10'da qo'l bilan chaqiriladigan `restore-drill.sh` mavjud edi. Endi uni
GitHub Actions **scheduled workflow** avtomatik chaqiradi, metrikalarni
Prometheus'ga uzatadi va failure bo'lgan zahoti Alertmanager orqali on-call'ga
xabar beradi.

### 7.17.1. Nima o'zgardi

| Komponent | Maqsad |
|-----------|--------|
| `deploy/scripts/restore-drill-prom.sh` | `restore-drill.sh` ni o'rab, duration + result'ni textfile collector orqali Prometheus'ga berish va failure bo'lsa AM'ga push qilish |
| `.github/workflows/restore-drill.yml` | Yakshanba 04:00 UTC cron + manual dispatch, SSH orqali Hetzner'da bajarish |
| node-exporter `--collector.textfile.directory` | `pos_backup_restore_drill_*` metrikalarini prod scrape stiyla |
| `alerts.yml` → `PosRestoreDrillStale` / `PosRestoreDrillLastRunFailed` | 10 kun muvafaqiyat yo'q bo'lsa yoki oxirgi run fail bo'lsa PAGE |

### 7.17.2. Serverda bir marta tayyorlash

1. `bash deploy/scripts/setup-monitoring.sh` — textfile katalogini `0755`
   huquqlari bilan yaratadi. Agar avval sozlangan bo'lsa, qayta ishga tushirish
   xavfsiz (idempotent).
2. node-exporter'ni qayta ishga tushiring (yangi volume mount uchun):
   ```bash
   docker compose \
     -f docker-compose.yaml \
     -f docker-compose.prod.yaml \
     -f docker-compose.monitoring.yaml \
     --profile monitoring up -d --force-recreate node-exporter
   ```
3. `restore-drill-prom.sh`'ni bir marta qo'l bilan sinab ko'ring:
   ```bash
   sudo bash /opt/pos/deploy/scripts/restore-drill-prom.sh
   # kutilayotgan natija:
   #   [restore-drill-prom] metrics written to /var/lib/pos/node-exporter-textfile/pos_restore_drill.prom
   #   [restore-drill-prom] drill finished in 37s, rc=0, log=/var/lib/pos/logs/restore-drill/drill-....log
   ```
4. Prometheus'da metrikani tekshiring:
   ```
   pos_backup_restore_drill_last_status
   pos_backup_restore_drill_last_duration_seconds
   pos_backup_restore_drill_last_success_timestamp_seconds
   ```

### 7.17.3. GitHub Actions sozlash

Yangi secret qo'shish **shart emas** — workflow allaqachon mavjud `DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT` secretlaridan foydalanadi
(`deploy-backend.yml` bilan bir xil).

**SSH sudoers** — workflow `sudo bash restore-drill-prom.sh` chaqiradi; deploy
user uchun passwordless sudo quyidagi skript uchun ochilsin:

```bash
# /etc/sudoers.d/pos-deploy (visudo bilan tahrirlang)
deploy ALL=(root) NOPASSWD: /opt/pos/deploy/scripts/restore-drill-prom.sh
```

Qo'lda ishga tushirish:
```
Actions tab → Restore drill → Run workflow → reason: "manual test"
```

### 7.17.4. Grafana panel — "Last restore drill"

Grafana'ga yangi panel qo'shish (yoki bor dashboard'ga):
```
Stat panel
  query A: time() - pos_backup_restore_drill_last_success_timestamp_seconds
  unit:    seconds (time)
  thresholds: green <= 3d, yellow <= 7d, red > 10d
  title:   "Time since last successful drill"
```

Qo'shimcha grafika:
```
query B: pos_backup_restore_drill_last_duration_seconds
  — drill qancha ish qiladi; keskin o'sish → backup'lar kattalashib bormoqda
  yoki I/O sekin.
```

### 7.17.5. Ikki tomonlama xabar berish

Drill fail bo'lsa on-call ikki yo'l bilan xabar oladi:
1. **Alertmanager push** — wrapper script AM API'ga to'g'ridan-to'g'ri alert
   yuboradi → Telegram'da darhol ko'rinadi (10 daqiqa ichida).
2. **GitHub Actions failure** — workflow red bo'ladi, repo "Actions" tab'da
   ko'rinadi; Slack/email integration'lari (mavjud bo'lsa) trigger bo'ladi.

Agar textfile collector 15 daqiqa ichida yangilanmasa, `PosRestoreDrillStale`
alert qoidasi 10 kun chegarasida yana mustaqil ravishda chiqaradi.

---

## 7.18. fail2ban — audit.log asosida IP blokirovkasi (Bosqich 19)

Rate limit va audit trail allaqachon 7.13'da bor; **fail2ban** qatlami
takroriy hujumlarni firewall darajasida kesadi — Node yoki Nginx yukini
ortiqcha ko'tarmasdan.

### 7.18.1. Nima kuzatiladi

`deploy/security/fail2ban/filter.d/pos-audit.conf` quyidagi JSONL qatorlarini
`audit.log`dan o'qiydi:

| `type` | Shart | Nega |
|--------|-------|------|
| `auth.login.failure` | har doim | parol parchalash |
| `rate_limit.blocked` | faqat `kind=="login"` | credential stuffing |

**E'tibor:** `rate_limit.blocked` + `kind=rpc` **qo'shilmagan** — bitta tashqi
IP orqali 10–30 ta kassa bo'lsa, global RPC limit barchasini bloklab qo'yadi.

Ixtiyoriy `pos-audit-probe` jailsi `auth.denied` ni kuzatadi — default
**o'chiq** (oddiy kassirlar ham tez-tez `PERMISSION_DENIED` ko'radi).

### 7.18.2. Old shartlar

1. **`POS_TRUST_PROXY=1`** va Nginx `real_ip` to'g'ri — aks holda `ip` maydoni
   `127.0.0.1` bo'ladi va fail2ban o'zini bloklaydi (yoki hech kimni bloklamaydi).
2. **`audit.log` yo'li** jail'da `/var/lib/pos/logs/audit.log` — boshqa yo'l
   bo'lsa `/etc/fail2ban/jail.d/pos-audit.local`ni tahrirlang.
3. **NAT xavfi:** `maxretry` bir xil ofisdan chiqqan barcha kassalar uchun
   umumiy — kerak bo'lsa `ignoreip`ga ofis egress IP qo'shing.

### 7.18.3. O'rnatish

```bash
cd /opt/pos
sudo bash deploy/scripts/install-fail2ban-pos.sh
sudo fail2ban-client status pos-audit
```

Tekshiruv:

```bash
# sintetik qatorlar bilan (script o'zi ham bajaradi):
echo '{"t":"2030-01-01T00:00:00.000Z","type":"auth.login.failure","username":"x","ip":"203.0.113.50","reason":"bad"}' | sudo tee -a /var/lib/pos/logs/audit.log
# 8 marta takrorlang yoki maxretry ni vaqtincha 1 qilib sinab ko'ring
sudo fail2ban-client status pos-audit
```

Blokdan chiqarish:

```bash
sudo fail2ban-client set pos-audit unbanip 203.0.113.50
```

### 7.18.4. Logrotate va vaqt belgisi

`pos-audit.logrotate` **copytruncate** ishlatadi. Filterni **polling** backend
bilan yozdik (`jail.d/pos-audit.local`). Agar ayrim kernel'larda eskirgan
qatorlar ko'rinsa: `sudo fail2ban-client reload pos-audit`.

Filtrda **datepattern yo'q**: Node `toISOString()` millisekundlari bilan,
fail2ban `strptime` esa distributivlar bo'yicha farq qiladi. Jonli tail uchun
`findtime` / `maxretry` aniqligi amaliyotda yetarli.

### 7.18.5. CI

`npm run test:fail2ban` — filter va `auditLog.cjs` JSONL shakli sinxronligini
tekshiradi (fail2ban o'rnatilmagan muhitda ham ishlaydi).

---

## Troubleshooting

**`Error: better-sqlite3 NODE_MODULE_VERSION mismatch`**
```bash
npm rebuild better-sqlite3
```

**`EACCES: permission denied, mkdir '/var/lib/pos'`**
```bash
sudo chown -R pos:pos /var/lib/pos
```

**CORS xatolari browser'da**
`.env`da `POS_CORS_ORIGINS` ga frontend domen qo'shing, server restart.

**`401 Unauthorized` frontend'dan**
`VITE_POS_RPC_SECRET` va `POS_HOST_SECRET` bir xil ekanligini tekshiring va
frontend'ni qayta build qiling (`npm run build`).
