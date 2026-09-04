/**
 * Date/time helpers
 *
 * Problem this solves:
 * - SQLite often stores timestamps as `YYYY-MM-DD HH:mm:ss` (no timezone).
 * - Canonical storage for sales/ledger is UTC-naive (`nowSqlUtc` / ISO stripped).
 * - `new Date('2025-12-24 10:00:00')` is interpreted as LOCAL time by JS,
 *   which makes printed receipts show a shifted time (e.g. Uzbekistan is UTC+5).
 *
 * This module:
 * - Parses DB timestamps safely (treats `YYYY-MM-DD HH:mm:ss` as UTC)
 * - Formats to `dd.MM.yyyy HH:mm` in Asia/Tashkent (default for this POS)
 *
 * Customer ledger caveat: legacy payment rows may still be Tashkent-naive.
 * Hisob tarixi uses `resolveLedgerEventTimes` in customerLedgerDisplay.ts
 * so mixed UTC + legacy-local rows do not double-shift (+5h twice).
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

/**
 * Shift a `YYYY-MM-DD` calendar date by N days (local YMD arithmetic; no toISOString).
 */
export function ymdShiftDays(base: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(base || '').trim());
  if (!m) return String(base || '');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // UTC noon calendar math avoids DST edge cases while staying timezone-agnostic on YMD.
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * Shift a `YYYY-MM-DD` calendar date by N months (clamps day to month length).
 */
export function ymdShiftMonths(base: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(base || '').trim());
  if (!m) return String(base || '');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1 + months, 1, 12, 0, 0));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(day)}`;
}

// Uzbekistan is UTC+5 year-round (no DST). Keep this aligned with
// electron/lib/timezone.cjs (UZBEKISTAN_TZ_HOURS_OFFSET).
const UZ_OFFSET_HOURS = 5;

/**
 * Convert a `<input type="datetime-local">` wall-clock string
 * (`YYYY-MM-DDTHH:mm`, optionally with seconds), interpreted as Asia/Tashkent
 * local time, into a canonical UTC ISO string (`...Z`). Returns null for
 * empty/invalid input so callers can store NULL.
 */
export function tashkentLocalToUtcIso(local: string | null | undefined): string | null {
  const m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - UZ_OFFSET_HOURS, Number(mi), s ? Number(s) : 0),
  ).toISOString();
}

/**
 * Inverse of {@link tashkentLocalToUtcIso}: take a stored UTC ISO (or any
 * parseable DB timestamp) and render the Asia/Tashkent wall-clock string
 * (`YYYY-MM-DDTHH:mm`) for binding back into a datetime-local input.
 */
export function utcIsoToTashkentLocal(iso: DbDateInput): string {
  const d = parseDbDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + UZ_OFFSET_HOURS * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
}


