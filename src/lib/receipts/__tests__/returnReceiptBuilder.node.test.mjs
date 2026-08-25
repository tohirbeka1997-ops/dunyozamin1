/**
 * Return receipt builder smoke (no TS import — mirrors receiptLineQty + HTML).
 * Run: npm run test:return-receipt
 */
import assert from 'node:assert/strict';

function shouldShowOnReceipt(item) {
  const qtySale = Number(item?.qty_sale ?? item?.quantity ?? 0) || 0;
  if (qtySale < 0) return true;
  const returned = Number(item?.returned_quantity ?? 0) || 0;
  if (item?.remaining_quantity != null && item?.remaining_quantity !== '') {
    return (Number(item.remaining_quantity) || 0) > 0;
  }
  return qtySale - returned > 0;
}

function buildThermalHtml(returnData) {
  const items = (returnData.items || []).map((item) => {
    const name = String(item.product_name || item.product?.name || 'Mahsulot');
    const qty = Number(item.qty_sale ?? item.quantity ?? 0);
    return `<div class="font-medium">${name}</div><span>${qty} x</span>`;
  });
  return `<div class="return-receipt-thermal">${items.join('')}</div>`;
}

assert.equal(shouldShowOnReceipt({ qty_sale: -2 }), true);
assert.equal(shouldShowOnReceipt({ quantity: 3, returned_quantity: 3 }), false);

const html = buildThermalHtml({
  return_number: 'RET-1',
  items: [{ product_name: 'Non', quantity: 1, unit_price: 5000, line_total: 5000 }],
});
assert.ok(html.includes('Non'), 'product on receipt');
assert.ok(html.includes('1 x'), 'qty on receipt');

console.log('returnReceiptBuilder.node.test.mjs OK');
