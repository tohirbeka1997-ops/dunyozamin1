/**
 * Checkout session lifecycle + nav-cart draft persistence.
 * Run: node src/pages/__tests__/postTerminalCheckout.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const POS_NAV_CART_DRAFT_KEY = 'pos:nav_cart_draft';

function buildCheckoutIdempotencySignature(input) {
  const lines = (input.lines || [])
    .map(
      (l) =>
        `${l.productId}:${Number(l.qtyBase) || 0}:${Number(l.unitPrice) || 0}:${Number(l.discountAmount) || 0}`,
    )
    .join('|');
  const meta = [
    `c=${input.customerId ?? ''}`,
    `dt=${input.discountType ?? ''}`,
    `dv=${input.discountValue ?? ''}`,
    `cur=${input.saleCurrency ?? ''}`,
    `lp=${Number(input.loyaltyRedeemPoints) || 0}`,
  ].join(';');
  return `${lines}#${meta}`;
}

function createSessionStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function readPosNavCartDraft(sessionStorage) {
  try {
    const raw = sessionStorage.getItem(POS_NAV_CART_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistPosNavCartDraft(sessionStorage, draft) {
  if (!draft || !draft.lines.length) {
    sessionStorage.removeItem(POS_NAV_CART_DRAFT_KEY);
    return;
  }
  sessionStorage.setItem(POS_NAV_CART_DRAFT_KEY, JSON.stringify(draft));
}

function clearPosNavCartDraft(sessionStorage) {
  persistPosNavCartDraft(sessionStorage, null);
}

/** Mirrors POSTerminal clearCartAndNavDraft + restore guard after successful sale. */
function simulateCheckoutCartClear(sessionStorage, state) {
  clearPosNavCartDraft(sessionStorage);
  state.navCartDraftRestored = true;
  state.cart = [];
}

function shouldRestoreNavCartDraft(sessionStorage, state) {
  if (state.navCartDraftRestored) return false;
  if (state.cart.length > 0) return false;
  const draft = readPosNavCartDraft(sessionStorage);
  return Boolean(draft?.lines?.length);
}

test('new basket after sale gets a fresh idempotency signature', () => {
  const sigBefore = buildCheckoutIdempotencySignature({
    lines: [{ productId: 'p1', qtyBase: 2, unitPrice: 10000, discountAmount: 0 }],
    customerId: 'c1',
  });
  const sigAfterClear = buildCheckoutIdempotencySignature({ lines: [], customerId: null });
  assert.notEqual(sigBefore, sigAfterClear);
});

test('retry of the same basket keeps the same idempotency signature', () => {
  const lines = [{ productId: 'p1', qtyBase: 1, unitPrice: 5000, discountAmount: 0 }];
  const sig1 = buildCheckoutIdempotencySignature({ lines, customerId: null });
  const sig2 = buildCheckoutIdempotencySignature({ lines, customerId: null });
  assert.equal(sig1, sig2);
});

test('successful checkout clears nav cart draft and blocks restore', () => {
  const sessionStorage = createSessionStorageMock();
  const state = { cart: [{ productId: 'p1' }], navCartDraftRestored: false };

  persistPosNavCartDraft(sessionStorage, {
    lines: [{ productId: 'p1', quantity: 1, unit_price: 1000, discount_amount: 0, subtotal: 1000, total: 1000 }],
  });
  assert.ok(readPosNavCartDraft(sessionStorage));

  simulateCheckoutCartClear(sessionStorage, state);

  assert.equal(state.cart.length, 0);
  assert.equal(readPosNavCartDraft(sessionStorage), null);
  assert.equal(shouldRestoreNavCartDraft(sessionStorage, state), false);
});

test('empty cart without draft clear would incorrectly restore (regression guard)', () => {
  const sessionStorage = createSessionStorageMock();
  const state = { cart: [], navCartDraftRestored: false };

  persistPosNavCartDraft(sessionStorage, {
    lines: [{ productId: 'p1', quantity: 5, unit_price: 1000, discount_amount: 0, subtotal: 5000, total: 5000 }],
  });

  // Old bug: setCart([]) alone left draft in sessionStorage → restore fired.
  assert.equal(shouldRestoreNavCartDraft(sessionStorage, state), true);
});

/** Mirrors posTerminalHelpers.getCartLineQuantitySign */
function getCartLineQuantitySign(exchangeReturnMode) {
  return exchangeReturnMode ? -1 : 1;
}

test('return mode applies negative sign when adding cart lines', () => {
  assert.equal(getCartLineQuantitySign(false), 1);
  assert.equal(getCartLineQuantitySign(true), -1);
  assert.equal(1 * getCartLineQuantitySign(true), -1);
});

const POS_REPLACES_ORDER_ID_KEY = 'pos_replaces_order_id';

function readPosReplacesOrderId(sessionStorage) {
  try {
    const v = sessionStorage.getItem(POS_REPLACES_ORDER_ID_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Mirrors posTerminalHelpers.resolveReplacesOrderIdForCheckout */
function resolveReplacesOrderIdForCheckout(
  importedOrderIdForEdit,
  importedHoldOrderId = null,
  sessionStorage = null,
) {
  if (importedHoldOrderId) return null;
  if (importedOrderIdForEdit) return importedOrderIdForEdit;
  return sessionStorage ? readPosReplacesOrderId(sessionStorage) : null;
}

test('amend checkout prefers in-memory edit id', () => {
  assert.equal(resolveReplacesOrderIdForCheckout('order-a', null), 'order-a');
});

test('amend checkout never sends replaces_order_id for hold import', () => {
  const ss = createSessionStorageMock();
  ss.setItem(POS_REPLACES_ORDER_ID_KEY, 'stale-completed');
  assert.equal(resolveReplacesOrderIdForCheckout(null, 'hold-1', ss), null);
});

test('amend checkout falls back to sessionStorage when edit state lost', () => {
  const ss = createSessionStorageMock();
  ss.setItem(POS_REPLACES_ORDER_ID_KEY, 'order-completed-42');
  assert.equal(resolveReplacesOrderIdForCheckout(null, null, ss), 'order-completed-42');
});

test('fresh sale checkout sends no replaces_order_id', () => {
  const ss = createSessionStorageMock();
  assert.equal(resolveReplacesOrderIdForCheckout(null, null, ss), null);
});

function computeOrderOutstandingForAmend(order) {
  const total = Number(order.total_amount ?? 0) || 0;
  const paid = Number(order.paid_amount ?? 0) || 0;
  return Math.max(0, total - paid);
}

function netPriorDebtForAmendCheckout(priorDebt, importedOrderOutstanding, isAmendCheckout) {
  const raw = Math.max(0, Number(priorDebt) || 0);
  const overlap = Math.max(0, Number(importedOrderOutstanding) || 0);
  if (!isAmendCheckout || overlap <= 0) return raw;
  return Math.max(0, raw - overlap);
}

test('amend checkout nets prior debt overlapping edited order outstanding', () => {
  const outstanding = computeOrderOutstandingForAmend({
    total_amount: 350000,
    paid_amount: 287000,
  });
  assert.equal(outstanding, 63000);
  assert.equal(netPriorDebtForAmendCheckout(63000, outstanding, true), 0);
  assert.equal(netPriorDebtForAmendCheckout(83000, outstanding, true), 20000);
});

test('fresh sale keeps full prior debt at checkout', () => {
  assert.equal(netPriorDebtForAmendCheckout(63000, 63000, false), 63000);
});

/** Mirrors posTerminalHelpers.computeCheckoutGrandTotal */
function computeCheckoutGrandTotal(saleTotal, priorDebt, includePriorDebt) {
  const total = Number(saleTotal) || 0;
  if (total <= 0) return total;
  const extra =
    includePriorDebt && (Number(priorDebt) || 0) > 0 ? Math.max(0, Number(priorDebt) || 0) : 0;
  return total + extra;
}

test('checkout To\'lash defaults to sale total without prior debt', () => {
  assert.equal(computeCheckoutGrandTotal(195000, 3972000, false), 195000);
  assert.equal(computeCheckoutGrandTotal(195000, 3972000, true), 4167000);
});

test('checkout grand total ignores prior debt on refund/exchange totals', () => {
  assert.equal(computeCheckoutGrandTotal(-50000, 3972000, true), -50000);
  assert.equal(computeCheckoutGrandTotal(0, 3972000, true), 0);
});

/** Mirrors posTerminalHelpers.getMaxSaleQtyForCartLine */
function getMaxSaleQtyForCartLine(stockMax, amendOriginalQtySale) {
  const bonus = Math.max(0, Number(amendOriginalQtySale) || 0);
  if (bonus <= 0) return stockMax;
  if (stockMax <= 0) return bonus;
  return stockMax + bonus;
}

test('amend import preserves original qty — max allows stock plus original sold', () => {
  // Sold 200 m, warehouse now 170 m after sale
  assert.equal(getMaxSaleQtyForCartLine(170, 200), 370);
});

test('fresh sale cart line uses warehouse stock only', () => {
  assert.equal(getMaxSaleQtyForCartLine(170, null), 170);
  assert.equal(getMaxSaleQtyForCartLine(170, 0), 170);
});

test('amend line with zero warehouse still allows original sold qty', () => {
  assert.equal(getMaxSaleQtyForCartLine(0, 200), 200);
});

function cartLineQtySale(line) {
  return Number(line.qty_sale ?? line.quantity ?? 0) || 0;
}

function cartOrderDiscountBase(items) {
  let saleSubtotal = 0;
  let saleLineDiscounts = 0;
  let hasSaleLine = false;
  for (const item of items) {
    if (cartLineQtySale(item) <= 0) continue;
    hasSaleLine = true;
    saleSubtotal += Number(item.subtotal || 0);
    saleLineDiscounts += Number(item.discount_amount || 0);
  }
  return {
    hasSaleLine,
    saleSubtotal,
    saleLineDiscounts,
    maxOrderDiscount: Math.max(0, saleSubtotal - saleLineDiscounts),
  };
}

function roundUZS(amount) {
  if (amount == null || !Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

function applyPercentUZS(amount, percent) {
  const a = Number(amount);
  const p = Number(percent);
  if (!Number.isFinite(a) || !Number.isFinite(p) || a <= 0) return 0;
  const pct = Math.max(0, Math.min(100, p));
  return Math.round((a * pct) / 100);
}

/** Mirrors posTerminalHelpers.computeHeldOrderTotal */
function computeHeldOrderTotal(items, orderDiscount, storedTotal) {
  if (storedTotal != null && Number.isFinite(Number(storedTotal))) {
    return roundUZS(Number(storedTotal));
  }
  const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const lineDiscountsTotal = items.reduce(
    (sum, item) => sum + Number(item.discount_amount || 0),
    0,
  );
  const discountBase = cartOrderDiscountBase(items);
  let globalDiscountAmount = 0;
  if (orderDiscount && discountBase.hasSaleLine && Number(orderDiscount.value) > 0) {
    if (orderDiscount.type === 'amount') {
      globalDiscountAmount = roundUZS(orderDiscount.value);
    } else {
      globalDiscountAmount = applyPercentUZS(
        discountBase.maxOrderDiscount,
        orderDiscount.value,
      );
    }
  }
  return roundUZS(subtotal - lineDiscountsTotal - globalDiscountAmount);
}

/** Old WaitingOrdersDialog bug: percent on net of all lines including returns. */
function legacyHeldOrderTotal(items, orderDiscount) {
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  if (!orderDiscount) return itemsTotal;
  if (orderDiscount.type === 'amount') return itemsTotal - orderDiscount.value;
  return itemsTotal - (itemsTotal * orderDiscount.value) / 100;
}

test('held order total: line discounts + amount order discount', () => {
  const items = [
    { qty_sale: 2, subtotal: 100000, discount_amount: 5000, total: 95000 },
  ];
  const total = computeHeldOrderTotal(items, { type: 'amount', value: 10000 });
  assert.equal(total, 85000);
});

test('held order total: percent order discount uses sale lines only (exchange return)', () => {
  const items = [
    { qty_sale: 1, subtotal: 100000, discount_amount: 0, total: 100000 },
    { qty_sale: -1, subtotal: -20000, discount_amount: 0, total: -20000 },
  ];
  const discount = { type: 'percent', value: 10 };
  const total = computeHeldOrderTotal(items, discount);
  assert.equal(total, 70000);
  assert.notEqual(total, legacyHeldOrderTotal(items, discount));
});

test('nav cart draft persists amend outstanding debt for prior-debt netting', () => {
  const sessionStorage = createSessionStorageMock();
  persistPosNavCartDraft(sessionStorage, {
    lines: [{ productId: 'p1', quantity: 2, unit_price: 5000, discount_amount: 0, subtotal: 10000, total: 10000 }],
    replacesOrderId: 'order-credit-1',
    importedOrderOutstanding: 63000,
  });
  const draft = readPosNavCartDraft(sessionStorage);
  assert.equal(draft?.replacesOrderId, 'order-credit-1');
  assert.equal(draft?.importedOrderOutstanding, 63000);
  assert.equal(netPriorDebtForAmendCheckout(63000, draft.importedOrderOutstanding, true), 0);
});

/** Mirrors posTerminalHelpers.resolveLoyaltyRedeemOnOrderImport */
function resolveLoyaltyRedeemOnOrderImport(order, isAmendImport) {
  if (!isAmendImport) return 0;
  return Math.max(0, Math.floor(Number(order.loyalty_redeem_points) || 0));
}

test('amend import restores loyalty redeem points from original order', () => {
  assert.equal(resolveLoyaltyRedeemOnOrderImport({ loyalty_redeem_points: 150 }, true), 150);
  assert.equal(resolveLoyaltyRedeemOnOrderImport({ loyalty_redeem_points: 12.9 }, true), 12);
});

test('hold import does not restore loyalty redeem points', () => {
  assert.equal(resolveLoyaltyRedeemOnOrderImport({ loyalty_redeem_points: 150 }, false), 0);
});

test('nav cart draft persists amend label, hold context, and loyalty redeem', () => {
  const sessionStorage = createSessionStorageMock();
  persistPosNavCartDraft(sessionStorage, {
    lines: [{ productId: 'p1', quantity: 1, unit_price: 1000, discount_amount: 0, subtotal: 1000, total: 1000 }],
    replacesOrderId: 'order-amend-1',
    replacesOrderNumber: 'ORD-1001',
    importedOrderOutstanding: 5000,
    loyaltyRedeemPoints: 80,
  });
  const amendDraft = readPosNavCartDraft(sessionStorage);
  assert.equal(amendDraft?.replacesOrderNumber, 'ORD-1001');
  assert.equal(amendDraft?.loyaltyRedeemPoints, 80);
  assert.equal(amendDraft?.importedHoldOrderId, undefined);

  persistPosNavCartDraft(sessionStorage, {
    lines: [{ productId: 'p2', quantity: 2, unit_price: 2000, discount_amount: 0, subtotal: 4000, total: 4000 }],
    importedHoldOrderId: 'hold-9',
    importedHoldOrderNumber: 'ORD-HOLD-9',
  });
  const holdDraft = readPosNavCartDraft(sessionStorage);
  assert.equal(holdDraft?.importedHoldOrderId, 'hold-9');
  assert.equal(holdDraft?.importedHoldOrderNumber, 'ORD-HOLD-9');
  assert.equal(holdDraft?.replacesOrderId, undefined);
});
