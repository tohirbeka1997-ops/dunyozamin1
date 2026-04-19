# POS Print Agent

A tiny Node.js daemon that runs **on the cashier PC** and bridges the gap
between the web-based POS (running in a browser against a cloud backend)
and the local thermal printer (USB / Windows shared / network / serial).

```
[ Browser tab @ pos.example.com ]
            |
            |  POST http://127.0.0.1:9100/print
            v
[ pos-print-agent ]  ── node-thermal-printer ──> [ Thermal printer ]
```

Without this agent the cloud backend cannot reach a printer physically
attached to the cashier's PC. The agent solves that in ~300 lines of JS
with no native dependencies required for the default Windows "shared
printer" mode.

---

## Quick start (Windows)

1. Install [Node.js 18+](https://nodejs.org/) on the cashier PC.
2. Copy the `print-agent/` folder anywhere (e.g. `C:\pos-print-agent\`).
3. Install dependencies:

   ```powershell
   cd C:\pos-print-agent
   npm install
   ```

4. Start the agent once so it writes a default `config.json`:

   ```powershell
   node agent.js
   ```

   It will print something like:

   ```
   [print-agent] Wrote default config to C:\pos-print-agent\config.json
   [print-agent] ⚠️  Edit it now: set the correct printer interface.
   [print-agent] Bearer secret: 6f9c...
   ```

5. Edit `config.json` — set `printer.interface` to match your installed
   Windows printer (see [Printer interface options](#printer-interface-options)).
   Copy the generated `agent.secret` into the web app build via
   `VITE_PRINT_AGENT_SECRET` (see below).

6. Test once more:

   ```powershell
   node agent.js
   # In another terminal:
   curl -H "Authorization: Bearer <secret>" -X POST http://127.0.0.1:9100/print/test
   ```

7. Install autostart so the agent runs at every Windows logon:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
   ```

   The installer registers a per-user Scheduled Task and launches it.
   Logs: `C:\pos-print-agent\logs\agent.log`.

---

## Quick start (Linux)

```bash
sudo useradd -r -s /usr/sbin/nologin pos
sudo mkdir -p /opt/pos-print-agent
sudo cp -r print-agent/* /opt/pos-print-agent/
sudo chown -R pos:pos /opt/pos-print-agent
cd /opt/pos-print-agent
sudo -u pos npm install --omit=dev

# First run to create config.json:
sudo -u pos node agent.js          # then Ctrl+C

# Edit /opt/pos-print-agent/config.json (printer.interface, secret, CORS)

sudo cp scripts/pos-print-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pos-print-agent
sudo systemctl status pos-print-agent
```

---

## Printer interface options

Set `printer.interface` in `config.json`. Pick the one that matches how
the printer is connected:

| Value | Platform | When to use |
|-------|----------|-------------|
| `printer:<Windows printer name>` | Windows | **Recommended.** Installed via Windows "Devices and Printers". No native deps. Uses PowerShell raw spooler. |
| `tcp://<host>:<port>` | Any | Network / Ethernet thermal printer. |
| `usb` | Any | Direct USB. Requires `usb` native module — only needed for printers without a Windows driver. |
| `/dev/ttyUSB0` or `COM3` | Linux / Windows | Serial printer. |

Examples:

```jsonc
"interface": "printer:XP-80C"       // Windows shared printer
"interface": "tcp://192.168.1.50:9100"  // Network
"interface": "usb"                   // Direct USB (requires node-usb)
```

---

## HTTP API

All endpoints return JSON. If `agent.secret` is configured, every endpoint
except `GET /health` requires:

```
Authorization: Bearer <secret>
```

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness + advertised printer/scale |
| `GET /config` | Full config (secret redacted) |
| `POST /print` | Print a receipt (lines + options) |
| `POST /print/test` | Print a fixed "SALOM" diagnostic receipt |
| `GET /scale/read` | Read one weight from the configured scale |
| `GET /scale/ports` | List available serial ports (for setup) |

### `GET /health`
```json
{ "ok": true, "agent": "pos-print-agent", "version": "1.0.0",
  "platform": "win32", "printer": { "interface": "printer:XP-80C", "type": "epson" } }
```

### `POST /print`
```json
{
  "lines": [
    { "text": "SALOM", "align": "center", "bold": true },
    { "text": "-------------------------", "align": "left" },
    { "text": "Total: 120 000 UZS", "align": "right", "bold": true }
  ],
  "options": { "charsPerLine": 48, "feedLines": 3, "cut": true }
}
```
→ `{ "ok": true, "data": { "bytes": 512, "path": "spooler", "spoolerName": "XP-80C" } }`

### `POST /print/test`
Prints a fixed "POS PRINT AGENT — Test receipt" page. Handy for smoke-testing
a new install without needing a full receipt payload.

### `GET /scale/read`
Returns the current weight from the scale configured in `config.json -> scale`.

```json
{ "ok": true, "data": { "weight": 0.245, "unit": "kg", "stable": true,
                         "raw": "ST,+  0.245kg", "ts": 1713556800123 } }
```

Error envelopes:

* `SCALE_DISABLED`   — `scale.enabled` is `false` in config.
* `SCALE_UNAVAILABLE` — the `serialport` package is not installed (run
  `npm install serialport` inside `print-agent/`).
* `SCALE_READ_FAILED` — port could not be opened, no data within timeout, etc.

### `GET /scale/ports`
Lists the serial ports visible to this PC:

```json
{ "ok": true, "data": [
    { "path": "COM5", "manufacturer": "Prolific", "friendlyName": "USB-SERIAL (COM5)" },
    { "path": "COM1", "manufacturer": null,        "friendlyName": "Communications Port (COM1)" }
]}
```

---

## Enabling scale support

The agent ships with scale support **disabled** — the heavy native dep
(`serialport`) is installed only when you need it:

```powershell
cd C:\pos-print-agent
npm install serialport
```

Then edit `config.json`:

```jsonc
"scale": {
  "enabled": true,
  "port": "COM5",          // /dev/ttyUSB0 on Linux
  "baudRate": 9600,
  "protocol": "cas",        // 'cas' | 'generic' | 'poll-ack'
  "timeoutMs": 2500,
  "minStableMs": 300,       // optional — require a stable reading for 300 ms
  "divisor": null           // optional — set to 1000 if scale sends grams
}
```

Restart the agent. Test:

```powershell
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:9100/scale/read
```

| Protocol | Typical scales | How the agent talks |
|----------|----------------|----------------------|
| `cas`    | CAS-PD, ACLAS, AND, many cheap CAS-compatible | Listens to continuous ASCII stream |
| `generic`| Generic ASCII scales with "W\r" query | Sends `W\r` on connect |
| `poll-ack`| Mettler Toledo, Avery, etc. | Sends `S\r\n`, parses first numeric field |

If your scale's format isn't parsed correctly, copy a raw frame from
`GET /scale/read` (it's echoed in the `raw` field) and we can tune the
parser — or just set `divisor`/`unit` to adjust the final value.

---

## Web app integration

In the web POS build, set these Vite env vars (see root `.env.example`):

```bash
VITE_PRINT_AGENT_URL=http://127.0.0.1:9100
VITE_PRINT_AGENT_SECRET=6f9c...         # must match agent config.json
```

The frontend's `src/lib/receipts/escposPrint.ts` will automatically try
the agent when running in web/SaaS mode (i.e. when `VITE_POS_RPC_URL`
is also set). In the Electron desktop build the agent is ignored and the
in-process `printService.cjs` is used instead.

### CORS

The agent's default `allowOrigins` is `["*"]`. Tighten it in production:

```jsonc
"allowOrigins": ["https://pos.example.com"]
```

---

## Security notes

* **Bind to 127.0.0.1** (default). Binding to `0.0.0.0` turns the agent
  into a LAN-wide print service — only do this if every machine on the LAN
  is trusted.
* **Always set `agent.secret`** before exposing the agent even on localhost.
  Otherwise any local process (browser extensions, malware) could print.
* The secret is stored on the cashier PC in `config.json` and in the browser
  build's env vars. Treat it as a shared password scoped to that PC; rotate
  if a PC is decommissioned.
* The agent reads payloads up to 2 MB. Receipt payloads are typically < 5 KB.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `ECONNREFUSED 127.0.0.1:9100` from browser | Agent not running. Start it manually (`node agent.js`) or check scheduled task / systemd status. |
| `Spooler print failed (exit 2)` | Windows printer name mismatch. `Get-Printer \| Format-Table Name`. |
| `node-thermal-printer is not installed` | You skipped `npm install`. Do it inside `print-agent/`. |
| CORS error in browser console | Add the web POS origin to `agent.allowOrigins` and restart the agent. |
| Prints are garbled / wrong width | Adjust `printer.charsPerLine` (32 for 58 mm, 48 for 80 mm) and `printer.type`. |
| `AUTH_ERROR Unauthorized` | `VITE_PRINT_AGENT_SECRET` doesn't match `agent.secret` in `config.json`. |

Check logs:

* Windows: `C:\pos-print-agent\logs\agent.log`
* Linux:   `sudo journalctl -u pos-print-agent -f` or `/var/log/pos-print-agent.log`

---

## License

Internal, same as parent project.
