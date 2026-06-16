# POS bazasini zaxiralash va serverdan tashqariga ko'chirish

> **Maqsad:** `pos.db` faqat serverda (`/var/lib/pos/pos.db`) qolmasin — vaqt-vaqtida bulutga va/yoki lokal kompyuterga nusxa tushsin.  
> **Muhim:** Bu **backup (zaxira)** tizimi. Kassa uchun ikki tomondan sinxron (`pos.db` ↔ server) **alohida mavzu** — bu hujjatda qamrab olinmaydi.

---

## 1. Bugun nima bor?

Tizimda **uch qavatli** zaxira allaqachon mavjud:

| Qavat | Qayerda | Oraliq | Fayl |
|-------|---------|--------|------|
| **1. Lokal snapshot** | Server: `/var/lib/pos/backups/` | Har **30 daqiqa** (sozlash mumkin) | `electron/services/backupManager.cjs` + `POS_BACKUP_*` |
| **2. Off-site (bulut)** | S3 / B2 / Google Drive / Hetzner… | Har **soat** | `deploy/scripts/backup-offsite.sh` + rclone |
| **3. Restore drill** | Off-site nusxani tekshirish | Haftalik (tavsiya) | `deploy/scripts/restore-drill.sh` |

### 1.1. Lokal snapshot (server ichida)

`pos-server` (Docker yoki `npm run server`) ishga tushganda `backupManager.cjs`:

- SQLite **online backup** API orqali `pos-YYYYMMDD-HHMMSS.db` yaratadi
- Papka: `/var/lib/pos/backups/`
- Eski nusxalar kesiladi (`POS_BACKUP_MAX`, default 48 ta ≈ 24 soat)

`.env` (server):

```bash
POS_BACKUP_ENABLED=1
POS_BACKUP_INTERVAL_MIN=30
POS_BACKUP_MAX=48
```

Qo'lda snapshot (admin RPC):

```bash
curl -sS -X POST "http://127.0.0.1:3333/rpc" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $POS_HOST_SECRET" \
  --data '{"channel":"pos:database:backup","args":[]}'
```

### 1.2. Off-site sync (rclone → bulut)

Skript: `deploy/scripts/backup-offsite.sh`

Har ishga tushganda:

1. (Ixtiyoriy) RPC orqali yangi snapshot oladi
2. `rclone copy /var/lib/pos/backups/` → `offsite:pos-backups/prod/`
3. Remote'da 30 kundan eski fayllarni o'chiradi
4. `.last-offsite-sync` sentinel yozadi (monitoring uchun)

**Systemd timer** (tavsiya, serverda):

```bash
sudo bash /opt/pos/deploy/scripts/install-backup-timer.sh
```

Timer: har soat `:17` da (`deploy/backup/pos-backup-offsite.timer`).

**Yoki Docker sidecar:**

```bash
cd /opt/pos
docker compose -f docker-compose.yaml -f docker-compose.prod.yaml \
  -f docker-compose.backup.yaml --profile backup up -d
```

### 1.3. Electron kassa (desktop)

Alohida POS dasturi ham o'z `userData/backups/` papkasiga 30 daqiqada zaxira oladi — bu **kassa kompyuteri** uchun, VPS server bilan aralashmasin.

---

## 2. Nima yetishmayapti?

| Yetishmayotgan narsa | Holat |
|---------------------|-------|
| Off-site timer o'rnatilganmi? | **Qo'lda sozlash kerak** — kod tayyor, lekin `rclone.conf` + `.env` + `install-backup-timer.sh` siz ishlamaydi |
| Lokal Windows PC nusxasi | **Avval yo'q edi** — endi: `deploy/scripts/pull-db-from-server.ps1` |
| Ikki server replication | **Yo'q** — faqat backup; kerak bo'lsa alohida loyiha |
| Kassa ↔ VPS sinxron | **Yo'q** (ataylab) — `docs/OFFLINE-SYNC-UZ.md` |

**Xulosa:** Serverda lokal backup **avtomatik** (agar `POS_BACKUP_ENABLED=1`). Bulut va PC nusxasi — **siz sozlaysiz**.

---

## 3. Tavsiya etilgan sozlash (production)

### 3-qadam modeli (eng amaliy)

```
pos.db (live)
    ↓ har 30 min
/var/lib/pos/backups/pos-*.db
    ↓ har soat (rclone)
Bulut: B2 / S3 / Google Drive
    ↓ har kecha (ixtiyoriy)
Windows PC: D:\POS-Backups\
```

---

## 4. Bulut zaxira (off-site) — qadam-baqadam

### 4.1. rclone remote yarating

Serverda:

```bash
sudo apt install -y rclone
cd /opt/pos/deploy/backup
cp rclone.conf.example rclone.conf
chmod 0600 rclone.conf
nano rclone.conf   # bitta [offsite] blokini to'ldiring
```

Tekshiruv:

```bash
rclone --config=/opt/pos/deploy/backup/rclone.conf lsd offsite:
```

**Provayderlar** (`rclone.conf.example` ichida):

- **Backblaze B2** — arzon, cold backup uchun tavsiya
- **AWS S3 / Cloudflare R2 / Wasabi / Hetzner Object Storage**
- **Google Drive** — `rclone config` bilan alohida sozlash mumkin

### 4.2. Server `.env` ga qo'shing

`/opt/pos/.env`:

```bash
POS_BACKUP_REMOTE=offsite
POS_BACKUP_REMOTE_PATH=pos-backups/prod
POS_BACKUP_REMOTE_RETENTION_DAYS=30
# backup-offsite.sh RPC snapshot uchun (POS_HOST_SECRET bilan bir xil):
POS_HOST_SECRET=...
POS_HOST_PORT=3333
```

### 4.3. Timer o'rnatish

```bash
sudo bash /opt/pos/deploy/scripts/install-backup-timer.sh
```

Foydali buyruqlar:

```bash
# Keyingi ish vaqti
systemctl list-timers pos-backup-offsite.timer

# Hozir bir marta ishga tushirish
sudo systemctl start pos-backup-offsite.service

# Log
journalctl -u pos-backup-offsite.service -n 50
journalctl -t pos-offsite --since '2 hours ago'

# Sentinel yangilanganmi?
cat /var/lib/pos/backups/.last-offsite-sync
```

### 4.4. Qo'lda sinov (deploy qilmasdan)

Serverda:

```bash
bash /opt/pos/deploy/scripts/backup-offsite.sh
echo $?   # 0 = OK, 1 = config xato, 2 = rclone vaqtinchalik xato
```

Bulutda fayllar:

```bash
rclone --config=/opt/pos/deploy/backup/rclone.conf \
  lsf offsite:pos-backups/prod/ --include 'pos-*.db'
```

---

## 5. Lokal Windows PC nusxasi

**Faqat PULL** — skript serverga hech narsa yuklamaydi va production DB ni o'zgartirmaydi.

### 5.1. PowerShell skript (tavsiya)

Loyiha rootidan (Windows):

```powershell
# Birinchi marta: deploy/deploy.env da DEPLOY_SERVER=user@your-server.com
.\deploy\scripts\pull-db-from-server.ps1

# Yoki parametrlar bilan:
.\deploy\scripts\pull-db-from-server.ps1 `
  -Server "deploy@1.2.3.4" `
  -IdentityFile "$env:USERPROFILE\.ssh\id_ed25519" `
  -LocalDir "D:\POS-Backups" `
  -KeepDays 14
```

Skript serverdagi `/var/lib/pos/backups/` dan **eng yangi** `pos-*.db` ni yuklab oladi.

### 5.2. Windows Task Scheduler (har kecha 02:00)

1. **Task Scheduler** → Create Task
2. Trigger: Daily, 02:00
3. Action: Start a program
   - Program: `powershell.exe`
   - Arguments:
     ```
     -NoProfile -ExecutionPolicy Bypass -File "D:\path\to\app01\deploy\scripts\pull-db-from-server.ps1"
     ```
4. "Run whether user is logged on or not" + SSH kalit uchun xizmat hisobi

### 5.3. Qo'lda scp (alternativa)

```powershell
scp -i $env:USERPROFILE\.ssh\id_ed25519 `
  deploy@server:/var/lib/pos/backups/pos-20260613-021700.db `
  D:\POS-Backups\
```

**Diqqat:** Jonli `pos.db` ni to'g'ridan-to'g'ri nusxalash tavsiya etilmaydi — faqat `backups/` dagi snapshot.

### 5.4. Bulutdan PC ga (rclone bilan)

Agar PC'da rclone o'rnatilgan bo'lsa:

```powershell
rclone copy offsite:pos-backups/prod/ D:\POS-Backups\ --include "pos-*.db" --max-age 7d
```

Bu server SSH talab qilmaydi — faqat bulut kalitlari kerak.

---

## 6. Ikkinchi server (replication)

Hozirgi kod **real-time replication** bermaydi. Amaliy variantlar:

| Variant | Izoh |
|---------|------|
| **Bulut backup + yangi server restore** | Afzal — `restore-drill.sh` mantiqidan foydalaning |
| **rsync backup papkasi** | `rsync -az deploy@A:/var/lib/pos/backups/ deploy@B:/mirror/backups/` (cron har 6 soat) |
| **SQLite replication** | Loyihada yo'q; murakkab, konflikt xavfi |

Production `pos.db` ni avtomatik ikkinchi serverdan **ustiga yozmang**.

---

## 7. Backup vs sinxron — farq

| | Backup (bu hujjat) | Kassa sinxron |
|--|-------------------|---------------|
| Maqsad | O'chib ketganda qayta tiklash | Offline sotuv + merge |
| Yo'nalish | Server → tashqari (bir tomonga) | Ikki tomonga (murakkab) |
| Fayl | `backups/pos-*.db` snapshot | Jonli `pos.db` |
| Hozirgi holat | ✅ Tayyor | ❌ To'liq yo'q (`docs/OFFLINE-SYNC-UZ.md`) |

---

## 8. Monitoring va tekshiruv

Prometheus alertlar (`deploy/monitoring/alerts.yml`):

- Lokal backup > 2 soat eski → `PosBackupStale`
- Off-site > 36 soat → off-site stale

Haftalik restore drill:

```bash
bash /opt/pos/deploy/scripts/restore-drill.sh
```

---

## 9. Tezkor checklist

**Server (bir marta):**

- [ ] `POS_BACKUP_ENABLED=1` — `/var/lib/pos/backups/` da `pos-*.db` paydo bo'ladi
- [ ] `deploy/backup/rclone.conf` to'ldirildi
- [ ] `.env` da `POS_BACKUP_REMOTE*` qatorlar bor
- [ ] `sudo bash deploy/scripts/install-backup-timer.sh`
- [ ] `systemctl start pos-backup-offsite.service` → exit 0
- [ ] Bulutda snapshot ko'rinadi

**Windows PC (ixtiyoriy):**

- [ ] `deploy/deploy.env` → `DEPLOY_SERVER=user@host`
- [ ] `pull-db-from-server.ps1` ishlaydi
- [ ] Task Scheduler har kecha ishga tushadi

---

## 10. Fayl manbalari

| Fayl | Vazifa |
|------|--------|
| `electron/services/backupManager.cjs` | 30 min lokal snapshot |
| `deploy/scripts/backup-offsite.sh` | rclone → bulut |
| `deploy/scripts/install-backup-timer.sh` | systemd timer o'rnatish |
| `deploy/backup/pos-backup-offsite.{service,timer}` | systemd unit fayllar |
| `deploy/backup/rclone.conf.example` | Bulut sozlama namunasi |
| `docker-compose.backup.yaml` | Docker orqali off-site |
| `deploy/scripts/restore-drill.sh` | Zaxira ishlaydimi tekshirish |
| `deploy/scripts/pull-db-from-server.ps1` | Windows → server backup PULL |
| `.env.server.example` | `POS_BACKUP_*` o'zgaruvchilar |

Batafsil migratsiya: `MIGRATION_TO_HETZNER.md` §7.10.
