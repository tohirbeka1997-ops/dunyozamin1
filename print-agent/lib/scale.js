/**
 * Scale (electronic scale / tarozi) bridge for pos-print-agent.
 * ----------------------------------------------------------------------------
 * Supports the most common retail-scale serial protocols used with cheap
 * USB-serial ("USB-COM") electronic scales:
 *
 *   - 'cas'        CAS-PD, ACLAS, AND and many CAS-compatible scales.
 *                  The scale continuously streams ASCII frames terminated
 *                  by CR+LF. Weight appears as a decimal number.
 *
 *   - 'generic'    Generic ASCII scale. Agent sends "W\r" every poll and
 *                  parses the first decimal number out of the response.
 *
 *   - 'poll-ack'   Command-based scales (e.g. Mettler Toledo, Avery): send
 *                  "S\r\n" and parse response like "S S     123.45 kg".
 *
 * The serialport library (`serialport` npm package) is **lazy-loaded** —
 * installations that never use a scale don't pay the native-build cost.
 *
 * All public methods return promises that resolve to a `ScaleReading`:
 *   { weight: 1.234, unit: 'kg', stable: true, raw: '  1.234 kg', ts: 169... }
 */

'use strict';

let _serialport = null;
function getSerialPort() {
  if (_serialport) return _serialport;
  try {
    _serialport = require('serialport');
  } catch (err) {
    const msg = 'serialport is not installed. Run `npm install serialport` inside print-agent/ to enable scale support.';
    const e = new Error(msg);
    e.cause = err;
    throw e;
  }
  return _serialport;
}

const DEFAULT_PROTOCOL = 'cas';
const DEFAULT_BAUD = 9600;
const DEFAULT_READ_TIMEOUT = 2500;

/**
 * Tries several patterns to extract weight + unit from an ASCII line.
 * Returns null if nothing usable.
 */
function parseAsciiLine(rawLine) {
  if (rawLine === null || rawLine === undefined) return null;
  const line = String(rawLine).replace(/[\x00-\x1F]+/g, ' ').trim();
  if (!line) return null;

  // Stability indicator. Many scales send 'S' (stable) or 'US' (unstable),
  // or prefix the reading with 'ST' / 'US' / '?' (overload).
  const upper = line.toUpperCase();
  let stable = true;
  if (/^US|^U |\bUS\b|\bUNSTABLE\b/.test(upper)) stable = false;

  // Grab the first signed/unsigned decimal number in the line.
  const numMatch = line.match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) return null;
  const weight = Number(numMatch[0]);
  if (!Number.isFinite(weight)) return null;

  // Try to find the unit after the number.
  let unit = 'kg';
  const unitMatch = line.match(/(kg|g|lb|oz)\b/i);
  if (unitMatch) unit = unitMatch[1].toLowerCase();

  return { weight, unit, stable, raw: line, ts: Date.now() };
}

/**
 * Read a single weight from the scale.
 *
 * @param {Object} config agent config.scale — { port, baudRate, protocol, timeoutMs, minStableMs, unit, divisor }
 * @returns {Promise<{weight:number, unit:string, stable:boolean, raw:string, ts:number}>}
 */
async function readScaleOnce(config) {
  const { SerialPort } = getSerialPort();
  const port = String(config.port || '').trim();
  if (!port) throw new Error('scale.port is not configured');

  const baudRate = Number(config.baudRate || DEFAULT_BAUD);
  const timeoutMs = Math.max(500, Number(config.timeoutMs || DEFAULT_READ_TIMEOUT));
  const protocol = String(config.protocol || DEFAULT_PROTOCOL).toLowerCase();
  const minStableMs = Math.max(0, Number(config.minStableMs || 0));
  const unitOverride = config.unit ? String(config.unit).toLowerCase() : null;
  const divisor = Number.isFinite(Number(config.divisor)) ? Number(config.divisor) : null;

  return await new Promise((resolve, reject) => {
    let finished = false;
    let buf = '';
    let lastStableReading = null;
    let stableSince = 0;

    const sp = new SerialPort({
      path: port,
      baudRate,
      dataBits: Number(config.dataBits || 8),
      stopBits: Number(config.stopBits || 1),
      parity: String(config.parity || 'none'),
      autoOpen: false,
    });

    const settle = (err, reading) => {
      if (finished) return;
      finished = true;
      try { sp.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(reading);
    };

    const timeoutTimer = setTimeout(() => settle(new Error(`Scale read timeout (${timeoutMs} ms) on ${port}`)), timeoutMs);

    const handleLine = (line) => {
      const reading = parseAsciiLine(line);
      if (!reading) return;
      if (unitOverride) reading.unit = unitOverride;
      if (divisor && divisor !== 0) reading.weight = reading.weight / divisor;

      if (!reading.stable) {
        stableSince = 0;
        lastStableReading = null;
        return;
      }
      const now = Date.now();
      if (stableSince === 0) {
        stableSince = now;
        lastStableReading = reading;
        if (minStableMs === 0) {
          clearTimeout(timeoutTimer);
          settle(null, reading);
        }
        return;
      }
      lastStableReading = reading;
      if (now - stableSince >= minStableMs) {
        clearTimeout(timeoutTimer);
        settle(null, reading);
      }
    };

    sp.on('error', (err) => {
      clearTimeout(timeoutTimer);
      settle(err);
    });

    sp.on('data', (chunk) => {
      buf += chunk.toString('ascii');
      // Split on CR/LF but keep partial line at the end.
      const parts = buf.split(/\r\n|\r|\n/);
      buf = parts.pop() || '';
      for (const part of parts) handleLine(part);
      // Some scales never send line breaks — flush occasionally.
      if (buf.length > 128) {
        handleLine(buf);
        buf = '';
      }
    });

    sp.open((err) => {
      if (err) {
        clearTimeout(timeoutTimer);
        settle(new Error(`Failed to open ${port}: ${err.message || err}`));
        return;
      }

      if (protocol === 'generic' || protocol === 'poll-ack') {
        const cmd = protocol === 'poll-ack' ? 'S\r\n' : 'W\r';
        try {
          sp.write(Buffer.from(cmd, 'ascii'));
        } catch (e) {
          clearTimeout(timeoutTimer);
          settle(new Error(`Failed to write poll command: ${e.message || e}`));
        }
      }
      // 'cas' (default) just listens.

      // Fallback: if the scale dribbles out readings but never a definitively
      // stable one, return the last value after 80% of the timeout budget.
      setTimeout(() => {
        if (!finished && lastStableReading) {
          clearTimeout(timeoutTimer);
          settle(null, lastStableReading);
        }
      }, Math.max(500, Math.floor(timeoutMs * 0.8)));
    });
  });
}

/**
 * Return the list of serial ports available on this machine. Handy for
 * configuring the agent without guessing COM numbers.
 */
async function listScalePorts() {
  const { SerialPort } = getSerialPort();
  const raw = await SerialPort.list();
  return raw.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || null,
    pnpId: p.pnpId || null,
    serialNumber: p.serialNumber || null,
    vendorId: p.vendorId || null,
    productId: p.productId || null,
    friendlyName: p.friendlyName || null,
  }));
}

module.exports = { readScaleOnce, listScalePorts, parseAsciiLine };
