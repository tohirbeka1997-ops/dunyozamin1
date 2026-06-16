/* eslint-disable no-console */
/**
 * printReceipt.smoke.test.cjs
 * Chek chop etish audit: matn quruvchi, ESC/POS buffer, PrintService validatsiya,
 * sotuvdan receipt snapshot, print-agent HTTP qatlami.
 *
 * Ishga tushirish: npm run test:print-smoke
 */
'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-print-smoke-'));
process.env.POS_SERVER_MODE = '1';
process.env.POS_DATA_DIR = tmpDir;
process.env.POS_VERBOSE_LOGS = '0';

const { open, close, getDb } = require('../db/open.cjs');
const { createServices } = require('./index.cjs');
const PrintService = require('./printService.cjs');
const {
  wrapText,
  makeLine,
  buildReceiptLines,
  buildReceiptInputFromOrder,
  buildReceiptInputFromPos,
  shouldAutoPrintReceipt,
  DEFAULT_CHARS_PER_LINE,
} = require('../lib/receiptTextBuilder.cjs');
const { ERROR_CODES, createError } = require('../lib/errors.cjs');

const WH = 'main-warehouse-001';
const ADMIN = 'default-admin-001';

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  ✗ ${name}`);
  console.log(`     ${err.message || err}`);
}

function runStep(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => ok(name)).catch((e) => fail(name, e));
    }
    ok(name);
    return Promise.resolve();
  } catch (e) {
    fail(name, e);
    return Promise.resolve();
  }
}

function renderLinesToBuffer(printSvc, lines, cfgOverrides = {}) {
  const cfg = {
    ...printSvc.getPrinterConfig(),
    interface: 'usb',
    cut: false,
    feedLines: 0,
    retryCount: 0,
    ...cfgOverrides,
  };
  const printer = printSvc.createPrinter(cfg);
  const width = printSvc.resolveCharsPerLine(cfg);
  let currentAlign = 'left';
  let currentBold = false;

  printer.clear();
  printSvc.applyReceiptStart(printer);
  printer.alignLeft();
  if (typeof printer.setTextNormal === 'function') printer.setTextNormal();

  for (const line of lines) {
    const align = line.align || 'left';
    if (align !== currentAlign) {
      if (align === 'center') printer.alignCenter();
      else if (align === 'right') printer.alignRight();
      else printer.alignLeft();
      currentAlign = align;
    }
    const bold = Boolean(line.bold);
    if (bold !== currentBold) {
      printer.bold(bold);
      currentBold = bold;
    }
    printer.println(printSvc.normalizeLine(line, width));
  }

  return printer.getBuffer?.();
}

async function runTests() {
  console.log('\n=== CHEK CHOP ETISH SMOKE TEST ===\n');

  console.log('--- Phase A: print-agent HTTP ---');
  try {
    execSync('node print-agent/agent.test.js', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ok('print-agent HTTP (15 qadam)');
  } catch (e) {
    fail('print-agent HTTP', e);
    if (e.stdout) console.log(String(e.stdout).slice(-800));
  }

  console.log('\n--- Phase B: chek matni + PrintService ---');
  console.log(`Temp DB: ${tmpDir}\n`);

  open();
  const db = getDb();
  const { products, inventory, sales, shifts, settings: settingsSvc } = createServices(db);
  const printSvc = new PrintService(db);

  await runStep('wrapText: uzun matn qatorlarga bo‘linadi', () => {
    const lines = wrapText('Smoke test do\'koni katta sarlavha matni', 16);
    assert.ok(lines.length >= 2);
    assert.ok(lines.every((l) => l.length <= 16));
  });

  await runStep('makeLine: chap/o‘ng ustun', () => {
    const line = makeLine('JAMI', '15 000', 32);
    assert.ok(line.includes('15 000'));
    assert.strictEqual(line.length, 32);
  });

  await runStep('buildReceiptLines: JAMI va to‘lovlar', () => {
    const lines = buildReceiptLines(
      {
        storeName: 'Smoke Market',
        orderNumber: 'ORD-TEST-001',
        dateTime: '2026-05-19 12:00:00',
        showCashier: true,
        cashierName: 'Admin',
        showCustomer: true,
        customerName: 'Test Mijoz',
        items: [{ name: 'Mahsulot A', sku: 'SKU-A', qty: 2, unitPrice: 5000, lineTotal: 10000 }],
        subtotal: 10000,
        totalAmount: 10000,
        paidAmount: 10000,
        payments: [{ method: 'Naqd pul', amount: 10000 }],
      },
      { charsPerLine: 32 },
    );
    const texts = lines.map((l) => l.text).join('\n');
    assert.ok(texts.includes('Chek'));
    assert.ok(texts.includes('JAMI'));
    assert.ok(texts.includes('Naqd') || texts.includes("To'lov"));
    assert.ok(lines.some((l) => l.bold && l.text.includes('JAMI')));
  });

  const product = products.create({
    name: 'Print Smoke Product',
    sku: `PRT-${Date.now()}`,
    sale_price: 7500,
    track_stock: 1,
    current_stock: 0,
  });
  inventory.adjustStock({
    warehouse_id: WH,
    adjustment_type: 'set',
    reason: 'Print smoke',
    created_by: ADMIN,
    items: [{ product_id: product.id, target_quantity: 5 }],
  });

  const shift = shifts.openShift({ user_id: ADMIN });
  const saleRes = sales.completePOSOrder(
    { total_amount: 7500, shift_id: shift.id, user_id: ADMIN },
    [
      {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        qty_sale: 1,
        qty_base: 1,
        unit_price: 7500,
        line_total: 7500,
      },
    ],
    [{ payment_method: 'cash', amount: 7500 }],
  );
  const orderId = saleRes.order_id;
  const order = sales._getOrderWithDetails(orderId);

  await runStep('shouldAutoPrintReceipt: default ON', () => {
    assert.strictEqual(shouldAutoPrintReceipt(null), true);
    assert.strictEqual(shouldAutoPrintReceipt({}), true);
    assert.strictEqual(shouldAutoPrintReceipt({ auto_print: true }), true);
    assert.strictEqual(shouldAutoPrintReceipt({ auto_print: false }), false);
    assert.strictEqual(shouldAutoPrintReceipt({ auto_print: '0' }), false);
  });

  await runStep('buildReceiptInputFromPos: POS savat → ReceiptInput', () => {
    const posData = {
      orderNumber: order.order_number,
      items: [
        {
          product: { name: product.name, sku: product.sku, unit: 'pcs' },
          quantity: 1,
          qty_sale: 1,
          unit_price: 7500,
          line_total: 7500,
        },
      ],
      subtotal: 7500,
      discountAmount: 0,
      total: 7500,
      paidAmount: 7500,
      changeAmount: 0,
      paymentMethod: 'Naqd pul',
      dateTime: '2026-05-19 14:00:00',
      cashierName: 'Kassir',
    };
    const input = buildReceiptInputFromPos(posData, { name: 'Smoke Do\'kon' }, { show_sku: true });
    assert.strictEqual(input.totalAmount, 7500);
    assert.strictEqual(input.items[0].lineTotal, 7500);
    const lines = buildReceiptLines(input, { charsPerLine: 32 });
    assert.ok(lines.some((l) => String(l.text).includes('JAMI')));
  });

  await runStep('buildReceiptInputFromOrder: buyurtmadan ReceiptInput', () => {
    const company = { name: 'Smoke Do\'kon', phone: '+998901111222', address: 'Toshkent' };
    const settings = { show_cashier: true, show_customer: true, show_sku: true };
    const input = buildReceiptInputFromOrder(order, company, settings);
    assert.strictEqual(input.orderNumber, order.order_number);
    assert.strictEqual(input.totalAmount, 7500);
    assert.ok(input.items.length >= 1);
    const lines = buildReceiptLines(input, { charsPerLine: DEFAULT_CHARS_PER_LINE });
    assert.ok(lines.length >= 8);
  });

  await runStep('receipts jadvali: snapshot yoziladi', () => {
    const row = db
      .prepare(
        `SELECT receipt_number, receipt_data FROM receipts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(orderId);
    assert.ok(row?.receipt_number);
    const data = JSON.parse(row.receipt_data);
    assert.ok(data.order || data.items);
  });

  await runStep('PrintService: bo‘sh chek rad', async () => {
    let threw = false;
    try {
      await printSvc.printReceipt({ lines: [] });
    } catch (e) {
      threw = true;
      assert.match(String(e.message || e.code || ''), /empty|Empty/i);
    }
    assert.ok(threw);
  });

  await runStep('PrintService: normalizeLine kesadi', () => {
    const out = printSvc.normalizeLine({ text: 'x'.repeat(80) }, 48);
    assert.strictEqual(out.length, 48);
  });

  await runStep('PrintService: ESC/POS buffer (matn + init)', () => {
    const lines = buildReceiptLines(
      {
        storeName: 'Buffer Test',
        orderNumber: order.order_number,
        dateTime: '2026-05-19',
        items: [{ name: product.name, qty: 1, unitPrice: 7500, lineTotal: 7500 }],
        subtotal: 7500,
        totalAmount: 7500,
        paidAmount: 7500,
      },
      { charsPerLine: 48 },
    );
    const buf = renderLinesToBuffer(printSvc, lines);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 20);
    const hex = buf.toString('utf8');
    assert.ok(hex.includes('Chek') || hex.includes('Buffer'));
    assert.ok(buf.includes(0x1b) && buf.includes(0x40));
  });

  if (process.platform === 'win32') {
    await runStep('PrintService: noto‘g‘ri printer nomi rad', async () => {
      let threw = false;
      try {
        await printSvc.printRawViaSpooler('bad"name', Buffer.from([0x1b, 0x40]));
      } catch (e) {
        threw = true;
        assert.strictEqual(e.code, ERROR_CODES.VALIDATION_ERROR);
      }
      assert.ok(threw);
    });
  }

  await runStep('PrintService: getPrinterConfig defaults', () => {
    const cfg = printSvc.getPrinterConfig();
    assert.ok(cfg.charsPerLine >= 24);
    assert.ok(['epson', 'star', 'escpos'].includes(String(cfg.type || 'epson').toLowerCase()) || cfg.type);
  });

  await runStep('PrintService.printReceipt: POS lines → buffer (mijoz cheki)', async () => {
    const posInput = buildReceiptInputFromPos(
      {
        orderNumber: order.order_number,
        items: [
          {
            product: { name: product.name, sku: product.sku },
            quantity: 1,
            unit_price: 7500,
            line_total: 7500,
          },
        ],
        subtotal: 7500,
        total: 7500,
        paidAmount: 7500,
        paymentMethod: 'cash',
        dateTime: '2026-05-19',
      },
      { name: 'POS Smoke' },
      {},
    );
    const lines = buildReceiptLines(posInput, { charsPerLine: 48 });
    const buf = renderLinesToBuffer(printSvc, lines);
    assert.ok(Buffer.isBuffer(buf) && buf.length > 40);
  });

  await runStep('completePOSOrder: yakuniy chek satrlari (POS tugmasi manbasi)', () => {
    const order2 = sales.completePOSOrder(
      { total_amount: 7500, shift_id: shift.id, user_id: ADMIN },
      [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          qty_sale: 1,
          qty_base: 1,
          line_total: 7500,
        },
      ],
      [{ payment_method: 'cash', amount: 7500 }],
    );
    const full = sales._getOrderWithDetails(order2.order_id);
    const input = buildReceiptInputFromOrder(full, { name: 'Smoke' }, { show_cashier: true });
    const lines = buildReceiptLines(input, { charsPerLine: DEFAULT_CHARS_PER_LINE });
    assert.ok(lines.length >= 10);
    const buf = renderLinesToBuffer(printSvc, lines);
    assert.ok(buf.length > 50);
  });

  console.log('\n--- Phase C: chek sozlamalari (auto_print) ---');
  await runStep('settings: receipt.auto_print default yo‘q → shouldAutoPrint true', () => {
    const rows = settingsSvc.getAll({ category: 'receipt' });
    const map = {};
    for (const row of rows) {
      const k = String(row.key || '').includes('.') ? row.key.split('.').slice(1).join('.') : row.key;
      map[k] = row.value;
    }
    assert.strictEqual(shouldAutoPrintReceipt(map), true);
  });

  close();
}

runTests()
  .then(() => {
    console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    fail('fatal', e);
    console.log(`\n=== NATIJA: ${passed} OK, ${failed} FAIL ===\n`);
    process.exit(1);
  });
