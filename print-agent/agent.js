#!/usr/bin/env node
/**
 * POS Print Agent
 * ============================================================================
 * A tiny HTTP server that lives on the cashier PC and accepts ESC/POS receipt
 * payloads from the web-based POS (running in a browser) and prints them on
 * the local thermal printer.
 *
 * Why:
 *   When the POS backend moves to a cloud server (HTTPS, a Linux container),
 *   it can no longer reach USB printers, Windows print spoolers or COM ports
 *   on the cashier's PC. The browser also cannot talk to USB directly. This
 *   agent fills that gap.
 *
 * Endpoints:
 *   GET  /health          -> { ok, version, printer: { name, ready } }
 *   GET  /config          -> agent config (admin secret required)
 *   POST /print           -> { lines: [...], options?: {...} }
 *   POST /print/test      -> prints a fixed "SALOM" test receipt
 *
 * Auth:
 *   If `agent.secret` is set in config.json every request must send
 *   `Authorization: Bearer <secret>`. Health endpoint is always public.
 *
 * Bind:
 *   Default 127.0.0.1:9100 — reachable only from the same machine (and thus
 *   only from the browser running on that same PC). Change `agent.bind`
 *   cautiously: exposing it on 0.0.0.0 means any LAN user can trigger prints.
 *
 * Usage:
 *   cd print-agent
 *   npm install
 *   node agent.js            # foreground
 *   # or install as a Windows service / systemd unit — see README.md
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const AGENT_VERSION = '1.0.0';
const CONFIG_PATH =
  process.env.POS_PRINT_AGENT_CONFIG ||
  path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  agent: {
    bind: '127.0.0.1',
    port: 9100,
    secret: null,                   // null => anonymous (localhost only)
    allowOrigins: ['*'],            // CORS: '*' OR explicit https://app.example.com list
    logFile: null,                  // null => stdout only
  },
  printer: {
    type: 'epson',                  // 'epson' | 'star' | 'star_line' | 'escpos'
    // One of:
    //   'printer:<Windows installed printer name>'   e.g. 'printer:XP-80C'
    //   'usb'                                         (node-usb native module)
    //   'tcp://192.168.1.100:9100'                    (network printer)
    //   'COM3' / '/dev/ttyUSB0'                       (serial)
    interface: 'printer:XP-80C',
    timeoutMs: 15000,
    charsPerLine: 48,
    textSize: { width: 0, height: 0 },
    usbVendorId: null,
    usbProductId: null,
    feedLines: 3,
    cut: true,
    retryCount: 2,
  },
  scale: {
    // Set `enabled: true` and install `npm install serialport` in print-agent/
    // to enable /scale/read. Otherwise the endpoint returns a clear error.
    enabled: false,
    port: '',                        // e.g. 'COM5' or '/dev/ttyUSB0'
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    protocol: 'cas',                 // 'cas' | 'generic' | 'poll-ack'
    timeoutMs: 2500,
    minStableMs: 0,                  // require stable weight for this many ms
    unit: null,                      // optional override: 'kg' | 'g' | 'lb' | 'oz'
    divisor: null,                   // optional divisor (e.g. 1000 if scale reports grams)
  },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // First-run bootstrap: write defaults + a fresh random secret.
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    cfg.agent.secret = require('crypto').randomBytes(24).toString('hex');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    console.log(`[print-agent] Wrote default config to ${CONFIG_PATH}`);
    console.log(`[print-agent] ⚠️  Edit it now: set the correct printer interface.`);
    console.log(`[print-agent] Bearer secret: ${cfg.agent.secret}`);
    return cfg;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const user = JSON.parse(raw);
  return {
    agent: { ...DEFAULT_CONFIG.agent, ...(user.agent || {}) },
    printer: { ...DEFAULT_CONFIG.printer, ...(user.printer || {}) },
    scale: { ...DEFAULT_CONFIG.scale, ...(user.scale || {}) },
  };
}

// ---------------------------------------------------------------------------
// Lazy-loaded printer layer (so /health still works even if node-thermal-printer
// failed to install — user gets a clear error instead of a process crash).
// ---------------------------------------------------------------------------
let _thermalModule = null;
function getThermalModule() {
  if (_thermalModule) return _thermalModule;
  try {
    _thermalModule = require('node-thermal-printer');
  } catch (err) {
    const msg =
      'node-thermal-printer is not installed. Run `npm install` inside print-agent/ first.';
    const e = new Error(msg);
    e.cause = err;
    throw e;
  }
  return _thermalModule;
}

const TYPE_MAP_LAZY = {
  get epson() { return getThermalModule().PrinterTypes.EPSON; },
  get star() { return getThermalModule().PrinterTypes.STAR; },
  get star_line() { return getThermalModule().PrinterTypes.STAR_LINE; },
  get escpos() { return getThermalModule().PrinterTypes.EPSON; },
};

// ---------------------------------------------------------------------------
// Windows raw spooler fallback — sends bytes directly to an installed printer
// without needing the native `printer` module. Used when interface starts
// with 'printer:'.
// ---------------------------------------------------------------------------
function getSpoolerBufferPath() {
  return path.join(os.tmpdir(), 'pos-print-agent-spooler.bin');
}

async function printRawViaSpooler(printerName, buffer) {
  if (!printerName) throw new Error('Missing printer name');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Empty print buffer');
  if (process.platform !== 'win32') {
    throw new Error('Spooler raw print only supported on Windows. Use interface=usb or tcp://host:port instead.');
  }
  const base64 = buffer.toString('base64');
  const script = `
$printerName = "${printerName.replace(/"/g, '""')}"
$data = [System.Convert]::FromBase64String("${base64}")
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFOA di);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static bool SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    var di = new DOCINFOA(){ pDocName="POS Receipt", pDataType="RAW"};
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
    IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
    int written;
    bool ok = WritePrinter(hPrinter, unmanaged, bytes.Length, out written);
    Marshal.FreeCoTaskMem(unmanaged);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok;
  }
}
"@
$ok = [RawPrinterHelper]::SendBytes($printerName, $data)
if (-not $ok) { exit 2 } else { exit 0 }
`;
  await new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Spooler print failed (exit ${code})`));
    });
  });
}

// ---------------------------------------------------------------------------
// printReceipt(payload, config) — the real work
// ---------------------------------------------------------------------------
async function printReceipt(payload, config) {
  if (!payload || !Array.isArray(payload.lines)) throw new Error('Invalid receipt payload');
  if (payload.lines.length === 0) throw new Error('Empty receipt');

  const { ThermalPrinter } = getThermalModule();
  const cfg = { ...config.printer, ...(payload.options || {}) };
  const typeKey = String(cfg.type || 'epson').toLowerCase();
  const printerType = TYPE_MAP_LAZY[typeKey] || TYPE_MAP_LAZY.epson;
  const requestedInterface = String(cfg.interface || '');
  const useSpooler = requestedInterface.toLowerCase().startsWith('printer:');
  const printerName = useSpooler ? requestedInterface.slice('printer:'.length) : null;
  const charsPerLine = Math.max(24, Number(cfg.charsPerLine || 48));
  const interfaceOverride = useSpooler ? getSpoolerBufferPath() : requestedInterface;

  const printer = new ThermalPrinter({
    type: printerType,
    interface: interfaceOverride,
    driver: null,
    width: charsPerLine,
    usbVendorId: cfg.usbVendorId ?? undefined,
    usbProductId: cfg.usbProductId ?? undefined,
    options: { timeout: Number(cfg.timeoutMs || 15000) },
  });

  let currentAlign = 'left';
  let currentBold = false;

  printer.clear();
  try {
    if (typeof printer.initHardware === 'function') printer.initHardware();
    if (typeof printer.append === 'function') {
      printer.append(Buffer.from([0x1b, 0x53]));
      printer.append(Buffer.from([0x12]));
      printer.append(Buffer.from([0x1b, 0x21, 0x00]));
      printer.append(Buffer.from([0x1b, 0x32]));
    }
  } catch { /* noop */ }
  printer.alignLeft();
  if (typeof printer.setTypeFontA === 'function') printer.setTypeFontA();
  if (typeof printer.setTextNormal === 'function') printer.setTextNormal();
  if (typeof printer.setTextSize === 'function') {
    const size = cfg.textSize || { width: 0, height: 0 };
    printer.setTextSize(Number(size?.height ?? 0), Number(size?.width ?? 0));
  }

  for (const line of payload.lines) {
    const align = line.align || 'left';
    if (align !== currentAlign) {
      if (align === 'center') printer.alignCenter();
      else if (align === 'right') printer.alignRight();
      else printer.alignLeft();
      currentAlign = align;
    }
    const bold = Boolean(line.bold);
    if (bold !== currentBold) {
      printer.bold(bold);
      currentBold = bold;
    }
    const text = String(line.text ?? '');
    const clipped = text.length > charsPerLine ? text.slice(0, charsPerLine) : text;
    printer.println(clipped);
  }

  const feedLines = Number(cfg.feedLines ?? 3);
  if (feedLines > 0 && typeof printer.feed === 'function') printer.feed(feedLines);
  if (cfg.cut !== false) printer.cut();

  const buf = printer.getBuffer?.();
  if (useSpooler) {
    await printRawViaSpooler(printerName, buf);
    return { bytes: buf ? buf.length : 0, path: 'spooler', spoolerName: printerName };
  }

  await printer.execute();
  return { bytes: buf ? buf.length : 0, path: requestedInterface.toLowerCase().startsWith('tcp') ? 'tcp' : 'usb' };
}

// ---------------------------------------------------------------------------
// Minimal HTTP layer
// ---------------------------------------------------------------------------
function parseAuth(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const s = String(h);
  if (!s.toLowerCase().startsWith('bearer ')) return null;
  return s.slice('bearer '.length).trim();
}

function corsHeadersFor(req, allowOrigins) {
  const origin = req.headers?.origin ? String(req.headers.origin) : '';
  const list = Array.isArray(allowOrigins) ? allowOrigins.filter(Boolean) : [];
  const allowAll = list.length === 0 || list.includes('*');
  let allowOrigin = '*';
  if (!allowAll) {
    if (origin && list.includes(origin)) allowOrigin = origin;
    else return null;
  }
  const h = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Requested-With, ngrok-skip-browser-warning',
    'Access-Control-Max-Age': '86400',
  };
  // Chrome/Edge: https://app... → http://127.0.0.1 preflight uchun (Private Network Access)
  h['Access-Control-Allow-Private-Network'] = 'true';
  return h;
}

function json(res, status, payload, extraHeaders = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function buildTestReceipt() {
  const now = new Date().toLocaleString();
  return [
    { text: 'POS PRINT AGENT', align: 'center', bold: true },
    { text: '================================', align: 'center' },
    { text: 'Test receipt', align: 'center' },
    { text: `Time: ${now}`, align: 'left' },
    { text: `Host: ${os.hostname()}`, align: 'left' },
    { text: `Node: ${process.version}`, align: 'left' },
    { text: '--------------------------------', align: 'center' },
    { text: 'If you can read this, the agent', align: 'left' },
    { text: 'and the printer are wired', align: 'left' },
    { text: 'correctly.', align: 'left' },
    { text: '', align: 'left' },
    { text: 'SALOM / HELLO', align: 'center', bold: true },
  ];
}

function log(logFile, ...args) {
  const line = `[${new Date().toISOString()}] ` + args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
function startAgent({ config } = {}) {
  const raw = config || loadConfig();
  // Always merge with defaults so callers/tests passing a partial config
  // still get the full shape (e.g. missing `scale` block).
  const cfg = {
    agent: { ...DEFAULT_CONFIG.agent, ...(raw.agent || {}) },
    printer: { ...DEFAULT_CONFIG.printer, ...(raw.printer || {}) },
    scale: { ...DEFAULT_CONFIG.scale, ...(raw.scale || {}) },
  };
  const { bind, port, secret, allowOrigins, logFile } = cfg.agent;

  if (!secret) {
    log(logFile, '[WARN] No agent.secret set — any local process can print. Consider setting one.');
  }
  if (bind !== '127.0.0.1' && bind !== '::1' && bind !== 'localhost') {
    log(logFile, `[WARN] Binding to ${bind} — agent is reachable beyond this PC.`);
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const cors = corsHeadersFor(req, allowOrigins);
    const c = cors || {};

    // Preflight
    if (req.method === 'OPTIONS') {
      if (!cors) return res.writeHead(403).end();
      return res.writeHead(204, c).end();
    }

    try {
      // Public health
      if (req.method === 'GET' && url === '/health') {
        return json(res, 200, {
          ok: true,
          agent: 'pos-print-agent',
          version: AGENT_VERSION,
          platform: process.platform,
          printer: { interface: cfg.printer.interface, type: cfg.printer.type },
          time: new Date().toISOString(),
        }, c);
      }

      // Auth gate for everything else
      if (secret) {
        const token = parseAuth(req);
        if (token !== secret) {
          return json(res, 401, { ok: false, error: { code: 'AUTH_ERROR', message: 'Unauthorized' } }, c);
        }
      }

      if (req.method === 'GET' && url === '/config') {
        return json(res, 200, {
          ok: true,
          data: {
            printer: cfg.printer,
            scale: cfg.scale,
            agent: { ...cfg.agent, secret: secret ? '***' : null },
          },
        }, c);
      }

      if (req.method === 'GET' && url === '/scale/ports') {
        try {
          const { listScalePorts } = require('./lib/scale');
          const ports = await listScalePorts();
          return json(res, 200, { ok: true, data: ports }, c);
        } catch (e) {
          return json(res, 200, {
            ok: false,
            error: { code: 'SCALE_UNAVAILABLE', message: e?.message || String(e) },
          }, c);
        }
      }

      if (req.method === 'GET' && url === '/scale/read') {
        if (!cfg.scale?.enabled) {
          return json(res, 200, {
            ok: false,
            error: { code: 'SCALE_DISABLED', message: 'Scale support is not enabled in config.json (scale.enabled = true).' },
          }, c);
        }
        try {
          const { readScaleOnce } = require('./lib/scale');
          const reading = await readScaleOnce(cfg.scale);
          log(logFile, 'GET /scale/read', reading);
          return json(res, 200, { ok: true, data: reading }, c);
        } catch (e) {
          log(logFile, 'scale read failed:', e?.message || e);
          return json(res, 200, {
            ok: false,
            error: { code: 'SCALE_READ_FAILED', message: e?.message || String(e) },
          }, c);
        }
      }

      if (req.method === 'POST' && url === '/print') {
        const body = await readJson(req);
        log(logFile, 'POST /print', { lineCount: Array.isArray(body?.lines) ? body.lines.length : 0 });
        try {
          const result = await printReceipt(body, cfg);
          return json(res, 200, { ok: true, data: result }, c);
        } catch (e) {
          log(logFile, 'print failed:', e?.message || e);
          return json(res, 200, {
            ok: false,
            error: { code: 'PRINT_FAILED', message: e?.message || String(e), details: e?.stack || null },
          }, c);
        }
      }

      if (req.method === 'POST' && url === '/print/test') {
        const lines = buildTestReceipt();
        try {
          const result = await printReceipt({ lines }, cfg);
          return json(res, 200, { ok: true, data: result }, c);
        } catch (e) {
          return json(res, 200, { ok: false, error: { code: 'PRINT_FAILED', message: e?.message || String(e) } }, c);
        }
      }

      return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }, c);
    } catch (err) {
      log(logFile, 'unhandled:', err?.message || err);
      const corsHdr = corsHeadersFor(req, allowOrigins) || {};
      return json(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: err?.message || String(err) } }, corsHdr);
    }
  });

  server.listen(port, bind, () => {
    log(logFile, `[pos-print-agent] listening on http://${bind}:${port}`);
    log(logFile, `[pos-print-agent] config: ${CONFIG_PATH}`);
    log(logFile, `[pos-print-agent] printer: ${cfg.printer.interface} (${cfg.printer.type})`);
    if (cfg.scale?.enabled) {
      log(logFile, `[pos-print-agent] scale:   ${cfg.scale.port} @ ${cfg.scale.baudRate} (${cfg.scale.protocol})`);
    }
    if (secret) log(logFile, `[pos-print-agent] Authorization: Bearer <secret>  (see config.json)`);
  });

  // Graceful shutdown
  const shutdown = () => {
    log(logFile, 'Shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

// Exported for tests
module.exports = { startAgent, loadConfig, printReceipt, buildTestReceipt, DEFAULT_CONFIG };

if (require.main === module) {
  startAgent();
}
