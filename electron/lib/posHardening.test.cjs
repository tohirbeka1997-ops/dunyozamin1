'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePositiveMoneyAmount,
  parseNonNegativeMoneyAmount,
  requiresShiftVarianceReason,
  SHIFT_VARIANCE_REASON_THRESHOLD,
  allocatePaymentInToDebtAndAdvance,
  assertDueDateNotBeforeToday,
  maskPhoneForExport,
  phoneToTelHref,
  isOutOfStockForSale,
  findInsufficientStockLines,
  shouldShowZeroSettlePaymentUi,
  isZeroTotalSaleAllowed,
  deriveOrderReturnStatus,
  computeOrderReturnMoney,
  availableToReturnQty,
  assertReturnQtyAllowed,
  assertStockAdjustmentQty,
  DEFAULT_MAX_STOCK_ADJUSTMENT,
} = require('./posHardening.cjs');

describe('parsePositiveMoneyAmount', () => {
  it('accepts positive integers and 2-decimal amounts', () => {
    assert.deepEqual(parsePositiveMoneyAmount(1000), { ok: true, amount: 1000 });
    assert.deepEqual(parsePositiveMoneyAmount('12.5'), { ok: true, amount: 12.5 });
    assert.deepEqual(parsePositiveMoneyAmount('12.50'), { ok: true, amount: 12.5 });
  });

  it('rejects negative, zero, empty, letters, and >2 decimals', () => {
    assert.equal(parsePositiveMoneyAmount(-1000).ok, false);
    assert.equal(parsePositiveMoneyAmount(0).ok, false);
    assert.equal(parsePositiveMoneyAmount('').ok, false);
    assert.equal(parsePositiveMoneyAmount('abc').ok, false);
    assert.equal(parsePositiveMoneyAmount('1.234').ok, false);
    assert.equal(parsePositiveMoneyAmount('-1').ok, false);
  });
});

describe('parseNonNegativeMoneyAmount', () => {
  it('allows zero closing cash and rejects negatives', () => {
    assert.deepEqual(parseNonNegativeMoneyAmount(0), { ok: true, amount: 0 });
    assert.equal(parseNonNegativeMoneyAmount(-1).ok, false);
    assert.equal(parseNonNegativeMoneyAmount('-1').ok, false);
  });
});

describe('requiresShiftVarianceReason', () => {
  it('requires reason when |diff| >= threshold', () => {
    const expected = 100000;
    const closing = expected + SHIFT_VARIANCE_REASON_THRESHOLD;
    const missing = requiresShiftVarianceReason(closing, expected, '');
    assert.equal(missing.required, true);
    assert.equal(missing.missing, true);
    const ok = requiresShiftVarianceReason(closing, expected, 'counted twice');
    assert.equal(ok.required, true);
    assert.equal(ok.missing, false);
  });

  it('does not require reason for small variance', () => {
    const r = requiresShiftVarianceReason(100, 50, '');
    assert.equal(r.required, false);
  });
});

describe('allocatePaymentInToDebtAndAdvance', () => {
  it('closes debt then puts excess into advance', () => {
    const r = allocatePaymentInToDebtAndAdvance(-5000, 10000);
    assert.equal(r.debt_portion, 5000);
    assert.equal(r.advance_portion, 5000);
    assert.equal(r.new_balance, 5000);
  });

  it('with no debt, full amount becomes advance', () => {
    const r = allocatePaymentInToDebtAndAdvance(0, 3000);
    assert.equal(r.debt_portion, 0);
    assert.equal(r.advance_portion, 3000);
    assert.equal(r.new_balance, 3000);
  });

  it('partial debt payment leaves remaining debt', () => {
    const r = allocatePaymentInToDebtAndAdvance(-8000, 3000);
    assert.equal(r.debt_portion, 3000);
    assert.equal(r.advance_portion, 0);
    assert.equal(r.new_balance, -5000);
  });

  it('existing advance grows on payment_in', () => {
    const r = allocatePaymentInToDebtAndAdvance(2000, 1000);
    assert.equal(r.debt_portion, 0);
    assert.equal(r.advance_portion, 1000);
    assert.equal(r.new_balance, 3000);
  });
});

describe('assertDueDateNotBeforeToday', () => {
  it('rejects past dates and accepts today/future', () => {
    assert.equal(assertDueDateNotBeforeToday('2020-01-01', '2026-08-27').ok, false);
    assert.equal(assertDueDateNotBeforeToday('2026-08-27', '2026-08-27').ok, true);
    assert.equal(assertDueDateNotBeforeToday('2026-09-01', '2026-08-27').ok, true);
  });
});

describe('maskPhoneForExport / phoneToTelHref', () => {
  it('masks middle digits and builds tel href', () => {
    assert.match(maskPhoneForExport('+998901234567'), /\*\*\*/);
    assert.equal(phoneToTelHref('+998 90 123-45-67'), 'tel:+998901234567');
  });
});

describe('stock helpers', () => {
  it('blocks out-of-stock tracked products', () => {
    assert.equal(isOutOfStockForSale({ current_stock: 0, track_stock: true }), true);
  });

  it('finds oversell lines', () => {
    const lines = findInsufficientStockLines([
      { product: { id: 'p1', name: 'A', current_stock: 1, track_stock: true }, qty_base: 2 },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].available, 1);
  });
});

describe('payment dialog zero-settle guard', () => {
  it('hides zero-settle UI when cart cleared after sale', () => {
    assert.equal(shouldShowZeroSettlePaymentUi({ cartLength: 0, total: 0 }), false);
    assert.equal(shouldShowZeroSettlePaymentUi({ cartLength: 1, total: 0 }), true);
    assert.equal(shouldShowZeroSettlePaymentUi({ cartLength: 1, total: 2000 }), false);
  });
});

describe('isZeroTotalSaleAllowed', () => {
  it('allows 100% discount / promo / loyalty / admin', () => {
    assert.equal(
      isZeroTotalSaleAllowed({ subtotal: 2000, discountAmount: 2000 }),
      true,
    );
    assert.equal(isZeroTotalSaleAllowed({ subtotal: 2000, hasPromo: true }), true);
    assert.equal(
      isZeroTotalSaleAllowed({ subtotal: 2000, loyaltyRedeemPoints: 50 }),
      true,
    );
    assert.equal(isZeroTotalSaleAllowed({ subtotal: 2000, userRole: 'admin' }), true);
  });

  it('rejects unauthorized bare zero total', () => {
    assert.equal(
      isZeroTotalSaleAllowed({ subtotal: 0, discountAmount: 0, userRole: 'cashier' }),
      false,
    );
    assert.equal(
      isZeroTotalSaleAllowed({ subtotal: 2000, discountAmount: 0, userRole: 'cashier' }),
      false,
    );
  });
});

describe('order return status / net totals', () => {
  it('derives not / partial / full return status', () => {
    assert.equal(
      deriveOrderReturnStatus([{ quantity: 2, returned_quantity: 0 }]),
      'not_returned',
    );
    assert.equal(
      deriveOrderReturnStatus([{ quantity: 2, returned_quantity: 1 }]),
      'partially_returned',
    );
    assert.equal(
      deriveOrderReturnStatus([{ quantity: 2, returned_quantity: 2 }]),
      'fully_returned',
    );
  });

  it('computes returned and net totals after full/partial return', () => {
    const full = computeOrderReturnMoney({
      grossTotal: 2000,
      items: [{ quantity: 1, returned_quantity: 1, final_total: 2000 }],
    });
    assert.equal(full.returned_total, 2000);
    assert.equal(full.net_total, 0);
    assert.equal(full.return_status, 'fully_returned');

    const partial = computeOrderReturnMoney({
      grossTotal: 2000,
      items: [{ quantity: 2, returned_quantity: 1, final_total: 2000 }],
    });
    assert.equal(partial.returned_total, 1000);
    assert.equal(partial.net_total, 1000);
    assert.equal(partial.return_status, 'partially_returned');
  });

  it('blocks re-return when availableToReturn is 0', () => {
    assert.equal(availableToReturnQty(3, 3), 0);
    const blocked = assertReturnQtyAllowed(3, 3, 1);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'CONFLICT');
  });

  it('blocks over-limit stock adjustment for cashier', () => {
    const blocked = assertStockAdjustmentQty(DEFAULT_MAX_STOCK_ADJUSTMENT + 5, {
      userRole: 'cashier',
    });
    assert.equal(blocked.ok, false);
  });
});
