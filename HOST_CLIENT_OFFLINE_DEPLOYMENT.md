# HOST + CLIENT (LAN) OFFLINE DEPLOYMENT GUIDE

Maqsad: **internet bo‘lmasin**, lekin **bir nechta qurilmada** bir xil ma’lumotlar ishlasin.

Bu rejimda:
- **HOST** kompyuterda **SQLite `pos.db`** ochiladi va barcha yozish/oqish shu yerda bo‘ladi.
- **CLIENT** kompyuterlar **DB ochmaydi**; barcha `pos:*` amallar LAN orqali HOST’ga yuboriladi.

> SQLite faylni bir nechta kompyuter bir payt tarmoqdan ochishi xavfli. Shuning uchun bu “HOST yagona DB” arxitekturasi tanlangan.

---

## 1) EXE (installer) yig‘ish

Build kompyuterda:

```bash
npm install
npm run dist:win
```

Natija: `release/` ichida NSIS installer (`*.exe`).

---

## 2) HOST/CLIENT konfiguratsiya fayli

Har qurilmada alohida config fayl yaratiladi:

- **Path**: `<userData>/pos-config.json`
- Misol (Windows): `C:\Users\<User>\AppData\Roaming\miaoda-react-admin\pos-config.json`

Ichida:
- `mode`: `"host"` yoki `"client"`
- `host.port`: HOST RPC port (default `3333`)
- `host.secret`: CLIENT’lar uchun token
- `client.hostUrl`: masalan `http://192.168.1.10:3333`
- `client.secret`: odatda HOST secret bilan bir xil

App ichidan ham ko‘rish/sozlash mumkin: **Settings → HOST/CLIENT**.

---

## 3) HOST o‘rnatish (do‘kondagi “asosiy” PC)

1. EXE o‘rnating va app’ni oching
2. **Settings → HOST/CLIENT**
3. `mode = host`
4. `host.port = 3333` (yoki o‘zingiz)
5. `host.secret`ni saqlab qo‘ying (CLIENT’larda kerak bo‘ladi)
6. App’ni **restart** qiling

### Windows Firewall
HOST’da LAN uchun port ochilishi kerak:
- Inbound rule: TCP `3333` (yoki siz tanlagan port)

---

## 4) CLIENT o‘rnatish (kassalar)

1. EXE o‘rnating va app’ni oching
2. **Settings → HOST/CLIENT**
3. `mode = client`
4. `client.hostUrl = http://<HOST_IP>:3333`
5. `client.secret = <HOST secret>`
6. “Test connection”
7. App’ni **restart** qiling

> Tavsiya: HOST IP **statik** bo‘lsin (router’da DHCP reservation).

---

## 5) Backup/Restore (faqat HOST)

### Backup
HOST’da `pos.db` fayli:
- `C:\Users\<User>\AppData\Roaming\miaoda-react-admin\pos.db`

Har kuni:
- `pos.db`ni USB yoki 2-diskka nusxa qiling (masalan `D:\POS_BACKUP\pos-YYYY-MM-DD.db`)

### Restore
1. App’ni yoping (HOST)
2. Backup `pos.db`ni original joyiga qo‘ying (almashtiring)
3. App’ni qayta oching

---

## 6) Offline talab

Ilova internet bo‘lmaganda ham ishlashi kerak.
Tashqi (internet) assetlar bo‘lsa (logo, font, va h.k.), ularni lokalga ko‘chirish tavsiya etiladi.






