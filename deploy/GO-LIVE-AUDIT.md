# Go-Live Audit — POS (app01)

**Sana:** 2026-05-21  
**Maqsad:** Kod + biznes tomondan deploy tayyorligi (o‘z do‘koni, 2 kassa, server).

---

## 1. Arxitektura (qisqa)

| Komponent | Vazifa |
|-----------|--------|
| **Electron desktop** | Kassa, ombor, hisobotlar, mahalliy SQLite |
| **POS RPC server** (`:3333`) | Admin web / masofaviy klientlar |
| **Public API** (`:3334`) | Mini-app, onlayn katalog, web buyurtma |
| **Telegram bot** | Buyurtma bildirishnomalari |
| **print-agent** | Har kassada termoprinter (HTTP) |

**Ma’lumotlar bazasi:** SQLite, `POS_DATA_DIR/pos.db`, **84** SQL migratsiya (`000` … `084`).

---

## 2. Biznes oqimlari — smoke test holati

| Oqim | Skript | Tekshiradi |
|------|--------|------------|
| Ombor / zaxira | `test:inventory-smoke` | qoldiq, adjust, transfer |
| Savat / sotuv / qaytarish | `test:cart-smoke` | POS yakunlash, qaytarish, zaxira |
| Hisobotlar | `test:reports-smoke` | kunlik, P&L, mijoz, ombor |
| Onlayn savdo | `test:online-smoke` | public-api, web order |
| Web buyurtma tahrir | `test:web-order-edit-smoke` | status, tahrir |
| Buyurtmalar / balans | `test:orders-smoke` | nasiya, kirdi/chiqdi, qoralama |
| Mahsulot narxi | `test:products-smoke` | narx sinxron, qoralama buyurtma |
| Xarid | `test:purchase-smoke` | PO, qabul, tannarx |
| Chek | `test:print-smoke` | matn, buffer, auto_print, agent |

**Barcha POS smoke:** `npm run test:pos-smoke`  
**To‘liq (tarmoq + agent):** `npm run test:smoke`

---

## 3. Deploy oldidan buyruqlar

```bash
# To‘liq preflight (xotira yetmasa: PREFLIGHT_SKIP_BUILD=1)
set NODE_OPTIONS=--max-old-space-size=8192
npm run deploy:preflight

# Yoki bosqichma-bosqich
npm run electron:build
npm run test:public-api
npm run test:pos-smoke
npm run db:integrity
npm run build
```

**Server deploy** (public-api test + ixtiyoriy POS smoke):

```bash
set DEPLOY_RUN_POS_SMOKE=1
npm run deploy:server
```

---

## 4. Kod audit — BLOCKER / HIGH

### BLOCKER (productiondan oldin hal qiling yoki riskni qabul qiling)

| # | Muammo | Tavsiya |
|---|--------|---------|
| B1 | Parol **SHA-256** (tuzsiz) | Keyingi relizda bcrypt/argon2; hozir RPC faqat LAN/TLS orqasida |
| B2 | Server **secrets** bo‘lmasa ishlamaydi | `POS_HOST_SECRET`, `JWT_*`, `TELEGRAM_*` — `.env.server.example` |
| B3 | `deploy:server` faqat `test:public-api` | Deploy oldin `deploy:preflight` yoki `DEPLOY_RUN_POS_SMOKE=1` |

### HIGH

| # | Muammo | Tavsiya |
|---|--------|---------|
| H1 | RPC default `0.0.0.0` | Production: `127.0.0.1` + nginx, firewall |
| H2 | Parol tiklash kodi API orqali qaytishi mumkin | Faqat dev; productionda SMS/email |
| H3 | Migratsiya `014`/`045`/`046` dublikat prefiks | Mavjud DBda `schema_migrations` tekshiring |
| H4 | `001_fix_customer_balance_sign.cjs` avtomatik emas | Bir marta legacy skript |
| H5 | Windows build xotira (OOM) | `NODE_OPTIONS=--max-old-space-size=8192` |

### MEDIUM (go-live dan keyin ham bo‘ladi)

- Chek: har kassada **print-agent** yoki Electron printer sozlamasi  
- Web: `Customers` export web rejimda cheklangan  
- Admin `wipeData` — faqat ishonchli admin  

---

## 5. Go-live kun checklist (48 soat)

### T-1 (server)

- [ ] Backup: `deploy/scripts/backup-offsite.sh` yoki DB nusxasi
- [ ] `npm run deploy:preflight` (yoki `PREFLIGHT_SKIP_BUILD=1` + alohida build serverda)
- [ ] Migratsiyalar: 84 ta `schema_migrations` qator
- [ ] `npm run db:integrity`
- [ ] Health: `:3333/health`, `:3334/health`
- [ ] Nginx TLS, CORS, `/v1` → public-api

### T-0 (kassalar)

- [ ] Electron `dist:win` o‘rnatildi (2 ta PC)
- [ ] `pos-config.json` / printer: print-agent URL
- [ ] Smena ochish → test sotuv → **Chek (F10)** / avtomatik chop
- [ ] Qaytarish 1 ta test
- [ ] Skaner / kg PLU test

### T+1

- [ ] Kunlik savdo hisoboti = kassa jami
- [ ] Onlayn buyurtma → POS import → sotuv
- [ ] Telegram bildirishnoma

---

## 6. Optimizatsiya (amalga oshirilgan / tavsiya)

| Soha | Holat |
|------|--------|
| Mahsulot narxi ↔ buyurtma | `productsService` `product_prices` + qoralama yangilash |
| Chek auto_print | Default ON (`normalizeReceiptSettings`) |
| POS chek tugmasi | F10, toast, ESC/POS → HTML fallback |
| Parol reset kodi | `crypto.randomInt` (2026-05-21) |
| Deploy preflight | `npm run deploy:preflight` |

**Tavsiya (keyingi sprint):** parol hashing, migration renumber, build CI da `max-old-space-size`.

---

## 7. Rollback

1. Oldingi release symlink / rsync snapshot  
2. `pos.db` backup qaytarish (faqat zarurat bo‘lsa)  
3. `systemctl restart` public-api, pos-rpc, telegram-bot  

---

## 8. Foydali fayllar

- `deploy/DEPLOY-READINESS-CHECKLIST.md` — muhit o‘zgaruvchilari  
- `deploy/deploy.env.example` — server namuna  
- `print-agent/README.md` — printer agent  
- `package.json` — barcha `test:*` skriptlar  
