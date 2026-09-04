/**
 * Mirrors critical parse/format behavior from src/lib/datetime.ts.
 * Run: node --test src/lib/__tests__/datetime.node.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const DEFAULT_TZ = "Asia/Tashkent";

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function parseDbDate(input) {
  if (!input) return new Date(NaN);
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  const s = String(input).trim();
  if (!s) return new Date(NaN);
  if (s.includes("T") && (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s))) {
    return new Date(s);
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
  if (m) {
    return new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}Z`);
  }
  return new Date(s);
}

function formatDateTime(input, opts = {}) {
  const d = parseDbDate(input);
  if (!Number.isFinite(d.getTime())) return "";
  const timeZone = opts.timeZone ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return `${map.day}.${map.month}.${map.year} ${map.hour}:${map.minute}`;
}

test("UTC-naive SQLite stamp displays as Tashkent wall (+5)", () => {
  // 18:09 UTC → 23:09 Asia/Tashkent
  assert.equal(formatDateTime("2026-09-04 18:09:00"), "04.09.2026 23:09");
});

test("ISO Z stamp same wall as UTC-naive equivalent", () => {
  assert.equal(formatDateTime("2026-09-04T18:09:00.000Z"), "04.09.2026 23:09");
  assert.equal(
    formatDateTime("2026-09-04 18:09:00"),
    formatDateTime("2026-09-04T18:09:00Z"),
  );
});

test("epoch ms from ledger resolve formats without second shift", () => {
  // Already-resolved instant (payment un-shifted from legacy local)
  const ms = Date.parse("2026-09-04T18:10:00Z");
  assert.equal(formatDateTime(ms), "04.09.2026 23:10");
});

test("naive-as-UTC without resolve would wrongly show +5 on Tashkent-stored stamp", () => {
  // Documents the bug: legacy local "23:10" must NOT be passed raw to formatDateTime
  assert.equal(formatDateTime("2026-09-04 23:10:00"), "05.09.2026 04:10");
});
