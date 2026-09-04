const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const { UZBEKISTAN_TZ_SQLITE_OFFSET } = require('../lib/timezone.cjs');

/**
 * Supplier Returns Service
 * - Records supplier returns (credit note) and adjusts inventory
 * - Only allows returning stock that originated from that supplier
 *   (inventory_batches.supplier_id remaining, else receipts/PO received − prior returns)
 * - Writes a "credit_note" entry into supplier_payments so supplier debt decreases
 */
class SupplierReturnsService {
  constructor(db, inventoryService, batchService = null) {
    this.db = db;
    this.inventoryService = inventoryService;
    this.batchService = batchService;
  }

  _tzDateExpr(columnExpr) {
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  _hasTable(name) {
    try {
      return !!this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name);
    } catch {
      return false;
    }
  }

  _tableCols(table) {
    try {
      return new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name));
    } catch {
      return new Set();
    }
  }

  _resolveWarehouseId(warehouseId) {
    return warehouseId || 'main-warehouse-001';
  }

  _currentStock(productId, warehouseId) {
    if (this.inventoryService?.getCurrentStock) {
      return Math.max(0, Number(this.inventoryService.getCurrentStock(productId, warehouseId)) || 0);
    }
    return 0;
  }

  /**
   * Qty already returned to this supplier for a product (completed returns).
   */
  _priorReturnedQty(supplierId, productId) {
    if (!this._hasTable('supplier_returns') || !this._hasTable('supplier_return_items')) return 0;
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(SUM(sri.quantity), 0) AS qty
        FROM supplier_return_items sri
        INNER JOIN supplier_returns sr ON sr.id = sri.return_id
        WHERE sr.supplier_id = ?
          AND sri.product_id = ?
          AND LOWER(COALESCE(sr.status, 'completed')) = 'completed'
      `
      )
      .get(supplierId, productId);
    return Math.max(0, Number(row?.qty || 0) || 0);
  }

  /**
   * Received qty from this supplier via receipts (preferred) or PO items.
   */
  _receivedFromSupplierQty(supplierId, productId) {
    let received = 0;

    if (this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      const receiptCols = this._tableCols('purchase_receipts');
      if (receiptCols.has('supplier_id')) {
        const row = this.db
          .prepare(
            `
            SELECT COALESCE(SUM(pri.received_qty), 0) AS qty
            FROM purchase_receipt_items pri
            INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
            WHERE pr.supplier_id = ?
              AND pri.product_id = ?
              AND LOWER(COALESCE(pr.status, 'received')) NOT IN ('cancelled', 'void', 'draft')
          `
          )
          .get(supplierId, productId);
        received = Math.max(0, Number(row?.qty || 0) || 0);
      }
    }

    if (received > 0) return received;

    if (this._hasTable('purchase_orders') && this._hasTable('purchase_order_items')) {
      const row = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(poi.received_qty), 0) AS qty
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.supplier_id = ?
            AND poi.product_id = ?
            AND LOWER(COALESCE(po.status, '')) IN ('received', 'partially_received', 'approved')
        `
        )
        .get(supplierId, productId);
      received = Math.max(0, Number(row?.qty || 0) || 0);
    }

    return received;
  }

  /**
   * Remaining returnable qty for product from this supplier.
   * Prefer inventory_batches.remaining_qty for that supplier_id when batches exist;
   * otherwise received − prior returns, capped by current stock.
   */
  getReturnableQty(supplierId, productId, warehouseId) {
    if (!supplierId || !productId) return 0;
    const wh = this._resolveWarehouseId(warehouseId);
    const stock = this._currentStock(productId, wh);

    if (this._hasTable('inventory_batches')) {
      const batchCols = this._tableCols('inventory_batches');
      if (batchCols.has('supplier_id')) {
        const ever = this.db
          .prepare(
            `
            SELECT COUNT(*) AS cnt
            FROM inventory_batches
            WHERE product_id = ?
              AND warehouse_id = ?
              AND supplier_id = ?
          `
          )
          .get(productId, wh, supplierId);
        if (Number(ever?.cnt || 0) > 0) {
          const rem = this.db
            .prepare(
              `
              SELECT COALESCE(SUM(remaining_qty), 0) AS qty
              FROM inventory_batches
              WHERE product_id = ?
                AND warehouse_id = ?
                AND supplier_id = ?
                AND COALESCE(status, 'active') = 'active'
                AND remaining_qty > 0
            `
            )
            .get(productId, wh, supplierId);
          return Math.min(stock, Math.max(0, Number(rem?.qty || 0) || 0));
        }
      }
    }

    const received = this._receivedFromSupplierQty(supplierId, productId);
    const returned = this._priorReturnedQty(supplierId, productId);
    return Math.min(stock, Math.max(0, received - returned));
  }

  /**
   * Products that still have returnable qty from this supplier.
   */
  listReturnableProducts(filters = {}) {
    const supplierId = filters.supplier_id;
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Yetkazib beruvchi tanlanmagan (supplier_id majburiy)');
    }

    const supplier = this.db
      .prepare('SELECT id, name, settlement_currency FROM suppliers WHERE id = ?')
      .get(supplierId);
    if (!supplier) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Yetkazib beruvchi topilmadi');
    }
    const settlementCurrency =
      String(supplier?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const supplierFx = this._resolveFxRate(supplierId, null, filters.fx_rate);

    const wh = this._resolveWarehouseId(filters.warehouse_id);
    const search = String(filters.search || '').trim().toLowerCase();
    const limit = Number.isFinite(Number(filters.limit))
      ? Math.min(500, Math.max(1, Number(filters.limit)))
      : 200;

    const productIds = new Set();

    if (this._hasTable('inventory_batches') && this._tableCols('inventory_batches').has('supplier_id')) {
      const rows = this.db
        .prepare(
          `
          SELECT DISTINCT product_id
          FROM inventory_batches
          WHERE supplier_id = ?
            AND warehouse_id = ?
            AND COALESCE(status, 'active') = 'active'
            AND remaining_qty > 0
        `
        )
        .all(supplierId, wh);
      for (const r of rows) productIds.add(String(r.product_id));
    }

    if (this._hasTable('purchase_receipts') && this._hasTable('purchase_receipt_items')) {
      const receiptCols = this._tableCols('purchase_receipts');
      if (receiptCols.has('supplier_id')) {
        const rows = this.db
          .prepare(
            `
            SELECT DISTINCT pri.product_id AS product_id
            FROM purchase_receipt_items pri
            INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
            WHERE pr.supplier_id = ?
              AND LOWER(COALESCE(pr.status, 'received')) NOT IN ('cancelled', 'void', 'draft')
              AND COALESCE(pri.received_qty, 0) > 0
          `
          )
          .all(supplierId);
        for (const r of rows) productIds.add(String(r.product_id));
      }
    }

    if (this._hasTable('purchase_orders') && this._hasTable('purchase_order_items')) {
      const rows = this.db
        .prepare(
          `
          SELECT DISTINCT poi.product_id AS product_id
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.supplier_id = ?
            AND LOWER(COALESCE(po.status, '')) IN ('received', 'partially_received', 'approved')
            AND COALESCE(poi.received_qty, 0) > 0
        `
        )
        .all(supplierId);
      for (const r of rows) productIds.add(String(r.product_id));
    }

    const out = [];
    for (const productId of productIds) {
      const returnableQty = this.getReturnableQty(supplierId, productId, wh);
      if (!(returnableQty > 0)) continue;

      const product = this.db
        .prepare('SELECT id, name, sku, purchase_price FROM products WHERE id = ?')
        .get(productId);
      if (!product) continue;

      const name = String(product.name || '');
      const sku = String(product.sku || '');
      if (search) {
        const hay = `${name} ${sku}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }

      const costInfo = this._latestSupplierCostInfo(supplierId, productId);
      let unitCostUzs =
        costInfo.unit_cost_uzs != null
          ? Number(costInfo.unit_cost_uzs)
          : Number(product.purchase_price || 0) || 0;
      const lineFx = costInfo.fx_rate || supplierFx;
      let unitCostUsd =
        costInfo.unit_cost_usd != null
          ? Number(costInfo.unit_cost_usd)
          : lineFx && unitCostUzs > 0
            ? unitCostUzs / lineFx
            : null;

      // unit_cost is always in settlement currency so UI + credit note stay consistent with POs.
      let unitCost = unitCostUzs;
      let costCurrency = 'UZS';
      if (settlementCurrency === 'USD') {
        if (unitCostUsd != null && Number.isFinite(unitCostUsd)) {
          unitCost = unitCostUsd;
          costCurrency = 'USD';
        } else if (lineFx && unitCostUzs > 0) {
          unitCost = unitCostUzs / lineFx;
          unitCostUsd = unitCost;
          costCurrency = 'USD';
        } else {
          // No FX yet — keep UZS and flag so create() can require conversion.
          costCurrency = 'UZS';
        }
      }

      out.push({
        product_id: product.id,
        product_name: name,
        product_sku: sku,
        returnable_qty: returnableQty,
        current_stock: this._currentStock(productId, wh),
        unit_cost: unitCost,
        unit_cost_uzs: unitCostUzs,
        unit_cost_usd: unitCostUsd,
        cost_currency: costCurrency,
        fx_rate: lineFx,
        settlement_currency: settlementCurrency,
        supplier_id: supplierId,
        warehouse_id: wh,
      });
    }

    out.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'uz'));
    return out.slice(0, limit);
  }

  /**
   * Reject mislabeled USD costs (UZS stuffed into unit_cost_usd) and non-positive values.
   * Classic bug: receipt/PO wrote unit_cost (UZS) into unit_cost_usd → credit note of millions "USD".
   */
  _sanitizeUnitCostUsd(unitCostUzs, unitCostUsd, fxRate) {
    if (!(Number(unitCostUsd) > 0) || !Number.isFinite(Number(unitCostUsd))) return null;
    const usd = Number(unitCostUsd);
    const uzs = Number(unitCostUzs);
    const fx = Number(fxRate) > 0 ? Number(fxRate) : null;

    // Same magnitude as UZS → almost certainly unconverted so'm stored as USD.
    if (Number.isFinite(uzs) && uzs > 0) {
      const rel = Math.abs(usd - uzs) / Math.max(uzs, usd);
      if (rel < 0.05) return null;
    }

    // With FX, expected USD is uzs/fx; if stored USD ≈ uzs (not uzs/fx), drop it.
    if (fx && Number.isFinite(uzs) && uzs > 0) {
      const expected = uzs / fx;
      if (expected > 0) {
        const vsExpected = Math.abs(usd - expected) / expected;
        const vsUzs = Math.abs(usd - uzs) / uzs;
        if (vsUzs < 0.05 && vsExpected > 0.5) return null;
        // Absurd unit USD (e.g. 40M) while UZS/fx is a normal price.
        if (usd > 1000 && expected < usd * 0.1 && vsExpected > 0.5) return null;
      }
    }

    return usd;
  }

  _packCostInfo(unitCostUzs, unitCostUsd, fxRate) {
    const uzs =
      unitCostUzs != null && Number.isFinite(Number(unitCostUzs)) && Number(unitCostUzs) >= 0
        ? Number(unitCostUzs)
        : null;
    const fx = Number(fxRate) > 0 ? Number(fxRate) : null;
    let usd = this._sanitizeUnitCostUsd(uzs, unitCostUsd, fx);
    if (usd == null && uzs != null && fx) usd = uzs / fx;
    if (uzs == null && usd != null && fx) {
      return { unit_cost_uzs: usd * fx, unit_cost_usd: usd, fx_rate: fx };
    }
    return { unit_cost_uzs: uzs, unit_cost_usd: usd, fx_rate: fx };
  }

  /**
   * Latest purchase cost for product from this supplier.
   * Prefer that supplier's inventory_batches (receipt/PO currency + unit cost), then receipts, then POs.
   * Inventory / PO unit_cost is always UZS; unit_cost_usd is settlement USD when present.
   * @returns {{ unit_cost_uzs: number|null, unit_cost_usd: number|null, fx_rate: number|null }}
   */
  _latestSupplierCostInfo(supplierId, productId) {
    const empty = { unit_cost_uzs: null, unit_cost_usd: null, fx_rate: null };

    // 1) This supplier's batches (remaining first, else latest opened) — authoritative for return FIFO.
    if (this._hasTable('inventory_batches') && this._tableCols('inventory_batches').has('supplier_id')) {
      const bCols = this._tableCols('inventory_batches');
      const hasCurrency = bCols.has('currency');
      const hasFx = bCols.has('exchange_rate');
      const hasCostUzs = bCols.has('cost_price_uzs');
      const row = this.db
        .prepare(
          `
          SELECT
            ${hasCostUzs ? 'COALESCE(NULLIF(cost_price_uzs, 0), unit_cost)' : 'unit_cost'} AS unit_cost_uzs
            ${hasCurrency ? ', currency' : ''}
            ${hasFx ? ', exchange_rate' : ''}
          FROM inventory_batches
          WHERE product_id = ?
            AND supplier_id = ?
            AND COALESCE(status, 'active') = 'active'
          ORDER BY
            CASE WHEN remaining_qty > 0 THEN 0 ELSE 1 END,
            datetime(COALESCE(opened_at, created_at)) DESC
          LIMIT 1
        `
        )
        .get(productId, supplierId);
      if (row && Number.isFinite(Number(row.unit_cost_uzs))) {
        const fx = hasFx && Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : null;
        const cur = hasCurrency ? String(row.currency || '').toUpperCase() : '';
        // Batches store unit_cost in UZS; derive USD when batch/PO was USD settlement.
        const usd =
          cur === 'USD' && fx && Number(row.unit_cost_uzs) > 0
            ? Number(row.unit_cost_uzs) / fx
            : null;
        const packed = this._packCostInfo(Number(row.unit_cost_uzs), usd, fx);
        if (packed.unit_cost_uzs != null) return packed;
      }
    }

    if (this._hasTable('purchase_receipt_items') && this._hasTable('purchase_receipts')) {
      const priCols = this._tableCols('purchase_receipt_items');
      const prCols = this._tableCols('purchase_receipts');
      const hasUsd = priCols.has('unit_cost_usd');
      const hasFx =
        (prCols.has('exchange_rate') ? 'pr.exchange_rate' : null) ||
        (priCols.has('exchange_rate') ? 'pri.exchange_rate' : null);
      const hasCurrency = prCols.has('currency');
      const row = this.db
        .prepare(
          `
          SELECT pri.unit_cost
            ${hasUsd ? ', pri.unit_cost_usd' : ''}
            ${hasFx ? `, ${hasFx} AS fx_rate` : ''}
            ${hasCurrency ? ', pr.currency AS receipt_currency' : ''}
          FROM purchase_receipt_items pri
          INNER JOIN purchase_receipts pr ON pr.id = pri.receipt_id
          WHERE pr.supplier_id = ?
            AND pri.product_id = ?
            AND COALESCE(pri.received_qty, 0) > 0
          ORDER BY datetime(COALESCE(pr.received_at, pr.created_at)) DESC
          LIMIT 1
        `
        )
        .get(supplierId, productId);
      if (row && Number.isFinite(Number(row.unit_cost))) {
        const fx = Number(row.fx_rate) > 0 ? Number(row.fx_rate) : null;
        let rawUsd = hasUsd ? row.unit_cost_usd : null;
        // If receipt is USD but unit_cost_usd missing, do not treat unit_cost (UZS) as USD.
        if (
          (rawUsd == null || !(Number(rawUsd) > 0)) &&
          hasCurrency &&
          String(row.receipt_currency || '').toUpperCase() === 'USD' &&
          fx &&
          Number(row.unit_cost) > 0
        ) {
          rawUsd = Number(row.unit_cost) / fx;
        }
        return this._packCostInfo(Number(row.unit_cost), rawUsd, fx);
      }
    }

    if (this._hasTable('purchase_order_items') && this._hasTable('purchase_orders')) {
      const poiCols = this._tableCols('purchase_order_items');
      const poCols = this._tableCols('purchase_orders');
      const hasUsd = poiCols.has('unit_cost_usd');
      const hasFx = poCols.has('fx_rate');
      const hasCurrency = poCols.has('currency');
      const row = this.db
        .prepare(
          `
          SELECT poi.unit_cost
            ${hasUsd ? ', poi.unit_cost_usd' : ''}
            ${hasFx ? ', po.fx_rate' : ''}
            ${hasCurrency ? ', po.currency AS po_currency' : ''}
          FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE po.supplier_id = ?
            AND poi.product_id = ?
            AND po.status IN ('received', 'partially_received', 'approved')
          ORDER BY datetime(po.created_at) DESC
          LIMIT 1
        `
        )
        .get(supplierId, productId);
      if (row && Number.isFinite(Number(row.unit_cost))) {
        const fx = hasFx && Number(row.fx_rate) > 0 ? Number(row.fx_rate) : null;
        let rawUsd = hasUsd ? row.unit_cost_usd : null;
        if (
          (rawUsd == null || !(Number(rawUsd) > 0)) &&
          hasCurrency &&
          String(row.po_currency || '').toUpperCase() === 'USD' &&
          fx &&
          Number(row.unit_cost) > 0
        ) {
          rawUsd = Number(row.unit_cost) / fx;
        }
        return this._packCostInfo(Number(row.unit_cost), rawUsd, fx);
      }
    }

    return empty;
  }

  /** @deprecated use _latestSupplierCostInfo — returns UZS unit cost only */
  _latestSupplierUnitCost(supplierId, productId) {
    const info = this._latestSupplierCostInfo(supplierId, productId);
    return info.unit_cost_uzs != null ? info.unit_cost_uzs : null;
  }

  /**
   * FX rate (UZS per 1 USD) for converting return costs into settlement currency.
   */
  _resolveFxRate(supplierId, purchaseOrderId, overrideFx) {
    const fromPayload = Number(overrideFx);
    if (Number.isFinite(fromPayload) && fromPayload > 0) return fromPayload;

    if (purchaseOrderId && this._hasTable('purchase_orders') && this._tableCols('purchase_orders').has('fx_rate')) {
      const po = this.db
        .prepare(`SELECT fx_rate FROM purchase_orders WHERE id = ?`)
        .get(purchaseOrderId);
      if (Number(po?.fx_rate) > 0) return Number(po.fx_rate);
    }

    if (this._hasTable('purchase_orders') && this._tableCols('purchase_orders').has('fx_rate')) {
      const row = this.db
        .prepare(
          `
          SELECT fx_rate
          FROM purchase_orders
          WHERE supplier_id = ?
            AND fx_rate IS NOT NULL
            AND fx_rate > 0
          ORDER BY datetime(COALESCE(order_date, created_at)) DESC
          LIMIT 1
        `
        )
        .get(supplierId);
      if (Number(row?.fx_rate) > 0) return Number(row.fx_rate);
    }

    if (this._hasTable('exchange_rates')) {
      try {
        const row = this.db
          .prepare(
            `
            SELECT rate
            FROM exchange_rates
            WHERE UPPER(TRIM(base_currency)) = 'USD'
              AND UPPER(TRIM(quote_currency)) = 'UZS'
              AND rate > 0
            ORDER BY datetime(COALESCE(effective_date, created_at)) DESC
            LIMIT 1
          `
          )
          .get();
        if (Number(row?.rate) > 0) return Number(row.rate);
      } catch {
        // optional table shape
      }
    }

    return null;
  }

  /**
   * Resolve unit cost in settlement currency (+ UZS snapshot for inventory semantics).
   * Incoming unit_cost is interpreted via cost_currency (default UZS — PO/inventory convention).
   */
  _resolveLineSettlementCost({
    settlementCurrency,
    fxRate,
    costInfo,
    unitCostInput,
    unitCostUsdInput,
    costCurrencyInput,
  }) {
    const fx =
      Number(fxRate) > 0
        ? Number(fxRate)
        : Number(costInfo?.fx_rate) > 0
          ? Number(costInfo.fx_rate)
          : null;

    let unitUzs =
      costInfo?.unit_cost_uzs != null && Number.isFinite(Number(costInfo.unit_cost_uzs))
        ? Number(costInfo.unit_cost_uzs)
        : null;
    // Never trust raw unit_cost_usd without sanitizing (UZS-as-USD legacy rows).
    let unitUsd = this._sanitizeUnitCostUsd(unitUzs, costInfo?.unit_cost_usd, fx);

    if (unitCostUsdInput !== undefined && unitCostUsdInput !== null && Number.isFinite(Number(unitCostUsdInput))) {
      const sanitizedIn = this._sanitizeUnitCostUsd(unitUzs, unitCostUsdInput, fx);
      if (sanitizedIn != null) {
        unitUsd = sanitizedIn;
        if ((unitUzs == null || !(unitUzs >= 0)) && fx) unitUzs = unitUsd * fx;
      } else if (fx && Number(unitCostUsdInput) > 0 && unitUzs != null && unitUzs > 0) {
        // Input looked like UZS stuffed as USD — prefer UZS/fx.
        unitUsd = unitUzs / fx;
      } else if (fx && Number(unitCostUsdInput) > 0) {
        // Treat huge "USD" input as UZS amount when no trusted UZS snapshot.
        const maybeUzs = Number(unitCostUsdInput);
        if (maybeUzs >= 1000) {
          unitUzs = maybeUzs;
          unitUsd = maybeUzs / fx;
        }
      }
    } else if (unitCostInput !== undefined && unitCostInput !== null && Number.isFinite(Number(unitCostInput))) {
      const costCur =
        String(costCurrencyInput || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      if (costCur === 'USD') {
        const sanitizedIn = this._sanitizeUnitCostUsd(unitUzs, unitCostInput, fx);
        if (sanitizedIn != null) {
          unitUsd = sanitizedIn;
          if ((unitUzs == null || !(unitUzs >= 0)) && fx) unitUzs = unitUsd * fx;
        } else if (fx && Number(unitCostInput) > 0) {
          // cost_currency=USD but value is clearly UZS (e.g. 40_916_150) — convert.
          unitUzs = Number(unitCostInput);
          unitUsd = unitUzs / fx;
        } else {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'USD tannarx noto‘g‘ri yoki UZS miqdori USD sifatida yuborilgan. fx_rate bilan qayta urinib ko‘ring.'
          );
        }
      } else {
        // Explicit UZS input always wins; recompute USD from fx (do not keep stale/bogus unit_cost_usd).
        unitUzs = Number(unitCostInput);
        if (fx) unitUsd = unitUzs / fx;
        else unitUsd = this._sanitizeUnitCostUsd(unitUzs, unitUsd, null);
      }
    }

    if (unitUsd == null && unitUzs != null && fx) unitUsd = unitUzs / fx;
    if (unitUzs == null && unitUsd != null && fx) unitUzs = unitUsd * fx;

    unitUzs = unitUzs != null && Number.isFinite(unitUzs) && unitUzs >= 0 ? unitUzs : 0;
    unitUsd = this._sanitizeUnitCostUsd(unitUzs, unitUsd, fx);

    if (settlementCurrency === 'USD') {
      if (unitUsd != null && Number.isFinite(unitUsd)) {
        return { unit_settlement: unitUsd, unit_cost_uzs: unitUzs, unit_cost_usd: unitUsd, fx_rate: fx };
      }
      if (fx && unitUzs > 0) {
        const converted = unitUzs / fx;
        return { unit_settlement: converted, unit_cost_uzs: unitUzs, unit_cost_usd: converted, fx_rate: fx };
      }
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'USD hisobli yetkazib beruvchiga qaytarish uchun unit_cost_usd yoki fx_rate (UZS/USD) majburiy. UZS tannarxni USD deb yozib bo‘lmaydi.'
      );
    }

    return {
      unit_settlement: unitUzs,
      unit_cost_uzs: unitUzs,
      unit_cost_usd: unitUsd,
      fx_rate: fx,
    };
  }

  /**
   * Create supplier return (credit note).
   * payload: {
   *   supplier_id, purchase_order_id?, warehouse_id?,
   *   return_reason?, notes?, created_by?,
   *   return_date?, fx_rate?, cost_currency?,
   *   items: [{ product_id, quantity, unit_cost?, unit_cost_usd?, cost_currency?, reason? }]
   * }
   *
   * Cost convention: PO/inventory unit_cost is UZS. For USD settlement suppliers the credit note
   * must land in amount_usd (via unit_cost_usd or UZS/fx_rate) — never raw UZS stuffed into USD.
   */
  create(payload = {}) {
    const supplierId = payload.supplier_id;
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Yetkazib beruvchi tanlanmagan (supplier_id majburiy)');
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Kamida bitta mahsulot qo‘shing');
    }

    const supplier = this.db
      .prepare('SELECT id, name, settlement_currency FROM suppliers WHERE id = ?')
      .get(supplierId);
    if (!supplier) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Yetkazib beruvchi topilmadi');
    }

    const settlementCurrency =
      String(supplier?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const fxRate = this._resolveFxRate(
      supplierId,
      payload.purchase_order_id || null,
      payload.fx_rate ?? payload.exchange_rate
    );

    const warehouseId = this._resolveWarehouseId(payload.warehouse_id);

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    const returnId = randomUUID();
    const returnNumber = `SRET-${Date.now()}-${returnId.slice(0, 6)}`;
    const returnDate = payload.return_date
      ? String(payload.return_date).split('T')[0].split(' ')[0]
      : now.split(' ')[0];

    const settlementModeRaw = String(payload.settlement_mode || payload.settlementMode || 'reduce_debt')
      .trim()
      .toLowerCase();
    const settlementMode =
      settlementModeRaw === 'create_advance' || settlementModeRaw === 'advance'
        ? 'create_advance'
        : settlementModeRaw === 'demand_refund' || settlementModeRaw === 'refund'
          ? 'demand_refund'
          : 'reduce_debt';

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT INTO supplier_returns (
            id, return_number, supplier_id, purchase_order_id, warehouse_id,
            status, return_reason, notes, total_amount,
            created_by, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          returnId,
          returnNumber,
          supplierId,
          payload.purchase_order_id || null,
          warehouseId,
          payload.status || 'completed',
          payload.return_reason || null,
          payload.notes || null,
          0,
          payload.created_by || null,
          now,
          now
        );

      let totalAmount = 0;
      /** Track qty reserved within this return so duplicate lines cannot over-return. */
      const reservedByProduct = new Map();

      for (const it of payload.items) {
        const productId = it.product_id;
        const qty = Number(it.quantity);
        if (!productId) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mahsulot tanlanmagan (items[].product_id)');
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Miqdor 0 dan katta bo‘lishi kerak');
        }

        const product = this.db.prepare('SELECT id, name, sku FROM products WHERE id = ?').get(productId);
        if (!product) {
          throw createError(ERROR_CODES.NOT_FOUND, `Mahsulot topilmadi: ${productId}`);
        }

        const alreadyReserved = Number(reservedByProduct.get(productId) || 0);
        const available = this.getReturnableQty(supplierId, productId, warehouseId) - alreadyReserved;

        if (!(available > 0)) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            `«${product.name}» ushbu yetkazib beruvchidan qabul qilinmagan yoki qaytarish uchun qoldiq yo‘q.`
          );
        }
        if (qty > available + 1e-9) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            `Qaytarish miqdori yetkazib beruvchidan kelgan qoldiqdan oshib ketdi. Mahsulot: ${product.name}. Mavjud: ${available}, so‘ralgan: ${qty}.`
          );
        }

        reservedByProduct.set(productId, alreadyReserved + qty);

        const costInfo = this._latestSupplierCostInfo(supplierId, productId);
        const lineFx = Number(it.fx_rate) > 0 ? Number(it.fx_rate) : fxRate || costInfo.fx_rate;
        const resolved = this._resolveLineSettlementCost({
          settlementCurrency,
          fxRate: lineFx,
          costInfo,
          unitCostInput: it.unit_cost,
          unitCostUsdInput: it.unit_cost_usd,
          costCurrencyInput: it.cost_currency || payload.cost_currency,
        });
        const safeUnitCost = Number(resolved.unit_settlement) || 0;

        const lineTotal = safeUnitCost * qty;
        totalAmount += lineTotal;

        this.db
          .prepare(
            `
            INSERT INTO supplier_return_items (
              id, return_id, product_id, product_name, product_sku,
              quantity, unit_cost, line_total, reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            randomUUID(),
            returnId,
            productId,
            product.name || productId,
            product.sku || '',
            qty,
            safeUnitCost,
            lineTotal,
            it.reason || null,
            now
          );

        if (payload.status !== 'draft') {
          try {
            this.inventoryService._updateBalance(
              productId,
              warehouseId,
              -qty,
              'supplier_return',
              'supplier_return',
              returnId,
              payload.return_reason || 'Postavshikka qaytarish',
              payload.created_by || null
            );
          } catch (stockErr) {
            if (stockErr?.code === ERROR_CODES.INSUFFICIENT_STOCK) {
              const avail = stockErr?.details?.available;
              throw createError(
                ERROR_CODES.INSUFFICIENT_STOCK,
                `Omborda yetarli qoldiq yo‘q: ${product.name}. Mavjud: ${avail != null ? avail : '?'}, so‘ralgan: ${qty}.`
              );
            }
            throw stockErr;
          }

          // Consume only this supplier's FIFO batches when they exist for the product.
          const shouldConsumeBatches =
            this.batchService &&
            this._hasTable('inventory_batches') &&
            this._tableCols('inventory_batches').has('supplier_id');

          if (shouldConsumeBatches) {
            const ever = this.db
              .prepare(
                `
                SELECT COUNT(*) AS cnt
                FROM inventory_batches
                WHERE product_id = ?
                  AND warehouse_id = ?
                  AND supplier_id = ?
              `
              )
              .get(productId, warehouseId, supplierId);

            if (Number(ever?.cnt || 0) > 0) {
              this.batchService.allocateFIFOForSupplierReturn({
                returnId,
                productId,
                warehouseId,
                quantity: qty,
                supplierId,
              });
            }
          }
        }
      }

      this.db
        .prepare(`UPDATE supplier_returns SET total_amount = ?, updated_at = ? WHERE id = ?`)
        .run(totalAmount, now, returnId);

      if ((payload.status || 'completed') !== 'draft' && totalAmount > 0) {
        const beforeSettlement = this.supplierService?.getSettlement
          ? this.supplierService.getSettlement(supplierId)
          : null;
        if (settlementMode === 'reduce_debt' && beforeSettlement) {
          const debt =
            settlementCurrency === 'USD' ? Number(beforeSettlement.debt_usd || 0) : Number(beforeSettlement.debt_uzs || 0);
          if (totalAmount > debt + 0.02) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              `Qarz yetarli emas (qarz: ${debt}, qaytarish: ${totalAmount}). Avans yoki refund tanlang.`,
            );
          }
        }

        let paymentId = null;
        if (settlementMode === 'reduce_debt') {
        const cols = this.db.prepare(`PRAGMA table_info(supplier_payments)`).all().map((c) => c.name);
        const hasNotes = cols.includes('notes');
        const hasNote = cols.includes('note');
        const notesCol = hasNotes ? 'notes' : hasNote ? 'note' : null;
        const hasReferenceNumber = cols.includes('reference_number');
        const hasCurrency = cols.includes('currency');
        const hasAmountUsd = cols.includes('amount_usd');

        paymentId = randomUUID();
        const paymentNumber = `SCN-${Date.now()}`;

        // Ledger buckets must match supplier settlement (same as createPayment / PO total_usd).
        const amountUzs = settlementCurrency === 'USD' ? 0 : totalAmount;
        const amountUsd = settlementCurrency === 'USD' ? totalAmount : null;

        const insertCols = [
          'id',
          'payment_number',
          'supplier_id',
          'purchase_order_id',
          'amount',
          'payment_method',
          'paid_at',
        ];
        const values = [
          paymentId,
          paymentNumber,
          supplierId,
          payload.purchase_order_id || null,
          amountUzs,
          'credit_note',
          `${returnDate} 00:00:00`,
        ];

        if (hasCurrency) {
          insertCols.push('currency');
          values.push(settlementCurrency);
        }
        if (hasAmountUsd && amountUsd != null) {
          insertCols.push('amount_usd');
          values.push(amountUsd);
        }

        if (hasReferenceNumber) {
          insertCols.push('reference_number');
          values.push(returnNumber);
        }

        if (notesCol) {
          insertCols.push(notesCol);
          const fxNote =
            settlementCurrency === 'USD' && fxRate
              ? ` [fx=${fxRate}]`
              : '';
          values.push(`Postavshikka qaytarish (credit note): ${returnNumber}${fxNote}`);
        }

        insertCols.push('created_by', 'created_at');
        values.push(payload.created_by || null, now);

        const placeholders = insertCols.map(() => '?').join(', ');
        this.db
          .prepare(`INSERT INTO supplier_payments (${insertCols.join(', ')}) VALUES (${placeholders})`)
          .run(...values);

        if (payload.purchase_order_id) {
          try {
            const poCols = this.db.prepare(`PRAGMA table_info(purchase_orders)`).all().map((c) => c.name);
            if (poCols.includes('paid_amount') && poCols.includes('payment_status')) {
              if (settlementCurrency === 'USD' && poCols.includes('paid_amount_usd') && poCols.includes('total_usd')) {
                const totalRow = this.db
                  .prepare(`SELECT total_usd FROM purchase_orders WHERE id = ?`)
                  .get(payload.purchase_order_id);
                const total = Number(totalRow?.total_usd ?? 0);
                const sumRow = this.db
                  .prepare(
                    `
                    SELECT COALESCE(SUM(amount_usd), 0) AS paid_amount_usd
                    FROM supplier_payments
                    WHERE purchase_order_id = ?
                  `
                  )
                  .get(payload.purchase_order_id);
                const paid = Number(sumRow?.paid_amount_usd ?? 0);
                const status = paid <= 0 ? 'UNPAID' : paid >= total ? 'PAID' : 'PARTIALLY_PAID';
                this.db
                  .prepare(
                    `UPDATE purchase_orders SET paid_amount_usd = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`
                  )
                  .run(paid, status, payload.purchase_order_id);
              } else {
                const totalRow = this.db
                  .prepare(`SELECT total_amount FROM purchase_orders WHERE id = ?`)
                  .get(payload.purchase_order_id);
                const total = Number(totalRow?.total_amount ?? 0);
                const sumRow = this.db
                  .prepare(
                    `
                    SELECT COALESCE(SUM(amount), 0) AS paid_amount
                    FROM supplier_payments
                    WHERE purchase_order_id = ?
                  `
                  )
                  .get(payload.purchase_order_id);
                const paid = Number(sumRow?.paid_amount ?? 0);
                const status = paid <= 0 ? 'UNPAID' : paid >= total ? 'PAID' : 'PARTIALLY_PAID';
                this.db
                  .prepare(
                    `UPDATE purchase_orders SET paid_amount = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`
                  )
                  .run(paid, status, payload.purchase_order_id);
              }
            }
          } catch {
            // ignore cache update failures
          }
        }
        } else if (this.supplierService?._createAdvanceRecord) {
          this.supplierService._createAdvanceRecord({
            supplierId,
            amount: totalAmount,
            currency: settlementCurrency,
            fxRate: fxRate || null,
            fxRateSource: fxRate ? 'return' : null,
            basisPaymentId: null,
            basisPurchaseOrderId: payload.purchase_order_id || null,
            notes:
              settlementMode === 'demand_refund'
                ? `Qaytarish — naqd/bank refund kutilmoqda: ${returnNumber}`
                : `Qaytarish — yetkazib beruvchi avansi: ${returnNumber}`,
            createdBy: payload.created_by || null,
            kind: settlementMode === 'demand_refund' ? 'pending_refund' : 'advance',
          });
        }

        if (this.supplierService?._recordSettlementLedger) {
          const afterSettlement = this.supplierService.getSettlement(supplierId);
          const debtKey = settlementCurrency === 'USD' ? 'debt_usd' : 'debt_uzs';
          const advKey = settlementCurrency === 'USD' ? 'advance_usd' : 'advance_uzs';
          this.supplierService._recordSettlementLedger({
            supplier_id: supplierId,
            op_type:
              settlementMode === 'create_advance'
                ? 'debit_note_create_advance'
                : settlementMode === 'demand_refund'
                  ? 'debit_note_demand_refund'
                  : 'debit_note_reduce_debt',
            currency: settlementCurrency,
            amount: totalAmount,
            debt_before: beforeSettlement ? beforeSettlement[debtKey] : 0,
            debt_after: afterSettlement[debtKey],
            advance_before: beforeSettlement ? beforeSettlement[advKey] : 0,
            advance_after: afterSettlement[advKey],
            purchase_order_id: payload.purchase_order_id || null,
            payment_id: paymentId,
            return_id: returnId,
            reason: payload.return_reason || payload.notes || `Supplier return ${returnNumber}`,
            payment_method: settlementMode === 'reduce_debt' ? 'credit_note' : settlementMode,
            cash_source: 'none',
            created_by: payload.created_by || null,
            created_at: now,
          });
        }
      }

      return this.get(returnId);
    });

    return tx();
  }

  /**
   * Return every currently returnable line for the supplier at max qty.
   */
  createReturnAll(payload = {}) {
    const supplierId = payload.supplier_id;
    if (!supplierId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Yetkazib beruvchi tanlanmagan (supplier_id majburiy)');
    }
    const rows = this.listReturnableProducts({
      supplier_id: supplierId,
      warehouse_id: payload.warehouse_id,
      limit: 500,
      fx_rate: payload.fx_rate ?? payload.exchange_rate,
    });
    if (!rows.length) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Qaytariladigan mahsulot topilmadi');
    }
    return this.create({
      ...payload,
      items: rows.map((p) => ({
        product_id: p.product_id,
        quantity: Number(p.returnable_qty),
        unit_cost: Number(p.unit_cost),
        unit_cost_usd: p.unit_cost_usd != null ? Number(p.unit_cost_usd) : undefined,
        cost_currency: p.cost_currency || payload.cost_currency,
        fx_rate: p.fx_rate,
      })),
    });
  }

  get(id) {
    if (!id) throw createError(ERROR_CODES.VALIDATION_ERROR, 'id majburiy');

    const row = this.db
      .prepare(
        `
        SELECT sr.*, s.name AS supplier_name, po.po_number AS po_number
        FROM supplier_returns sr
        LEFT JOIN suppliers s ON s.id = sr.supplier_id
        LEFT JOIN purchase_orders po ON po.id = sr.purchase_order_id
        WHERE sr.id = ?
      `
      )
      .get(id);

    if (!row) throw createError(ERROR_CODES.NOT_FOUND, 'Postavshikka qaytarish topilmadi');

    const items = this.db
      .prepare(
        `
        SELECT sri.*
        FROM supplier_return_items sri
        WHERE sri.return_id = ?
        ORDER BY sri.created_at ASC
      `
      )
      .all(id);

    return { ...row, items };
  }

  list(filters = {}) {
    let query = `
      SELECT sr.*, s.name AS supplier_name, po.po_number AS po_number
      FROM supplier_returns sr
      LEFT JOIN suppliers s ON s.id = sr.supplier_id
      LEFT JOIN purchase_orders po ON po.id = sr.purchase_order_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.supplier_id) {
      query += ' AND sr.supplier_id = ?';
      params.push(filters.supplier_id);
    }
    if (filters.purchase_order_id) {
      query += ' AND sr.purchase_order_id = ?';
      params.push(filters.purchase_order_id);
    }
    if (filters.status) {
      query += ' AND sr.status = ?';
      params.push(filters.status);
    }
    if (filters.date_from) {
      query += ` AND ${this._tzDateExpr('sr.created_at')} >= date(?)`;
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      query += ` AND ${this._tzDateExpr('sr.created_at')} <= date(?)`;
      params.push(filters.date_to);
    }

    query += ' ORDER BY datetime(sr.created_at) DESC';

    const limit = Number.isFinite(Number(filters.limit)) ? Math.min(500, Math.max(1, Number(filters.limit))) : 100;
    const offset = Number.isFinite(Number(filters.offset)) ? Math.max(0, Number(filters.offset)) : 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(params);
  }
}

module.exports = SupplierReturnsService;
