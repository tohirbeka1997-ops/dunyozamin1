/**
 * Cashier-facing customer balance: one signed running number.
 *
 * Storage / position.net stays legacy: net = advance − debt (negative = owes).
 * Cashier signed = debt − advance = −net:
 *   +N  → mijoz qarzdor (owes us)
 *   −N  → ortiqcha to‘lov (credit to customer) — never call it «Avans» in primary UI
 *    0  → clear
 */

export type LedgerSnapshotSource = "audit" | "balance_after";

export type LedgerPositionSnapshot = {
  debt: number;
  advance: number;
  /** Legacy net = advance − debt (matches customers.balance / position.net). */
  net: number;
  /** Cashier signed = debt − advance (+ owes, − prepaid). */
  signed: number;
  source: LedgerSnapshotSource;
};

export type LedgerQoldiView = LedgerPositionSnapshot & {
  /** Absolute value for formatting. */
  amount: number;
  className: string;
  kind: "debt" | "credit" | "zero";
};

export type LedgerCashFlow = {
  received: number;
  given: number;
  total: number;
  debtOnly: boolean;
};

export type LedgerOrderAmounts = {
  total?: number | null;
  paid?: number | null;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Convert legacy net (advance − debt) → cashier signed (debt − advance). */
export function toCashierSigned(legacyNet: number): number {
  return roundMoney(-(Number(legacyNet) || 0));
}

/** Cashier signed from dual buckets. */
export function cashierSignedFromBuckets(debt: number, advance: number): number {
  return roundMoney((Number(debt) || 0) - (Number(advance) || 0));
}

/** Position immediately after this ledger event (stored snapshot). */
export function ledgerSnapshotAfter(entry: {
  balance_after?: number | null;
  debt_after?: number | null;
  advance_after?: number | null;
}): LedgerPositionSnapshot {
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

export function signedBalanceKind(signed: number): "debt" | "credit" | "zero" {
  const n = Number(signed) || 0;
  if (n > 0.001) return "debt";
  if (n < -0.001) return "credit";
  return "zero";
}

export function signedBalanceClassName(signed: number): string {
  const kind = signedBalanceKind(signed);
  if (kind === "debt") return "text-destructive";
  if (kind === "credit") return "text-emerald-600";
  return "text-muted-foreground";
}

/**
 * Format cashier-signed balance as +N / −N / 0 (no Avans / Qarz labels).
 * `formatAbs` turns absolute amount into a localized money string.
 */
export function formatCashierSigned(
  signed: number,
  formatAbs: (abs: number) => string,
): string {
  const n = Number(signed) || 0;
  if (Math.abs(n) <= 0.001) return formatAbs(0);
  const body = formatAbs(Math.abs(n));
  return n > 0 ? `+${body}` : `−${body}`;
}

/** @deprecated Prefer formatCashierSigned; kept for call sites that still pass legacy net. */
export function signedBalanceLabel(legacyNet: number): {
  label: string;
  amount: number;
  className: string;
  kind: "debt" | "credit" | "zero";
  signed: number;
} {
  const signed = toCashierSigned(legacyNet);
  const kind = signedBalanceKind(signed);
  return {
    label: "",
    amount: Math.abs(signed),
    className: signedBalanceClassName(signed),
    kind,
    signed,
  };
}

export function ledgerRunningPosition(entry: {
  balance_after?: number | null;
  debt_after?: number | null;
  advance_after?: number | null;
}): LedgerQoldiView {
  const snap = ledgerSnapshotAfter(entry);
  return {
    ...snap,
    amount: Math.abs(snap.signed),
    className: signedBalanceClassName(snap.signed),
    kind: signedBalanceKind(snap.signed),
  };
}

/** True when last chronological Qoldi signed matches Hisob holati. */
export function ledgerLastMatchesPosition(
  lastEntry:
    | {
        balance_after?: number | null;
        debt_after?: number | null;
        advance_after?: number | null;
      }
    | null
    | undefined,
  position: { net?: number | null; debt?: number | null; advance?: number | null },
  eps = 0.02,
): boolean {
  if (!lastEntry) return true;
  const snap = ledgerSnapshotAfter(lastEntry);
  const posSigned =
    position.debt != null || position.advance != null
      ? cashierSignedFromBuckets(Number(position.debt) || 0, Number(position.advance) || 0)
      : toCashierSigned(Number(position.net) || 0);
  return Math.abs(snap.signed - posSigned) <= eps;
}

/** CSV / plain text for Qoldi: signed +/- number (no Avans). */
export function formatLedgerQoldiPlain(snap: LedgerPositionSnapshot): string {
  const n = Number(snap.signed) || 0;
  if (Math.abs(n) <= 0.001) return "0";
  return n > 0 ? `+${n}` : `-${Math.abs(n)}`;
}

/** Single-line from legacy net (advance − debt). */
export function formatSignedBalancePlain(legacyNet: number): string {
  return formatLedgerQoldiPlain({
    debt: Math.max(0, -(Number(legacyNet) || 0)),
    advance: Math.max(0, Number(legacyNet) || 0),
    net: Number(legacyNet) || 0,
    signed: toCashierSigned(legacyNet),
    source: "balance_after",
  });
}

/**
 * Storage convention for customer_ledger.created_at:
 * - Canonical (sales, returns, new payments): UTC-naive `YYYY-MM-DD HH:mm:ss`
 * - Legacy payments / lend / advance-apply: Asia/Tashkent wall-clock naive (no Z)
 *
 * Display always shows Asia/Tashkent. Sorting uses the same interpreted instant.
 * Uzbekistan is UTC+5 year-round (no DST).
 */
export const LEDGER_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const FUTURE_GRACE_MS = 15 * 60 * 1000;
const PEER_CLOSER_MS = 2 * 60 * 60 * 1000;
const PEER_OFFSET_GAP_MS = 3 * 60 * 60 * 1000;

function isTimezoneAwareIso(s: string): boolean {
  return s.includes("T") && (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s));
}

function matchNaiveSqlite(s: string): RegExpMatchArray | null {
  return s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(\.\d+)?$/);
}

/** Parse as UTC instant (naive SQLite → …Z). Does not apply legacy-local correction. */
export function ledgerEventTimeMsUtc(
  createdAt: string | number | Date | null | undefined,
): number {
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
  if (isTimezoneAwareIso(s)) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const m = matchNaiveSqlite(s);
  if (m) {
    const t = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}Z`).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** True when sale/return writers — always UTC-naive in this codebase. */
export function isLedgerUtcAnchorType(
  type?: string | null,
  opCode?: string | null,
): boolean {
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

function minDist(target: number, peers: number[]): number {
  if (!peers.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const p of peers) {
    const d = Math.abs(p - target);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Resolve one stamp to epoch ms.
 * - Aware ISO / Date / number: as-is
 * - Naive: UTC by default; treat as Asia/Tashkent wall-clock when:
 *   (a) UTC reading is implausibly in the future vs now, or
 *   (b) `forceLocal` / peer anchors show local fits ~5h better
 */
export function ledgerEventTimeMs(
  createdAt: string | number | Date | null | undefined,
  opts?: {
    nowMs?: number;
    /** Known UTC anchor instants from sibling sale/return rows. */
    utcAnchorMs?: number[];
    /** Force Tashkent-local interpretation of a naive stamp. */
    forceLocal?: boolean;
  },
): number {
  if (createdAt == null || createdAt === "") return 0;
  if (createdAt instanceof Date || typeof createdAt === "number") {
    return ledgerEventTimeMsUtc(createdAt);
  }
  const s = String(createdAt).trim();
  if (!s) return 0;
  if (isTimezoneAwareIso(s)) {
    return ledgerEventTimeMsUtc(s);
  }
  const m = matchNaiveSqlite(s);
  if (!m) {
    return ledgerEventTimeMsUtc(s);
  }

  const asUtc = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}Z`).getTime();
  if (!Number.isFinite(asUtc)) return 0;
  const asLocal = asUtc - LEDGER_TZ_OFFSET_MS;

  if (opts?.forceLocal) return asLocal;

  const anchors = opts?.utcAnchorMs || [];
  if (anchors.length) {
    const dUtc = minDist(asUtc, anchors);
    const dLocal = minDist(asLocal, anchors);
    if (dLocal + PEER_CLOSER_MS < dUtc && dUtc - dLocal >= PEER_OFFSET_GAP_MS) {
      return asLocal;
    }
  }

  const nowMs = opts?.nowMs ?? Date.now();
  if (asUtc > nowMs + FUTURE_GRACE_MS && asLocal <= nowMs + FUTURE_GRACE_MS) {
    return asLocal;
  }

  return asUtc;
}

export type LedgerTimeEntry = {
  created_at?: string | null;
  id?: string | null;
  type?: string | null;
  op_code?: string | null;
};

/**
 * Resolve every row's event instant with the same rules used for display + sort.
 * Sale/return rows anchor UTC; legacy Tashkent payment stamps are un-shifted.
 */
export function resolveLedgerEventTimes(
  entries: LedgerTimeEntry[],
  opts?: { nowMs?: number },
): Map<string, number> {
  const nowMs = opts?.nowMs ?? Date.now();
  const anchorMs: number[] = [];
  for (const e of entries) {
    if (!isLedgerUtcAnchorType(e.type, e.op_code)) continue;
    const t = ledgerEventTimeMsUtc(e.created_at);
    if (t > 0) anchorMs.push(t);
  }

  const out = new Map<string, number>();
  entries.forEach((e, index) => {
    const key = String(e.id || `idx:${index}`);
    const isAnchor = isLedgerUtcAnchorType(e.type, e.op_code);
    const ms = isAnchor
      ? ledgerEventTimeMsUtc(e.created_at)
      : ledgerEventTimeMs(e.created_at, {
          nowMs,
          utcAnchorMs: anchorMs,
        });
    out.set(key, ms);
  });
  return out;
}

/** Stable chronological compare: event time, then id. */
export function compareLedgerEntries(
  a: LedgerTimeEntry,
  b: LedgerTimeEntry,
  direction: "asc" | "desc" = "asc",
  timeMsById?: Map<string, number>,
): number {
  const msA =
    timeMsById?.get(String(a.id || "")) ??
    ledgerEventTimeMs(a.created_at, {
      forceLocal: false,
    });
  const msB =
    timeMsById?.get(String(b.id || "")) ??
    ledgerEventTimeMs(b.created_at, {
      forceLocal: false,
    });
  const d = msA - msB;
  if (d !== 0) return direction === "asc" ? d : -d;
  const idA = String(a.id || "");
  const idB = String(b.id || "");
  if (idA === idB) return 0;
  const idCmp = idA < idB ? -1 : 1;
  return direction === "asc" ? idCmp : -idCmp;
}

export function sortLedgerEntries<T extends LedgerTimeEntry>(
  entries: T[],
  direction: "asc" | "desc" = "asc",
): T[] {
  const timeMsById = resolveLedgerEventTimes(entries);
  return [...entries].sort((a, b) => compareLedgerEntries(a, b, direction, timeMsById));
}

function parseMoneyToken(raw: string): number {
  const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && Math.abs(parsed) > 0.009 ? Math.abs(parsed) : 0;
}

/** Paid-at-checkout from ledger note (`to‘lov N` / `To'liq to'langan`). */
export function parsePaidFromLedgerNote(note: string | null | undefined): number {
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

export function parseAmountFromLedgerNote(note: string | null | undefined): number {
  const text = String(note || "");
  if (!text) return 0;
  const patterns = [
    /To['\u2018\u2019`]liq to['\u2018\u2019`]langan[:\s]*([\d\s.,]+)/i,
    /Jami[:\s]*([\d\s.,]+)/i,
    /nasiya[:\s]*([\d\s.,]+)/i,
    /to['\u2018\u2019`]lov[:\s]*([\d\s.,]+)/i,
    /([\d][\d\s.,]{2,})\s*so['\u2018\u2019`]?m/i,
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

function splitSignedAmount(amount: number): { inAmount: number; outAmount: number } {
  const amt = Number(amount || 0);
  return {
    inAmount: amt > 0 ? amt : 0,
    outAmount: amt < 0 ? Math.abs(amt) : 0,
  };
}

/** Prefer ledger.amount; fall back to debt/advance delta, note, or linked order total. */
export function ledgerDisplayAmount(
  entry: {
    amount?: number | null;
    debt_before?: number | null;
    debt_after?: number | null;
    advance_before?: number | null;
    advance_after?: number | null;
    note?: string | null;
    ref_id?: string | null;
    order_total_amount?: number | null;
  },
  orderAmountsById?: Map<string, LedgerOrderAmounts>,
): number {
  const raw = Math.abs(Number(entry.amount || 0) || 0);
  if (raw > 0.009) return raw;
  const debtDelta = Math.abs(Number(entry.debt_after ?? 0) - Number(entry.debt_before ?? 0));
  if (debtDelta > 0.009) return debtDelta;
  const advanceDelta = Math.abs(
    Number(entry.advance_after ?? 0) - Number(entry.advance_before ?? 0),
  );
  if (advanceDelta > 0.009) return advanceDelta;
  const fromNote = parseAmountFromLedgerNote(entry.note);
  if (fromNote > 0.009) return fromNote;
  const joined = Number(entry.order_total_amount || 0) || 0;
  if (joined > 0.009) return joined;
  if (entry.ref_id && orderAmountsById?.has(entry.ref_id)) {
    const total = Number(orderAmountsById.get(entry.ref_id)?.total || 0);
    if (total > 0.009) return total;
  }
  return 0;
}

/**
 * Cash paid at checkout for a sale ledger row (not later debt payments).
 * Prefer note `to‘lov N` (written at sale time) over orders.paid_amount (may include later pays).
 */
export function saleCheckoutPaidAmount(
  entry: {
    type?: string | null;
    op_code?: string | null;
    amount?: number | null;
    note?: string | null;
    ref_id?: string | null;
    order_paid_amount?: number | null;
  },
  orderAmountsById?: Map<string, LedgerOrderAmounts>,
): number {
  const code = String(entry.op_code || "").toUpperCase();
  const type = String(entry.type || "");
  const saleLike =
    type === "sale" || SALE_OP_CODES.has(code) || code === "SALE_RETURN";
  if (!saleLike) return 0;

  const fromNote = parsePaidFromLedgerNote(entry.note);
  if (fromNote > 0.009) return roundMoney(fromNote);

  const signed = Number(entry.amount || 0) || 0;
  if (code === "SALE_PAYMENT" || (type === "sale" && signed > 0.009)) {
    return roundMoney(Math.abs(signed));
  }

  // Fallback only when note lacks to‘lov (legacy rows). Prefer map over join when both exist.
  if (entry.ref_id && orderAmountsById?.has(entry.ref_id)) {
    const paid = Math.max(0, Number(orderAmountsById.get(entry.ref_id)?.paid || 0) || 0);
    if (paid > 0.009) return roundMoney(paid);
  }
  const fromOrderJoin = Math.max(0, Number(entry.order_paid_amount || 0) || 0);
  if (fromOrderJoin > 0.009) return roundMoney(fromOrderJoin);

  return 0;
}

/**
 * Cashier columns: Olindi (kirim), Berildi (chiqim), Umumiy (op total).
 * Sale rows with checkout payment show that amount in Kirim even when ledger.amount is credit-only.
 */
export function ledgerCashFlow(
  entry: {
    type?: string | null;
    op_code?: string | null;
    amount?: number | null;
    note?: string | null;
    ref_id?: string | null;
    debt_before?: number | null;
    debt_after?: number | null;
    advance_before?: number | null;
    advance_after?: number | null;
    order_paid_amount?: number | null;
    order_total_amount?: number | null;
  },
  orderAmountsById?: Map<string, LedgerOrderAmounts>,
): LedgerCashFlow {
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
    const orderTotal =
      Math.max(
        0,
        Number(entry.order_total_amount || 0) || 0,
        entry.ref_id && orderAmountsById?.has(entry.ref_id)
          ? Number(orderAmountsById.get(entry.ref_id)?.total || 0) || 0
          : 0,
      ) || 0;
    const summa = Math.max(total, jami, orderTotal, checkoutPaid, Math.abs(signed));
    if (checkoutPaid > 0.009) {
      return { received: checkoutPaid, given: 0, total: summa, debtOnly: false };
    }
    if (code === "SALE_PAYMENT" || (type === "sale" && signed > 0.009)) {
      const paid = Math.abs(signed) > 0.009 ? Math.abs(signed) : summa;
      return { received: paid, given: 0, total: summa || paid, debtOnly: false };
    }
  }
  if (code === "ADVANCE_APPLIED_TO_ORDER" || (type === "adjustment" && Math.abs(signed) < 0.009)) {
    return { received: 0, given: 0, total, debtOnly: false };
  }
  if (MONEY_IN_OP_CODES.has(code) || type === "payment_in") {
    return { received: total, given: 0, total, debtOnly: false };
  }
  if (MONEY_OUT_OP_CODES.has(code) || type === "payment_out") {
    return { received: 0, given: total, total, debtOnly: false };
  }
  if (type === "refund" || code === "SALE_RETURN") {
    return { received: 0, given: total, total, debtOnly: false };
  }
  const { inAmount, outAmount } = splitSignedAmount(signed);
  if (inAmount > 0.009 || outAmount > 0.009) {
    return {
      received: inAmount > 0.009 ? inAmount : 0,
      given: outAmount > 0.009 ? outAmount : 0,
      total: total || inAmount || outAmount,
      debtOnly: false,
    };
  }
  return { received: 0, given: 0, total, debtOnly: false };
}
