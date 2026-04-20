# Print Agent — kassa PC da o‘rnatish (brauzer + termal printer)

Internetdagi POS (`https://app...`) USB printerga to‘g‘ridan-to‘g‘ri ulanmaydi. **pos-print-agent** kassa kompyuterida ishlaydi: brauzer `http://127.0.0.1:9100` ga ESC/POS yuboradi, agent esa Windows printer / USB ga chop etadi.

```
[ Brauzer: https://app.dunyozamin.com ]
       |  fetch → faqat shu kassa PC
       v
[ pos-print-agent :9100 ]  →  [ Termal printer ]
```

## 1. Talablar

- Windows kassa PC: **Node.js 18+**
- Termal printer: Windowsda **o‘rnatilgan printer** nomi (masalan `XP-80C`) — **Devices and Printers** dan tekshiring

## 2. O‘rnatish

1. Loyihadagi `print-agent/` papkasini kassa PC ga nusxalang (masalan `C:\pos-print-agent\`).
2. PowerShell:

   ```powershell
   cd C:\pos-print-agent
   npm install
   node agent.js
   ```

3. Birinchi marta `config.json` yaratiladi. Ichida **`agent.secret`** bo‘ladi — uni nusxalang.
4. `config.json` da **`printer.interface`** ni qo‘ying:

   ```json
   "interface": "printer:SIZNING_PRINTER_NOMI"
   ```

   Masalan: `"printer:XP-80C"` (Windowsdagi nom bilan **aniq** mos kelishi kerak).

5. **CORS** (odatda shart emas): `agent.allowOrigins` ichiga `https://app.dunyozamin.com` qo‘shishingiz mumkin yoki `["*"]` qoldiring.

6. Agentni qayta ishga tushiring va test:

   ```powershell
   curl.exe http://127.0.0.1:9100/health
   ```

   Secret yoqilgan bo‘lsa:

   ```powershell
   curl.exe -H "Authorization: Bearer YOUR_SECRET" -X POST http://127.0.0.1:9100/print/test
   ```

7. **Avtostart** (tavsiya):

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
   ```

## 3. Frontend build (sizning dev kompyuteringizda)

`VITE_PRINT_AGENT_SECRET` **kassa `config.json` dagi `agent.secret` bilan bir xil** bo‘lishi kerak. Build vaqtida Vite uni kodga qoplaydi.

Loyiha ildizidagi `.env` (yoki build buyrug‘i bilan):

```env
VITE_PRINT_AGENT_URL=http://127.0.0.1:9100
VITE_PRINT_AGENT_SECRET=print-agentdan_nusxa_olingan_secret
```

Keyin:

```bash
npm run build
```

Va `dist/` ni serverga yuklash (`scp` yoki `frontend-build-and-publish.sh`).

**Eslatma:** barcha kassalar **bir xil secret** ishlatishi mumkin (faqat `localhost` ga so‘rov); yoki har kassa uchun alohida build (kamdan-kam kerak).

## 4. Brauzer cheklovlari (muhim)

Ba’zi brauzerlar `https://` sahifadan `http://127.0.0.1` ga **fetch** ni qattiq tekshiradi (Private Network / mixed content).

Agar chop etish ishlamasa:

- **Edge** da odatda yaxshi ishlaydi; **Chrome** yangi versiyalarda qo‘shimcha so‘rov so‘rash mumkin.
- **Sinab ko‘ring:** `VITE_PRINT_AGENT_URL=http://localhost:9100` (127.0.0.1 o‘rniga) — agent `127.0.0.1` da tursa ham `localhost` bir xil mashinaga ishora qiladi.
- POS **faqat ichki tarmoq HTTPS** da bo‘lsa, yoki kelajakda agentga **HTTPS (localhost)** qo‘shish mumkin (murakkabroq).

## 5. USB tarozi

`print-agent/config.json` da `scale.enabled`, `scale.port` (masalan `COM5`) va `npm install serialport` — batafsil `print-agent/README.md`.

## 6. Qisqa checklist

- [ ] Kassa PC: Node + `npm install` + `config.json` + printer nomi
- [ ] `agent.secret` → dev `.env` → `VITE_PRINT_AGENT_SECRET`
- [ ] `npm run build` + serverga `dist` yuklash
- [ ] Kassada: agent ishlayaptimi (`/health`), POS dan chek sinovi
