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

module.exports = {
  UZBEKISTAN_TIMEZONE,
  UZBEKISTAN_TZ_HOURS_OFFSET,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
  UZBEKISTAN_TZ_ISO_OFFSET,
  formatYmdInTimeZone,
  nowSqlInTimeZone,
  parseDbTimestamp,
};

