'use strict';

const { randomUUID } = require('crypto');
const { ERROR_CODES, createError } = require('./errors.cjs');
const {
  canonicalUnit,
  unitsEquivalent,
  isForbiddenProductName,
  matchInvoiceLines,
  buildInvoiceAttachmentNote,
} = require('./invoicePurchase.cjs');
const { readInvoiceImage, extractInvoiceWithVision } = require('./invoiceVision.cjs');

function tableCols(db, table) {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function loadMatchCatalog(db) {
  const cols = tableCols(db, 'products');
  if (!cols.has('id') || !cols.has('name')) return [];
  const hasUnits =
    cols.has('unit_id') &&
    !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='units'`).get();
  const unitParts = [];
  if (cols.has('base_unit')) unitParts.push("NULLIF(p.base_unit, '')");
  if (cols.has('unit')) unitParts.push("NULLIF(p.unit, '')");
  if (hasUnits) unitParts.push('u.code');
  unitParts.push("'pcs'");
  const unitExpr = `COALESCE(${unitParts.join(', ')})`;
  const article = cols.has('article') ? 'p.article' : 'NULL';
  const active = cols.has('is_active') ? 'WHERE COALESCE(p.is_active, 1) = 1' : '';
  const join = hasUnits ? 'LEFT JOIN units u ON u.id = p.unit_id' : '';
  return (
    db
      .prepare(
        `
        SELECT p.id, p.sku, p.barcode, p.name, ${article} AS article, ${unitExpr} AS unit
        FROM products p
        ${join}
        ${active}
      `,
      )
      .all() || []
  );
}

function loadProduct(db, productId) {
  const rows = loadMatchCatalog(db).filter((row) => row.id === productId);
  if (rows[0]) return rows[0];
  const cols = tableCols(db, 'products');
  if (!cols.has('id')) return null;
  return db.prepare('SELECT id, sku, barcode, name FROM products WHERE id = ?').get(productId) || null;
}

function duplicateInvoiceRefs(db, supplierId, invoiceNumber) {
  const key = String(invoiceNumber || '').trim().toLowerCase();
  if (!supplierId || !key) return [];
  const out = [];
  const poCols = tableCols(db, 'purchase_orders');
  if (poCols.has('invoice_number') && poCols.has('supplier_id')) {
    const rows =
      db
        .prepare(
          `
          SELECT id, po_number, invoice_number, status
          FROM purchase_orders
          WHERE supplier_id = ?
            AND lower(trim(COALESCE(invoice_number, ''))) = ?
            AND lower(COALESCE(status, '')) NOT IN ('cancelled')
        `,
        )
        .all(supplierId, key) || [];
    for (const row of rows) out.push({ kind: 'purchase_order', ...row });
  }
  const receiptCols = tableCols(db, 'purchase_receipts');
  if (receiptCols.has('invoice_number') && receiptCols.has('supplier_id')) {
    const rows =
      db
        .prepare(
          `
          SELECT id, receipt_number, invoice_number, purchase_order_id
          FROM purchase_receipts
          WHERE supplier_id = ?
            AND lower(trim(COALESCE(invoice_number, ''))) = ?
        `,
        )
        .all(supplierId, key) || [];
    for (const row of rows) out.push({ kind: 'receipt', ...row });
  }
  return out;
}

function supplierSettlement(db, supplierId) {
  const id = String(supplierId || '').trim();
  if (!id) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Yetkazib beruvchi tanlanishi shart');
  }
  const cols = tableCols(db, 'suppliers');
  const currencyCol = cols.has('settlement_currency') ? 'settlement_currency' : "'UZS' AS settlement_currency";
  const row = db.prepare(`SELECT id, name, ${currencyCol} FROM suppliers WHERE id = ?`).get(id);
  if (!row) {
    throw createError(ERROR_CODES.NOT_FOUND, 'Yetkazib beruvchi topilmadi');
  }
  const currency = String(row.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
  return { ...row, currency, currency_label: currency === 'USD' ? 'USD' : "so'm" };
}

async function extractInvoiceDraft(purchases, payload = {}) {
  const supplier = supplierSettlement(purchases.db, payload.supplier_id);
  let image;
  try {
    image = readInvoiceImage(payload);
  } catch (err) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, err?.message || 'Rasmni o‘qib bo‘lmadi');
  }
  const vision = await extractInvoiceWithVision(image, payload);
  if (!vision.ok) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, vision.message || 'Nakladnoyni o‘qib bo‘lmadi');
  }
  const catalog = loadMatchCatalog(purchases.db);
  const lines = matchInvoiceLines(vision.parsed.lines, catalog);
  const invoiceNumber = String(payload.invoice_number || vision.parsed.invoice_number || '').trim();
  const aiCurrency = vision.parsed.currency;
  return {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    currency: supplier.currency,
    currency_label: supplier.currency_label,
    invoice_number: invoiceNumber || vision.parsed.invoice_number || '',
    invoice_date: vision.parsed.invoice_date || '',
    ai_supplier_name: vision.parsed.supplier_name || null,
    ai_currency: aiCurrency,
    currency_warning:
      aiCurrency && aiCurrency !== supplier.currency
        ? `Nakladnoyda ${aiCurrency} ko‘rinadi, ta'minotchi hisobi ${supplier.currency}. Qatorlar ${supplier.currency_label} da saqlanadi.`
        : null,
    image_url: image.publicPath || null,
    provider: vision.provider,
    model: vision.model,
    raw_ai: vision.parsed,
    lines,
    duplicate_warning: duplicateInvoiceRefs(purchases.db, supplier.id, invoiceNumber || vision.parsed.invoice_number),
    stock_changed: false,
  };
}

/**
 * Stock qty vs invoice money when the operator converts units (quti → dona).
 * Money stays invoice_qty × unit_price. Stock qty is warehouse_qty.
 * Stock unit cost is that money ÷ warehouse_qty (FX applied by the caller).
 * Equivalent units ignore warehouse_qty and keep invoice qty × unit price.
 */
function postedStockLine(line, productUnit) {
  const invoiceQty = Number(line.qty);
  const unitPrice = Number(line.unit_price);
  if (!unitsEquivalent(line.unit, productUnit)) {
    const warehouseQty = Number(line.warehouse_qty);
    if (!Number.isFinite(warehouseQty) || warehouseQty <= 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `«${line.name || 'Qator'}»: nakladnoy birligi (${line.unit || '?'}) ombor birligidan (${productUnit || '?'}) farq qiladi. Ombor birligida miqdor kiriting.`,
      );
    }
    if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `«${line.name || 'Qator'}»: miqdor 0 dan katta bo‘lishi kerak`);
    }
    const invoiceTotal = invoiceQty * unitPrice;
    return {
      qty: warehouseQty,
      unitCost: invoiceTotal / warehouseQty,
      invoiceTotal,
    };
  }
  if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, `«${line.name || 'Qator'}»: miqdor 0 dan katta bo‘lishi kerak`);
  }
  return {
    qty: invoiceQty,
    unitCost: unitPrice,
    invoiceTotal: invoiceQty * unitPrice,
  };
}

function uniqueSku(db, line, index) {
  const candidates = [];
  if (line.sku) candidates.push(String(line.sku).trim());
  if (line.barcode) candidates.push(String(line.barcode).trim());
  candidates.push(`NK${Date.now().toString(36)}${index}`.toUpperCase());
  candidates.push(`NK${randomUUID().replace(/-/g, '').slice(0, 10)}`.toUpperCase());
  for (const sku of candidates) {
    if (!sku) continue;
    const taken = db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku);
    if (!taken) return sku.slice(0, 64);
  }
  return `NK${randomUUID().replace(/-/g, '').slice(0, 12)}`.toUpperCase();
}

function confirmInvoicePurchase(purchases, payload = {}) {
  const supplier = supplierSettlement(purchases.db, payload.supplier_id);
  const currency = supplier.currency;
  const fxRate = Number(payload.fx_rate);
  if (currency === 'USD' && (!Number.isFinite(fxRate) || fxRate <= 0)) {
    throw createError(
      ERROR_CODES.VALIDATION_ERROR,
      'USD ta\'minotchi uchun kurs kerak (1 USD = necha so\'m). Kurs yo\'q — saqlab bo\'lmaydi.',
    );
  }

  const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
  const accepted = [];
  rawLines.forEach((line, index) => {
    const action = String(line?.action || '').toLowerCase();
    if (action === 'skip') return;
    if (action !== 'match' && action !== 'create') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `«${line?.name || 'Qator'}»: mahsulotni bog‘lang, yarating yoki o‘tkazib yuboring`,
      );
    }
    const unitPrice = Number(line?.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `«${line?.name || 'Qator'}»: narx 0 dan kichik bo‘lmasin`);
    }
    accepted.push({ ...line, action, unit_price: unitPrice, index });
  });
  if (!accepted.length) {
    throw createError(ERROR_CODES.VALIDATION_ERROR, 'Kamida bitta qatorni qabul qiling');
  }

  const prepared = [];
  for (const line of accepted) {
    let product;
    if (line.action === 'create') {
      const name = String(line.name || '').trim();
      if (isForbiddenProductName(name)) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Noma’lum mahsulot yaratilmaydi. Nom yozing yoki mavjud mahsulotni bog‘lang.',
        );
      }
      const salePrice = Number(line.sale_price);
      if (!Number.isFinite(salePrice) || salePrice <= 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, `«${name}»: yangi mahsulot uchun sotuv narxi kerak`);
      }
      const unit = canonicalUnit(line.unit) || 'pcs';
      const barcode = line.barcode ? String(line.barcode).trim() : null;
      if (barcode) {
        const taken = purchases.db.prepare('SELECT id, name FROM products WHERE barcode = ?').get(barcode);
        if (taken) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            `Shtrix-kod ${barcode} allaqachon «${taken.name}» da. Shu mahsulotni bog‘lang.`,
          );
        }
      }
      if (!purchases.productsService?.create) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, 'Mahsulot xizmati ulanmagan');
      }
      const unitUsd = currency === 'USD' ? line.unit_price : null;
      const unitUzs = currency === 'USD' ? line.unit_price * fxRate : line.unit_price;
      product = purchases.productsService.create(
        {
          name,
          sku: uniqueSku(purchases.db, line, line.index),
          barcode,
          article: line.article ? String(line.article).trim() : null,
          unit,
          base_unit: unit,
          purchase_price: unitUzs,
          sale_price: salePrice,
          current_stock: 0,
          track_stock: 1,
        },
        { actorUserId: payload.created_by || null },
      );
      product = {
        id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.base_unit || product.unit || unit,
      };
    } else {
      const productId = String(line.product_id || '').trim();
      if (!productId) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, `«${line.name || 'Qator'}»: ombor mahsuloti tanlanmagan`);
      }
      product = loadProduct(purchases.db, productId);
      if (!product) {
        throw createError(ERROR_CODES.NOT_FOUND, `Mahsulot topilmadi: ${productId}`);
      }
    }

    const priced = postedStockLine(line, product.unit || 'pcs');
    const unitUsd = currency === 'USD' ? priced.unitCost : null;
    const unitUzs = currency === 'USD' ? priced.unitCost * fxRate : priced.unitCost;
    prepared.push({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku || null,
      ordered_qty: priced.qty,
      unit_cost: unitUzs,
      line_total: currency === 'USD' ? priced.invoiceTotal * fxRate : priced.invoiceTotal,
      unit_cost_usd: unitUsd,
      line_total_usd: unitUsd == null ? null : priced.invoiceTotal,
    });
  }

  const invoiceNumber = String(payload.invoice_number || '').trim() || null;
  const imageUrl = payload.image_url ? String(payload.image_url) : null;
  const notes = buildInvoiceAttachmentNote({
    imageUrl,
    rawAi: payload.raw_ai || null,
    invoiceNumber,
  });
  const duplicates = duplicateInvoiceRefs(purchases.db, supplier.id, invoiceNumber);

  const orderItems = prepared.map((item) => {
    const row = {
      product_id: item.product_id,
      product_name: item.product_name,
      product_sku: item.product_sku,
      ordered_qty: item.ordered_qty,
      unit_cost: item.unit_cost,
      line_total: item.line_total,
    };
    if (currency === 'USD') {
      row.unit_cost_usd = item.unit_cost_usd;
      row.line_total_usd = item.line_total_usd;
    }
    return row;
  });

  let po = null;
  try {
    po = purchases.createOrder({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      status: 'draft',
      currency,
      fx_rate: currency === 'USD' ? fxRate : null,
      invoice_number: invoiceNumber,
      notes,
      payment_scheme: 'full',
      created_by: payload.created_by || null,
      items: orderItems,
    });
    const pool = (po.items || []).map((item) => ({ ...item, used: false }));
    const receiptItems = [];
    for (const item of prepared) {
      const hit = pool.find(
        (row) =>
          !row.used &&
          row.product_id === item.product_id &&
          Math.abs(Number(row.ordered_qty) - Number(item.ordered_qty)) < 1e-6,
      );
      if (!hit?.id) {
        throw createError(ERROR_CODES.INTERNAL_ERROR, 'Xarid qatori qabul uchun topilmadi');
      }
      hit.used = true;
      receiptItems.push({
        item_id: hit.id,
        product_id: item.product_id,
        received_qty: item.ordered_qty,
      });
    }
    const received = purchases.receiveGoods(po.id, {
      items: receiptItems,
      invoice_number: invoiceNumber,
      notes,
      received_by: payload.created_by || null,
    });
    return {
      purchase_order: received,
      warnings: duplicates,
      currency,
      currency_label: supplier.currency_label,
    };
  } catch (err) {
    if (po?.id) {
      try {
        const fresh = purchases.db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.id);
        if (fresh && (fresh.status === 'draft' || fresh.status === 'cancelled')) {
          purchases.deleteOrder(po.id);
        }
      } catch {
        // Leave the draft if it can no longer be deleted; receive did not commit stock.
      }
    }
    throw err;
  }
}

module.exports = {
  extractInvoiceDraft,
  confirmInvoicePurchase,
  loadMatchCatalog,
  duplicateInvoiceRefs,
};
