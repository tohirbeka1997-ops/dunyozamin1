# To'liq yechim — POSda sotuvdan keyin avtomatik chek

## Holat: imkoniyat ALLAQACHON bor ✅
Kod tayyor — yangi dasturlaш kerak emas, **sozlash** kerak.

- **Sozlama:** `receipt.auto_print` (default **YONIQ**). Sozlamalar → Chek → "Avtomatik chop etish" toggle (`Settings.tsx`).
- **Sotuvdan keyin:** har sotuvда `POSTerminal.tsx` `shouldAutoPrintReceipt(...)` tekшiрiб, `printReceipt(..., { silent: true })` chaqиради (naqd va nasiya yo'llари — 4645 va 5069).
- **Transport avtomatик tanlanади** (`escposPrint.ts`):
  1. **Electron desktop** → ichки `printService` orqали to'g'ридан-to'g'рi printerга (jim).
  2. **Web/brauzер (SaaS)** → kassир PC'sидаги **print-agent** demonи (`http://127.0.0.1:9100`) orqали (jim).
  3. Ikkalаsи ham yo'q → **HTML fallback** (`window.print` — brauzер chop oynаsи, jim emas).

## Sizning holat (web — api.dunyozamin.com brauzерда)
Avtomatik **jim** termal chek uchun har kassир PC'sида **pos-print-agent** ishlаб turishi kerak. Bo'lmаsa — tizim HTML fallbackка o'tади (har sotuvда brauzер chop oynаsi ochилади — bezovtа).

## Qadamlar (to'liq yechim)

### 1. Print-agent o'rnatish (har kassир PC'sида)
Tafsилот: **`print-agent/SETUP-UZ.md`** (o'zbekча). Qisqача:
1. Kassир PC'га **Node.js 18+** o'rnатинг.
2. `print-agent/` papkаsini PC'га ko'chиринг (mas. `C:\pos-print-agent\`).
3. `npm install` (shu papkада).
4. `config.example.json` → `config.json`: termal **printer nomi**ни (Windows ulashган printer nomи), qog'oz eni (58/80mm), kerak bo'lса `secret` (token) ni kiriting.
5. Agent'ni ishga tushириng va **avtoзапуск** qiling (Windows: `print-agent/scripts/pos-print-agent.service` yoki Task Scheduler — README'да).
6. Tekшiriш: brauzерда `http://127.0.0.1:9100/health` ochилса — agent tayyor.

### 2. Web build'ни agentга ulash (ixtiyoriy — default ishlайди)
- `VITE_PRINT_AGENT_URL` default **`http://127.0.0.1:9100`** — odatда o'zgартириш shart emas.
- Agar agentда token bo'lса — web buildда `VITE_PRINT_AGENT_SECRET`ни **aynan** o'shага teng qo'yиб, qайта build qiling.
- Web POS allaqachon remote-RPC rejimида (`VITE_POS_RPC_URL` bor) → tizim **avval agentни** sinайди.

### 3. Sozlamalar (POS ichида)
- Sozlamalar → Chek: **"Avtomatik chop etish" = YONIQ**.
- Qog'oz eni (58 / 78 / 80mm), shablon, kompaniyа nomи/logo, "o'rta matn"ни to'g'ріланг (`ReceiptDesignerPage`).

### 4. Tekshirish
- Test sotuv → chek **o'zи** chiqsин (oynа ochилмаsдан).
- Agent loglарida `/print` so'rovи ko'rinсин; printer qog'oz kessин (`cut`).

## Muhim ogohlantirishlar (caveat)
- **HTTPS → http://127.0.0.1 (mixed content):** zamonавий brauzерlар loopback (`127.0.0.1`/`localhost`)га ruxsat beradi (xavfsиz kontекст istisnoси) — odatда ishlайди. Agar brauzер bloklаsa: agentни `localhost` bilan chaqиринг yoki brauzер siyosатини tekшiринг.
- **Avtoзапуск:** agent kassир PC yonгanда o'zи ishga tushsин (xizмат/Task Scheduler) — aks holда ertalаб chek chiqмайди.
- **Printer ulashиш:** Windows "shared printer" rejimи default; USB/tармоq/serial ham qo'llаб-quvvatlанади (config'да).
- **Bir nechta kassа:** har PC'да alohida agent + o'zining printerи.

## Agar agent ишlatishni xohlamasangiz — muqobil
**Electron desktop build**ни kassада ishlатинг: u printerга **ichкаридан** (in-process) ulanади — print-agent kerak emas, jim avtomatik chek beradi. (Web qulayлиgini xohlasangiz — agent yo'lи to'g'ри.)

## Xulosa
Funksiyа bor va to'g'ри qurilган. "To'liq yechим" = **har kassир PC'sида print-agent o'rnатиб, avtoзапуск qилиш** + Sozlamalarда avto-print YONIQ. Shundан so'ng web POSда sotuvdan keyин chek **o'zи** chiqади. Tafsилот: `print-agent/SETUP-UZ.md`.
