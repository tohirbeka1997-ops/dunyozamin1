const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readConfig, writeConfig } = require('../config/appConfig.cjs');
const { createError, ERROR_CODES } = require('../lib/errors.cjs');

const DEFAULT_CONFIG = {
  type: 'epson',
  interface: 'usb',
  timeoutMs: 15000,
  charsPerLine: 48,
  textSize: { width: 0, height: 0 },
  usbVendorId: null,
  usbProductId: null,
  spoolerName: 'XP-80C',
  preferSpooler: true,
  feedLines: 3,
  cut: true,
  retryCount: 2,
};

const TYPE_MAP = {
  epson: PrinterTypes.EPSON,
  star: PrinterTypes.STAR,
  star_line: PrinterTypes.STAR_LINE,
  escpos: PrinterTypes.EPSON,
};

class PrintService {
  constructor(_db) {
    this._db = _db;
  }

  getPrinterConfig(overrides) {
    const cfg = readConfig();
    const printer = cfg?.printer || {};
    return { ...DEFAULT_CONFIG, ...printer, ...(overrides || {}) };
  }

  resolveCharsPerLine(config) {
    const raw = Number(config.charsPerLine || DEFAULT_CONFIG.charsPerLine);
    if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
    return DEFAULT_CONFIG.charsPerLine;
  }

  resolveUsbIds(config) {
    const iface = String(config.interface || 'usb');
    const useUsb = iface.toLowerCase().startsWith('usb');
    const usbVendorId =
      config.usbVendorId === null || config.usbVendorId === undefined
        ? undefined
        : Number(config.usbVendorId);
    const usbProductId =
      config.usbProductId === null || config.usbProductId === undefined
        ? undefined
        : Number(config.usbProductId);
    const fallbackVendorId = 8137; // XP-80C VID (0x1FC9)
    const fallbackProductId = 8214; // XP-80C PID (0x2016)
    const resolvedVendorId = useUsb && usbVendorId === undefined ? fallbackVendorId : usbVendorId;
    const resolvedProductId =
      useUsb && usbProductId === undefined ? fallbackProductId : usbProductId;
    const usedFallback = useUsb && (usbVendorId === undefined || usbProductId === undefined);
    return {
      useUsb,
      resolvedVendorId,
      resolvedProductId,
      usedFallback,
    };
  }

  getPrinterDriver(iface) {
    if (!iface || !iface.toLowerCase().startsWith('printer:')) return undefined;
    // Windows: chop etish `printRawViaSpooler` (PowerShell) orqali — `printer` native moduli kerak emas
    // va electron-builder `npm rebuild printer` da grunt/ERESOLVE xatolariga olib kelardi.
    return null;
  }

  getSpoolerBufferPath() {
    return path.join(os.tmpdir(), 'pos-spooler-buffer.bin');
  }

  async printRawViaSpooler(printerName, buffer) {
    if (!printerName) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Missing printer name');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Empty print buffer');
    }
    if (process.platform !== 'win32') {
      throw createError(ERROR_CODES.INTERNAL_ERROR, 'Spooler raw print only supported on Windows');
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
        else reject(createError(ERROR_CODES.INTERNAL_ERROR, `Spooler print failed (${code})`));
      });
    });
  }

  createPrinter(config) {
    const typeKey = String(config.type || 'epson').toLowerCase();
    const printerType = TYPE_MAP[typeKey] || PrinterTypes.EPSON;
    const iface = String(config.interface || 'usb');
    const { resolvedVendorId, resolvedProductId } = this.resolveUsbIds(config);
    const driver = config._driver !== undefined ? config._driver : this.getPrinterDriver(iface);
    const interfaceOverride = config._interfaceOverride || iface;
    return new ThermalPrinter({
      type: printerType,
      interface: interfaceOverride,
      driver,
      width: Number(config.charsPerLine || DEFAULT_CONFIG.charsPerLine),
      usbVendorId: resolvedVendorId,
      usbProductId: resolvedProductId,
      options: {
        timeout: Number(config.timeoutMs || DEFAULT_CONFIG.timeoutMs),
      },
    });
  }

  normalizeLine(line, width) {
    const text = line?.text ?? '';
    const normalized = String(text);
    return normalized.length > width ? normalized.slice(0, width) : normalized;
  }

  applyReceiptStart(printer) {
    // Reset to a known-good state (standard mode, no condensed, font A, normal size)
    try {
      if (typeof printer.initHardware === 'function') {
        printer.initHardware(); // ESC @
      }
      if (typeof printer.append === 'function') {
        printer.append(Buffer.from([0x1b, 0x53])); // ESC S (standard mode)
        printer.append(Buffer.from([0x12])); // DC2 (cancel condensed)
        printer.append(Buffer.from([0x1b, 0x21, 0x00])); // ESC ! 0 (normal)
        printer.append(Buffer.from([0x1b, 0x32])); // ESC 2 (default line spacing)
      }
    } catch {
      // ignore raw reset failures
    }
  }

  async printReceipt(payload) {
    if (!payload || !Array.isArray(payload.lines)) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid receipt payload');
    }
    if (payload.lines.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Empty receipt');
    }

    const cfg = this.getPrinterConfig(payload.options);
    const forcedSpoolerName = String(cfg.spoolerName || DEFAULT_CONFIG.spoolerName || 'XP-80C');
    const forcedInterface = `printer:${forcedSpoolerName}`;
    const cfgForcedSpooler = {
      ...cfg,
      preferSpooler: true,
      interface: forcedInterface,
    };
    const charsPerLine = this.resolveCharsPerLine(cfgForcedSpooler);
    const width = Math.max(24, charsPerLine);

    const attemptPrint = async (localCfg, meta) => {
      const requestedInterface = String(localCfg.interface || '');
      const useSpooler = requestedInterface.toLowerCase().startsWith('printer:');
      const printerName = useSpooler ? requestedInterface.slice('printer:'.length) : null;
      const spoolerDriver = this.getPrinterDriver(requestedInterface);
      const usePowerShellSpooler = useSpooler && !spoolerDriver;
      const interfaceOverride = usePowerShellSpooler ? this.getSpoolerBufferPath() : requestedInterface;
      const printer = this.createPrinter({
        ...localCfg,
        charsPerLine,
        _driver: spoolerDriver,
        _interfaceOverride: interfaceOverride,
      });
      const sizeCfg = localCfg.textSize || DEFAULT_CONFIG.textSize;
      const iface = String(requestedInterface || '').toLowerCase();
      const { useUsb, resolvedVendorId, resolvedProductId, usedFallback } =
        this.resolveUsbIds(localCfg);
      console.log('[Print] receipt start', {
        charsPerLine,
        textSize: { width: sizeCfg?.width ?? 0, height: sizeCfg?.height ?? 0 },
        lineCount: payload.lines.length,
        interface: localCfg.interface,
        useSpooler,
        useUsb,
        type: localCfg.type,
        usbVendorId: resolvedVendorId,
        usbProductId: resolvedProductId,
        spoolerMode: useSpooler ? (usePowerShellSpooler ? 'powershell' : 'driver') : undefined,
        path: useSpooler ? 'spooler' : useUsb ? 'usb' : 'direct',
        ...meta,
      });
      let isConnected = null;
      if (!useSpooler && !useUsb) {
        isConnected = await printer.isPrinterConnected();
        if (!isConnected) {
          throw createError(ERROR_CODES.INTERNAL_ERROR, 'Printer is not connected');
        }
      } else if (useUsb) {
        try {
          isConnected = await printer.isPrinterConnected();
        } catch {
          isConnected = null;
        }
      }
      if (useUsb) {
        console.log('[Print] usb connection check', { isConnected });
      }

      let currentAlign = 'left';
      let currentBold = false;

      printer.clear();
      this.applyReceiptStart(printer);
      printer.alignLeft();
      if (typeof printer.setTypeFontA === 'function') {
        printer.setTypeFontA();
      }
      if (typeof printer.setTextNormal === 'function') {
        printer.setTextNormal();
      }
      if (typeof printer.setTextSize === 'function') {
        const size = localCfg.textSize || DEFAULT_CONFIG.textSize;
        const height = Number(size?.height ?? 0);
        const widthSize = Number(size?.width ?? 0);
        printer.setTextSize(height, widthSize);
      }
      if (typeof printer.resetLineSpacing === 'function') {
        printer.resetLineSpacing();
      }

      payload.lines.forEach((line) => {
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
        printer.println(this.normalizeLine(line, width));
      });

      if (localCfg.feedLines && Number(localCfg.feedLines) > 0) {
        const lines = Number(localCfg.feedLines);
        if (typeof printer.feed === 'function') {
          printer.feed(lines);
        } else {
          for (let i = 0; i < lines; i += 1) {
            printer.newLine();
          }
        }
      }
      if (localCfg.cut) {
        printer.cut();
      }

      const buf = printer.getBuffer?.();
      if (useSpooler && usePowerShellSpooler) {
        await this.printRawViaSpooler(printerName, buf);
        console.log('[Print] receipt done', {
          bytes: buf ? buf.length : 0,
          path: 'spooler',
          spoolerMode: 'powershell',
        });
      } else {
        await printer.execute();
        try {
          const bytes = buf ? buf.length : 0;
          console.log('[Print] receipt done', {
            bytes,
            path: useSpooler ? 'spooler' : useUsb ? 'usb' : 'direct',
          });
        } catch {
          console.log('[Print] receipt done', {
            path: useSpooler ? 'spooler' : useUsb ? 'usb' : 'direct',
          });
        }
      }

      if (useUsb && !useSpooler && usedFallback) {
        try {
          writeConfig({
            printer: {
              usbVendorId: resolvedVendorId ?? null,
              usbProductId: resolvedProductId ?? null,
            },
          });
          console.log('[Print] usb ids autosaved', {
            usbVendorId: resolvedVendorId ?? null,
            usbProductId: resolvedProductId ?? null,
          });
        } catch (error) {
          console.warn('[Print] usb ids autosave failed', {
            message: error?.message || String(error),
          });
        }
      }
    };

    const retries = Math.max(0, Number(cfgForcedSpooler.retryCount || 0));
    const preferSpooler = Boolean(cfgForcedSpooler.preferSpooler);
    const spoolerName = String(cfgForcedSpooler.spoolerName || DEFAULT_CONFIG.spoolerName || 'XP-80C');
    const effectiveCfg = preferSpooler
      ? { ...cfgForcedSpooler, interface: `printer:${spoolerName}` }
      : cfgForcedSpooler;
    const iface = String(effectiveCfg.interface || '').toLowerCase();
    const useUsb = iface === 'usb' || iface.startsWith('usb');
    const fallbackCfg = { ...cfgForcedSpooler, interface: `printer:${spoolerName}` };

    let lastError = null;
    const tryUsbFirst = async () => {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          await attemptPrint(effectiveCfg, { attempt, forcedInterface });
          return { success: true };
        } catch (error) {
          lastError = error;
          console.warn('[Print] attempt failed', {
            attempt,
            message: error?.message || String(error),
          });
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            continue;
          }
        }
      }
      throw lastError || createError(ERROR_CODES.INTERNAL_ERROR, 'Unknown print error');
    };

    const trySpooler = async () => {
      console.warn('[Print] trying spooler path', { spoolerName, forcedInterface });
      await attemptPrint(fallbackCfg, { fallbackUsed: true, forcedInterface });
      return { success: true, fallbackUsed: true };
    };

    if (useUsb) {
      // If we still ended up in USB after forcing spooler, log it explicitly
      console.warn('[Print] forced spooler expected, but USB is in use', {
        forcedInterface,
        interface: effectiveCfg.interface,
      });
      try {
        return await tryUsbFirst();
      } catch (error) {
        console.warn('[Print] raw USB failed, trying spooler fallback', { spoolerName });
        return await trySpooler();
      }
    }

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await attemptPrint(effectiveCfg, { attempt });
        return { success: true };
      } catch (error) {
        lastError = error;
        console.warn('[Print] attempt failed', {
          attempt,
          message: error?.message || String(error),
        });
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        throw error;
      }
    }
    throw lastError || createError(ERROR_CODES.INTERNAL_ERROR, 'Unknown print error');
  }
}

module.exports = PrintService;
