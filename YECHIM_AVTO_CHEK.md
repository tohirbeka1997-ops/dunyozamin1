# To'liq yechim — POSda sotuvdan keyin avtomatik chek

## Holat
Kod tayyor: `receipt.auto_print` (default **YONIQ**). Sotuvdan keyin `POSTerminal.tsx` `shouldAutoPrintReceipt(...)` tekshirib, `printReceipt(..., { silent: true })` chaqiradi (naqd ~5504+, nasiya ~5957+, offline queue ham).

**Silent siyosat (muhim):** avtomatik chop etishda ESC/POS ishlamasa **brauzer `window.print` oynasi ochilmaydi**. O‘rniga toast: «Chek chiqmadi» + F10 eslatmasi. Qo‘lda F10 / «Chek» tugmasi hali ham ESC/POS → HTML fallback qiladi.

## Transport
`escposPrint.ts` avtomatik tanlaydi:
1. **Electron desktop** → ichki `printService` (jim).
2. **Web/brauzer (SaaS)** → kassir PC’dagi **print-agent** (`http://127.0.0.1:9100`) (jim).
3. Ikkalasi ham yo‘q → silent avto-printda **xato toast**; qo‘lda print’da HTML fallback.

Cut oldidan `feedLines: 6` (chek pastini kesib tashlamaslik uchun).

## Sizning holat (web — api.dunyozamin.com brauzerda)
Jim termal chek uchun har kassir PC’da **pos-print-agent** ishlab turishi kerak.

## Qadamlar

### 1. Print-agent o‘rnatish (har kassir PC’da)
Tafsilot: **`print-agent/SETUP-UZ.md`**. Qisqacha:
1. Node.js 18+.
2. `print-agent/` → mas. `C:\pos-print-agent\`.
3. `npm install`.
4. `config.example.json` → `config.json` (Windows printer nomi, qog‘oz eni, ixtiyoriy secret).
5. Agent + **avtozapusk**.
6. Tekshiruv: `http://127.0.0.1:9100/health`.

### 2. Web build
- `VITE_PRINT_AGENT_URL` default `http://127.0.0.1:9100`.
- Agentda token bo‘lsa — `VITE_PRINT_AGENT_SECRET` mos, qayta build.
- Remote RPC (`VITE_POS_RPC_URL`) → avval agent sinovdan o‘tadi.

### 3. Sozlamalar (POS)
- Sozlamalar → Chek: **Avtomatik chop etish = YONIQ**.

### 4. Tekshirish
- Agent ON + test sotuv → chek oyna ochilmasdan chiqadi; agent logda `/print`.
- Agent OFF + avto-print → toast xato, brauzer dialog **yo‘q**; F10 bilan qayta / HTML.
- Offline queued sotuv → `lastReceipt` saqlanadi va silent print uriniladi.

## Muqobil
**Electron desktop** kassada: print-agent shart emas — ichki printService.

## Xulosa
Avto-chek = sozlama ON + (print-agent yoki Electron). Silent rejimda brauzer dialog ochilmaydi — shu «bo‘lib tashlayapti» effektini bartaraf qiladi.
