/**
 * Node unit tests for purchaseHardening (no Electron).
 * Run: node src/lib/purchase/__tests__/purchaseHardening.node.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const {
  computePurchasePaymentStatus,
  splitPaymentAgainstRemainder,
  validateConfirmReceiveInput,
  computeReceivableQty,
  canAcceptSupplierOverpayAsAdvance,
  computeFxDiffAmount,
  normalizePurchaseRole,
} = require(path.join(root, 'electron/lib/purchaseHardening.cjs'));

assert.equal(computePurchasePaymentStatus(150, 100), 'OVERPAID');
assert.equal(computePurchasePaymentStatus(100, 100), 'PAID');
assert.equal(computePurchasePaymentStatus(40, 100), 'PARTIALLY_PAID');

const split = splitPaymentAgainstRemainder(120, 100, 'UZS');
assert.equal(split.settleAmount, 100);
assert.equal(split.advanceAmount, 20);
assert.equal(split.requiresAdvanceAck, true);

const bad = validateConfirmReceiveInput({
  supplier_id: '',
  items: [{ product_id: 'p', received_qty: 0, unit_cost: 0 }],
  received_at: '',
  currency: 'UZS',
});
assert.equal(bad.ok, false);

assert.equal(computeReceivableQty(10, 4, 1), 5);
assert.equal(canAcceptSupplierOverpayAsAdvance('admin'), true);
assert.equal(canAcceptSupplierOverpayAsAdvance('cashier'), false);

assert.equal(normalizePurchaseRole('warehouse'), 'receiver');
assert.equal(normalizePurchaseRole('buxgalter'), 'accountant');

const fxLoss = computeFxDiffAmount({
  settleAmountInPoCurrency: 10,
  poCurrency: 'USD',
  poFxRate: 12000,
  paymentFxRate: 12500,
});
assert.equal(fxLoss, 5000);

const fxNone = computeFxDiffAmount({
  settleAmountInPoCurrency: 10,
  poCurrency: 'UZS',
  poFxRate: 12000,
  paymentFxRate: 12500,
});
assert.equal(fxNone, null);

console.log('purchaseHardening.node.test.mjs: ok');
