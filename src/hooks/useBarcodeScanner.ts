/**
 * useBarcodeScanner — global HID "keyboard wedge" barcode scanner hook.
 * ----------------------------------------------------------------------------
 * Most USB/Bluetooth POS barcode scanners (Honeywell, Zebra, Datalogic,
 * Netum, etc.) ship in "keyboard wedge" mode: scanning a barcode types
 * the digits at ~1-10 ms per keystroke and then presses Enter.
 *
 * This hook listens to `keydown` events on `document` (window-wide) and:
 *   1) Buffers rapid keystrokes that arrive faster than a human could type.
 *   2) Flushes the buffer when a terminator (Enter/Tab) arrives OR after
 *      a short idle timeout, and calls `onScan(code)`.
 *   3) Ignores keystrokes when a real text input is focused UNLESS the
 *      pattern is clearly a scanner burst — so free typing into search/
 *      textarea is not hijacked.
 *
 * Works in both Electron desktop AND web/SaaS (the browser already receives
 * keyboard events regardless of whether the scanner is plugged into a
 * cashier PC running the Print Agent or not).
 *
 * Usage:
 *   useBarcodeScanner({
 *     onScan: (code) => handleBarcodeSearch(code),
 *     minLength: 4,
 *     // Optional: restrict to a global listener only while a certain
 *     // route / modal is open.
 *     enabled: isPosOpen,
 *   });
 */
import { useEffect, useRef } from 'react';

export type UseBarcodeScannerOptions = {
  /** Called when a complete scan is detected. */
  onScan: (code: string, meta: { durationMs: number; terminator: 'enter' | 'tab' | 'idle' }) => void;
  /** Minimum digits/chars to accept. Default 4. */
  minLength?: number;
  /** Maximum ms between keystrokes for them to count as part of one scan. Default 40 ms. */
  maxIntervalMs?: number;
  /** Idle flush timeout if no terminator is received. Default 60 ms. */
  idleTimeoutMs?: number;
  /** If false, the hook does nothing. Default true. */
  enabled?: boolean;
  /**
   * If a standard input/textarea/contenteditable element is focused,
   *   - 'hijack'      — always steal scanner input (useful when you KNOW
   *                     barcodes should route to a specific handler).
   *   - 'ignore'      — never steal; let the focused field receive keys.
   *   - 'auto' (default) — only hijack if the burst clearly looks like a
   *                     scanner (very fast + ends with Enter/Tab).
   */
  whenInputFocused?: 'hijack' | 'ignore' | 'auto';
  /**
   * Restrict to specific key codes. By default accepts digits, letters and
   * common punctuation used by EAN/UPC/Code128/GS1/QR payloads.
   */
  allowedKey?: (key: string) => boolean;
};

const DEFAULT_ALLOWED = (key: string) => key.length === 1 && /[\x20-\x7E]/.test(key);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useBarcodeScanner(opts: UseBarcodeScannerOptions) {
  const {
    onScan,
    minLength = 4,
    maxIntervalMs = 40,
    idleTimeoutMs = 60,
    enabled = true,
    whenInputFocused = 'auto',
    allowedKey = DEFAULT_ALLOWED,
  } = opts;

  // Keep latest callback/config in refs so we don't re-attach the listener on
  // every parent render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const cfgRef = useRef({ minLength, maxIntervalMs, idleTimeoutMs, whenInputFocused, allowedKey });
  cfgRef.current = { minLength, maxIntervalMs, idleTimeoutMs, whenInputFocused, allowedKey };

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;

    let buffer = '';
    let firstAt = 0;
    let lastAt = 0;
    let idleTimer: number | null = null;

    const flush = (reason: 'enter' | 'tab' | 'idle') => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      const code = buffer;
      buffer = '';
      firstAt = 0;
      lastAt = 0;
      if (code.length < cfgRef.current.minLength) return;
      // Ensure it's clearly a burst and not slow typing.
      // durationMs is total time from first to last char.
      const durationMs = lastAt - firstAt;
      // Average per-char interval heuristic:
      const avg = code.length > 1 ? durationMs / (code.length - 1) : 0;
      if (reason === 'idle' && avg > cfgRef.current.maxIntervalMs) return; // looked like slow typing
      try {
        onScanRef.current(code, { durationMs, terminator: reason });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useBarcodeScanner] onScan threw', err);
      }
    };

    const scheduleIdleFlush = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => flush('idle'), cfgRef.current.idleTimeoutMs);
    };

    const handler = (e: KeyboardEvent) => {
      // Terminators first — they always flush whatever we've got.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length >= cfgRef.current.minLength) {
          const focused = isEditableTarget(e.target);
          const mode = cfgRef.current.whenInputFocused;
          const looksLikeBurst =
            buffer.length >= cfgRef.current.minLength &&
            (lastAt - firstAt) < (buffer.length * 25); // < 25ms avg = clearly machine
          const shouldHijack =
            mode === 'hijack' ||
            (mode === 'auto' && (!focused || looksLikeBurst)) ||
            (mode === 'ignore' && !focused);
          if (shouldHijack) {
            e.preventDefault();
            e.stopPropagation();
            flush(e.key === 'Enter' ? 'enter' : 'tab');
            return;
          }
          // Not our burst — let the focused input handle Enter/Tab normally,
          // but drop the accumulated buffer because it never made it to the UI.
          buffer = '';
          firstAt = 0;
          lastAt = 0;
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!cfgRef.current.allowedKey(e.key)) {
        // Non-printable key — ignore but keep the buffer; many scanners end
        // with Enter only.
        return;
      }

      const now = performance.now();
      if (buffer.length === 0) {
        firstAt = now;
      } else {
        const gap = now - lastAt;
        if (gap > cfgRef.current.maxIntervalMs) {
          // Too slow — restart the burst from this character.
          buffer = '';
          firstAt = now;
        }
      }
      buffer += e.key;
      lastAt = now;

      // If focused in an input and we already have a solid burst going,
      // keep silently collecting; we'll decide at the terminator whether
      // to hijack.
      scheduleIdleFlush();
    };

    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, [enabled]);
}

// ----------------------------------------------------------------------------
// Pure utility for unit tests — simulate a scanner burst and return the
// detected code (or null).
// ----------------------------------------------------------------------------
export type SimulatedKey = { key: string; t: number };

export function detectScan(
  keys: SimulatedKey[],
  opts: { minLength?: number; maxIntervalMs?: number } = {}
): { code: string; terminator: 'enter' | 'tab' | 'idle' } | null {
  const minLength = opts.minLength ?? 4;
  const maxIntervalMs = opts.maxIntervalMs ?? 40;
  let buffer = '';
  let firstAt = 0;
  let lastAt = 0;
  for (const k of keys) {
    if (k.key === 'Enter' || k.key === 'Tab') {
      if (buffer.length >= minLength) {
        return { code: buffer, terminator: k.key === 'Enter' ? 'enter' : 'tab' };
      }
      buffer = '';
      firstAt = 0;
      lastAt = 0;
      continue;
    }
    if (k.key.length !== 1) continue;
    if (buffer.length === 0) {
      firstAt = k.t;
    } else if (k.t - lastAt > maxIntervalMs) {
      buffer = '';
      firstAt = k.t;
    }
    buffer += k.key;
    lastAt = k.t;
  }
  if (buffer.length >= minLength) {
    const durationMs = lastAt - firstAt;
    const avg = buffer.length > 1 ? durationMs / (buffer.length - 1) : 0;
    if (avg <= maxIntervalMs) return { code: buffer, terminator: 'idle' };
  }
  return null;
}
