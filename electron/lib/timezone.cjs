const UZBEKISTAN_TIMEZONE = 'Asia/Tashkent';

// Uzbekistan is on UTC+05:00 year-round (no DST). SQLite's `datetime()`
// modifier does not understand IANA timezones, so reports use this hour
// shift to convert UTC-stored timestamps to local business time. Keep this
// constant aligned with `UZBEKISTAN_TIMEZONE` — if the project ever moves
// to a different region or Uzbekistan reintroduces DST, update both here.
const UZBEKISTAN_TZ_HOURS_OFFSET = 5;
const UZBEKISTAN_TZ_SQLITE_OFFSET = `+${UZBEKISTAN_TZ_HOURS_OFFSET} hours`;
const UZBEKISTAN_TZ_ISO_OFFSET = `+0${UZBEKISTAN_TZ_HOURS_OFFSET}:00`;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getDatePartsInTimeZone(input = new Date(), timeZone = UZBEKISTAN_TIMEZONE) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  if (!map.year || !map.month || !map.day) return null;
  return { year: map.year, month: map.month, day: map.day };
}

function formatYmdInTimeZone(input = new Date(), timeZone = UZBEKISTAN_TIMEZONE) {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const parts = getDatePartsInTimeZone(input, timeZone);
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftYmd(ymd, days) {
  const raw = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return formatYmdInTimeZone(dt);
}

function ymdRangeInclusive(fromYmd, toYmd, maxDays = 62) {
  const from = String(fromYmd || '').slice(0, 10);
  const to = String(toYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  if (from > to) return [];
  const out = [];
  let cur = from;
  for (let i = 0; i < maxDays; i += 1) {
    out.push(cur);
    if (cur >= to) break;
    cur = shiftYmd(cur, 1);
    if (!cur) break;
  }
  return out;
}

/**
 * Parse a DB timestamp to epoch ms for sorting/comparison.
 * Matches frontend `parseDbDate` — SQLite `YYYY-MM-DD HH:mm:ss` is UTC (no Z suffix).
 */
function parseDbTimestamp(input) {
  if (!input) return 0;
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : 0;
  }

  const s = String(input).trim();
  if (!s) return 0;

  if (s.includes('T') && (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s))) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const sqliteDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/;
  const m = s.match(sqliteDateTime);
  if (m) {
    const datePart = m[1];
    const timePart = `${m[2]}${m[3] ?? ':00'}`;
    const msPart = m[4] ?? '';
    const t = new Date(`${datePart}T${timePart}${msPart}Z`).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

function nowSqlInTimeZone(timeZone = UZBEKISTAN_TIMEZONE) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day} ${map.hour || pad2(d.getHours())}:${map.minute || pad2(d.getMinutes())}:${map.second || pad2(d.getSeconds())}`;
}

/**
 * UTC wall-clock as SQLite-friendly `YYYY-MM-DD HH:mm:ss` (no T/Z).
 *
 * Storage convention (customer_ledger / payments / sales / returns):
 * - Write with `nowSqlUtc` (UTC-naive). Do NOT use `nowSqlInTimeZone` for ledger rows.
 * - UI parses naive stamps as UTC, then shows Asia/Tashkent (`formatDateTime`).
 * - Legacy payment rows may still be Tashkent-naive; frontend
 *   `resolveLedgerEventTimes` undoes the double-shift for mixed histories.
 */
function nowSqlUtc(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return nowSqlUtc(new Date());
  }
  return d.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
}

/**
 * Normalize mixed timestamp strings so SQLite `datetime()` does not return NULL.
 * Takes first 19 chars after T→space / Z-strip → `YYYY-MM-DD HH:mm:ss`
 * (drops fractional seconds and trailing `+HH:MM` offsets).
 */
function sqlNormalizeDatetimeExpr(columnSql) {
  const col = String(columnSql || 'created_at');
  return `datetime(substr(replace(replace(${col}, 'T', ' '), 'Z', ''), 1, 19))`;
}

module.exports = {
  UZBEKISTAN_TIMEZONE,
  UZBEKISTAN_TZ_HOURS_OFFSET,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
  UZBEKISTAN_TZ_ISO_OFFSET,
  formatYmdInTimeZone,
  shiftYmd,
  ymdRangeInclusive,
  nowSqlInTimeZone,
  nowSqlUtc,
  sqlNormalizeDatetimeExpr,
  parseDbTimestamp,
};

