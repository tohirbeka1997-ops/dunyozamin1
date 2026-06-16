# Offline rejim va sinxronlash — tahlil va rejа

> **Sana:** 2026-06-13  
> **Maqsad:** Zaif PC + CLIENT rejimi + VPS (pos.db) uchun offline sotuv va qayta ulanishda sinxronlash.

---

## 1. Bugun nima ishlaydi?

| Komponent | Offline holat | Izoh |
|-----------|---------------|------|
| **HOST rejimi (Electron)** | ✅ To‘liq | `pos.db` mahalliy SQLite — internet shart emas. Mahsulot, mijoz, smena, sotuv — hammasi lokal. |
| **CLIENT rejimi (Electron)** | ❌ Sotuv yo‘q | Mahalliy DB ochilmaydi; har bir amal HOST RPC orqali. Server unreachable bo‘lsa — xato. |
| **sales-mobile** | ⚠️ Qisman | **Sotuv** offline navbatga tushadi (`offlineQueue.ts`); internet qaytganida `completeSale` qayta yuboriladi. Mahsulot qidiruv va smena — onlayn kerak. |
| **Mini-app (mijozlar)** | ❌ | Faqat onlayn API. |
| **Admin SPA (brauzer → RPC)** | ❌ | Server kerak. |
| **Desktop renderer (`src/offline/db.ts`)** | ⚠️ Asoslangan, lekin ulanmagan | IndexedDB outbox + `useSyncEngine` bor, lekin Electron sotuv yo‘li (`completePOSOrder`) bunga ulanmagan edi. Faqat mock/dev (`VITE_ALLOW_MOCK_API`) ishlatardi. |

**Xulosa:** Zaif kompyuterda CLIENT rejimida **hech qanday offline sotuv** yo‘q edi. HOST rejimida esa offline allaqachon ishlaydi, lekin VPS bilan avtomatik sinxron yo‘q.

---

## 2. CLIENT rejimi nima uchun offline ishlamaydi?

`electron/main.cjs` CLIENT rejimida:

1. SQLite **ochilmaydi** (`DB will NOT be opened locally`).
2. Barcha `pos:*` kanallar `clientForwarder.cjs` orqali HTTP `POST /rpc` ga yuboriladi.
3. Server javob bermasa — `fetch` xato, sotuv bekor.

Bu **ataylab** shunday qilingan (`KASSA_MULTI_TERMINAL_PLAN.md`):

- Single source of truth — bitta HOST DB
- Stock/checkout atomic transaction HOST’da
- CLIENT — faqat UI + RPC (stateless)

Shuning uchun CLIENT offline = arxitekturaga zid; qo‘shimcha qatlam kerak.

---

## 3. Tavsiya etiladigan arxitektura variantlari

### Variant A — Zaif PC’ni HOST qilish + davriy DB sinxron

**G‘oya:** Kompyuterda `pos.db` nusxasi, HOST rejimi. Internet borida VPS bilan fayl/sync script.

| Afzallik | Kamchilik |
|----------|-----------|
| To‘liq offline (katalog, qoldiq, hisobot) | Ikki nusxa — konflikt xavfi yuqori |
| Mavjud kod o‘zgarmaydi | VPS ↔ lokal DB sinxron **hali yo‘q** — script yozish kerak |
| Zaif PC faqat SQLite o‘qiydi | Bir vaqtda VPS + lokal HOST — ma’lumot ajralishi |

**Konflikt:** Oxirgi yozuv yutadi (LWW) yoki manual merge. Bir do‘konda bitta vaqtning o‘zida faqat bitta manba bo‘lishi kerak.

**Murakkablik:** O‘rta–yuqori (2–4 hafta to‘liq sinxron).

---

### Variant B — Operatsiya darajasidagi outbox (tavsiya, v1 boshlandi)

**G‘oya:** CLIENT rejimida sotuv payload’i lokal navbatga (`order_uuid` bilan). Internet qaytganida `pos:sales:completePOSOrder` qayta chaqiriladi. Server `order_uuid` dublikatini qaytaradi (`salesService.cjs`).

| Afzallik | Kamchilik |
|----------|-----------|
| Mavjud CLIENT/VPS arxitekturani buzmaydi | Offline’da katalog/qoldiq yangilanmaydi (React Query cache) |
| sales-mobile bilan bir xil pattern | Smena serverda ochiq bo‘lishi kerak (replay vaqtida) |
| Idempotent — double-charge xavfi past | Stock yetarli emas bo‘lsa replay xato |
| v1 minimal — 1 kun | Faqat sotuv; qaytarish/xarajat keyinroq |

**Konflikt hal qilish:**

- **Sotuv:** `order_uuid` — server mavjud buyurtmani qaytaradi.
- **Stock:** HOST atomic tekshiruv — yetarli emas → xato, operator hal qiladi.
- **Narx:** Replay vaqtidagi server narxi (offline vaqtidagi narx emas).

**Murakkablik:** Past–o‘rta (v1: 1–2 kun, to‘liq: 1–2 hafta).

---

### Variant C — SQLite replica / ikki tomondan sinxron

**G‘oya:** CRDT/LiteFS litestream, yoki custom changelog sync.

| Afzallik | Kamchilik |
|----------|-----------|
| To‘liq offline + to‘liq ma’lumot | Eng murakkab |
| | Konflikt, migratsiya, multi-kassa |

**Murakkablik:** Juda yuqori (oylar). Hozirgi ehtiyoj uchun ortiqcha.

---

## 4. Tavsiya

**Qisqa muddat (zaif PC + VPS):** **Variant B** — CLIENT + offline sotuv navbati.

**Uzoq muddat (bitta do‘kon, barqaror internet):** VPS’da HOST, barcha kassalar CLIENT — outbox faqat internet uzilishiga qarshi.

**Alohida filial / doimiy offline:** **Variant A** — mahalliy HOST + rejalashtirilgan DB eksport/import.

---

## 5. v1 implementatsiya (2026-06-13)

Quyidagi fayllar qo‘shildi:

| Fayl | Vazifa |
|------|--------|
| `src/lib/isRpcUnreachable.ts` | Tarmoq/server xatosi vs biznes xatosi |
| `src/lib/offlineSalesQueue.ts` | Sotuv navbati (localStorage) |
| `src/lib/offlineSalesSync.ts` | Replay + CLIENT rejim tekshiruvi |
| `src/db/orders.api.ts` | RPC xato → navbatga |
| `src/App.tsx` | Avto-sync (online event + 60s poll) |
| `src/components/common/NetworkBadge.tsx` | Kutilayotgan sotuvlar badge |
| `src/pages/POSTerminal.tsx` | Offline saqlash toast + badge |

### Foydalanish

1. CLIENT rejimi o‘zgarmaydi — mavjud production sozlama saqlanadi.
2. Server unreachable bo‘lganda sotuv **OFF-XXXXXXXX** raqami bilan navbatga tushadi.
3. Internet qaytganida avtomatik yuboriladi; header’da badge ko‘rinadi.
4. Qo‘lda sync: badge yonidagi ↻ tugmasi.

### Cheklovlar (v1)

- Offline’da yangi mahsulot qidirish / qoldiq tekshirish cheklangan (cache).
- Smena replay vaqtida ochiq bo‘lishi kerak.
- Qaytarish, xarajat, mijoz yaratish — hali navbatda emas.
- VPS’dan **pull** (yangi mahsulot/narx) alohida bosqich.

---

## 6. Keyingi bosqichlar

1. **Offline read cache** — mahsulot/mijoz snapshot (TanStack Query persist).
2. **HOST ↔ VPS sync script** — `rsync` + WAL checkpoint yoki export API.
3. **Outbox kengaytirish** — returns, expenses, shift open/close.
4. **Health ping** — `navigator.onLine` emas, haqiqiy `pos:health` RPC.
5. **Settings UI** — offline navbat ro‘yxati va qo‘lda o‘chirish.

---

*Hujjat versiyasi: 0.1*
