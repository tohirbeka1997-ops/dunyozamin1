/**
 * POS hardening unit tests (money, stock lines, variance, debt/advance).
 * Run: node --test src/lib/__tests__/posHardening.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'path';

const require = createRequire(import.meta.url);
const hardening = require(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../electron/lib/posHardening.cjs'),
);

const {
  parsePositiveMoneyAmount,
  parseNonNegativeMoneyAmount,
  requiresShiftVarianceReason,
  isOutOfStockForSale,
  findInsufficientStockLines,
  allocatePaymentInToDebtAndAdvance,
  assertDueDateNotBeforeToday,
  maskPhoneForExport,
  SHIFT_VARIANCE_REASON_THRESHOLD,
  shouldShowZeroSettlePaymentUi,
  isZeroTotalSaleAllowed,
  deriveOrderReturnStatus,
  computeOrderReturnMoney,
  availableToReturnQty,
  assertReturnQtyAllowed,
  RETURN_LIMIT_EXCEEDED_CODE,
  isSalesReturnFullyExhausted,
  canCreateSalesReturnForOrder,
  assertStockAdjustmentQty,
  DEFAULT_MAX_STOCK_ADJUSTMENT,
  roleCanApproveInventoryRevision,
  roleCanManageInventoryRevision,
  assertProductSalePriceAllowed,
  isProductPriceNotSet,
  bulkPriceChangeRequiresApproval,
  classifyPaymentOut,
  assertPaymentOutAllowed,
  assertBonusCorrection,
  assertOptionalUzPhone,
  assertOptionalEmail,
  assertInitialBonusPoints,
} = hardening;

function sanitizeMoneyInput(raw, { allowEmpty = true } = {}) {
  const normalized = String(raw || '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '');
  if (normalized === '') return allowEmpty ? '' : '';
  const firstDot = normalized.indexOf('.');
  if (firstDot < 0) return normalized.replace(/^0+(\d)/, '$1') || '0';
  const intPart = normalized.slice(0, firstDot).replace(/^0+(\d)/, '$1') || '0';
  const frac = normalized
    .slice(firstDot + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${intPart}.${frac}`;
}

test('parsePositiveMoneyAmount rejects negatives/zero/letters', () => {
  assert.equal(parsePositiveMoneyAmount(-1000).ok, false);
  assert.equal(parsePositiveMoneyAmount(0).ok, false);
  assert.equal(parsePositiveMoneyAmount('abc').ok, false);
  assert.equal(parsePositiveMoneyAmount('').ok, false);
  assert.equal(parsePositiveMoneyAmount(1500).ok, true);
});

test('parseNonNegativeMoneyAmount allows 0, blocks -1', () => {
  assert.equal(parseNonNegativeMoneyAmount(0).ok, true);
  assert.equal(parseNonNegativeMoneyAmount(-1).ok, false);
});

test('sanitizeMoneyInput strips junk and caps decimals', () => {
  assert.equal(sanitizeMoneyInput('-1000'), '1000');
  assert.equal(sanitizeMoneyInput('12.345'), '12.34');
  assert.equal(sanitizeMoneyInput('ab12c'), '12');
});

test('isOutOfStockForSale respects track_stock', () => {
  assert.equal(isOutOfStockForSale({ current_stock: 0, track_stock: true }), true);
  assert.equal(isOutOfStockForSale({ current_stock: 0, track_stock: false }), false);
  assert.equal(isOutOfStockForSale({ current_stock: 3, track_stock: true }), false);
});

test('findInsufficientStockLines detects oversell', () => {
  const lines = findInsufficientStockLines([
    {
      product: { id: 'p1', name: 'Widget', current_stock: 3, track_stock: true },
      qty_base: 4,
    },
    {
      product: { id: 'p2', name: 'Ok', current_stock: 5, track_stock: true },
      qty_base: 2,
    },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].productName, 'Widget');
  assert.equal(lines[0].requested, 4);
  assert.equal(lines[0].available, 3);
});

test('requiresShiftVarianceReason at threshold', () => {
  const r = requiresShiftVarianceReason(0, SHIFT_VARIANCE_REASON_THRESHOLD, '');
  assert.equal(r.required, true);
  assert.equal(r.missing, true);
});

test('allocatePaymentInToDebtAndAdvance overpay to advance', () => {
  const r = allocatePaymentInToDebtAndAdvance(-5000, 10000);
  assert.equal(r.debt_portion, 5000);
  assert.equal(r.advance_portion, 5000);
  assert.equal(r.new_balance, 5000);
});

test('assertDueDateNotBeforeToday rejects past', () => {
  assert.equal(assertDueDateNotBeforeToday('1999-01-01', '2026-08-27').ok, false);
});

test('maskPhoneForExport hides middle digits', () => {
  assert.match(maskPhoneForExport('998901234567'), /\*\*\*/);
});

test('classifyPaymentOut: within advance is payout; over is lend', () => {
  const within = classifyPaymentOut(5000, 3000);
  assert.equal(within.ok, true);
  assert.equal(within.kind, 'payout');
  assert.equal(within.debt_created, 0);

  const over = classifyPaymentOut(2000, 5000);
  assert.equal(over.ok, true);
  assert.equal(over.kind, 'lend');
  assert.equal(over.debt_created, 3000);

  const noAdvance = classifyPaymentOut(-1000, 500);
  assert.equal(noAdvance.ok, true);
  assert.equal(noAdvance.kind, 'lend');
});

test('assertPaymentOutAllowed: cashier blocked over advance; manager lend needs reason', () => {
  const blocked = assertPaymentOutAllowed({
    oldBalance: 1000,
    amount: 5000,
    roles: ['cashier'],
    kindRequested: 'payout',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'PAYOUT_EXCEEDS_ADVANCE');

  const lendNoReason = assertPaymentOutAllowed({
    oldBalance: 1000,
    amount: 5000,
    roles: ['manager'],
    kindRequested: 'lend',
    reason: '',
    creditLimit: 100000,
  });
  assert.equal(lendNoReason.ok, false);
  assert.equal(lendNoReason.code, 'LEND_REASON_REQUIRED');

  const lendOk = assertPaymentOutAllowed({
    oldBalance: 1000,
    amount: 5000,
    roles: ['admin'],
    kindRequested: 'lend',
    reason: 'Emergency cash',
    creditLimit: 100000,
  });
  assert.equal(lendOk.ok, true);
  assert.equal(lendOk.kind, 'lend');

  // Client lend_authorized must NOT bypass role gate
  const spoof = assertPaymentOutAllowed({
    oldBalance: 1000,
    amount: 5000,
    roles: ['cashier'],
    kindRequested: 'lend',
    reason: 'spoof',
    lendAuthorized: true,
    creditLimit: 100000,
  });
  assert.equal(spoof.ok, false);
  assert.equal(spoof.code, 'LEND_FORBIDDEN');

  const noLimit = assertPaymentOutAllowed({
    oldBalance: -59990,
    amount: 10000,
    roles: ['manager'],
    kindRequested: 'lend',
    reason: 'test',
    creditLimit: 0,
  });
  assert.equal(noLimit.ok, false);
  assert.equal(noLimit.code, 'CREDIT_LIMIT_NOT_SET');
  assert.match(String(noLimit.error), /kredit limiti belgilanmagan/i);

  const overLimit = assertPaymentOutAllowed({
    oldBalance: -59990,
    amount: 10000,
    roles: ['manager'],
    kindRequested: 'lend',
    reason: 'test',
    creditLimit: 65000,
  });
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.code, 'CREDIT_LIMIT_EXCEEDED');
  if (!overLimit.ok) {
    assert.equal(overLimit.new_debt, 69990);
    assert.equal(overLimit.over_by, 4990);
  }

  const lendFromDebt = assertPaymentOutAllowed({
    oldBalance: -59990,
    amount: 10000,
    roles: ['manager'],
    kindRequested: 'lend',
    reason: 'test',
    creditLimit: 100000,
  });
  assert.equal(lendFromDebt.ok, true);
  if (lendFromDebt.ok) {
    assert.equal(lendFromDebt.new_balance, -69990);
  }

  const payoutNeedsReason = assertPaymentOutAllowed({
    oldBalance: 5000,
    amount: 1000,
    roles: ['manager'],
    kindRequested: 'payout',
    reason: '',
  });
  assert.equal(payoutNeedsReason.ok, false);
  assert.equal(payoutNeedsReason.code, 'PAYOUT_REASON_REQUIRED');

  const cashierPayoutBlocked = assertPaymentOutAllowed({
    oldBalance: 5000,
    amount: 1000,
    roles: ['cashier'],
    kindRequested: 'payout',
    reason: 'refund',
  });
  assert.equal(cashierPayoutBlocked.ok, false);
  assert.equal(cashierPayoutBlocked.code, 'PAYOUT_FORBIDDEN');
});

test('assertBonusCorrection requires integer reason and blocks empty', () => {
  assert.equal(assertBonusCorrection({ delta: null, reason: 'x', roles: ['admin'] }).ok, false);
  assert.equal(assertBonusCorrection({ delta: 0, reason: 'x', roles: ['admin'] }).ok, false);
  assert.equal(assertBonusCorrection({ delta: 10, reason: '', roles: ['admin'] }).ok, false);
  assert.equal(
    assertBonusCorrection({ delta: 10, reason: 'fix', roles: ['admin'], beforeBalance: 0 }).ok,
    true,
  );
  assert.equal(
    assertBonusCorrection({
      delta: 50,
      reason: 'fix',
      roles: ['manager'],
      beforeBalance: 0,
      largeThreshold: 10,
      largeApproved: true,
      authorized: true,
    }).ok,
    false,
  );
  assert.equal(
    assertBonusCorrection({
      delta: 50,
      reason: 'fix',
      roles: ['admin'],
      beforeBalance: 0,
      largeThreshold: 10,
    }).ok,
    true,
  );
});

test('assertOptionalUzPhone and email', () => {
  assert.equal(assertOptionalUzPhone('').ok, true);
  assert.equal(assertOptionalUzPhone('bad').ok, false);
  assert.equal(assertOptionalUzPhone('+998901234567').ok, true);
  assert.equal(assertOptionalUzPhone('8 88 111 22 33').ok, true);
  assert.equal(assertOptionalUzPhone('8 88 111 22 33').normalized, '998881112233');
  assert.equal(assertOptionalEmail('a@b.com').ok, true);
  assert.equal(assertOptionalEmail('not-an-email').ok, false);
});

test('assertInitialBonusPoints rejects text and over-limit', () => {
  assert.equal(assertInitialBonusPoints('abc').ok, false);
  assert.equal(assertInitialBonusPoints(50).ok, true);
  assert.equal(assertInitialBonusPoints(999999, { maxInitial: 100 }).ok, false);
});

test('shouldShowZeroSettlePaymentUi hides after cart clear', () => {
  assert.equal(shouldShowZeroSettlePaymentUi({ cartLength: 0, total: 0 }), false);
  assert.equal(shouldShowZeroSettlePaymentUi({ cartLength: 2, total: 0 }), true);
});

test('isZeroTotalSaleAllowed: 100% discount vs unauthorized', () => {
  assert.equal(
    isZeroTotalSaleAllowed({ subtotal: 5000, discountAmount: 5000 }),
    true,
  );
  assert.equal(
    isZeroTotalSaleAllowed({ subtotal: 5000, discountAmount: 0, userRole: 'cashier' }),
    false,
  );
});

test('sale → full return → net 0; partial → half net', () => {
  const full = computeOrderReturnMoney({
    grossTotal: 2000,
    items: [{ quantity: 1, returned_quantity: 1, final_total: 2000 }],
  });
  assert.equal(full.net_total, 0);
  assert.equal(full.return_status, 'fully_returned');

  const partial = computeOrderReturnMoney({
    grossTotal: 2000,
    items: [{ quantity: 2, returned_quantity: 1, final_total: 2000 }],
  });
  assert.equal(partial.net_total, 1000);
  assert.equal(partial.return_status, 'partially_returned');
  assert.equal(
    deriveOrderReturnStatus([{ quantity: 2, returned_quantity: 1 }]),
    'partially_returned',
  );
});

test('credit overpay creates advance via allocatePaymentInToDebtAndAdvance', () => {
  const r = allocatePaymentInToDebtAndAdvance(-2000, 5000);
  assert.equal(r.debt_portion, 2000);
  assert.equal(r.advance_portion, 3000);
  assert.equal(r.new_balance, 3000);
});

test('fully returned line has availableToReturn 0; partial capped', () => {
  assert.equal(availableToReturnQty(5, 5), 0);
  assert.equal(availableToReturnQty(5, 2), 3);
  assert.equal(assertReturnQtyAllowed(5, 5, 1).ok, false);
  assert.equal(assertReturnQtyAllowed(5, 5, 1).code, RETURN_LIMIT_EXCEEDED_CODE);
  assert.equal(assertReturnQtyAllowed(5, 2, 3).ok, true);
  assert.equal(assertReturnQtyAllowed(5, 2, 4).ok, false);
});

test('isSalesReturnFullyExhausted blocks fully returned orders', () => {
  assert.equal(
    isSalesReturnFullyExhausted({ return_status: 'fully_returned', net_total: 0 }),
    true,
  );
  assert.equal(
    isSalesReturnFullyExhausted({
      gross_total: 2000,
      returned_total: 2000,
      net_total: 0,
    }),
    true,
  );
  assert.equal(
    canCreateSalesReturnForOrder({
      return_status: 'partially_returned',
      gross_total: 2000,
      returned_total: 1000,
      net_total: 1000,
    }),
    true,
  );
  assert.equal(
    isSalesReturnFullyExhausted({
      items: [{ quantity: 2, returned_quantity: 2 }],
      gross_total: 1000,
    }),
    true,
  );
});

test('over-limit stock adjust blocked for cashier; manager allowed', () => {
  const blocked = assertStockAdjustmentQty(DEFAULT_MAX_STOCK_ADJUSTMENT + 1, {
    maxQty: DEFAULT_MAX_STOCK_ADJUSTMENT,
    userRole: 'cashier',
  });
  assert.equal(blocked.ok, false);
  const managerOk = assertStockAdjustmentQty(DEFAULT_MAX_STOCK_ADJUSTMENT + 1, {
    maxQty: DEFAULT_MAX_STOCK_ADJUSTMENT,
    userRole: 'manager',
  });
  assert.equal(managerOk.ok, true);
});

test('inventory revision: warehouse can manage but only manager/admin approve complete', () => {
  assert.equal(roleCanApproveInventoryRevision('warehouse'), false);
  assert.equal(roleCanApproveInventoryRevision('cashier'), false);
  assert.equal(roleCanApproveInventoryRevision('manager'), true);
  assert.equal(roleCanApproveInventoryRevision('admin'), true);
  assert.equal(roleCanManageInventoryRevision('warehouse'), true);
  assert.equal(roleCanManageInventoryRevision('receiver'), true);
  assert.equal(roleCanManageInventoryRevision('cashier'), false);
});

test('zero sale price blocked unless free_sale_allowed', () => {
  assert.equal(isProductPriceNotSet({ sale_price: 0 }), true);
  assert.equal(assertProductSalePriceAllowed(0, { freeSaleAllowed: false }).ok, false);
  assert.equal(assertProductSalePriceAllowed(0, { freeSaleAllowed: true }).ok, true);
  assert.equal(
    bulkPriceChangeRequiresApproval({ productCount: 25, userRole: 'cashier' }).missing,
    true,
  );
});
