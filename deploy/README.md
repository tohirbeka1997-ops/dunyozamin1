# POS Deploy Assetlari

Bu katalog **server-side deploy** uchun kerakli shablonlar va skriptlarni
o'z ichiga oladi. Asosiy arxitektura `MIGRATION_TO_HETZNER.md`da.

## Tarkibi

```
deploy/
├── nginx/
│   └── pos.conf.template        # Parametrli vhost shabloni (Nginx)
├── scripts/
│   ├── setup-nginx.sh           # SERVERDA: Nginx + Let's Encrypt o'rnatish
│   ├── frontend-build-and-publish.sh  # LOKAL: build + rsync dist/ → server
│   └── renew-ssl.sh             # SERVERDA: SSL qo'lda yangilash (test)
└── README.md                    # Bu fayl
```

## Tezkor deploy (Quick Start)

### 1. Backend server'ni ishga tushirish (serverda)

Docker variant (tavsiya etiladi):
```bash
cd /opt/pos
cp .env.server.example .env
# .env ni to'ldiring: POS_HOST_SECRET, VITE_POS_RPC_SECRET, POS_CORS_ORIGINS
docker compose up -d --build
curl http://127.0.0.1:3333/health
```

Docker'siz (systemd) variant — `MIGRATION_TO_HETZNER.md` §3 ga qarang.

### 2. Nginx + SSL o'rnatish (serverda)

```bash
sudo DOMAIN=pos.example.com \
     API_DOMAIN=api.example.com \
     EMAIL=admin@example.com \
     deploy/scripts/setup-nginx.sh
```

Skript:
- Nginx + certbot + python3-certbot-nginx o'rnatadi
- `pos.conf.template` ni sizning qiymatlaringiz bilan render qiladi va `/etc/nginx/sites-available/pos.conf` ga yozadi
- `/etc/nginx/sites-enabled/default` ni olib tashlaydi
- `nginx -t` bilan sintaksisni tekshiradi
- `certbot --nginx` ni chaqirib HTTPS'ni yoqadi
- UFW firewall'da 80/443 ni ochadi
- `certbot.timer` avtomatik yangilashni yoqadi

Environment o'zgaruvchilari (`setup-nginx.sh` ichida):

| ENV | Default | Tavsif |
|---|---|---|
| `DOMAIN` | — **majburiy** | asosiy domen (`pos.example.com`) |
| `API_DOMAIN` | `$DOMAIN` | API sub-domeni, alohida bo'lsa |
| `EMAIL` | — **majburiy** | Let's Encrypt emaili |
| `WEB_ROOT` | `/var/www/pos` | frontend dist manzili |
| `UPSTREAM_HOST` | `127.0.0.1` | backend binding |
| `UPSTREAM_PORT` | `3333` | backend port |
| `CLIENT_MAX_BODY` | `25m` | upload limit (rasm uchun) |
| `SKIP_CERTBOT` | `0` | `1` bo'lsa faqat HTTP (test uchun) |

### 3. Frontendni yuklash (lokaldan)

```bash
SERVER=pos@api.example.com \
API_URL=https://api.example.com \
API_SECRET="<POS_HOST_SECRET qiymati>" \
deploy/scripts/frontend-build-and-publish.sh
```

Skript:
- `.env.production.local` ni vaqtinchalik yaratadi (`VITE_POS_RPC_URL/SECRET`)
- `npm run build` bajaradi
- `dist/` ni `/var/www/pos-releases/<timestamp>/` ga rsync qiladi
- Symlink swap bilan `/var/www/pos` ni yangi versiyaga o'tkazadi (atomic deploy)
- Oxirgi 5 ta versiyani saqlaydi (oldingilari o'chadi)
- Nginx'ni reload qiladi
- Healthcheck bajaradi

Rollback uchun:
```bash
ssh $SERVER 'ls /var/www/pos-releases'
ssh $SERVER 'ln -sfn /var/www/pos-releases/<OLDREV> /var/www/pos.tmp && mv -T /var/www/pos.tmp /var/www/pos'
```

### 4. SSL yangilanish tekshiruvi (ixtiyoriy)

Certbot avtomatik ishlaydi, lekin qo'lda test qilish uchun:
```bash
sudo deploy/scripts/renew-ssl.sh --dry-run   # xavfsiz test
sudo deploy/scripts/renew-ssl.sh             # real yangilash
```

## Xavfsizlik checklist

- [ ] `POS_HOST_SECRET` kamida 32 belgi (UUID/hex)
- [ ] `POS_CORS_ORIGINS` da aniq domen yozilgan (`*` ishlatmang production'da)
- [ ] `/rpc`, `/health` faqat Nginx (`127.0.0.1:3333` proxy) orqali
- [ ] UFW yoki Hetzner firewall'da 3333 port public'ga YOPIQ
- [ ] Let's Encrypt email ishlaydigan pochta (69-kunlik ogohlantirish uchun)
- [ ] `.env` fayli `git status`da yo'q (`.gitignore` ishlaydi)
- [ ] Server'ni non-root user orqali (docker user=1001 yoki systemd User=pos)
- [ ] Backup disk to'lganligini monitor qiling (`POS_BACKUP_MAX`)

## Troubleshooting

### Nginx 502 Bad Gateway
- Backend ishlayapmi? — `curl http://127.0.0.1:3333/health`
- Docker uchun: `docker compose ps`, `docker compose logs pos-server`
- systemd uchun: `systemctl status pos-server`, `journalctl -u pos-server -n 50`

### 401 Unauthorized RPC so'rovlarda
- Frontend `.env`da `VITE_POS_RPC_SECRET` va backend `.env`da `POS_HOST_SECRET` bir xilmi?
- Build paytida ENV to'g'ri injektsiya bo'lganmi? — `dist/assets/*.js` da yangi hash borligiga ishonch hosil qiling

### CORS xatosi brauzerda
- `POS_CORS_ORIGINS` ga sizning frontend URL'i qo'shilganmi? (masalan `https://pos.example.com`)
- `hostServer.cjs` CORS o'zi ham javob beradi, lekin aniq origin ko'rsatilgani afzal

### Sertifikat yangilanmayapti
```bash
sudo certbot certificates             # holatni ko'rish
sudo deploy/scripts/renew-ssl.sh --dry-run
sudo systemctl status certbot.timer
journalctl -u certbot --no-pager | tail -n 50
```

### "Cannot execute .sh on Windows"
- Bash skriptlar Linux serverda bajariladi
- `frontend-build-and-publish.sh` lokal mashinada (macOS/Linux/Git Bash/WSL) ishga tushadi
- Windows lokalda foydalanish uchun Git Bash yoki WSL2 tavsiya etiladi
