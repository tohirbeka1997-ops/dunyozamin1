'use strict';

/**
 * Shared POS cash-register hardening helpers (Electron / public-api).
 * Keep in sync with src/lib/posHardening.ts
 */

const MONEY_MAX_DECIMALS = 2;
/** Absolute cash variance (UZS) that requires a close-shift reason. */
const SHIFT_VARIANCE_REASON_THRESHOLD = 10000;

/**
 * @param {unknown} raw
 * @returns {{ ok: true, amount: number } | { ok: false, error: string }}
 */
function parsePositiveMoneyAmount(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'amount is required' };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return { ok: false, error: 'amount must be a number greater than 0' };
    }
    const scaled = Math.round(raw * 100);
    if (Math.abs(raw * 100 - scaled) > 1e-6) {
      return { ok: false, error: 'amount allows at most 2 decimal places' };
    }
    return { ok: true, amount: scaled / 100 };
  }

  const text = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!text) return { ok: false, error: 'amount is required' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: 'amount must be a positive number with at most 2 decimals' };
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'amount must be a number greater than 0' };
  }
  return { ok: true, amount };
}

/**
 * Closing / opening cash: allow 0, reject negatives and bad format.
 * @param {unknown} raw
 * @returns {{ ok: true, amount: number } | { ok: false, error: string }}
 */
function parseNonNegativeMoneyAmount(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'amount is required' };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, error: 'amount must be a number greater than or equal to 0' };
    }
    const scaled = Math.round(raw * 100);
    if (Math.abs(raw * 100 - scaled) > 1e-6) {
      return { ok: false, error: 'amount allows at most 2 decimal places' };
    }
    return { ok: true, amount: scaled / 100 };
  }

  const text = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!text) return { ok: false, error: 'amount is required' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: 'amount must be a non-negative number with at most 2 decimals' };
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'amount must be a number greater than or equal to 0' };
  }
  return { ok: true, amount };
}

function isValidPositiveMoneyAmount(value) {
  return parsePositiveMoneyAmount(value).ok;
}

function isValidNonNegativeMoneyAmount(value) {
  return parseNonNegativeMoneyAmount(value).ok;
}

/**
 * @param {number} closingCash
 * @param {number} expectedCash
 * @param {string|null|undefined} reason
 * @param {number} [threshold]
 */
function requiresShiftVarianceReason(closingCash, expectedCash, reason, threshold = SHIFT_VARIANCE_REASON_THRESHOLD) {
  const diff = Math.abs(Number(closingCash || 0) - Number(expectedCash || 0));
  if (!(diff >= threshold)) return { required: false, diff };
  const text = String(reason || '').trim();
  if (!text) return { required: true, diff, missing: true };
  return { required: true, diff, missing: false };
}

function productTracksStock(product) {
  return product?.track_stock !== false && product?.track_stock !== 0;
}

/** Soft ceiling for catalog sale/cost prices (override via settings elsewhere). */
const DEFAULT_MAX_PRODUCT_PRICE = 1_000_000_000_000;

function isProductFreeSaleAllowed(product) {
  return product?.free_sale_allowed === true || product?.free_sale_allowed === 1;
}

function getProductSalePrice(product) {
  const n = Number(product?.sale_price ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Catalog / POS rule: salePrice > 0 OR freeSaleAllowed.
 * Zero-price without the flag must not enter a standard cart or marketplace.
 */
function isProductSalePriceSellable(product) {
  const price = getProductSalePrice(product);
  if (price > 0) return true;
  return isProductFreeSaleAllowed(product);
}

/** True when list/POS should show distinct “Price not set” (blocked free sale). */
function isProductPriceNotSet(product) {
  return getProductSalePrice(product) <= 0 && !isProductFreeSaleAllowed(product);
}

/**
 * Validate sale price for create/update and POS/API sale lines.
 * @returns {{ ok: true, salePrice: number, freeSale: boolean } | { ok: false, error: string, code: string }}
 */
function assertProductSalePriceAllowed(salePriceRaw, opts = {}) {
  const salePrice = Number(salePriceRaw);
  if (!Number.isFinite(salePrice)) {
    return { ok: false, error: 'sale_price must be a number', code: 'VALIDATION_ERROR' };
  }
  if (salePrice < 0) {
    return { ok: false, error: 'sale_price must be >= 0', code: 'NEGATIVE_PRICE' };
  }
  const max =
    Number.isFinite(Number(opts.maxPrice)) && Number(opts.maxPrice) > 0
      ? Number(opts.maxPrice)
      : DEFAULT_MAX_PRODUCT_PRICE;
  if (salePrice > max) {
    return {
      ok: false,
      error: `sale_price exceeds maximum allowed (${max})`,
      code: 'PRICE_TOO_HIGH',
    };
  }
  const freeSale = opts.freeSaleAllowed === true || opts.freeSaleAllowed === 1;
  const requirePositive = opts.requirePositiveUnlessFree !== false;
  if (requirePositive && salePrice <= 0 && !freeSale) {
    return {
      ok: false,
      error: 'sale_price must be > 0 unless free_sale_allowed',
      code: 'ZERO_PRICE_BLOCKED',
    };
  }
  return { ok: true, salePrice, freeSale };
}

/**
 * Cost price: >= 0, finite, under max.
 * @returns {{ ok: true, costPrice: number } | { ok: false, error: string, code: string }}
 */
function assertProductCostPriceAllowed(costRaw, opts = {}) {
  const costPrice = Number(costRaw);
  if (!Number.isFinite(costPrice)) {
    return { ok: false, error: 'purchase_price must be a number', code: 'VALIDATION_ERROR' };
  }
  if (costPrice < 0) {
    return { ok: false, error: 'purchase_price must be >= 0', code: 'NEGATIVE_PRICE' };
  }
  const max =
    Number.isFinite(Number(opts.maxPrice)) && Number(opts.maxPrice) > 0
      ? Number(opts.maxPrice)
      : DEFAULT_MAX_PRODUCT_PRICE;
  if (costPrice > max) {
    return {
      ok: false,
      error: `purchase_price exceeds maximum allowed (${max})`,
      code: 'PRICE_TOO_HIGH',
    };
  }
  return { ok: true, costPrice };
}

/**
 * Bulk sale-price change needs manager approval when >20 SKUs or >30% delta.
 * @returns {{ required: boolean, missing?: boolean }}
 */
function bulkPriceChangeRequiresApproval(opts = {}) {
  const count = Number(opts.productCount) || 0;
  const pct = Math.abs(Number(opts.maxAbsPercentChange) || 0);
  const needs = count > 20 || pct > 30;
  if (!needs) return { required: false };
  const role = String(opts.userRole || '').toLowerCase();
  const isMgr = opts.authorized === true || role === 'admin' || role === 'manager';
  if (isMgr) return { required: true, missing: false };
  return { required: true, missing: true };
}

/**
 * Compute bulk-adjusted price. Does NOT clamp negatives to 0 — callers must
 * reject <=0 finals for sale prices (P0-02: -100% / -150% must fail, not become 0).
 */
function computeBulkNewPrice(oldPrice, opts = {}) {
  const old = Number(oldPrice) || 0;
  const mode = String(opts.mode || '');
  let np;
  switch (mode) {
    case 'percent':
      np = old * (1 + Number(opts.percent) / 100);
      break;
    case 'amount':
      np = old + Number(opts.amount);
      break;
    case 'set':
      np = Number(opts.exactPrice ?? opts.exact);
      break;
    case 'round': {
      const step = Number(opts.roundTo) > 0 ? Number(opts.roundTo) : 1000;
      np = Math.round(old / step) * step;
      break;
    }
    default:
      np = old;
  }
  if (!Number.isFinite(np)) return NaN;
  return Math.round(np);
}

/** Sale-field bulk finals must be strictly > 0. */
function assertBulkSaleFinalPrice(newPrice, ctx = {}) {
  const np = Number(newPrice);
  if (!Number.isFinite(np)) {
    return {
      ok: false,
      error: `Invalid bulk sale price for ${ctx.sku || ctx.productId || 'product'}`,
      code: 'VALIDATION_ERROR',
    };
  }
  if (!(np > 0)) {
    return {
      ok: false,
      error: `Bulk sale price would be <= 0 for ${ctx.sku || ctx.productId || 'product'}`,
      code: 'ZERO_PRICE_BLOCKED',
      newPrice: np,
    };
  }
  return { ok: true, newPrice: np };
}

/** Percent decrease that would zero/negate price (-100% and below). */
function isBulkPercentDecreaseBlocked(percent) {
  const p = Number(percent);
  return Number.isFinite(p) && p <= -100;
}

function getProductAvailableStock(product) {
  const n = Number(product?.current_stock ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isOutOfStockForSale(product) {
  return productTracksStock(product) && getProductAvailableStock(product) <= 0;
}

function findInsufficientStockLines(lines) {
  const out = [];
  for (const line of lines || []) {
    if (!productTracksStock(line.product)) continue;
    const qtyBase = Number(line.qty_base ?? line.quantity ?? 0) || 0;
    if (qtyBase <= 0) continue;
    const stock = getProductAvailableStock(line.product);
    const amendBonusBase =
      (Number(line.amend_original_qty_sale) || 0) * (Number(line.ratio_to_base) || 1);
    const available = stock + Math.max(0, amendBonusBase);
    if (qtyBase > available) {
      out.push({
        productId: line.product.id,
        productName: line.product.name,
        requested: qtyBase,
        available,
      });
    }
  }
  return out;
}

/**
 * Debt payment / overpay allocation (signed balance: negative = debt, positive = advance).
 * Payment may exceed debt: first closes debt, excess becomes customer advance.
 * If there is no debt, the full positive amount goes to advance.
 *
 * @param {number} oldBalance
 * @param {number} amount positive payment_in amount
 * @returns {{ debt_portion: number, advance_portion: number, new_balance: number }}
 */
function allocatePaymentInToDebtAndAdvance(oldBalance, amount) {
  const bal = Number(oldBalance) || 0;
  const pay = Number(amount) || 0;
  if (!(pay > 0) || !Number.isFinite(pay)) {
    return { debt_portion: 0, advance_portion: 0, new_balance: bal };
  }
  if (!(bal < 0)) {
    return { debt_portion: 0, advance_portion: pay, new_balance: bal + pay };
  }
  const debt = Math.abs(bal);
  const debt_portion = Math.min(pay, debt);
  const advance_portion = Math.max(0, pay - debt_portion);
  return { debt_portion, advance_portion, new_balance: bal + pay };
}

/** Soft defaults for bonus correction limits (override via settings). */
const DEFAULT_BONUS_CORRECTION_PER_OP = 5000;
const DEFAULT_BONUS_CORRECTION_PER_DAY = 20000;
const DEFAULT_BONUS_LARGE_CORRECTION = 1000;
const DEFAULT_INITIAL_BONUS_LIMIT = 10000;

/**
 * Classify payment_out: payout from customer advance vs lend (create debt).
 * Signed balance: positive = advance, negative = debt.
 *
 * @param {number} oldBalance
 * @param {number} amount positive amount to give
 */
function classifyPaymentOut(oldBalance, amount) {
  const bal = Number(oldBalance) || 0;
  const amt = Number(amount) || 0;
  if (!(amt > 0) || !Number.isFinite(amt)) {
    return { ok: false, error: 'amount must be greater than 0', code: 'INVALID_AMOUNT' };
  }
  const advance = bal > 0 ? bal : 0;
  const new_balance = bal - amt;
  if (amt <= advance + 1e-9) {
    return {
      ok: true,
      kind: 'payout',
      advance,
      amount: amt,
      debt_created: 0,
      new_balance,
    };
  }
  return {
    ok: true,
    kind: 'lend',
    advance,
    amount: amt,
    debt_created: Math.round((amt - advance) * 100) / 100,
    new_balance,
  };
}

function _normalizeRoleSet(roles) {
  const set = new Set();
  for (const r of roles || []) {
    const c = String(r || '')
      .trim()
      .toLowerCase();
    if (c) set.add(c);
  }
  return set;
}

function roleCanPayoutWithinAdvance(roles) {
  const set = _normalizeRoleSet(roles);
  return (
    set.has('admin') ||
    set.has('manager') ||
    set.has('senior_cashier') ||
    set.has('cashier')
  );
}

function roleCanLendCreateDebt(roles, _lendAuthorizedIgnored) {
  // Never trust client lendAuthorized flags — role matrix only.
  const set = _normalizeRoleSet(roles);
  return set.has('admin') || set.has('manager');
}

function roleCanExportCustomers(roles) {
  const set = _normalizeRoleSet(roles);
  return set.has('admin');
}

function roleCanReissueLoyaltyQr(roles) {
  const set = _normalizeRoleSet(roles);
  return set.has('admin') || set.has('manager');
}

function roleCanChangeCreditDueDate(roles) {
  const set = _normalizeRoleSet(roles);
  return set.has('admin') || set.has('manager');
}

/**
 * Enforce payout-within-advance vs authorized lend.
 * @returns {{ ok: true, kind: 'payout'|'lend', ... } | { ok: false, error: string, code: string }}
 */
function assertPaymentOutAllowed(opts = {}) {
  const oldBalance = opts.oldBalance;
  const amount = opts.amount;
  const classified = classifyPaymentOut(oldBalance, amount);
  if (!classified.ok) return classified;

  const roles = opts.roles || [];
  const kindRequested = opts.kindRequested ? String(opts.kindRequested).toLowerCase() : null;
  const reasonText = String(opts.reason || '').trim();

  // Explicit payout request cannot exceed advance
  if (kindRequested === 'payout' && classified.kind === 'lend') {
    return {
      ok: false,
      error: 'Payout amount exceeds customer advance; use lend action',
      code: 'PAYOUT_EXCEEDS_ADVANCE',
      advance: classified.advance,
      amount: classified.amount,
      debt_created: classified.debt_created,
    };
  }

  // Auto / lend path when amount > advance
  if (classified.kind === 'lend' || kindRequested === 'lend') {
    if (!roleCanLendCreateDebt(roles, opts.lendAuthorized)) {
      return {
        ok: false,
        error: 'Lending (creating debt) requires manager or admin approval',
        code: 'LEND_FORBIDDEN',
        advance: classified.advance,
        amount: classified.amount,
        debt_created: classified.debt_created,
      };
    }
    if (!reasonText) {
      return {
        ok: false,
        error: 'Lend reason is required',
        code: 'LEND_REASON_REQUIRED',
        advance: classified.advance,
        amount: classified.amount,
        debt_created: classified.debt_created,
      };
    }
    const limit = Number(opts.creditLimit);
    if (Number.isFinite(limit) && limit >= 0) {
      const newDebt = Math.max(0, -classified.new_balance);
      if (newDebt > limit + 1e-6) {
        return {
          ok: false,
          error: `Exceeds customer credit limit (${limit})`,
          code: 'CREDIT_LIMIT_EXCEEDED',
          advance: classified.advance,
          amount: classified.amount,
          debt_created: classified.debt_created,
          new_debt: newDebt,
          credit_limit: limit,
        };
      }
    }
    return {
      ok: true,
      kind: 'lend',
      advance: classified.advance,
      amount: classified.amount,
      debt_created: classified.debt_created,
      new_balance: classified.new_balance,
      reason: reasonText,
    };
  }

  if (!roleCanPayoutWithinAdvance(roles)) {
    return {
      ok: false,
      error: 'Payout not allowed for this role',
      code: 'PAYOUT_FORBIDDEN',
      advance: classified.advance,
      amount: classified.amount,
    };
  }
  return {
    ok: true,
    kind: 'payout',
    advance: classified.advance,
    amount: classified.amount,
    debt_created: 0,
    new_balance: classified.new_balance,
  };
}

/**
 * Bonus correction: non-zero integer + mandatory reason + optional limits.
 */
function parseBonusDeltaInteger(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'bonus delta is required', code: 'BONUS_DELTA_REQUIRED' };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw === 0) {
      return {
        ok: false,
        error: 'bonus delta must be a non-zero integer',
        code: 'BONUS_DELTA_INVALID',
      };
    }
    return { ok: true, delta: raw };
  }
  const text = String(raw).trim().replace(/\s+/g, '');
  if (!/^-?\d+$/.test(text)) {
    return {
      ok: false,
      error: 'bonus delta must be a non-zero integer',
      code: 'BONUS_DELTA_INVALID',
    };
  }
  const delta = Number(text);
  if (!Number.isFinite(delta) || delta === 0) {
    return {
      ok: false,
      error: 'bonus delta must be a non-zero integer',
      code: 'BONUS_DELTA_INVALID',
    };
  }
  return { ok: true, delta };
}

function assertBonusCorrection(opts = {}) {
  const parsed = parseBonusDeltaInteger(opts.delta);
  if (!parsed.ok) return parsed;
  const reason = String(opts.reason || '').trim();
  if (!reason) {
    return { ok: false, error: 'bonus correction reason is required', code: 'BONUS_REASON_REQUIRED' };
  }
  const before = Number(opts.beforeBalance) || 0;
  const after = before + parsed.delta;
  const allowNegative = opts.allowNegative === true;
  if (!allowNegative && after < -0.0001) {
    return {
      ok: false,
      error: 'bonus balance cannot be negative',
      code: 'BONUS_NEGATIVE_BLOCKED',
      after,
    };
  }
  const perOp =
    Number.isFinite(Number(opts.perOpLimit)) && Number(opts.perOpLimit) > 0
      ? Number(opts.perOpLimit)
      : DEFAULT_BONUS_CORRECTION_PER_OP;
  if (Math.abs(parsed.delta) > perOp) {
    return {
      ok: false,
      error: `bonus correction exceeds per-operation limit (${perOp})`,
      code: 'BONUS_PER_OP_LIMIT',
      limit: perOp,
    };
  }
  const dayUsed = Number(opts.dayUsedAbs) || 0;
  const perDay =
    Number.isFinite(Number(opts.perDayLimit)) && Number(opts.perDayLimit) > 0
      ? Number(opts.perDayLimit)
      : DEFAULT_BONUS_CORRECTION_PER_DAY;
  if (dayUsed + Math.abs(parsed.delta) > perDay + 1e-9) {
    return {
      ok: false,
      error: `bonus correction exceeds per-day limit (${perDay})`,
      code: 'BONUS_PER_DAY_LIMIT',
      limit: perDay,
      dayUsed,
    };
  }
  const largeAt =
    Number.isFinite(Number(opts.largeThreshold)) && Number(opts.largeThreshold) > 0
      ? Number(opts.largeThreshold)
      : DEFAULT_BONUS_LARGE_CORRECTION;
  const roles = opts.roles || [];
  const set = _normalizeRoleSet(roles);
  const isMgr = set.has('admin') || set.has('manager') || opts.authorized === true;
  if (!isMgr) {
    return { ok: false, error: 'bonus correction requires manager or admin', code: 'BONUS_FORBIDDEN' };
  }
  const needsLargeApprove = Math.abs(parsed.delta) >= largeAt;
  // Admin only for large corrections — never trust client largeApproved/authorized flags.
  if (needsLargeApprove && !set.has('admin')) {
    return {
      ok: false,
      error: 'large bonus correction requires admin',
      code: 'BONUS_LARGE_APPROVAL_REQUIRED',
      threshold: largeAt,
    };
  }
  return {
    ok: true,
    delta: parsed.delta,
    after,
    reason,
    requiresLargeApproval: needsLargeApprove,
  };
}

function assertInitialBonusPoints(raw, opts = {}) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, points: 0 };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      return { ok: false, error: 'initial bonus must be a non-negative integer', code: 'BONUS_INVALID' };
    }
  } else {
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) {
      return { ok: false, error: 'initial bonus must be a non-negative integer', code: 'BONUS_INVALID' };
    }
  }
  const points = typeof raw === 'number' ? raw : Number(String(raw).trim());
  const max =
    Number.isFinite(Number(opts.maxInitial)) && Number(opts.maxInitial) > 0
      ? Number(opts.maxInitial)
      : DEFAULT_INITIAL_BONUS_LIMIT;
  if (points > max) {
    return {
      ok: false,
      error: `initial bonus exceeds limit (${max})`,
      code: 'BONUS_INITIAL_LIMIT',
      limit: max,
    };
  }
  return { ok: true, points };
}

function assertOptionalEmail(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return { ok: true, email: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254) {
    return { ok: false, error: 'invalid email format', code: 'EMAIL_INVALID' };
  }
  return { ok: true, email: s };
}

function assertOptionalUzPhone(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return { ok: true, phone: null, normalized: null };
  const digits = s.replace(/\D/g, '');
  let normalized = null;
  if (digits.startsWith('998') && digits.length >= 12) {
    normalized = digits.slice(0, 12);
  } else if (digits.length === 9) {
    normalized = `998${digits}`;
  } else if (digits.length === 10 && digits.startsWith('8')) {
    normalized = `998${digits.slice(1)}`;
  } else if (digits.length === 12 && digits.startsWith('998')) {
    normalized = digits;
  }
  if (!normalized || !/^998\d{9}$/.test(normalized)) {
    return {
      ok: false,
      error: 'invalid UZ phone format',
      code: 'PHONE_INVALID',
    };
  }
  return { ok: true, phone: s, normalized };
}

/**
 * Credit due date must be YYYY-MM-DD and not before local "today".
 * @param {unknown} value
 * @param {string} [todayYmd] override for tests (YYYY-MM-DD)
 * @returns {{ ok: true, due_date: string } | { ok: false, error: string }}
 */
function assertDueDateNotBeforeToday(value, todayYmd) {
  if (value == null || value === '') {
    return { ok: false, error: 'due_date is required' };
  }
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { ok: false, error: 'due_date must be YYYY-MM-DD' };
  }
  let today = todayYmd;
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(String(today))) {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    today = `${y}-${m}-${day}`;
  }
  if (s < String(today)) {
    return { ok: false, error: 'due_date cannot be before today' };
  }
  return { ok: true, due_date: s };
}

/**
 * Mask phone for external exports / unauthorized views. Digits kept partially.
 * @param {unknown} phone
 * @returns {string}
 */
function maskPhoneForExport(phone) {
  const raw = phone == null ? '' : String(phone).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const visible = digits.slice(-4);
  const prefix = digits.length > 4 ? digits.slice(0, Math.min(3, digits.length - 4)) : '';
  return prefix ? `${prefix}***${visible}` : `***${visible}`;
}

/**
 * Build tel: href from a displayed phone (keeps leading + when present).
 * @param {unknown} phone
 * @returns {string|null}
 */
function phoneToTelHref(phone) {
  const raw = phone == null ? '' : String(phone).trim();
  if (!raw) return null;
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) return null;
  return `tel:${hasPlus ? '+' : ''}${digits}`;
}

/**
 * Empty cart must never show "finish zero sum" after a completed sale.
 * Zero-settle UI is only for a real cart that nets to 0.
 */
function shouldShowZeroSettlePaymentUi({ cartLength, total }) {
  const len = Number(cartLength) || 0;
  const tot = Number(total);
  return len > 0 && Number.isFinite(tot) && Math.abs(tot) < 0.005;
}

/**
 * Total=0 checkout is allowed only with 100% discount / promo / bonus points /
 * or an authorized role (admin|manager).
 */
function isZeroTotalSaleAllowed({
  subtotal = 0,
  discountAmount = 0,
  loyaltyDiscountAmount = 0,
  hasPromo = false,
  loyaltyRedeemPoints = 0,
  userRole = null,
  authorized = false,
} = {}) {
  const role = String(userRole || '').toLowerCase();
  if (authorized === true || role === 'admin' || role === 'manager') return true;
  if (hasPromo === true) return true;
  if ((Number(loyaltyRedeemPoints) || 0) > 0) return true;
  const sub = Number(subtotal) || 0;
  const covered =
    (Number(discountAmount) || 0) + (Number(loyaltyDiscountAmount) || 0);
  if (sub > 0 && covered + 0.01 >= sub) return true;
  return false;
}

/**
 * Derive order-level return status from line sold vs returned quantities.
 * @returns {'not_returned'|'partially_returned'|'fully_returned'}
 */
function deriveOrderReturnStatus(items) {
  const lines = Array.isArray(items) ? items : [];
  if (lines.length === 0) return 'not_returned';
  let anyReturned = false;
  let allFully = true;
  let anyPositiveQty = false;
  for (const line of lines) {
    const qty = Math.abs(Number(line.quantity ?? line.qty_sale ?? 0) || 0);
    if (!(qty > 0)) continue;
    anyPositiveQty = true;
    const returned = Math.max(0, Number(line.returned_quantity) || 0);
    if (returned > 0) anyReturned = true;
    if (returned + 1e-9 < qty) allFully = false;
  }
  if (!anyPositiveQty || !anyReturned) return 'not_returned';
  return allFully ? 'fully_returned' : 'partially_returned';
}

/**
 * Gross / returned / net money for an order (line pro-rata from returned qty).
 */
function computeOrderReturnMoney({ grossTotal, items } = {}) {
  const gross = Math.max(0, Number(grossTotal) || 0);
  const lines = Array.isArray(items) ? items : [];
  let returnedFromLines = 0;
  for (const line of lines) {
    const qty = Math.abs(Number(line.quantity ?? line.qty_sale ?? 0) || 0);
    const returned = Math.max(0, Number(line.returned_quantity) || 0);
    if (!(qty > 0) || !(returned > 0)) continue;
    const lineTotal = Math.abs(
      Number(
        line.final_total ??
          line.line_total ??
          line.total ??
          (Number(line.unit_price) || 0) * qty,
      ) || 0,
    );
    returnedFromLines += lineTotal * Math.min(1, returned / qty);
  }
  const returned_total = Math.round(returnedFromLines * 100) / 100;
  const net_total = Math.round(Math.max(0, gross - returned_total) * 100) / 100;
  return {
    gross_total: gross,
    returned_total,
    net_total,
    return_status: deriveOrderReturnStatus(lines),
  };
}

/** availableToReturn = soldQuantity − approvedReturnedQuantity (never negative). */
function availableToReturnQty(soldQuantity, approvedReturnedQuantity) {
  const sold = Math.max(0, Number(soldQuantity) || 0);
  const returned = Math.max(0, Number(approvedReturnedQuantity) || 0);
  return Math.max(0, sold - returned);
}

const RETURN_LIMIT_EXCEEDED_CODE = 'RETURN_LIMIT_EXCEEDED';

const RETURN_LIMIT_EXCEEDED_MESSAGE =
  'Sotuv to‘liq qaytarilgan yoki qaytarish miqdori ruxsat etilgan limitdan oshgan.';

function isSalesReturnFullyExhausted(order = {}) {
  const status = String(order.return_status || '').toLowerCase();
  if (status === 'fully_returned') return true;

  const gross = Math.max(0, Number(order.gross_total ?? order.total_amount ?? 0) || 0);
  const returnedAmt = Math.max(0, Number(order.returned_total ?? 0) || 0);
  const net =
    order.net_total != null && order.net_total !== ''
      ? Math.max(0, Number(order.net_total) || 0)
      : Math.max(0, gross - returnedAmt);

  if (net <= 0.009) return true;
  if (gross > 0 && returnedAmt >= gross - 0.009) return true;

  const lines = Array.isArray(order.items) ? order.items : [];
  if (lines.length > 0) {
    let soldQty = 0;
    let returnedQty = 0;
    for (const line of lines) {
      const sold = Math.abs(Number(line.quantity ?? line.qty_sale ?? 0) || 0);
      if (!(sold > 0)) continue;
      soldQty += sold;
      returnedQty += Math.max(0, Number(line.returned_quantity ?? 0) || 0);
    }
    if (soldQty > 0 && returnedQty >= soldQty - 1e-9) return true;
  }

  return false;
}

function canCreateSalesReturnForOrder(order = {}) {
  return !isSalesReturnFullyExhausted(order);
}

/**
 * Over-return check for a single line.
 * @returns {{ ok: true, available: number } | { ok: false, available: number, code: string }}
 */
function assertReturnQtyAllowed(soldQuantity, approvedReturnedQuantity, requestQty) {
  const available = availableToReturnQty(soldQuantity, approvedReturnedQuantity);
  const qty = Number(requestQty) || 0;
  if (!(qty > 0)) {
    return { ok: false, available, code: RETURN_LIMIT_EXCEEDED_CODE };
  }
  if (qty > available + 1e-9) {
    return { ok: false, available, code: RETURN_LIMIT_EXCEEDED_CODE };
  }
  return { ok: true, available };
}

/** Default max absolute qty for a single manual stock adjustment line. */
const DEFAULT_MAX_STOCK_ADJUSTMENT = 10000;

const MANUAL_STOCK_ADJUSTMENT_TYPES = new Set([
  'surplus',
  'shortage',
  'damage',
  'expiry',
  'recount',
  'system_error',
  'other',
  'increase',
  'decrease',
  'adjustment',
  'set',
]);

/** Complete / variance approval: manager or admin only (storekeeper counts, cannot complete). */
function roleCanApproveInventoryRevision(roles) {
  const list = Array.isArray(roles) ? roles : roles ? [roles] : [];
  return list.some((r) => {
    const role = String(r || '').toLowerCase();
    return role === 'admin' || role === 'manager';
  });
}

/** Create / count / cancel / partial scope: warehouse staff + managers. */
function roleCanManageInventoryRevision(roles) {
  const list = Array.isArray(roles) ? roles : roles ? [roles] : [];
  return list.some((r) => {
    const role = String(r || '').toLowerCase();
    return (
      role === 'admin' ||
      role === 'manager' ||
      role === 'warehouse' ||
      role === 'ombor' ||
      role === 'receiver'
    );
  });
}

function normalizeProductCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

/**
 * Validate stock adjustment absolute quantity against unit rules and configurable max.
 * @returns {{ ok: true, qty: number, requiresApproval: boolean } | { ok: false, error: string, code?: string }}
 */
function assertStockAdjustmentQty(rawQty, opts = {}) {
  const qty = Math.abs(Number(rawQty) || 0);
  if (!(qty > 0) || !Number.isFinite(qty)) {
    return { ok: false, error: 'Adjustment quantity must be a number greater than 0' };
  }
  const max = Number(opts.maxQty);
  const effectiveMax =
    Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_STOCK_ADJUSTMENT;
  const requiresApprovalFlag = opts.approvalRequired === true;
  const isManager =
    opts.authorized === true ||
    ['admin', 'manager'].includes(String(opts.userRole || '').toLowerCase());
  if (qty > effectiveMax + 1e-9) {
    if (requiresApprovalFlag && !isManager && !opts.approverId) {
      return {
        ok: false,
        error: `Adjustment exceeds max ${effectiveMax}; manager approval required`,
        code: 'APPROVAL_REQUIRED',
      };
    }
    if (!requiresApprovalFlag && !isManager) {
      return {
        ok: false,
        error: `Adjustment quantity exceeds maximum allowed (${effectiveMax})`,
        code: 'CONFLICT',
      };
    }
  }
  return { ok: true, qty, requiresApproval: qty > effectiveMax + 1e-9 };
}

module.exports = {
  MONEY_MAX_DECIMALS,
  SHIFT_VARIANCE_REASON_THRESHOLD,
  DEFAULT_MAX_STOCK_ADJUSTMENT,
  DEFAULT_MAX_PRODUCT_PRICE,
  parsePositiveMoneyAmount,
  parseNonNegativeMoneyAmount,
  isValidPositiveMoneyAmount,
  isValidNonNegativeMoneyAmount,
  requiresShiftVarianceReason,
  productTracksStock,
  getProductAvailableStock,
  isOutOfStockForSale,
  findInsufficientStockLines,
  isProductFreeSaleAllowed,
  getProductSalePrice,
  isProductSalePriceSellable,
  isProductPriceNotSet,
  assertProductSalePriceAllowed,
  assertProductCostPriceAllowed,
  bulkPriceChangeRequiresApproval,
  computeBulkNewPrice,
  assertBulkSaleFinalPrice,
  isBulkPercentDecreaseBlocked,
  allocatePaymentInToDebtAndAdvance,
  classifyPaymentOut,
  assertPaymentOutAllowed,
  roleCanPayoutWithinAdvance,
  roleCanLendCreateDebt,
  roleCanExportCustomers,
  roleCanReissueLoyaltyQr,
  roleCanChangeCreditDueDate,
  parseBonusDeltaInteger,
  assertBonusCorrection,
  assertInitialBonusPoints,
  assertOptionalEmail,
  assertOptionalUzPhone,
  DEFAULT_BONUS_CORRECTION_PER_OP,
  DEFAULT_BONUS_CORRECTION_PER_DAY,
  DEFAULT_BONUS_LARGE_CORRECTION,
  DEFAULT_INITIAL_BONUS_LIMIT,
  assertDueDateNotBeforeToday,
  maskPhoneForExport,
  phoneToTelHref,
  shouldShowZeroSettlePaymentUi,
  isZeroTotalSaleAllowed,
  deriveOrderReturnStatus,
  computeOrderReturnMoney,
  availableToReturnQty,
  assertReturnQtyAllowed,
  RETURN_LIMIT_EXCEEDED_CODE,
  RETURN_LIMIT_EXCEEDED_MESSAGE,
  isSalesReturnFullyExhausted,
  canCreateSalesReturnForOrder,
  assertStockAdjustmentQty,
  MANUAL_STOCK_ADJUSTMENT_TYPES,
  roleCanApproveInventoryRevision,
  roleCanManageInventoryRevision,
  normalizeProductCode,
};
