/**
 * Mirrors src/lib/customerLedgerDisplay.ts (plain node, no TS loader).
 * Cashier signed: + owes, − prepaid. Run:
 *   node --test src/lib/__tests__/customerLedgerDisplay.node.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toCashierSigned(legacyNet) {
  return roundMoney(-(Number(legacyNet) || 0));
}

function cashierSignedFromBuckets(debt, advance) {
  return roundMoney((Number(debt) || 0) - (Number(advance) || 0));
}

function ledgerSnapshotAfter(entry) {
  if (entry.debt_after != null || entry.advance_after != null) {
    const debt = Math.max(0, Number(entry.debt_after || 0) || 0);
    const advance = Math.max(0, Number(entry.advance_after || 0) || 0);
    const net = roundMoney(advance - debt);
    return {
      debt: roundMoney(debt),
      advance: roundMoney(advance),
      net,
      signed: cashierSignedFromBuckets(debt, advance),
      source: "audit",
    };
  }
  const bal = Number(entry.balance_after || 0) || 0;
  const net = roundMoney(bal);
  return {
    debt: roundMoney(Math.max(0, -bal)),
    advance: roundMoney(Math.max(0, bal)),
    net,
    signed: toCashierSigned(net),
    source: "balance_after",
  };
}

function formatCashierSigned(signed, formatAbs) {
  const n = Number(signed) || 0;
  if (Math.abs(n) <= 0.001) return formatAbs(0);
  const body = formatAbs(Math.abs(n));
  return n > 0 ? `+${body}` : `−${body}`;
}

function formatLedgerQoldiPlain(snap) {
  const n = Number(snap.signed) || 0;
  if (Math.abs(n) <= 0.001) return "0";
  return n > 0 ? `+${n}` : `-${Math.abs(n)}`;
}

function ledgerLastMatchesPosition(lastEntry, position, eps = 0.02) {
  if (!lastEntry) return true;
  const snap = ledgerSnapshotAfter(lastEntry);
  const posSigned =
    position.debt != null || position.advance != null
      ? cashierSignedFromBuckets(Number(position.debt) || 0, Number(position.advance) || 0)
      : toCashierSigned(Number(position.net) || 0);
  return Math.abs(snap.signed - posSigned) <= eps;
}

function ledgerEventTimeMsUtc(createdAt) {
  if (createdAt == null || createdAt === "") return 0;
  if (createdAt instanceof Date) {
    const t = createdAt.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof createdAt === "number") {
    return Number.isFinite(createdAt) ? createdAt : 0;
  }
  const s = String(createdAt).trim();
  if (!s) return 0;
  if (s.includes("T") && (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s))) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
  if (m) {
    const t = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}Z`).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

const LEDGER_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const FUTURE_GRACE_MS = 15 * 60 * 1000;
const PEER_CLOSER_MS = 2 * 60 * 60 * 1000;
const PEER_OFFSET_GAP_MS = 3 * 60 * 60 * 1000;

function isLedgerUtcAnchorType(type, opCode) {
  const t = String(type || "").toLowerCase();
  const c = String(opCode || "").toUpperCase();
  if (t === "sale" || t === "refund") return true;
  return (
    c === "CREDIT_SALE" ||
    c === "SALE_ON_CREDIT" ||
    c === "SALE_PAYMENT" ||
    c === "SALE_RETURN"
  );
}

function minDist(target, peers) {
  if (!peers.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const p of peers) {
    const d = Math.abs(p - target);
    if (d < best) best = d;
  }
  return best;
}

function ledgerEventTimeMs(createdAt, opts = {}) {
  if (createdAt == null || createdAt === "") return 0;
  if (createdAt instanceof Date || typeof createdAt === "number") {
    return ledgerEventTimeMsUtc(createdAt);
  }
  const s = String(createdAt).trim();
  if (!s) return 0;
  if (s.includes("T") && (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s))) {
    return ledgerEventTimeMsUtc(s);
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
  if (!m) return ledgerEventTimeMsUtc(s);
  const asUtc = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}Z`).getTime();
  if (!Number.isFinite(asUtc)) return 0;
  const asLocal = asUtc - LEDGER_TZ_OFFSET_MS;
  if (opts.forceLocal) return asLocal;
  const anchors = opts.utcAnchorMs || [];
  if (anchors.length) {
    const dUtc = minDist(asUtc, anchors);
    const dLocal = minDist(asLocal, anchors);
    if (dLocal + PEER_CLOSER_MS < dUtc && dUtc - dLocal >= PEER_OFFSET_GAP_MS) {
      return asLocal;
    }
  }
  const nowMs = opts.nowMs ?? Date.now();
  if (asUtc > nowMs + FUTURE_GRACE_MS && asLocal <= nowMs + FUTURE_GRACE_MS) {
    return asLocal;
  }
  return asUtc;
}

function resolveLedgerEventTimes(entries, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const anchorMs = [];
  for (const e of entries) {
    if (!isLedgerUtcAnchorType(e.type, e.op_code)) continue;
    const t = ledgerEventTimeMsUtc(e.created_at);
    if (t > 0) anchorMs.push(t);
  }
  const out = new Map();
  entries.forEach((e, index) => {
    const key = String(e.id || `idx:${index}`);
    const isAnchor = isLedgerUtcAnchorType(e.type, e.op_code);
    const ms = isAnchor
      ? ledgerEventTimeMsUtc(e.created_at)
      : ledgerEventTimeMs(e.created_at, { nowMs, utcAnchorMs: anchorMs });
    out.set(key, ms);
  });
  return out;
}

function compareLedgerEntries(a, b, direction = "asc", timeMsById) {
  const msA = timeMsById?.get(String(a.id || "")) ?? ledgerEventTimeMs(a.created_at);
  const msB = timeMsById?.get(String(b.id || "")) ?? ledgerEventTimeMs(b.created_at);
  const d = msA - msB;
  if (d !== 0) return direction === "asc" ? d : -d;
  const idA = String(a.id || "");
  const idB = String(b.id || "");
  if (idA === idB) return 0;
  const idCmp = idA < idB ? -1 : 1;
  return direction === "asc" ? idCmp : -idCmp;
}

function sortLedgerEntries(entries, direction = "asc") {
  const timeMsById = resolveLedgerEventTimes(entries);
  return [...entries].sort((a, b) => compareLedgerEntries(a, b, direction, timeMsById));
}

function parseMoneyToken(raw) {
  const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && Math.abs(parsed) > 0.009 ? Math.abs(parsed) : 0;
}

function parsePaidFromLedgerNote(note) {
  const text = String(note || "");
  if (!text) return 0;
  const patterns = [
    /To['\u2018\u2019`]liq to['\u2018\u2019`]langan[:\s]*([\d\s.,]+)/i,
    /to['\u2018\u2019`]lov[:\s]*([\d\s.,]+)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const n = parseMoneyToken(match[1]);
    if (n > 0.009) return n;
  }
  return 0;
}

const MONEY_IN_OP_CODES = new Set([
  "ADVANCE_RECEIVED",
  "DEBT_PAYMENT_RECEIVED",
  "CUSTOMER_PAYMENT",
  "CUSTOMER_LOAN_REPAID",
  "SALE_PAYMENT",
]);
const MONEY_OUT_OP_CODES = new Set([
  "CUSTOMER_LOAN_ISSUED",
  "ADVANCE_REFUND",
  "ADVANCE_REFUNDED",
]);
const DEBT_ONLY_OP_CODES = new Set(["CREDIT_SALE", "SALE_ON_CREDIT"]);
const SALE_OP_CODES = new Set(["CREDIT_SALE", "SALE_ON_CREDIT", "SALE_PAYMENT"]);

function ledgerDisplayAmount(entry, orderAmountsById) {
  const raw = Math.abs(Number(entry.amount || 0) || 0);
  if (raw > 0.009) return raw;
  const fromNote = parsePaidFromLedgerNote(entry.note);
  if (fromNote > 0.009) return fromNote;
  return 0;
}

function saleCheckoutPaidAmount(entry, orderAmountsById) {
  const code = String(entry.op_code || "").toUpperCase();
  const type = String(entry.type || "");
  const saleLike = type === "sale" || SALE_OP_CODES.has(code);
  if (!saleLike) return 0;

  const fromNote = parsePaidFromLedgerNote(entry.note);
  if (fromNote > 0.009) return roundMoney(fromNote);

  const signed = Number(entry.amount || 0) || 0;
  if (code === "SALE_PAYMENT" || (type === "sale" && signed > 0.009)) {
    return roundMoney(Math.abs(signed));
  }

  if (entry.ref_id && orderAmountsById?.has(entry.ref_id)) {
    const paid = Math.max(0, Number(orderAmountsById.get(entry.ref_id)?.paid || 0) || 0);
    if (paid > 0.009) return roundMoney(paid);
  }
  const fromOrderJoin = Math.max(0, Number(entry.order_paid_amount || 0) || 0);
  if (fromOrderJoin > 0.009) return roundMoney(fromOrderJoin);
  return 0;
}

function ledgerCashFlow(entry, orderAmountsById) {
  const code = String(entry.op_code || "").toUpperCase();
  const type = String(entry.type || "");
  const signed = Number(entry.amount || 0) || 0;
  const total = ledgerDisplayAmount(entry, orderAmountsById);
  const saleLike = type === "sale" || SALE_OP_CODES.has(code);
  const checkoutPaid = saleLike ? saleCheckoutPaidAmount(entry, orderAmountsById) : 0;
  const pureCreditSale =
    saleLike &&
    code !== "SALE_PAYMENT" &&
    checkoutPaid <= 0.009 &&
    (DEBT_ONLY_OP_CODES.has(code) || (type === "sale" && signed < -0.009));

  if (pureCreditSale) {
    return { received: 0, given: 0, total, debtOnly: true };
  }
  if (saleLike && code !== "SALE_RETURN") {
    const jamiMatch = String(entry.note || "").match(/Jami[:\s]*([\d\s.,]+)/i);
    const jami = jamiMatch ? parseMoneyToken(jamiMatch[1]) : 0;
    const summa = Math.max(total, jami, checkoutPaid, Math.abs(signed));
    if (checkoutPaid > 0.009) {
      return { received: checkoutPaid, given: 0, total: summa, debtOnly: false };
    }
    if (code === "SALE_PAYMENT" || (type === "sale" && signed > 0.009)) {
      const paid = Math.abs(signed) > 0.009 ? Math.abs(signed) : summa;
      return { received: paid, given: 0, total: summa || paid, debtOnly: false };
    }
  }
  if (MONEY_IN_OP_CODES.has(code) || type === "payment_in") {
    return { received: total, given: 0, total, debtOnly: false };
  }
  if (MONEY_OUT_OP_CODES.has(code) || type === "payment_out") {
    return { received: 0, given: total, total, debtOnly: false };
  }
  return { received: 0, given: 0, total, debtOnly: false };
}

function saleUnpaidRemainder(entry, flow, orderAmountsById) {
  const signed = Number(entry.amount || 0) || 0;
  const jamiMatch = String(entry.note || "").match(/Jami[:\s]*([\d\s.,]+)/i);
  const jami = jamiMatch ? parseMoneyToken(jamiMatch[1]) : 0;
  const orderTotal = Math.max(
    0,
    Number(entry.order_total_amount || 0) || 0,
    entry.ref_id && orderAmountsById?.has(entry.ref_id)
      ? Number(orderAmountsById.get(entry.ref_id)?.total || 0) || 0
      : 0,
  );
  const received = Number(flow.received || 0) || 0;
  const knownJami = Math.max(jami, orderTotal);
  if (signed < -0.009) {
    if (knownJami > 0.009) return roundMoney(Math.max(0, knownJami - received));
    return roundMoney(-signed);
  }
  const saleTotal = Math.max(knownJami, flow.total);
  return roundMoney(Math.max(0, saleTotal - received));
}

function ledgerCashierDelta(entry, orderAmountsById) {
  const code = String(entry.op_code || "").toUpperCase();
  const type = String(entry.type || "");
  const signed = Number(entry.amount || 0) || 0;
  const flow = ledgerCashFlow(entry, orderAmountsById);

  if (code === "ADVANCE_APPLIED_TO_ORDER" || (type === "adjustment" && Math.abs(signed) < 0.009)) {
    return 0;
  }

  const saleLike = type === "sale" || SALE_OP_CODES.has(code);
  if (saleLike && code !== "SALE_RETURN") {
    return saleUnpaidRemainder(entry, flow, orderAmountsById);
  }

  if (type === "refund" || code === "SALE_RETURN") {
    const mag = flow.given > 0.009 ? flow.given : flow.total > 0.009 ? flow.total : Math.abs(signed);
    return roundMoney(-mag);
  }

  if (MONEY_IN_OP_CODES.has(code) || type === "payment_in") {
    const mag =
      flow.received > 0.009 ? flow.received : flow.total > 0.009 ? flow.total : Math.abs(signed);
    return roundMoney(-mag);
  }

  if (MONEY_OUT_OP_CODES.has(code) || type === "payment_out") {
    const mag = flow.given > 0.009 ? flow.given : flow.total > 0.009 ? flow.total : Math.abs(signed);
    return roundMoney(mag);
  }

  return roundMoney(-signed);
}

function walkLedgerRunningSigned(entries, orderAmountsById) {
  const chrono = sortLedgerEntries(entries, "asc");
  const out = new Map();
  let signed = 0;
  chrono.forEach((entry, index) => {
    signed = roundMoney(signed + ledgerCashierDelta(entry, orderAmountsById));
    out.set(String(entry.id || `idx:${index}`), signed);
  });
  return out;
}

function runningSignedMatchesPosition(runningSigned, position, eps = 0.02) {
  if (runningSigned == null || !Number.isFinite(Number(runningSigned))) return true;
  const posSigned =
    position.debt != null || position.advance != null
      ? cashierSignedFromBuckets(Number(position.debt) || 0, Number(position.advance) || 0)
      : toCashierSigned(Number(position.net) || 0);
  return Math.abs(Number(runningSigned) - posSigned) <= eps;
}

test("sale 500 → cashier signed +500", () => {
  const snap = ledgerSnapshotAfter({ debt_after: 500, advance_after: 0 });
  assert.equal(snap.signed, 500);
  assert.equal(formatLedgerQoldiPlain(snap), "+500");
  assert.equal(formatCashierSigned(snap.signed, (a) => String(a)), "+500");
});

test("pay 200 after 500 → +300", () => {
  const afterPay = ledgerSnapshotAfter({ debt_after: 300, advance_after: 0 });
  assert.equal(afterPay.signed, 300);
  assert.equal(formatLedgerQoldiPlain(afterPay), "+300");
  assert.ok(
    ledgerLastMatchesPosition(
      { debt_after: 300, advance_after: 0 },
      { debt: 300, advance: 0, net: -300 },
    ),
  );
});

test("overpay → negative signed (ortiqcha), never Avans label", () => {
  const snap = ledgerSnapshotAfter({ debt_after: 0, advance_after: 100 });
  assert.equal(snap.signed, -100);
  assert.equal(formatLedgerQoldiPlain(snap), "-100");
  const plain = formatCashierSigned(snap.signed, (a) => String(a));
  assert.equal(plain, "−100");
  assert.ok(!/avans/i.test(plain));
});

test("coexisting debt+advance nets to one signed Qoldi", () => {
  const snap = ledgerSnapshotAfter({ debt_after: 100000, advance_after: 25000 });
  assert.equal(snap.signed, 75000);
  assert.equal(formatLedgerQoldiPlain(snap), "+75000");
});

test("legacy balance_after negative = debt → +signed", () => {
  const snap = ledgerSnapshotAfter({ balance_after: -377000 });
  assert.equal(snap.signed, 377000);
  assert.equal(toCashierSigned(-377000), 377000);
});

test("Hozir match uses signed, not dual Avans", () => {
  assert.equal(
    ledgerLastMatchesPosition({ debt_after: 377000, advance_after: 0 }, { net: -377000 }),
    true,
  );
  assert.equal(
    ledgerLastMatchesPosition({ balance_after: -195000 }, { net: -377000 }),
    false,
  );
});

test("mixed timeline sorts ascending by canonical time + id", () => {
  const rows = [
    { id: "c", created_at: "2026-08-28 08:25:00" },
    { id: "a", created_at: "2026-08-27T21:13:00.000Z" },
    { id: "d", created_at: "2026-08-28 07:28:00" },
    { id: "b", created_at: "2026-08-28 07:28:00" },
  ];
  const sorted = sortLedgerEntries(rows, "asc");
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["a", "b", "d", "c"],
  );
  const times = sorted.map((r) => ledgerEventTimeMs(r.created_at));
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] >= times[i - 1], `time order at ${i}`);
  }
});

test("UTC sale + legacy Tashkent payment ~1–2 min apart (no double-shift)", () => {
  // Sale written UTC-naive 18:09 → wall 23:09 Tashkent
  // Payment written legacy Tashkent-naive 23:10 (same wall minute+1)
  const rows = [
    {
      id: "sale1",
      type: "sale",
      op_code: "CREDIT_SALE",
      created_at: "2026-09-04 18:09:00",
    },
    {
      id: "pay1",
      type: "payment_in",
      op_code: "DEBT_PAYMENT_RECEIVED",
      created_at: "2026-09-04 23:10:00",
    },
    {
      id: "pay2",
      type: "payment_in",
      op_code: "DEBT_PAYMENT_RECEIVED",
      created_at: "2026-09-04 23:11:30",
    },
  ];
  const times = resolveLedgerEventTimes(rows);
  const saleMs = times.get("sale1");
  const pay1Ms = times.get("pay1");
  const pay2Ms = times.get("pay2");
  assert.ok(Math.abs(pay1Ms - saleMs) <= 2 * 60 * 1000, "pay1 within 2 min of sale");
  assert.ok(Math.abs(pay2Ms - pay1Ms) <= 2 * 60 * 1000, "pay2 within 2 min of pay1");
  const sorted = sortLedgerEntries(rows, "asc");
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["sale1", "pay1", "pay2"],
  );
});

test("naive stamp far in future vs now treated as Tashkent-local", () => {
  // now = 2026-09-04 18:19 UTC (= 23:19 Tashkent)
  const nowMs = Date.parse("2026-09-04T18:19:00Z");
  // Legacy local write of wall 23:10 stored as naive "23:10"
  const ms = ledgerEventTimeMs("2026-09-04 23:10:00", { nowMs });
  assert.equal(ms, Date.parse("2026-09-04T18:10:00Z"));
});

test("new UTC-naive payment near UTC sale stays UTC (no false local)", () => {
  const rows = [
    {
      id: "sale1",
      type: "sale",
      op_code: "CREDIT_SALE",
      created_at: "2026-09-04 18:09:00",
    },
    {
      id: "pay1",
      type: "payment_in",
      op_code: "DEBT_PAYMENT_RECEIVED",
      created_at: "2026-09-04 18:10:00",
    },
  ];
  const times = resolveLedgerEventTimes(rows, {
    nowMs: Date.parse("2026-09-04T18:20:00Z"),
  });
  assert.equal(times.get("pay1"), Date.parse("2026-09-04T18:10:00Z"));
  assert.ok(Math.abs(times.get("pay1") - times.get("sale1")) <= 2 * 60 * 1000);
});

test("sale with paid 200 shows Kirim 200", () => {
  const mixed = ledgerCashFlow({
    type: "sale",
    op_code: "CREDIT_SALE",
    amount: -300,
    note: "Sotuv: ORD-1 (Jami 500 UZS; to‘lov 200; nasiya 300; avans 0; chegirma 0)",
  });
  assert.equal(mixed.received, 200);
  assert.equal(mixed.total, 500);
  assert.equal(mixed.debtOnly, false);

  const paidSale = ledgerCashFlow({
    type: "sale",
    op_code: "SALE_PAYMENT",
    amount: 200,
    note: "Sotuv: ORD-2 (Jami 200 UZS; to‘lov 200; usul: Naqd 200; chegirma 0; avans 0)",
  });
  assert.equal(paidSale.received, 200);
  assert.ok(paidSale.total >= 200);

  const pureNasiya = ledgerCashFlow({
    type: "sale",
    op_code: "CREDIT_SALE",
    amount: -3000,
    note: "Sotuv: ORD-3 (Jami 3000 UZS; to‘lov 0; nasiya 3000; avans 0; chegirma 0)",
  });
  assert.equal(pureNasiya.received, 0);
  assert.equal(pureNasiya.debtOnly, true);
  assert.equal(pureNasiya.total, 3000);
});

test("Nasiya 950k Olindi 600k → Qoldi +350k (ignores debt_after 1248000)", () => {
  // Screenshot 07.09.2026 11:21: stored debt_after mixed other open AR (898k + 350k).
  const nasiya = {
    id: "nasiya-1121",
    type: "sale",
    op_code: "CREDIT_SALE",
    amount: -350000,
    debt_after: 1248000,
    advance_after: 0,
    note: "Sotuv: ORD-1788702097836 (Jami 950000 so'm; to‘lov 600000; nasiya 350000; avans 0; chegirma 0)",
    created_at: "2026-09-07 06:21:00",
  };
  assert.equal(ledgerCashierDelta(nasiya), 350000);
  const running = walkLedgerRunningSigned([nasiya]);
  assert.equal(running.get("nasiya-1121"), 350000);
  assert.equal(formatLedgerQoldiPlain({ signed: running.get("nasiya-1121") }), "+350000");
});

test("after Nasiya +350k, To'lov 898k walks to −548k; Hozir +350k stays the live truth", () => {
  // 898k closed a hidden open order that displayed Qoldi never showed (prev row was 0).
  // Display walk: 350000 − 898000 = −548000 (ortiqcha). Live customers.debt_uzs stays +350000.
  const rows = [
    {
      id: "nasiya-1121",
      type: "sale",
      op_code: "CREDIT_SALE",
      amount: -350000,
      debt_after: 1248000,
      note: "Sotuv: ORD-1 (Jami 950000 so'm; to‘lov 600000; nasiya 350000; avans 0; chegirma 0)",
      created_at: "2026-09-07 06:21:00",
    },
    {
      id: "pay-1124",
      type: "payment_in",
      op_code: "DEBT_PAYMENT_RECEIVED",
      amount: 898000,
      debt_after: 350000,
      note: "Pul qabul qilindi: cash",
      created_at: "2026-09-07 06:24:00",
    },
  ];
  const running = walkLedgerRunningSigned(rows);
  assert.equal(running.get("nasiya-1121"), 350000);
  assert.equal(running.get("pay-1124"), -548000);
  assert.equal(
    runningSignedMatchesPosition(running.get("pay-1124"), { debt: 350000, advance: 0, net: -350000 }),
    false,
  );
  assert.equal(
    runningSignedMatchesPosition(350000, { debt: 350000, advance: 0, net: -350000 }),
    true,
  );
});

test("fully paid Sotuv does not change Qoldi (prev + 0)", () => {
  const rows = [
    {
      id: "prior",
      type: "sale",
      op_code: "CREDIT_SALE",
      amount: -261998,
      note: "Sotuv: ORD-0 (Jami 261998 so'm; to‘lov 0; nasiya 261998; avans 0; chegirma 0)",
      created_at: "2026-09-06 10:00:00",
    },
    {
      id: "paid-sale",
      type: "sale",
      op_code: "SALE_PAYMENT",
      amount: 54500,
      debt_after: 316498,
      note: "Sotuv: ORD-8 (Jami 54500 so'm; to‘lov 54500; usul: Naqd 54500; chegirma 0; avans 0)",
      created_at: "2026-09-06 16:43:00",
    },
  ];
  const running = walkLedgerRunningSigned(rows);
  assert.equal(ledgerCashierDelta(rows[1]), 0);
  assert.equal(running.get("prior"), 261998);
  assert.equal(running.get("paid-sale"), 261998);
});

test("fully paid Sotuv from 0 stays 0", () => {
  const sale = {
    id: "full",
    type: "sale",
    op_code: "SALE_PAYMENT",
    amount: 942000,
    debt_after: 942000,
    note: "Sotuv: ORD-1 (Jami 942000 so'm; to‘lov 942000; usul: Naqd 942000; chegirma 0; avans 0)",
    created_at: "2026-09-07 08:56:00",
  };
  assert.equal(ledgerCashierDelta(sale), 0);
  assert.equal(walkLedgerRunningSigned([sale]).get("full"), 0);
});

test("lend Berildi increases Qoldi; payment reduces it", () => {
  const rows = [
    {
      id: "lend",
      type: "payment_out",
      op_code: "CUSTOMER_LOAN_ISSUED",
      amount: -5000,
      created_at: "2026-09-07 09:00:00",
    },
    {
      id: "pay",
      type: "payment_in",
      op_code: "DEBT_PAYMENT_RECEIVED",
      amount: 2000,
      created_at: "2026-09-07 09:05:00",
    },
  ];
  const running = walkLedgerRunningSigned(rows);
  assert.equal(running.get("lend"), 5000);
  assert.equal(running.get("pay"), 3000);
});
