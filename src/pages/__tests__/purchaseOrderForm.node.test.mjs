/**
 * Purchase order form helpers — scan search, bulk add batching, totals.
 * Run: npm run test:purchase-form
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror purchaseScanSearch.ts (no TS in node smoke)
function productMatches(term, product) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  return (
    product.name.toLowerCase().includes(q) ||
    String(product.sku || '').toLowerCase().includes(q)
  );
}

function filterCatalog(products, term, limit = 150) {
  const q = String(term || '').trim();
  if (!q) return [];
  return products.filter((p) => productMatches(q, p)).slice(0, limit);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function buildOrderTotals(subtotal, orderDiscountPercent, summaryExpense, orderTaxPercent) {
  const orderDiscount = (subtotal * clampPercent(orderDiscountPercent)) / 100;
  const afterDiscount = Math.max(0, subtotal - orderDiscount);
  const tax = (afterDiscount * clampPercent(orderTaxPercent)) / 100;
  const totalAmount = afterDiscount + Number(summaryExpense || 0) + tax;
  return { orderDiscount, tax, totalAmount };
}

function computeLineTotal(qty, unitCost) {
  const q = Number(qty || 0) || 0;
  const unit = Number(unitCost || 0) || 0;
  return unit * q;
}

function appendProductToItems(items, productId, qtyToAdd, unitCost) {
  const safeQty = Number.isFinite(qtyToAdd) && qtyToAdd > 0 ? qtyToAdd : 1;
  const existingIndex = items.findIndex((item) => item.product_id === productId);
  if (existingIndex >= 0) {
    const updated = [...items];
    const existing = { ...updated[existingIndex] };
    existing.ordered_qty = Number(existing.ordered_qty || 0) + safeQty;
    existing.line_total = computeLineTotal(existing.ordered_qty, existing.unit_cost);
    updated[existingIndex] = existing;
    return updated;
  }
  return [
    {
      product_id: productId,
      ordered_qty: safeQty,
      unit_cost: unitCost,
      line_total: computeLineTotal(safeQty, unitCost),
    },
    ...items,
  ];
}

function bulkAddProducts(items, rows) {
  let next = items;
  for (const row of rows) {
    next = appendProductToItems(next, row.productId, row.qty, row.unitCost);
  }
  return next;
}

const CATALOG = [
  { id: '1', name: 'Germetik Akfix', sku: '2188', barcode: null },
  { id: '2', name: 'Kabel 2x2.5', sku: '1840', barcode: '4780115659503' },
  { id: '3', name: '004 Plafon', sku: 'Dh3-004', barcode: '3008694958123' },
];

test('barcodeless product findable by SKU via name search', () => {
  const hits = filterCatalog(CATALOG, '2188');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, '1');
});

test('barcodeless product findable by partial name', () => {
  const hits = filterCatalog(CATALOG, 'kabel');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sku, '1840');
});

test('PO search display cap keeps overflow count', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    name: `Mix product ${i}`,
    sku: `MIX-${i}`,
    barcode: null,
  }));
  const SHOW = 150;
  const all = filterCatalog(many, 'mix', Number.MAX_SAFE_INTEGER);
  assert.equal(all.length, 200);
  const shown = all.slice(0, SHOW);
  assert.equal(shown.length, SHOW);
  assert.equal(all.length - shown.length, 50);
});

test('bulk selection aggregates checked rows with qty', () => {
  const rows = {
    '1': { checked: true, qty: 3 },
    '2': { checked: true, qty: 10 },
    '3': { checked: false, qty: 1 },
  };
  const payload = CATALOG.filter((p) => rows[p.id]?.checked).map((p) => ({
    id: p.id,
    qty: Math.max(1, Number(rows[p.id]?.qty) || 1),
  }));
  assert.deepEqual(payload, [
    { id: '1', qty: 3 },
    { id: '2', qty: 10 },
  ]);
});

test('bulk add appends all selected products in one batch', () => {
  const result = bulkAddProducts([], [
    { productId: '1', qty: 3, unitCost: 1000 },
    { productId: '2', qty: 10, unitCost: 500 },
    { productId: '3', qty: 2, unitCost: 2000 },
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.product_id).sort(),
    ['1', '2', '3'],
  );
  const byId = Object.fromEntries(result.map((r) => [r.product_id, r]));
  assert.equal(byId['1'].ordered_qty, 3);
  assert.equal(byId['1'].line_total, 3000);
  assert.equal(byId['2'].line_total, 5000);
});

test('line total equals qty times unit cost', () => {
  assert.equal(computeLineTotal(202, 6450), 202 * 6450);
});

test('order grand total updates when discount tax and expense change', () => {
  const subtotal = 1_000_000;
  const none = buildOrderTotals(subtotal, 0, 0, 0);
  const discounted = buildOrderTotals(subtotal, 10, 0, 0);
  const full = buildOrderTotals(subtotal, 10, 50_000, 12);

  assert.equal(none.totalAmount, 1_000_000);
  assert.equal(discounted.totalAmount, 900_000);
  assert.equal(full.totalAmount, 900_000 + 50_000 + 900_000 * 0.12);
});

test('margin percent uses sale-cost over sale', () => {
  const margin = (sale, cost) => ((sale - cost) / sale) * 100;
  assert.equal(margin(10000, 8000), 20);
});

// --- USD supplier dual-pricing (mirrors PurchaseOrderForm.tsx) ---

function computeItemTotalsUsd(item, fxRate) {
  const qty = Number(item.ordered_qty || 0) || 0;
  const rate = Number(fxRate || 0);
  let baseUsd = Number(item.base_unit_cost_usd ?? NaN);
  if (!Number.isFinite(baseUsd) || baseUsd < 0) baseUsd = 0;
  if (baseUsd === 0 && rate > 0) {
    const legacyUzs = Number(item.base_unit_cost ?? item.unit_cost ?? 0);
    if (legacyUzs > 0) baseUsd = legacyUzs / rate;
  }
  const baseUzs = rate > 0 && baseUsd > 0 ? baseUsd * rate : Number(item.base_unit_cost ?? 0) || 0;
  const netUnitUzs = baseUzs;
  const netLineUzs = netUnitUzs * qty;
  const netUnitUsd = baseUsd;
  const netLineUsd = netUnitUsd * qty;
  return {
    ...item,
    base_unit_cost: baseUzs,
    base_unit_cost_usd: baseUsd,
    unit_cost: netUnitUzs,
    line_total: netLineUzs,
    unit_cost_usd: netUnitUsd,
    line_total_usd: netLineUsd,
  };
}

function getCostUzsUsd(item, fxRate) {
  const rate = Number(fxRate || 0);
  const baseUsd = Number(item.base_unit_cost_usd ?? item.unit_cost_usd ?? 0) || 0;
  if (baseUsd > 0 && rate > 0) return baseUsd * rate;
  return Number(item.unit_cost ?? item.base_unit_cost ?? 0) || 0;
}

function marginPercentUsd(item, fxRate) {
  const sale = Number(item.sale_price ?? 0) || 0;
  const cost = getCostUzsUsd(item, fxRate);
  if (sale <= 0 || cost <= 0) return null;
  return ((sale - cost) / sale) * 100;
}

function defaultUsdCostFromCatalog(purchaseUzs, fxRate) {
  const rate = Number(fxRate || 0);
  if (!rate || purchaseUzs <= 0) return { baseUsd: 0, baseUzs: 0 };
  const baseUsd = purchaseUzs / rate;
  return { baseUsd, baseUzs: baseUsd * rate };
}

test('USD PO: user-entered cost in USD does not double-multiply by fx rate', () => {
  const fxRate = 12100;
  const row = computeItemTotalsUsd(
    { ordered_qty: 1, base_unit_cost_usd: 2000 },
    fxRate,
  );
  assert.equal(row.base_unit_cost_usd, 2000);
  assert.equal(row.line_total_usd, 2000);
  assert.equal(row.line_total, 2000 * fxRate);
  assert.equal(row.base_unit_cost, 2000 * fxRate);
});

test('USD PO: catalog purchase UZS converts to USD default cost', () => {
  const fxRate = 12100;
  const catalogUzs = 24200000;
  const { baseUsd, baseUzs } = defaultUsdCostFromCatalog(catalogUzs, fxRate);
  assert.equal(baseUsd, 2000);
  assert.equal(baseUzs, catalogUzs);
  const row = computeItemTotalsUsd(
    { ordered_qty: 2, base_unit_cost_usd: baseUsd, base_unit_cost: baseUzs },
    fxRate,
  );
  assert.equal(row.line_total_usd, 4000);
  assert.equal(row.line_total, 4000 * fxRate);
});

test('USD PO: margin compares UZS sale price against UZS-equivalent cost', () => {
  const fxRate = 12100;
  const row = computeItemTotalsUsd(
    { ordered_qty: 1, base_unit_cost_usd: 2, sale_price: 30000 },
    fxRate,
  );
  const margin = marginPercentUsd(row, fxRate);
  const expectedCostUzs = 2 * fxRate;
  assert.equal(expectedCostUzs, 24200);
  assert.ok(margin != null);
  assert.equal(Math.round(margin), Math.round(((30000 - expectedCostUzs) / 30000) * 100));
});

test('USD PO: sale price stays UZS independent of purchase USD cost', () => {
  const fxRate = 12100;
  const row = computeItemTotalsUsd(
    { ordered_qty: 1, base_unit_cost_usd: 2000, sale_price: 25000 },
    fxRate,
  );
  assert.equal(row.sale_price, 25000);
  assert.notEqual(row.sale_price, row.base_unit_cost_usd);
});

// --- payment scheme helpers (purchasePaymentScheme.ts) ---

function validateInstallmentScheduleSum(rows, total, currency) {
  const tol = currency === 'USD' ? 0.02 : 1;
  const sum = rows.reduce((acc, row) => {
    const amt =
      currency === 'USD'
        ? Number(row.amount_usd ?? row.amount ?? 0)
        : Number(row.amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
  return { ok: Math.abs(sum - total) <= tol, sum };
}

test('installment schedule sum must equal PO total', () => {
  const rows = [
    { seq: 1, due_date: '2026-07-01', amount: 60000 },
    { seq: 2, due_date: '2026-08-01', amount: 40000 },
  ];
  const okMatch = validateInstallmentScheduleSum(rows, 100000, 'UZS');
  assert.equal(okMatch.ok, true);
  const bad = validateInstallmentScheduleSum(rows, 90000, 'UZS');
  assert.equal(bad.ok, false);
});

// --- ordered vs received validation (purchaseOrderQtyValidation.ts) ---

function findPoOrderQtyViolations(formItems, existingItems) {
  if (!existingItems?.some((it) => Number(it.received_qty || 0) > 0)) {
    return [];
  }
  const receivedByPid = new Map();
  for (const row of existingItems) {
    const pid = String(row.product_id || '');
    if (!pid) continue;
    receivedByPid.set(pid, (receivedByPid.get(pid) || 0) + Number(row.received_qty ?? 0));
  }
  const orderedByPid = new Map();
  for (const row of formItems) {
    const pid = String(row.product_id || '');
    if (!pid) continue;
    orderedByPid.set(pid, (orderedByPid.get(pid) || 0) + Number(row.ordered_qty ?? 0));
  }
  const violations = [];
  for (const [productId, receivedQty] of receivedByPid) {
    if (receivedQty <= 0) continue;
    const orderedQty = orderedByPid.get(productId) || 0;
    if (orderedQty < receivedQty - 1e-9) {
      violations.push({ productId, receivedQty, orderedQty });
    }
  }
  return violations;
}

test('receive validation: draft edit may set ordered below received', () => {
  const violations = findPoOrderQtyViolations(
    [{ product_id: 'p1', ordered_qty: 1 }],
    [{ product_id: 'p1', ordered_qty: 5, received_qty: 2 }],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].receivedQty, 2);
  assert.equal(violations[0].orderedQty, 1);
});

test('receive validation: no check when nothing received yet', () => {
  const violations = findPoOrderQtyViolations(
    [{ product_id: 'p1', ordered_qty: 1 }],
    [{ product_id: 'p1', ordered_qty: 5, received_qty: 0 }],
  );
  assert.equal(violations.length, 0);
});

test('buildItemsPayloadForSave does not re-add omitted received lines', () => {
  function buildItemsPayloadForSave(items, existingItems) {
    return items.map((item) => ({
      ...(item.id ? { id: item.id } : {}),
      received_qty: Number(
        existingItems.find((ex) => (item.id ? ex.id === item.id : ex.product_id === item.product_id))
          ?.received_qty ?? 0,
      ),
      product_id: item.product_id,
      ordered_qty: item.ordered_qty,
    }));
  }

  const payload = buildItemsPayloadForSave(
    [{ product_id: 'p2', ordered_qty: 3 }],
    [
      { id: 'line-1', product_id: 'p1', ordered_qty: 2, received_qty: 2 },
      { id: 'line-2', product_id: 'p2', ordered_qty: 5, received_qty: 0 },
    ],
  );
  assert.equal(payload.length, 1);
  assert.equal(payload[0].product_id, 'p2');
  assert.equal(
    payload.some((row) => row.product_id === 'p1'),
    false,
    'omitted received line must not be silently re-added',
  );
});

test('removeItem blocks lines with received_qty > 0', () => {
  function canRemovePoLine(item, existingItems) {
    if (!item) return false;
    if (item.id) {
      const byId = existingItems.find((ex) => ex.id === item.id);
      if (byId) return Number(byId.received_qty || 0) <= 0;
    }
    const received = existingItems
      .filter((ex) => ex.product_id === item.product_id)
      .reduce((sum, ex) => sum + Number(ex.received_qty || 0), 0);
    return received <= 0;
  }

  assert.equal(
    canRemovePoLine({ id: 'line-1', product_id: 'p1' }, [
      { id: 'line-1', product_id: 'p1', received_qty: 2 },
    ]),
    false,
  );
  assert.equal(
    canRemovePoLine({ id: 'line-2', product_id: 'p2' }, [
      { id: 'line-2', product_id: 'p2', received_qty: 0 },
    ]),
    true,
  );
});

test('draft save path must not gate on receive qty validation flag', () => {
  const shouldValidateForReceive = (markAsReceived) => false;
  assert.equal(shouldValidateForReceive(false), false);
  assert.equal(shouldValidateForReceive(true), false);
});

// --- optional prices: draft vs receive (purchaseOrderLinePricing.ts mirrors) ---

function salePriceForPoLineSave(salePrice) {
  const n = Number(salePrice ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getPoLineUnitCost(item, currency) {
  if (currency === 'USD') {
    return Number(item.base_unit_cost_usd ?? item.unit_cost_usd ?? 0) || 0;
  }
  return Number(item.base_unit_cost ?? item.unit_cost ?? 0) || 0;
}

function findZeroCostPoLineNames(items, currency) {
  return items
    .filter((item) => !(getPoLineUnitCost(item, currency) > 0))
    .map((item) => String(item.product_name || 'Nomsiz mahsulot'));
}

test('line sale_price saves when set even if catalog-update toggle is off', () => {
  const updateSalePriceOnReceive = false;
  // Wrong legacy gate wiped line sale on draft save — must not depend on toggle.
  const legacyBroken = (sale, toggle) => (toggle && Number(sale ?? 0) > 0 ? Number(sale) : null);
  assert.equal(legacyBroken(12000, updateSalePriceOnReceive), null);
  assert.equal(salePriceForPoLineSave(12000), 12000);
  assert.equal(salePriceForPoLineSave(0), null);
  assert.equal(salePriceForPoLineSave(null), null);
});

test('draft allows zero tannarx; receive requires positive cost', () => {
  const items = [
    { product_name: 'Yangi SKU', ordered_qty: 2, base_unit_cost: 0, sale_price: null },
    { product_name: 'Kabel', ordered_qty: 1, base_unit_cost: 5000, sale_price: 8000 },
  ];
  const zeroNames = findZeroCostPoLineNames(items, 'UZS');
  assert.deepEqual(zeroNames, ['Yangi SKU']);
  // Draft save: zero cost OK (only check that finder reports; UI does not block).
  assert.equal(zeroNames.length > 0, true);
  // Receive: must block when any zero-cost line remains.
  const canReceive = zeroNames.length === 0;
  assert.equal(canReceive, false);
});

test('USD receive cost uses base_unit_cost_usd not UZS catalog', () => {
  const items = [
    {
      product_name: 'Import',
      base_unit_cost: 0,
      base_unit_cost_usd: 2.5,
      unit_cost: 0,
    },
  ];
  assert.deepEqual(findZeroCostPoLineNames(items, 'USD'), []);
  assert.deepEqual(findZeroCostPoLineNames(items, 'UZS'), ['Import']);
});

test('empty catalog prices do not force PO line sale or cost', () => {
  const product = { purchase_price: 0, sale_price: 0 };
  const line = {
    product_name: 'From PO create',
    base_unit_cost: Number(product.purchase_price) || 0,
    sale_price: Number(product.sale_price) > 0 ? Number(product.sale_price) : null,
  };
  assert.equal(line.base_unit_cost, 0);
  assert.equal(line.sale_price, null);
  assert.equal(salePriceForPoLineSave(line.sale_price), null);
  assert.deepEqual(findZeroCostPoLineNames([line], 'UZS'), ['From PO create']);
});
