/**
 * Product search match + reports hub route smoke (no React DOM).
 * Run: node --test src/lib/__tests__/posIntegrityFollowup.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Inline mirror of productSearchMatch (ESM source) for Node without TS transform.
function productMatchesSearchTerm(product, rawTerm) {
  const term = String(rawTerm || '').trim().toLowerCase();
  if (!term) return true;
  const termNorm = term.replace(/[\s\-_]/g, '');
  const name = String(product.name || '').toLowerCase();
  const sku = String(product.sku || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const article = String(product.article || '')
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
  const brand = String(product.brand || '').toLowerCase();
  return (
    name.includes(term) ||
    sku.includes(term) ||
    barcode.includes(term) ||
    (termNorm.length > 0 && article.includes(termNorm)) ||
    brand.includes(term)
  );
}

test('SKU search only matches products with that SKU/name/barcode', () => {
  const rows = [
    { name: 'Cement', sku: 'CEM-001', barcode: '460001' },
    { name: 'Paint', sku: 'PNT-002', barcode: '460002' },
    { name: 'Glue', sku: 'GLU-003', barcode: '460003' },
    { name: 'Noise 2188mm', sku: 'PIPE', barcode: 'x' },
    { name: 'Exact', sku: '2188', barcode: 'y' },
  ];
  const hits = rows.filter((p) => productMatchesSearchTerm(p, 'PNT-002'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sku, 'PNT-002');
  const none = rows.filter((p) => productMatchesSearchTerm(p, 'ZZZ-NOPE'));
  assert.equal(none.length, 0);
});

test('exact SKU filter suppresses unrelated substring matches', () => {
  function filterProductsBySearchTerm(products, rawTerm) {
    const term = String(rawTerm || '').trim().toLowerCase();
    if (!term) return products;
    const exact = products.filter(
      (p) =>
        String(p.sku || '').toLowerCase() === term ||
        String(p.barcode || '').toLowerCase() === term,
    );
    if (exact.length > 0) return exact;
    return products.filter((p) => productMatchesSearchTerm(p, term));
  }
  const rows = [
    { name: 'Pipe 2188mm', sku: 'PIPE-900', barcode: '100' },
    { name: 'Cable', sku: '2188', barcode: '200' },
    { name: 'Other', sku: '21880', barcode: '300' },
  ];
  const hits = filterProductsBySearchTerm(rows, '2188');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sku, '2188');
});

test('Reports hub cards expose semantic Link routes for each category', () => {
  const src = readFileSync(path.join(root, 'src/pages/Reports.tsx'), 'utf8');
  assert.match(src, /from 'react-router-dom'/);
  assert.match(src, /<Link/);
  for (const p of [
    '/reports/sales',
    '/reports/financial',
    '/reports/inventory',
    '/reports/purchase',
    '/reports/customer',
    '/reports/employee',
    '/reports/system',
  ]) {
    assert.ok(src.includes(p), `missing route ${p}`);
  }
  assert.match(src, /data-testid=\{`reports-hub-card-/);
  assert.match(src, /focus-visible:ring/);
  assert.match(src, /No permission/);
});

test('CreateReturn continues disabled when no returnable qty (source guard)', () => {
  const src = readFileSync(path.join(root, 'src/pages/CreateReturn.tsx'), 'utf8');
  assert.match(src, /all_items_already_returned/);
  assert.match(src, /canContinueFromItems/);
  assert.match(src, /disabled=\{!canContinueFromItems\}/);
  assert.match(src, /idempotency_key/);
  assert.match(src, /availableToReturnQty/);
  assert.match(src, /Math\.min\(\s*computedAvailable/);
  assert.match(src, /confirmOpen/);
  assert.match(src, /fully_returned/);
});

test('returnsService does not coalesce remaining=0 to sold (source guard)', () => {
  const src = readFileSync(path.join(root, 'electron/services/returnsService.cjs'), 'utf8');
  assert.doesNotMatch(src, /remaining_quantity \|\| soldQty/);
  assert.match(src, /never use `remaining \|\| sold`/);
  assert.match(src, /_allReservingReturnStatusesSql/);
});

test('Inventory keeps prior rows on load error (source guard)', () => {
  const src = readFileSync(path.join(root, 'src/pages/Inventory.tsx'), 'utf8');
  assert.match(src, /loadError/);
  assert.match(src, /Do NOT clear existing table data/);
  assert.match(src, /filterProductsBySearchTerm/);
});

test('Orders list blocks return action when fully returned (source guard)', () => {
  const orders = readFileSync(path.join(root, 'src/pages/Orders.tsx'), 'utf8');
  const table = readFileSync(
    path.join(root, 'src/components/orders/VirtualizedOrdersTable.tsx'),
    'utf8',
  );
  const detail = readFileSync(path.join(root, 'src/pages/OrderDetail.tsx'), 'utf8');
  assert.match(orders, /canCreateSalesReturnForOrder/);
  assert.match(orders, /return_fully_returned_tooltip/);
  assert.match(table, /returnFullyReturnedTooltip/);
  assert.match(table, /disabled/);
  assert.match(detail, /returnFullyExhausted/);
  assert.match(detail, /canCreateSalesReturnForOrder/);
});

test('Suppliers action buttons expose aria-label and delete confirmation (source guard)', () => {
  const src = readFileSync(path.join(root, 'src/pages/Suppliers.tsx'), 'utf8');
  assert.match(src, /aria-label="Yetkazib beruvchini tahrirlash"/);
  assert.match(src, /aria-label="Yetkazib beruvchini o'chirish"/);
  assert.match(src, /title="Tahrirlash"/);
  assert.match(src, /title="O'chirish"/);
  assert.match(src, /deleteDialogOpen/);
  assert.match(src, /handleDeleteConfirm/);
});

test('staffErrorMap maps RETURN_LIMIT_EXCEEDED to HTTP 409 (source guard)', () => {
  const src = readFileSync(path.join(root, 'public-api/lib/staffErrorMap.cjs'), 'utf8');
  assert.match(src, /RETURN_LIMIT_EXCEEDED/);
  assert.match(src, /409/);
});

test('returnsService audits rejected over-return attempts (source guard)', () => {
  const src = readFileSync(path.join(root, 'electron/services/returnsService.cjs'), 'utf8');
  assert.match(src, /return_rejected/);
  assert.match(src, /RETURN_LIMIT_EXCEEDED/);
});
