/**
 * Date/time helpers
 *
 * Problem this solves:
 * - SQLite often stores timestamps as `YYYY-MM-DD HH:mm:ss` (no timezone).
 * - In our backend we frequently use UTC (`datetime('now')`), but the string has no "Z".
 * - `new Date('2025-12-24 10:00:00')` is interpreted as LOCAL time by JS,
 *   which makes printed receipts show a shifted time (e.g. Uzbekistan is UTC+5).
 *
 * This module:
 * - Parses DB timestamps safely (treats `YYYY-MM-DD HH:mm:ss` as UTC)
 * - Formats to `dd.MM.yyyy HH:mm` in Asia/Tashkent (default for this POS)
 */

export type DbDateInput = Date | string | number | null | undefined;

const DEFAULT_TZ = 'Asia/Tashkent';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parse a DB timestamp into a Date.
 * - ISO strings are parsed normally.
 * - `YYYY-MM-DD HH:mm:ss` (or without seconds) is treated as UTC.
 */
export function parseDbDate(input: DbDateInput): Date {
  if (!input) return new Date(NaN);
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);

  const s = String(input).trim();
  if (!s) return new Date(NaN);

  // If it already looks like ISO with timezone, trust native parsing.
  // Examples: 2025-12-24T10:00:00Z, 2025-12-24T10:00:00+05:00
  if (s.includes('T') && (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s))) {
    return new Date(s);
  }

  // SQLite common format: "YYYY-MM-DD HH:mm:ss" (no timezone).
  // Treat as UTC to avoid timezone shifts on display.
  const sqliteDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/;
  const m = s.match(sqliteDateTime);
  if (m) {
    const datePart = m[1];
    const timePart = `${m[2]}${m[3] ?? ':00'}`;
    const msPart = m[4] ?? '';
    // Construct ISO UTC
    return new Date(`${datePart}T${timePart}${msPart}Z`);
  }

  // Fallback
  return new Date(s);
}

/**
 * Format datetime as `dd.MM.yyyy HH:mm` in a specific timezone.
 */
export function formatDateTime(
  input: DbDateInput,
  opts?: { timeZone?: string; withSeconds?: boolean }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';

  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  const withSeconds = Boolean(opts?.withSeconds);

  // Use formatToParts so output is stable regardless of locale separators.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const dd = map.day ?? pad2(d.getDate());
  const mm = map.month ?? pad2(d.getMonth() + 1);
  const yyyy = map.year ?? String(d.getFullYear());
  const HH = map.hour ?? pad2(d.getHours());
  const MM = map.minute ?? pad2(d.getMinutes());
  const SS = map.second ?? pad2(d.getSeconds());

  return withSeconds
    ? `${dd}.${mm}.${yyyy} ${HH}:${MM}:${SS}`
    : `${dd}.${mm}.${yyyy} ${HH}:${MM}`;
}

/**
 * Convenience alias for receipt datetime.
 */
export function formatReceiptDateTime(input: DbDateInput): string {
  return formatDateTime(input, { timeZone: DEFAULT_TZ });
}

/**
 * Convenience alias for order/payment datetime (keeps seconds like `dd.MM.yyyy HH:mm:ss`)
 */
export function formatOrderDateTime(input: DbDateInput): string {
  return formatDateTime(input, { timeZone: DEFAULT_TZ, withSeconds: true });
}

/**
 * Format date as `YYYY-MM-DD` in a specific timezone (default: Asia/Tashkent).
 * Use this for *day-based* filtering ("bugun/kecha") to avoid UTC/local mismatches.
 */
export function formatDateYMD(
  input: DbDateInput,
  opts?: { timeZone?: string }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';

  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const yyyy = map.year ?? String(d.getFullYear());
  const mm = map.month ?? pad2(d.getMonth() + 1);
  const dd = map.day ?? pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format date as `dd.MM.yyyy` in a specific timezone (default: Asia/Tashkent).
 * Use this for date-only display (lists, tables).
 */
export function formatDate(
  input: DbDateInput,
  opts?: { timeZone?: string }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';

  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const dd = map.day ?? pad2(d.getDate());
  const mm = map.month ?? pad2(d.getMonth() + 1);
  const yyyy = map.year ?? String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Format time as `HH:mm` (or `HH:mm:ss`) in a specific timezone (default: Asia/Tashkent).
 */
export function formatTime(
  input: DbDateInput,
  opts?: { timeZone?: string; withSeconds?: boolean }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';

  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  const withSeconds = Boolean(opts?.withSeconds);

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const HH = map.hour ?? pad2(d.getHours());
  const MM = map.minute ?? pad2(d.getMinutes());
  const SS = map.second ?? pad2(d.getSeconds());

  return withSeconds ? `${HH}:${MM}:${SS}` : `${HH}:${MM}`;
}

/**
 * Format as `MMM dd` (e.g. "dek 24") in a specific timezone (default: Asia/Tashkent).
 * Useful for chart axes.
 */
export function formatMonthDay(
  input: DbDateInput,
  opts?: { timeZone?: string }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';
  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone,
    month: 'short',
    day: '2-digit',
  }).format(d);
}

/**
 * Format as `MMM dd, yyyy` in a specific timezone (default: Asia/Tashkent).
 * Useful for chart tooltips.
 */
export function formatMonthDayYear(
  input: DbDateInput,
  opts?: { timeZone?: string }
): string {
  const d = parseDbDate(input);
  if (!isFinite(d.getTime())) return '';
  const timeZone = opts?.timeZone ?? DEFAULT_TZ;
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Today's date in `YYYY-MM-DD` for Asia/Tashkent.
 */
export function todayYMD(): string {
  return formatDateYMD(new Date(), { timeZone: DEFAULT_TZ });
}


