# DunyoZamin POS — Kamchiliklar va yangi imkoniyatlar (roadmap)

> Holat: loyiha yetuk (POS, Orders, Quotes, Returns, Purchase, Inventory, Suppliers, Customers, Promotions, Employees, Expenses, Reports, WebOrders, Courier, Marketplace, Mini-app, Barcode). 87 test fayli, 18 ta TODO. Quyida — real kodga asoslangan bo'shliqlar va o'sish yo'nalishlari.

---

## A. Kamchiliklar (tuzatish kerak)

### 🔴 P0 — Web/Electron parity (takroriy muammo manbai)
Web shim (`src/lib/remotePosApi.ts`) `electron/preload.cjs`dan **orqada** — quyidagilar webda **ishlamaydi**:
`couriers:list/upsert/setActive`, `files:saveProductImageBuffer` (mahsulot rasm yuklash), `files:readFileBuffer`, `products:getLastBulkPriceBatch` (bulk undo yordamchisi), `database:uploadProgress`, `renderer:log`.
**Yechim:** shim'ni preload bilan **parity**ga keltiring (auth/xavfsiz kanallarni qo'shing). Kelajak uchun **CI tekshiruvi**: preloaddagi har kanal shim'da bormi (skript bilan).

### 🔴 P0 — Deploy versiya nomuvofiqligi
"Unknown channel: …listOpenOrders" — host (`/rpc` beruvchi Electron) eski build edi.
**Yechim:** klient↔host **versiya/health tekshiruvi** (`pos:health`da build versiya), mos kelmasa ogohlantirish; deploy runbookda host'ni majburiy qayta build/restart.

### 🟠 P1 — Audit log (faollik tarixi) yo'q
Kim narxni o'zgartirdi, chegirma berdi, mahsulot/buyurtmani o'chirdi, qaytarish qildi, zaxira tuzatdi — **yozilmaydi**. Ko'p kassirli do'kon uchun zarur.
**Yechim:** `audit_log` jadvali + servis (actor, amal, ob'ekt, eski→yangi qiymat, vaqt) + admin ko'rinishi.

### 🟠 P1 — Xavfsizlik
1 ta **high** npm zaifligi (root); `legacyUserData` qayta nomlash **data-loss xavfi** (oldingi audit). Granular **ruxsatlar (RBAC)** — rollar bor, lekin maydon darajasidagi ruxsatlar (chegirma limiti, narx ko'rish, qaytarish huquqi) cheklangan.
**Yechim:** `npm audit fix`; userData papka nomini real upgrade'da sinash; rol→ruxsat matritsasi.

### 🟡 P2 — Operatsion
- **Avto-chek (web):** har kassir PC'sida `print-agent` o'rnatish kerak (aks holda HTML fallback). O'rnatishni soddalashtiring (installer/auto-start).
- **Build/test:** frontend `build`+`typecheck` CI'da gate qilinsin (hozir sandboxda tekshirib bo'lmaydi).
- **Son formati:** `MoneyInput` ko'p joyda, lekin barcha input'lar shu komponentga o'tganini tasdiqlang.

### 🟡 P2 — Mini-app
Dark mode/UI tayyor, lekin past Android'da `backdrop-filter` (glass) perf'ini sinash; flash-deal "−%" real chegirmaga bog'lanishini tekshirish.

---

## B. Yangi imkoniyatlar (qo'shish mumkin)

### 💎 Yuqori ta'sir / past xarajat
1. **Audit log + "kim o'zgartirdi"** — yuqoridagi P1; ham xavfsizlik, ham ishonch.
2. **Ombor ⇄ ombor transfer** — ko'p ombor bor, lekin **ko'chirish hujjati** yo'q. Transfer (chiqim/kirim juftligi) + tarix.
3. **Foyda/margin hisoboti** — FIFO tannarx bor; sof foyda, margin %, mahsulot/kategoriya bo'yicha. Egasi uchun eng kerakli.
4. **Dead-stock / ABC tahlil** — sotilmayotgan zaxira, ABC (eng daromadli mahsulotlar), qayta buyurtma nuqtasi (reorder point) ogohlantirishi.
5. **Soatlik/kunlik sotuv issiqlik xaritasi** — eng band soatlar, kassir samaradorligi.

### 📈 Sotuv va mijoz
6. **Sodiqlik kengaytirish** — darajalar (kumush/oltin), tug'ilgan kun bonusi, **referral** (mini-appda `ReferralCard` bor — ulang).
7. **Promo kengaytirish** — "1+1", bundle (to'plam narx), vaqtli flash, kategoriya bo'yicha chegirma, mijoz-segment aksiyasi.
8. **Telegram bot bildirishnomalari** — mijozga buyurtma holati (qabul→tayyor→yetkazildi); egasiga **kunlik hisobot** (tushum, top mahsulot, qarzdor); qarzdorlik eslatma (bor — kengaytiring).
9. **QR/online to'lov** — Payme/Click/Uzum chuqurroq integratsiya (chekda QR, mini-appda to'lov).

### 🚚 Operatsiyalar
10. **Kuryer/yetkazib berish kengaytirish** — marshrut, real-time holat, kuryer mobil ko'rinishi (`CourierOrders` bor).
11. **Inventarizatsiya sessiyasi** — sanash varaqalari, farq (variance) hisoboti, qisman/to'liq.
12. **Egasi uchun "Boss" mobil ilovasi** — istalgan joydan tushum, zaxira, qarzdor, smena holati (push bilan).

### 🤖 Kelajak (ilg'or)
13. **AI prognoz** — sotuv bashorati → avtomatik buyurtma tavsiyasi (reorder), narx tavsiyasi.
14. **Fiskal modul** — O'zbekiston soliq/fiskal integratsiyasi (zarur bo'lsa).
15. **Barcode Studio** — etiketka dizayneri + 25 shablon (TZ allaqachon tayyor: `TZ_CURSOR_BARCODE_STUDIO.md`).
16. **Ko'p tilli kassir UI** (uz/ru) — to'liq i18n.

---

## C. Tavsiya etilgan tartib (3 to'lqin)
- **1-to'lqin (tezkor, xavfsizlik+ishonch):** P0 parity + versiya-health → Audit log → npm/RBAC → foyda hisoboti.
- **2-to'lqin (daromad):** ombor transfer → dead-stock/ABC + reorder → promo kengaytirish → TG bildirishnoma.
- **3-to'lqin (o'sish):** loyalty darajalar/referral → "Boss" mobil → AI reorder → Barcode Studio.

> Har bir bandni alohida **Cursor TZ**'siga aylantirib bera olaman — qaysi birlaridan boshlaymiz, ayting (masalan: "Audit log + foyda hisoboti + ombor transfer").
