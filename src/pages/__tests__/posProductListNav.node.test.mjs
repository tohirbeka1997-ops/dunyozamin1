/**
 * POS product-list keyboard navigation math.
 * Run: node --test src/pages/__tests__/posProductListNav.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const POS_SCAN_DEDUPE_MS = 350;

function clampListIndex(index, length) {
  const len = Math.max(0, Math.trunc(Number(length) || 0));
  if (len <= 0) return -1;
  const raw = Number(index);
  const i = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  return Math.max(0, Math.min(len - 1, i));
}

function stepListIndex(index, length, delta) {
  const len = Math.max(0, Math.trunc(Number(length) || 0));
  if (len <= 0) return -1;
  const from = index < 0 ? (Number(delta) > 0 ? -1 : 0) : index;
  return clampListIndex(from + Number(delta || 0), len);
}

function activateListIndex(length, previousIndex = 0) {
  if (previousIndex >= 0) return clampListIndex(previousIndex, length);
  return clampListIndex(0, length);
}

function isRecentScanDedupe(lastAt, now, windowMs = POS_SCAN_DEDUPE_MS) {
  return Number(now) - Number(lastAt) < Number(windowMs);
}

function isProductListJumpKey(key, opts) {
  if (key === 'F4') return true;
  if (!opts.fromSearch) return false;
  if (key === 'ArrowDown') return true;
  if (key === 'Tab' && !opts.shiftKey) return true;
  return false;
}

function isCartJumpKey(key, opts) {
  if (Math.max(0, Math.trunc(Number(opts.cartLength) || 0)) <= 0) return false;
  if (key === 'F5') return true;
  if (opts.fromList && key === 'Tab' && !opts.shiftKey) return true;
  return false;
}

/** Mirrors posTerminalHelpers.canToggleExchangeReturnMode — empty cart is allowed. */
function canToggleExchangeReturnMode(opts) {
  void opts.cartLength;
  if (opts.paymentDialogOpen || opts.waitingOrdersDialogOpen) return false;
  return true;
}

function isPosTypingTarget(opts) {
  const tag = String(opts.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (opts.isContentEditable) return true;
  if (opts.insideCombobox) return true;
  const role = String(opts.role || '').toLowerCase();
  if (role === 'combobox' || role === 'listbox' || role === 'spinbutton') return true;
  return false;
}

function clampListIndexLocal(index, length) {
  const len = Math.max(0, Math.trunc(Number(length) || 0));
  if (len <= 0) return -1;
  const raw = Number(index);
  const i = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  return Math.max(0, Math.min(len - 1, i));
}

function planCartLineQtyStep(qtySale, direction) {
  const raw = Number(qtySale);
  const current = Number.isFinite(raw) ? raw : 0;
  if (direction > 0) {
    const next = current + 1;
    if (next === 0) return { action: 'remove', nextQty: 0 };
    return { action: 'update', nextQty: next };
  }
  if (current === 0) return { action: 'noop', nextQty: 0 };
  if (current > 0) {
    const next = current - 1;
    return next <= 0 ? { action: 'remove', nextQty: 0 } : { action: 'update', nextQty: next };
  }
  return { action: 'update', nextQty: current - 1 };
}

function resolveListLeftCartIndex(selectedCartIndex, cartLength) {
  const len = Math.max(0, Math.trunc(Number(cartLength) || 0));
  if (len <= 0) return -1;
  if (selectedCartIndex >= 0) return clampListIndexLocal(selectedCartIndex, len);
  return 0;
}

function nextCartIndexAfterLineChange(index, cartLengthBefore, removed) {
  const before = Math.max(0, Math.trunc(Number(cartLengthBefore) || 0));
  if (before <= 0) return -1;
  const after = removed ? before - 1 : before;
  if (after <= 0) return -1;
  return clampListIndexLocal(index, after);
}

test('clampListIndex clamps ends and empty list', () => {
  assert.equal(clampListIndex(0, 0), -1);
  assert.equal(clampListIndex(3, 0), -1);
  assert.equal(clampListIndex(-2, 5), 0);
  assert.equal(clampListIndex(9, 5), 4);
  assert.equal(clampListIndex(2, 5), 2);
  assert.equal(clampListIndex(Number.NaN, 5), 0);
});

test('stepListIndex does not wrap past ends', () => {
  assert.equal(stepListIndex(0, 4, -1), 0);
  assert.equal(stepListIndex(3, 4, 1), 3);
  assert.equal(stepListIndex(1, 4, 1), 2);
  assert.equal(stepListIndex(-1, 4, 1), 0);
  assert.equal(stepListIndex(2, 0, 1), -1);
});

test('activateListIndex keeps a valid previous row or starts at 0', () => {
  assert.equal(activateListIndex(8, -1), 0);
  assert.equal(activateListIndex(8, 3), 3);
  assert.equal(activateListIndex(3, 9), 2);
  assert.equal(activateListIndex(0, 2), -1);
});

test('isProductListJumpKey: F4 / search ArrowDown / search Tab, not F2/F3/F8/F9', () => {
  assert.equal(isProductListJumpKey('F4', { fromSearch: false }), true);
  assert.equal(isProductListJumpKey('ArrowDown', { fromSearch: true }), true);
  assert.equal(isProductListJumpKey('Tab', { fromSearch: true }), true);
  assert.equal(isProductListJumpKey('Tab', { fromSearch: true, shiftKey: true }), false);
  assert.equal(isProductListJumpKey('ArrowDown', { fromSearch: false }), false);
  assert.equal(isProductListJumpKey('F2', { fromSearch: true }), false);
  assert.equal(isProductListJumpKey('F3', { fromSearch: true }), false);
  assert.equal(isProductListJumpKey('F8', { fromSearch: false }), false);
  assert.equal(isProductListJumpKey('F9', { fromSearch: false }), false);
  assert.equal(isProductListJumpKey('F5', { fromSearch: true }), false);
  assert.equal(isProductListJumpKey('Enter', { fromSearch: true }), false);
});

test('isRecentScanDedupe matches the 350ms scanner window', () => {
  assert.equal(isRecentScanDedupe(1000, 1349), true);
  assert.equal(isRecentScanDedupe(1000, 1350), false);
  assert.equal(isRecentScanDedupe(1000, 2000), false);
});

test('isCartJumpKey: F5 / list Tab, not empty cart or search Tab', () => {
  assert.equal(isCartJumpKey('F5', { fromList: false, cartLength: 2 }), true);
  assert.equal(isCartJumpKey('Tab', { fromList: true, cartLength: 1 }), true);
  assert.equal(isCartJumpKey('Tab', { fromList: true, cartLength: 1, shiftKey: true }), false);
  assert.equal(isCartJumpKey('Tab', { fromList: false, cartLength: 2 }), false);
  assert.equal(isCartJumpKey('F5', { fromList: true, cartLength: 0 }), false);
  assert.equal(isCartJumpKey('F4', { fromList: true, cartLength: 2 }), false);
  assert.equal(isCartJumpKey('ArrowRight', { fromList: true, cartLength: 2 }), false);
});

test('canToggleExchangeReturnMode: empty cart is allowed; overlays block F8', () => {
  assert.equal(
    canToggleExchangeReturnMode({
      cartLength: 0,
      paymentDialogOpen: false,
      waitingOrdersDialogOpen: false,
    }),
    true,
  );
  assert.equal(
    canToggleExchangeReturnMode({
      cartLength: 3,
      paymentDialogOpen: false,
      waitingOrdersDialogOpen: false,
    }),
    true,
  );
  assert.equal(
    canToggleExchangeReturnMode({
      cartLength: 0,
      paymentDialogOpen: true,
      waitingOrdersDialogOpen: false,
    }),
    false,
  );
  assert.equal(
    canToggleExchangeReturnMode({
      cartLength: 2,
      paymentDialogOpen: false,
      waitingOrdersDialogOpen: true,
    }),
    false,
  );
});

test('isPosTypingTarget blocks inputs, MoneyInput-like fields, and combobox', () => {
  assert.equal(isPosTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isPosTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isPosTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isPosTypingTarget({ tagName: 'DIV', role: 'combobox' }), true);
  assert.equal(isPosTypingTarget({ tagName: 'DIV', insideCombobox: true }), true);
  assert.equal(isPosTypingTarget({ tagName: 'DIV' }), false);
});

test('planCartLineQtyStep: +1, first-line −1, clamp to remove at 0, empty noop', () => {
  assert.deepEqual(planCartLineQtyStep(2, 1), { action: 'update', nextQty: 3 });
  assert.deepEqual(planCartLineQtyStep(3, -1), { action: 'update', nextQty: 2 });
  assert.deepEqual(planCartLineQtyStep(1, -1), { action: 'remove', nextQty: 0 });
  assert.deepEqual(planCartLineQtyStep(0.4, -1), { action: 'remove', nextQty: 0 });
  assert.deepEqual(planCartLineQtyStep(0, -1), { action: 'noop', nextQty: 0 });
  assert.deepEqual(planCartLineQtyStep(Number.NaN, -1), { action: 'noop', nextQty: 0 });
  assert.deepEqual(planCartLineQtyStep(-1, 1), { action: 'remove', nextQty: 0 });
  assert.deepEqual(planCartLineQtyStep(-2, -1), { action: 'update', nextQty: -3 });
});

test('resolveListLeftCartIndex prefers selected line, else first; empty cart is -1', () => {
  assert.equal(resolveListLeftCartIndex(-1, 0), -1);
  assert.equal(resolveListLeftCartIndex(0, 0), -1);
  assert.equal(resolveListLeftCartIndex(-1, 3), 0);
  assert.equal(resolveListLeftCartIndex(2, 3), 2);
  assert.equal(resolveListLeftCartIndex(9, 3), 2);
});

test('nextCartIndexAfterLineChange clamps after remove and empties to -1', () => {
  assert.equal(nextCartIndexAfterLineChange(0, 3, false), 0);
  assert.equal(nextCartIndexAfterLineChange(0, 3, true), 0);
  assert.equal(nextCartIndexAfterLineChange(2, 3, true), 1);
  assert.equal(nextCartIndexAfterLineChange(0, 1, true), -1);
  assert.equal(nextCartIndexAfterLineChange(0, 0, true), -1);
});
