/* eslint-disable no-console */
/**
 * Nakladnoydan xarid: confirm creates a PO and receives it through receiveGoods.
 * Stock and FIFO batch move only after confirm. No vision network call.
 *
 * node is not used — better-sqlite3 is the Electron build:
 *   npx electron electron/services/invoicePurchase.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-invoice-purchase-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');

function stockOf(inventory, productId) {
  return Number(inventory.getCurrentStock(productId, WH)) || 0;
}

function batchQty(db, productId) {
  const cols = new Set((db.prepare(`PRAGMA table_info(inventory_batches)`).all() || []).map((c) => c.name));
  const qtyCol = cols.has('remaining_qty') ? 'remaining_qty' : cols.has('initial_qty') ? 'initial_qty' : null;
  if (!qtyCol) return { qty: 0, unit_cost: 0 };
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(${qtyCol}), 0) AS qty, COALESCE(MAX(unit_cost), 0) AS unit_cost
       FROM inventory_batches WHERE product_id = ?`,
    )
    .get(productId);
  return { qty: Number(row?.qty || 0), unit_cost: Number(row?.unit_cost || 0) };
}

try {
  open();
  const db = getDb();
  const { products, inventory, purchases, suppliers } = createServices(db);
  db.prepare(
    `INSERT INTO settings (id, key, value, type, category, is_public, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), 'inventory.batch_mode_enabled', '1', 'boolean', 'inventory', 0, datetime('now'), datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')`,
  ).run();

  const supplier = suppliers.create({
    name: 'Nakladnoy UZS',
    phone: '+998901110001',
    settlement_currency: 'UZS',
  });
  const usdSupplier = suppliers.create({
    name: 'Nakladnoy USD',
    phone: '+998901110002',
    settlement_currency: 'USD',
  });
  const piece = products.create({
    name: 'Nakladnoy dona',
    sku: `NK-PCS-${Date.now()}`,
    barcode: '990000111',
    sale_price: 15000,
    purchase_price: 8000,
    unit: 'pcs',
    base_unit: 'pcs',
    current_stock: 0,
  });
  const meter = products.create({
    name: 'Nakladnoy metr',
    sku: `NK-M-${Date.now()}`,
    sale_price: 9000,
    purchase_price: 4000,
    unit: 'm',
    base_unit: 'm',
    current_stock: 0,
  });

  assert.throws(
    () =>
      purchases.confirmInvoicePurchase({
        supplier_id: supplier.id,
        invoice_number: 'INV-BLOCK',
        created_by: ADMIN,
        lines: [
          {
            action: 'match',
            product_id: piece.id,
            name: 'quti qatori',
            qty: 1,
            unit: 'quti',
            unit_price: 1000,
          },
        ],
      }),
    /ombor birligida miqdor/i,
  );
  assert.strictEqual(stockOf(inventory, piece.id), 0);

  assert.throws(
    () =>
      purchases.confirmInvoicePurchase({
        supplier_id: supplier.id,
        created_by: ADMIN,
        lines: [{ action: 'create', name: "Noma'lum", qty: 1, unit: 'dona', unit_price: 1000, sale_price: 2000 }],
      }),
    /Noma/i,
  );

  const saved = purchases.confirmInvoicePurchase({
    supplier_id: supplier.id,
    invoice_number: 'NK-100',
    image_url: '/product-images/demo.jpg',
    raw_ai: { invoice_number: 'NK-100', lines: [{ name: 'Nakladnoy dona' }] },
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: piece.id,
        name: 'Nakladnoy dona',
        qty: 4,
        unit: 'dona',
        unit_price: 8000,
      },
      {
        action: 'match',
        product_id: meter.id,
        name: 'Nakladnoy metr',
        qty: 2,
        unit: 'quti',
        unit_price: 5000,
        warehouse_qty: 10,
      },
      {
        action: 'skip',
        name: 'kerak emas',
        qty: 9,
        unit: 'dona',
        unit_price: 1,
      },
      {
        action: 'create',
        name: 'Yangi nakladnoy mahsulot',
        qty: 3,
        unit: 'pachka',
        unit_price: 2000,
        sale_price: 4500,
      },
    ],
  });

  assert.strictEqual(saved.purchase_order.status, 'received');
  assert.strictEqual(saved.purchase_order.invoice_number, 'NK-100');
  assert.match(String(saved.purchase_order.notes || ''), /demo\.jpg/);
  assert.match(String(saved.purchase_order.notes || ''), /AI JSON/);
  assert.strictEqual(stockOf(inventory, piece.id), 4);
  assert.strictEqual(stockOf(inventory, meter.id), 10);
  const created = db.prepare(`SELECT id FROM products WHERE name = ?`).get('Yangi nakladnoy mahsulot');
  assert.ok(created);
  const unitCols = new Set((db.prepare(`PRAGMA table_info(products)`).all() || []).map((c) => c.name));
  if (unitCols.has('base_unit')) {
    const unitRow = db.prepare(`SELECT base_unit FROM products WHERE id = ?`).get(created.id);
    assert.strictEqual(unitRow.base_unit, 'pack');
  }
  assert.strictEqual(stockOf(inventory, created.id), 3);
  assert.strictEqual(batchQty(db, piece.id).qty, 4);
  assert.strictEqual(batchQty(db, meter.id).qty, 10);
  assert.strictEqual(batchQty(db, meter.id).unit_cost, 1000);
  const meterPo = db
    .prepare(
      `SELECT ordered_qty, unit_cost, line_total FROM purchase_order_items
       WHERE purchase_order_id = ? AND product_id = ?`,
    )
    .get(saved.purchase_order.id, meter.id);
  assert.strictEqual(Number(meterPo.ordered_qty), 10);
  assert.strictEqual(Number(meterPo.unit_cost), 1000);
  assert.strictEqual(Number(meterPo.line_total), 10000);
  const meterReceipt = db
    .prepare(
      `SELECT received_qty, unit_cost, line_total FROM purchase_receipt_items
       WHERE product_id = ? AND receipt_id IN (
         SELECT id FROM purchase_receipts WHERE purchase_order_id = ?
       )`,
    )
    .get(meter.id, saved.purchase_order.id);
  assert.strictEqual(Number(meterReceipt.received_qty), 10);
  assert.strictEqual(Number(meterReceipt.unit_cost), 1000);
  assert.strictEqual(Number(meterReceipt.line_total), 10000);

  const receipt = db
    .prepare(`SELECT invoice_number, notes FROM purchase_receipts WHERE purchase_order_id = ?`)
    .get(saved.purchase_order.id);
  assert.strictEqual(receipt.invoice_number, 'NK-100');
  assert.match(String(receipt.notes || ''), /AI JSON/);

  const again = purchases.confirmInvoicePurchase({
    supplier_id: supplier.id,
    invoice_number: 'NK-100',
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: piece.id,
        name: 'Nakladnoy dona',
        qty: 1,
        unit: 'dona',
        unit_price: 8000,
      },
    ],
  });
  assert.ok(again.warnings.length >= 1);
  assert.strictEqual(stockOf(inventory, piece.id), 5);

  assert.throws(
    () =>
      purchases.confirmInvoicePurchase({
        supplier_id: usdSupplier.id,
        created_by: ADMIN,
        lines: [
          {
            action: 'match',
            product_id: piece.id,
            name: 'Nakladnoy dona',
            qty: 1,
            unit: 'dona',
            unit_price: 2,
          },
        ],
      }),
    /kurs/i,
  );

  const usd = purchases.confirmInvoicePurchase({
    supplier_id: usdSupplier.id,
    invoice_number: 'USD-1',
    fx_rate: 12500,
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: piece.id,
        name: 'Nakladnoy dona',
        qty: 2,
        unit: 'dona',
        unit_price: 2,
      },
    ],
  });
  assert.strictEqual(String(usd.purchase_order.currency).toUpperCase(), 'USD');
  assert.strictEqual(Number(usd.purchase_order.fx_rate), 12500);
  const usdItem = db
    .prepare(
      `SELECT unit_cost, unit_cost_usd FROM purchase_receipt_items WHERE receipt_id IN (
         SELECT id FROM purchase_receipts WHERE purchase_order_id = ?
       )`,
    )
    .get(usd.purchase_order.id);
  assert.strictEqual(Number(usdItem.unit_cost_usd), 2);
  assert.strictEqual(Number(usdItem.unit_cost), 25000);
  assert.strictEqual(stockOf(inventory, piece.id), 7);

  const boxPiece = products.create({
    name: 'Nakladnoy quti dona',
    sku: `NK-BOX-${Date.now()}`,
    sale_price: 2000,
    purchase_price: 100,
    unit: 'pcs',
    base_unit: 'pcs',
    current_stock: 0,
  });
  const box = purchases.confirmInvoicePurchase({
    supplier_id: supplier.id,
    invoice_number: 'BOX-PCS',
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: boxPiece.id,
        name: 'quti qatori',
        qty: 2,
        unit: 'quti',
        unit_price: 5000,
        warehouse_qty: 10,
      },
    ],
  });
  assert.strictEqual(stockOf(inventory, boxPiece.id), 10);
  assert.strictEqual(batchQty(db, boxPiece.id).qty, 10);
  assert.strictEqual(batchQty(db, boxPiece.id).unit_cost, 1000);
  const boxPo = db
    .prepare(
      `SELECT ordered_qty, unit_cost, line_total FROM purchase_order_items
       WHERE purchase_order_id = ? AND product_id = ?`,
    )
    .get(box.purchase_order.id, boxPiece.id);
  assert.strictEqual(Number(boxPo.ordered_qty), 10);
  assert.strictEqual(Number(boxPo.unit_cost), 1000);
  assert.strictEqual(Number(boxPo.line_total), 10000);
  const boxReceipt = db
    .prepare(
      `SELECT received_qty, unit_cost, line_total FROM purchase_receipt_items
       WHERE product_id = ? AND receipt_id IN (
         SELECT id FROM purchase_receipts WHERE purchase_order_id = ?
       )`,
    )
    .get(boxPiece.id, box.purchase_order.id);
  assert.strictEqual(Number(boxReceipt.received_qty), 10);
  assert.strictEqual(Number(boxReceipt.unit_cost), 1000);
  assert.strictEqual(Number(boxReceipt.line_total), 10000);

  const shtPiece = products.create({
    name: 'Nakladnoy sht',
    sku: `NK-SHT-${Date.now()}`,
    sale_price: 9000,
    purchase_price: 100,
    unit: 'pcs',
    base_unit: 'pcs',
    current_stock: 0,
  });
  const sameUnit = purchases.confirmInvoicePurchase({
    supplier_id: supplier.id,
    invoice_number: 'SHT-PCS',
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: shtPiece.id,
        name: 'sht qatori',
        qty: 2,
        unit: 'шт',
        unit_price: 5000,
        warehouse_qty: 10,
      },
    ],
  });
  assert.strictEqual(stockOf(inventory, shtPiece.id), 2);
  const shtPo = db
    .prepare(
      `SELECT ordered_qty, unit_cost, line_total FROM purchase_order_items
       WHERE purchase_order_id = ? AND product_id = ?`,
    )
    .get(sameUnit.purchase_order.id, shtPiece.id);
  assert.strictEqual(Number(shtPo.ordered_qty), 2);
  assert.strictEqual(Number(shtPo.unit_cost), 5000);
  assert.strictEqual(Number(shtPo.line_total), 10000);

  const usdBoxPiece = products.create({
    name: 'Nakladnoy USD quti',
    sku: `NK-USDBOX-${Date.now()}`,
    sale_price: 20000,
    purchase_price: 100,
    unit: 'pcs',
    base_unit: 'pcs',
    current_stock: 0,
  });
  const usdBox = purchases.confirmInvoicePurchase({
    supplier_id: usdSupplier.id,
    invoice_number: 'USD-BOX',
    fx_rate: 12500,
    created_by: ADMIN,
    lines: [
      {
        action: 'match',
        product_id: usdBoxPiece.id,
        name: 'usd quti',
        qty: 2,
        unit: 'quti',
        unit_price: 5,
        warehouse_qty: 10,
      },
    ],
  });
  assert.strictEqual(stockOf(inventory, usdBoxPiece.id), 10);
  assert.strictEqual(batchQty(db, usdBoxPiece.id).qty, 10);
  assert.strictEqual(batchQty(db, usdBoxPiece.id).unit_cost, 12500);
  const usdBoxItem = db
    .prepare(
      `SELECT received_qty, unit_cost, line_total, unit_cost_usd, line_total_usd
       FROM purchase_receipt_items WHERE receipt_id IN (
         SELECT id FROM purchase_receipts WHERE purchase_order_id = ?
       )`,
    )
    .get(usdBox.purchase_order.id);
  assert.strictEqual(Number(usdBoxItem.received_qty), 10);
  assert.strictEqual(Number(usdBoxItem.unit_cost_usd), 1);
  assert.strictEqual(Number(usdBoxItem.line_total_usd), 10);
  assert.strictEqual(Number(usdBoxItem.unit_cost), 12500);
  assert.strictEqual(Number(usdBoxItem.line_total), 125000);
  const usdBoxPo = db
    .prepare(
      `SELECT ordered_qty, unit_cost, line_total, unit_cost_usd, line_total_usd
       FROM purchase_order_items WHERE purchase_order_id = ? AND product_id = ?`,
    )
    .get(usdBox.purchase_order.id, usdBoxPiece.id);
  assert.strictEqual(Number(usdBoxPo.ordered_qty), 10);
  assert.strictEqual(Number(usdBoxPo.unit_cost_usd), 1);
  assert.strictEqual(Number(usdBoxPo.line_total_usd), 10);
  assert.strictEqual(Number(usdBoxPo.line_total), 125000);

  console.log('invoice purchase smoke ok');
  close();
  process.exit(0);
} catch (err) {
  console.error(err);
  try {
    close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
