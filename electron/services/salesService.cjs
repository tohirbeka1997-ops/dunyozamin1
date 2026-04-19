const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const { readConfig } = require('../config/appConfig.cjs');

/**
 * Sales Service (POS Terminal)
 * Handles order creation, management, and finalization
 */
class SalesService {
  constructor(db, inventoryService, batchService = null, costService = null, pricingService = null, promotionService = null) {
    this.db = db;
    this.inventoryService = inventoryService;
    this.batchService = batchService;
    this.costService = costService;
    this.pricingService = pricingService;
    this.promotionService = promotionService;
    this._orderItemsColumns = null;
    this._orderColumns = null;
  }

  _getOrderItemsColumns() {
    if (this._orderItemsColumns) return this._orderItemsColumns;
    const cols = this.db.prepare(`PRAGMA table_info(order_items)`).all() || [];
    this._orderItemsColumns = new Set(cols.map((c) => c.name));
    return this._orderItemsColumns;
  }

  _hasOrderItemCol(name) {
    try {
      return this._getOrderItemsColumns().has(name);
    } catch {
      return false;
    }
  }

  _getOrderColumns() {
    if (this._orderColumns) return this._orderColumns;
    const cols = this.db.prepare(`PRAGMA table_info(orders)`).all() || [];
    this._orderColumns = new Set(cols.map((c) => c.name));
    return this._orderColumns;
  }

  _hasOrderCol(name) {
    try {
      return this._getOrderColumns().has(name);
    } catch {
      return false;
    }
  }

  _hasCustomersCol(name) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(customers)`).all() || [];
      return cols.some((c) => c.name === name);
    } catch {
      return false;
    }
  }

  _getSettingRaw(key) {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value != null ? String(row.value) : null;
    } catch {
      return null;
    }
  }

  _isLoyaltyMasterEnabled() {
    const v = (this._getSettingRaw('loyalty.master.enabled') || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  _getLoyaltyPointsPerUzs() {
    const v = Number(this._getSettingRaw('loyalty.master.points_per_uzs'));
    return Number.isFinite(v) && v > 0 ? v : 1000;
  }

  _isLoyaltyGeneralEnabled() {
    const v = (this._getSettingRaw('loyalty.general.enabled') || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  _getLoyaltyEarnScope() {
    const raw = (this._getSettingRaw('loyalty.earn.scope') || 'master_only').trim().toLowerCase();
    if (raw === 'all_registered' || raw === 'exclude_walk_in') return raw;
    return 'master_only';
  }

  _getLoyaltyGeneralPointsPerUzs() {
    const v = Number(this._getSettingRaw('loyalty.earn.points_per_uzs'));
    return Number.isFinite(v) && v > 0 ? v : 1000;
  }

  _getLoyaltyMinOrderUzs() {
    const v = Number(this._getSettingRaw('loyalty.earn.min_order_uzs'));
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  _isLoyaltyRedeemEnabled() {
    const v = (this._getSettingRaw('loyalty.redeem.enabled') || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  _getLoyaltyRedeemUzsPerPoint() {
    const v = Number(this._getSettingRaw('loyalty.redeem.points_per_uzs'));
    return Number.isFinite(v) && v > 0 ? v : 100;
  }

  _getLoyaltyRedeemMinPoints() {
    const v = Number(this._getSettingRaw('loyalty.redeem.min_points'));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  _getLoyaltyRedeemMaxPercentOfOrder() {
    const v = Number(this._getSettingRaw('loyalty.redeem.max_percent_of_order'));
    if (!Number.isFinite(v) || v <= 0) return 100;
    return Math.min(100, v);
  }

  _hasBonusLedgerTable() {
    try {
      const t = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
        .get();
      return !!t;
    } catch {
      return false;
    }
  }

  _hasEarnLedgerForOrder(customerId, orderId) {
    if (!this._hasBonusLedgerTable() || !customerId || !orderId) return false;
    try {
      const row = this.db
        .prepare(
          `SELECT 1 FROM customer_bonus_ledger WHERE customer_id = ? AND order_id = ? AND type = 'earn' LIMIT 1`
        )
        .get(customerId, orderId);
      return !!row;
    } catch {
      return false;
    }
  }

  _insertBonusLedgerRow({ customerId, type, points, orderId, note, createdBy, now }) {
    if (!this._hasBonusLedgerTable()) return;
    try {
      const lid = randomUUID();
      this.db
        .prepare(
          `INSERT INTO customer_bonus_ledger (id, customer_id, type, points, order_id, note, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(lid, customerId, type, points, orderId || null, note || null, now, createdBy || null);
    } catch (e) {
      console.warn('[loyalty] customer_bonus_ledger insert skip:', e?.message || e);
    }
  }

  /**
   * Redeem loyalty points: deduct bonus_points + ledger row. Idempotent per order.
   */
  _applyLoyaltyRedeemOnOrder({
    orderData,
    orderId,
    orderNumber,
    customerId,
    skipWalkInCustomerId,
    createdBy,
    now,
  }) {
    if (!this._hasCustomersCol('bonus_points')) return;
    if (!customerId || (skipWalkInCustomerId && customerId === skipWalkInCustomerId)) return;

    const requested = Math.floor(Number(orderData.loyalty_redeem_points) || 0);
    if (requested <= 0) return;

    if (!this._isLoyaltyRedeemEnabled()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Ball ishlatish hozircha o‘chirilgan (sozlamalar).');
    }

    const existing = this.db
      .prepare(`SELECT 1 FROM customer_bonus_ledger WHERE order_id = ? AND type = 'redeem' LIMIT 1`)
      .get(orderId);
    if (existing) return;

    const uzsPerPt = this._getLoyaltyRedeemUzsPerPoint();
    const minPts = this._getLoyaltyRedeemMinPoints();
    if (minPts > 0 && requested < minPts) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Minimal ishlatish: ${minPts} ball (sozlamalar).`
      );
    }

    const subtotal = Number(orderData.subtotal) || 0;
    const maxPct = this._getLoyaltyRedeemMaxPercentOfOrder();
    const maxUzsFromPct = subtotal * (maxPct / 100);
    const maxPtsFromPct = uzsPerPt > 0 ? Math.floor(maxUzsFromPct / uzsPerPt) : 0;

    const cust = this.db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(customerId);
    const balance = Number(cust?.bonus_points) || 0;
    const applyPts = Math.min(requested, Math.floor(balance), maxPtsFromPct);

    if (applyPts < requested) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Ball yetarli emas yoki chegirma limiti oshib ketdi. Maksimal: ${Math.min(Math.floor(balance), maxPtsFromPct)} ball.`
      );
    }

    if (applyPts <= 0) return;

    const discountUzs = applyPts * uzsPerPt;
    const disc = Number(orderData.discount_amount) || 0;
    const tot = Number(orderData.total_amount) || 0;
    const sub = Number(orderData.subtotal) || 0;
    if (Math.abs(sub - disc - tot) > 0.05) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Buyurtma chegirma/jami summasi mos kelmaydi (loyalty).'
      );
    }
    if (disc + 0.05 < discountUzs) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Ball chegirmasi buyurtma chegirmasiga kiritilmagan yoki mos kelmaydi.'
      );
    }

    this.db
      .prepare(
        'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) - ?, updated_at = ? WHERE id = ?'
      )
      .run(applyPts, now, customerId);

    this._insertBonusLedgerRow({
      customerId,
      type: 'redeem',
      points: -Math.abs(applyPts),
      orderId,
      note: `Ishlatildi: ${orderNumber || orderId} (−${applyPts} ball, ~${discountUzs} so‘m)`,
      createdBy,
      now,
    });

    if (this._hasOrderCol('loyalty_redeem_points')) {
      this.db.prepare('UPDATE orders SET loyalty_redeem_points = ? WHERE id = ?').run(applyPts, orderId);
    }
  }

  /**
   * Accrue bonus: master tier uses master settings (exclusive). Other tiers use general rules when enabled.
   * Based on actually paid amount only (excludes unpaid credit). Idempotent per order (earn).
   */
  _accrueCustomerLoyalty({
    customerId,
    paidAmount,
    orderTotalAmount,
    orderId,
    orderNumber,
    createdBy,
    now,
    skipWalkInCustomerId,
  }) {
    if (!customerId || (skipWalkInCustomerId && customerId === skipWalkInCustomerId)) return;
    if (!this._hasCustomersCol('bonus_points')) return;
    const paid = Number(paidAmount) || 0;
    if (paid <= 0) return;

    if (this._hasEarnLedgerForOrder(customerId, orderId)) return;

    const minOrder = this._getLoyaltyMinOrderUzs();
    const orderTotal = Number(orderTotalAmount) || 0;
    if (minOrder > 0 && orderTotal < minOrder) return;

    const cust = this.db.prepare('SELECT pricing_tier FROM customers WHERE id = ?').get(customerId);
    const tier = String(cust?.pricing_tier || 'retail');

    if (this._isLoyaltyMasterEnabled() && tier === 'master') {
      const perUzs = this._getLoyaltyPointsPerUzs();
      const earned = Math.floor(paid / perUzs);
      if (earned <= 0) return;
      this.db
        .prepare(
          'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) + ?, updated_at = ? WHERE id = ?'
        )
        .run(earned, now, customerId);
      this._insertBonusLedgerRow({
        customerId,
        type: 'earn',
        points: earned,
        orderId,
        note: `Usta sotuv ${orderNumber || orderId || ''}`.trim(),
        createdBy,
        now,
      });
      return;
    }

    if (!this._isLoyaltyGeneralEnabled()) return;

    const scope = this._getLoyaltyEarnScope();
    if (scope === 'master_only') return;
    if (skipWalkInCustomerId && customerId === skipWalkInCustomerId) return;

    const perUzs = this._getLoyaltyGeneralPointsPerUzs();
    const earned = Math.floor(paid / perUzs);
    if (earned <= 0) return;

    this.db
      .prepare(
        'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) + ?, updated_at = ? WHERE id = ?'
      )
      .run(earned, now, customerId);
    this._insertBonusLedgerRow({
      customerId,
      type: 'earn',
      points: earned,
      orderId,
      note: `Sotuv ${orderNumber || orderId || ''}`.trim(),
      createdBy,
      now,
    });
  }

  _getDeviceId() {
    try {
      const cfg = readConfig();
      return cfg?.device_id || null;
    } catch {
      return null;
    }
  }

  _getUserRoleCodes(userId) {
    if (!userId) return [];
    try {
      const rows = this.db.prepare(
        `
        SELECT r.code
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `
      ).all(userId);
      return (rows || []).map((r) => String(r.code));
    } catch {
      return [];
    }
  }

  _getMaxDiscountPercent(roleCodes = []) {
    try {
      const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'pricing.max_discount_percent_by_role'`).get();
      const map = row?.value ? JSON.parse(row.value) : {};
      let maxPct = 0;
      for (const code of roleCodes) {
        const v = Number(map?.[code] ?? 0);
        if (Number.isFinite(v)) maxPct = Math.max(maxPct, v);
      }
      return maxPct;
    } catch {
      return 0;
    }
  }

  /**
   * Create draft order
   */
  createDraftOrder(data) {
    // Resolve user_id / cashier_id with fallback
    let userId = data.user_id || data.cashier_id;
    if (!userId) {
      const defaultUser = this.db.prepare('SELECT id FROM profiles LIMIT 1').get();
      if (defaultUser) userId = defaultUser.id;
    }
    if (!userId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'User ID is required');
    }

    // SINGLE WAREHOUSE SYSTEM: Always use main-warehouse-001
    const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
    
    // Ensure main warehouse exists (create if missing)
    const warehouseExists = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(MAIN_WAREHOUSE_ID);
    if (!warehouseExists) {
      console.log('⚠️  [SalesService.createOrder] Main warehouse not found, creating it...');
      this.db.prepare(`
        INSERT INTO warehouses (id, code, name, is_active, created_at, updated_at)
        VALUES (?, 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'))
      `).run(MAIN_WAREHOUSE_ID);
      console.log('✅ [SalesService.createOrder] Main warehouse created');
    }
    
    // Always use main warehouse (ignore any provided warehouseId)
    const warehouseId = MAIN_WAREHOUSE_ID;
    console.log('📦 [SalesService.createOrder] Using main warehouse:', warehouseId);

    const id = randomUUID();
    const orderNumber = `ORD-${Date.now()}`;
    const now = new Date().toISOString();

    const hasOrderUuid = this._hasOrderCol('order_uuid');
    const hasDeviceId = this._hasOrderCol('device_id');
    const hasPriceTierId = this._hasOrderCol('price_tier_id');
    const orderUuid = hasOrderUuid ? (data.order_uuid || randomUUID()) : null;
    const deviceId = hasDeviceId ? (data.device_id || this._getDeviceId()) : null;

    const orderCols = [
      'id',
      'order_number',
      'customer_id',
      'cashier_id',
      'user_id',
      'warehouse_id',
      'shift_id',
      'subtotal',
      'discount_amount',
      'discount_percent',
      'tax_amount',
      'total_amount',
      'paid_amount',
      'change_amount',
      'status',
      'payment_status',
      'notes',
      'created_at',
      'updated_at',
      ...(hasOrderUuid ? ['order_uuid'] : []),
      ...(hasDeviceId ? ['device_id'] : []),
      ...(hasPriceTierId ? ['price_tier_id'] : []),
    ];
    const orderVals = [
      id,
      orderNumber,
      data.customer_id || null,
      userId, // cashier_id (required)
      userId, // user_id (alias)
      warehouseId,
      data.shift_id || null,
      0, 0, 0, 0, 0, 0, 0,
      'hold',
      'pending',
      data.notes || null,
      now,
      now,
      ...(hasOrderUuid ? [orderUuid] : []),
      ...(hasDeviceId ? [deviceId] : []),
      ...(hasPriceTierId ? [data.price_tier_id ?? null] : []),
    ];

    this.db
      .prepare(`INSERT INTO orders (${orderCols.join(', ')}) VALUES (${orderCols.map(() => '?').join(', ')})`)
      .run(...orderVals);

    return this._getOrderWithDetails(id);
  }

  /**
   * Add item to order
   */
  addItem(orderId, itemData) {
    if (!orderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID is required');
    }

    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
    }

    if (order.status !== 'hold') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only add items to draft orders');
    }

    if (!itemData.product_id || !itemData.quantity || itemData.quantity <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Product ID and quantity are required');
    }

    // Get product
    const product = this.db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(itemData.product_id);
    if (!product) {
      throw createError(ERROR_CODES.NOT_FOUND, `Product ${itemData.product_id} not found or inactive`);
    }

    // Check stock if tracking
    const qtySale = Number(itemData.qty_sale ?? itemData.quantity ?? 0) || 0;
    const qtyBase = Number(itemData.qty_base ?? qtySale) || 0;
    const saleUnit = itemData.sale_unit ?? product.unit ?? null;

    if (product.track_stock) {
      const balance = this.db.prepare(`
        SELECT quantity FROM stock_balances 
        WHERE product_id = ? AND warehouse_id = ?
      `).get(itemData.product_id, order.warehouse_id);
      
      const available = balance ? balance.quantity : 0;
      const existingQty = this._hasOrderItemCol('qty_base')
        ? this.db.prepare(`
            SELECT COALESCE(SUM(qty_base), 0) as total FROM order_items 
            WHERE order_id = ? AND product_id = ?
          `).get(orderId, itemData.product_id)
        : this.db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) as total FROM order_items 
            WHERE order_id = ? AND product_id = ?
          `).get(orderId, itemData.product_id);
      
      const totalQty = (existingQty.total || 0) + qtyBase;
      if (totalQty > available) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          `Insufficient stock. Available: ${available}, Requested: ${totalQty}`);
      }
    }

    const itemId = randomUUID();
    const unitPrice = itemData.unit_price || product.sale_price;
    const priceTier = itemData.price_tier === 'master' ? 'master' : 'retail';
    const discountAmount = itemData.discount_amount || 0;
    const lineTotal = (unitPrice * qtySale) - discountAmount;
    const basePrice = itemData.base_price ?? unitPrice;
    const ustaPrice = itemData.usta_price ?? null;
    const discountType = itemData.discount_type ?? (discountAmount > 0 ? 'fixed' : 'none');
    const discountValue =
      itemData.discount_value ?? (qtySale > 0 ? discountAmount / qtySale : 0);
    const finalUnitPrice =
      itemData.final_unit_price ?? (qtySale > 0 ? lineTotal / qtySale : unitPrice);
    const finalTotal = itemData.final_total ?? lineTotal;
    const priceSource = itemData.price_source ?? (priceTier === 'master' ? 'usta' : 'base');

    const hasPriceTier = this._hasOrderItemCol('price_tier');
    const createdAt = new Date().toISOString();

    const hasSaleUnit = this._hasOrderItemCol('sale_unit');
    const hasQtySale = this._hasOrderItemCol('qty_sale');
    const hasQtyBase = this._hasOrderItemCol('qty_base');
    const hasBasePrice = this._hasOrderItemCol('base_price');
    const hasUstaPrice = this._hasOrderItemCol('usta_price');
    const hasDiscountType = this._hasOrderItemCol('discount_type');
    const hasDiscountValue = this._hasOrderItemCol('discount_value');
    const hasFinalUnitPrice = this._hasOrderItemCol('final_unit_price');
    const hasFinalTotal = this._hasOrderItemCol('final_total');
    const hasPriceSource = this._hasOrderItemCol('price_source');
    const hasCostPrice = this._hasOrderItemCol('cost_price');

    const unitCost = hasCostPrice && this.costService
      ? this.costService.resolveCostForSale(product.id, qtyBase, order.warehouse_id, null)
      : 0;

    const cols = [
      'id',
      'order_id',
      'product_id',
      'product_name',
      'product_sku',
      'unit_price',
      ...(hasPriceTier ? ['price_tier'] : []),
      'quantity',
      'discount_amount',
      'line_total',
      'created_at',
      ...(hasSaleUnit ? ['sale_unit'] : []),
      ...(hasQtySale ? ['qty_sale'] : []),
      ...(hasQtyBase ? ['qty_base'] : []),
      ...(hasBasePrice ? ['base_price'] : []),
      ...(hasUstaPrice ? ['usta_price'] : []),
      ...(hasDiscountType ? ['discount_type'] : []),
      ...(hasDiscountValue ? ['discount_value'] : []),
      ...(hasFinalUnitPrice ? ['final_unit_price'] : []),
      ...(hasFinalTotal ? ['final_total'] : []),
      ...(hasPriceSource ? ['price_source'] : []),
      ...(hasCostPrice ? ['cost_price'] : []),
    ];
    const vals = [
      itemId,
      orderId,
      product.id,
      product.name,
      product.sku,
      unitPrice,
      ...(hasPriceTier ? [priceTier] : []),
      qtySale,
      discountAmount,
      lineTotal,
      createdAt,
      ...(hasSaleUnit ? [saleUnit] : []),
      ...(hasQtySale ? [qtySale] : []),
      ...(hasQtyBase ? [qtyBase] : []),
      ...(hasBasePrice ? [basePrice] : []),
      ...(hasUstaPrice ? [ustaPrice] : []),
      ...(hasDiscountType ? [discountType] : []),
      ...(hasDiscountValue ? [discountValue] : []),
      ...(hasFinalUnitPrice ? [finalUnitPrice] : []),
      ...(hasFinalTotal ? [finalTotal] : []),
      ...(hasPriceSource ? [priceSource] : []),
      ...(hasCostPrice ? [unitCost] : []),
    ];
    const placeholders = cols.map(() => '?').join(', ');
    this.db
      .prepare(`INSERT INTO order_items (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...vals);

    this._recalculateOrderTotals(orderId);
    return this._getOrderWithDetails(orderId);
  }

  /**
   * Remove item from order
   */
  removeItem(orderId, itemId) {
    if (!orderId || !itemId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID and Item ID are required');
    }

    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
    }

    if (order.status !== 'hold') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only remove items from draft orders');
    }

    const result = this.db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(itemId, orderId);
    if (result.changes === 0) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order item ${itemId} not found`);
    }

    this._recalculateOrderTotals(orderId);
    return this._getOrderWithDetails(orderId);
  }

  /**
   * Update item quantity
   */
  updateItemQuantity(orderId, itemId, quantity) {
    if (!orderId || !itemId || !quantity || quantity <= 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID, Item ID, and valid quantity are required');
    }

    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
    }

    if (order.status !== 'hold') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only update items in draft orders');
    }

    const item = this.db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
    if (!item) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order item ${itemId} not found`);
    }

    const qtySale = Number(quantity || 0) || 0;
    const existingQtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
    const existingQtyBase = Number(item.qty_base ?? existingQtySale) || 0;
    const ratioToBase =
      existingQtySale > 0 ? existingQtyBase / existingQtySale : 1;
    const qtyBase = qtySale * (Number.isFinite(ratioToBase) && ratioToBase > 0 ? ratioToBase : 1);

    // Check stock
    const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (product.track_stock) {
      const balance = this.db.prepare(`
        SELECT quantity FROM stock_balances 
        WHERE product_id = ? AND warehouse_id = ?
      `).get(item.product_id, order.warehouse_id);
      
      const available = balance ? balance.quantity : 0;
      if (qtyBase > available) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          `Insufficient stock. Available: ${available}, Requested: ${qtyBase}`);
      }
    }

    const lineTotal = (item.unit_price * qtySale) - item.discount_amount;
    const finalUnitPrice = qtySale > 0 ? lineTotal / qtySale : item.unit_price;
    const updates = ['quantity = ?', 'line_total = ?'];
    const params = [qtySale, lineTotal];
    if (this._hasOrderItemCol('qty_sale')) {
      updates.push('qty_sale = ?');
      params.push(qtySale);
    }
    if (this._hasOrderItemCol('qty_base')) {
      updates.push('qty_base = ?');
      params.push(qtyBase);
    }
    if (this._hasOrderItemCol('final_unit_price')) {
      updates.push('final_unit_price = ?');
      params.push(finalUnitPrice);
    }
    if (this._hasOrderItemCol('final_total')) {
      updates.push('final_total = ?');
      params.push(lineTotal);
    }

    this.db.prepare(`
      UPDATE order_items 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params, itemId);

    this._recalculateOrderTotals(orderId);
    return this._getOrderWithDetails(orderId);
  }

  /**
   * Set customer for order
   */
  setCustomer(orderId, customerId) {
    if (!orderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID is required');
    }

    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
    }

    if (order.status !== 'hold') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only set customer for draft orders');
    }

    if (customerId) {
      const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
      if (!customer) {
        throw createError(ERROR_CODES.NOT_FOUND, `Customer ${customerId} not found`);
      }
    }

    this.db.prepare('UPDATE orders SET customer_id = ?, updated_at = ? WHERE id = ?').run(
      customerId || null,
      new Date().toISOString(),
      orderId
    );

    return this._getOrderWithDetails(orderId);
  }

  /**
   * Finalize order (complete transaction)
   * Uses transaction for multi-step operation with concurrency safety.
   * All operations (payments, stock updates, receipts) happen atomically.
   */
  finalizeOrder(orderId, paymentData) {
    if (!orderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order ID is required');
    }

    if (!paymentData || !paymentData.payments || !Array.isArray(paymentData.payments) || paymentData.payments.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment information is required');
    }

    // Use transaction for atomicity and concurrency safety
    // better-sqlite3's transaction() provides serializable isolation
    return this.db.transaction(() => {
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) {
        throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
      }

      if (order.status !== 'hold') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only finalize draft orders');
      }

      // Check shift status if shift_id is present
      if (order.shift_id) {
        const shift = this.db.prepare('SELECT status FROM shifts WHERE id = ?').get(order.shift_id);
        if (shift && shift.status !== 'open') {
          throw createError(ERROR_CODES.SHIFT_CLOSED, 
            `Cannot finalize order. Shift is ${shift.status}.`,
            { shiftId: order.shift_id, status: shift.status });
        }
      }

      // Get order items
      const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      if (items.length === 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order must have at least one item');
      }

      // Runtime guard: Verify order exists before inserting payments
      const orderExists = this.db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId);
      if (!orderExists) {
        console.error('FK Guard Failed: Order not found before payments', { orderId, payload: paymentData });
        throw createError(ERROR_CODES.NOT_FOUND, 
          `Order ${orderId} not found. Cannot insert payments.`);
      }

      const now = new Date().toISOString();

      // Process payments
      let totalPaid = 0;
      const payments = [];

      for (const payment of paymentData.payments) {
        if (!payment.amount || payment.amount <= 0) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Each payment must have a valid amount');
        }

        if (!payment.payment_method) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment method is required');
        }

        totalPaid += payment.amount;

        const paymentId = randomUUID();
        const paymentNumber = `PAY-${Date.now()}-${payments.length}`;

        this.db.prepare(`
          INSERT INTO payments (
            id, order_id, payment_number, payment_method, amount,
            reference_number, notes, paid_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentId,
          orderId,
          paymentNumber,
          payment.payment_method,
          payment.amount,
          payment.reference_number || null,
          payment.notes || null,
          now,
          now
        );

        payments.push({ id: paymentId, payment_number: paymentNumber, ...payment });

        // Create cash movement if cash payment
        if (payment.payment_method === 'cash') {
          // CRITICAL Debug: Log values before cash_movements INSERT
          console.log('💰 Cash payment (finalizeOrder) - preparing cash_movements INSERT:', {
            payment_method: payment.payment_method,
            shift_id: order.shift_id,
            order_id: orderId,
            payment_id: paymentId,
            user_id: order.user_id,
            amount: payment.amount
          });

          // Validate shift_id FK: If shift_id is provided, it must exist in shifts table
          let validShiftId = order.shift_id || null;
          if (validShiftId) {
            const shiftExists = this.db.prepare('SELECT id FROM shifts WHERE id = ?').get(validShiftId);
            if (!shiftExists) {
              console.error('❌ CRITICAL: shift_id does not exist in shifts table:', validShiftId);
              console.error('❌ Setting to null as fallback.');
              validShiftId = null; // Set to null since FK constraint requires valid shift or NULL
            } else {
              console.log('✅ Cash movement shift_id validated (finalizeOrder):', validShiftId);
            }
          } else {
            console.log('ℹ️ No shift_id provided for cash movement (finalizeOrder) (will use NULL)');
          }

          // CRITICAL: Validate created_by FK - must exist in users table
          const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(order.user_id);
          if (!userExists) {
            console.error('❌ FK Constraint Error: user_id does not exist in users table:', order.user_id);
            throw createError(ERROR_CODES.VALIDATION_ERROR, 
              `Cannot create cash movement: user_id '${order.user_id}' does not exist in users table.`);
          }

          console.log('✅ Cash movement FK validation passed:', {
            shift_id: validShiftId,
            created_by: order.user_id
          });

          const cashMovementId = randomUUID();
          const cashMovementNumber = `CASH-${Date.now()}-${cashMovementId.substring(0, 8)}`;
          
          try {
            this.db.prepare(`
              INSERT INTO cash_movements (
                id, movement_number, shift_id, movement_type, amount,
                reference_type, reference_id, created_by, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              cashMovementId,
              cashMovementNumber,
              validShiftId, // Use validated shift_id (null if invalid)
              'sale',
              payment.amount,
              'order',
              orderId,
              order.user_id, // Should be valid user_id
              now
            );
            console.log('✅ Cash movement created successfully:', cashMovementId);
          } catch (error) {
            console.error('❌ Cash movement INSERT failed:', error);
            console.error('❌ Failed values:', {
              shift_id: validShiftId,
              created_by: order.user_id,
              reference_id: orderId
            });
            throw error; // Re-throw to trigger transaction rollback
          }
        }
      }

      // Calculate change
      const changeAmount = totalPaid > order.total_amount ? totalPaid - order.total_amount : 0;
      const creditAmount = totalPaid < order.total_amount ? order.total_amount - totalPaid : 0;

      // Determine payment status
      let paymentStatus = 'paid';
      if (creditAmount > 0) {
        paymentStatus = order.customer_id ? 'on_credit' : 'partial';
      } else if (totalPaid < order.total_amount) {
        paymentStatus = 'partial';
      }

      // Update order
      this.db.prepare(`
        UPDATE orders 
        SET status = ?, payment_status = ?, paid_amount = ?, change_amount = ?, credit_amount = ?, updated_at = ?
        WHERE id = ?
      `).run(
        'completed',
        paymentStatus,
        totalPaid,
        changeAmount,
        creditAmount,
        now,
        orderId
      );

      // Batch mode: allocate FIFO batches for each order_item before writing stock movements.
      // This ensures no "partiyasiz sotuv" after cutover.
      const nowSqlite = now.replace('T', ' ').replace('Z', '').substring(0, 19);
      const batchActive = !!this.batchService?.shouldEnforceAt?.(nowSqlite);

      if (batchActive && this.batchService) {
        const hasAllocStmt = this.db.prepare(`
          SELECT 1
          FROM inventory_batch_allocations
          WHERE reference_type = 'order_item'
            AND reference_id = ?
            AND direction = 'out'
          LIMIT 1
        `);

        for (const item of items) {
          const product = this.db.prepare('SELECT track_stock FROM products WHERE id = ?').get(item.product_id);
          if (product && product.track_stock) {
            const exists = hasAllocStmt.get(item.id);
            if (!exists) {
              this.batchService.allocateFIFOForOrderItem({
                orderItemId: item.id,
                productId: item.product_id,
                warehouseId: order.warehouse_id,
                quantity: item.qty_base ?? item.quantity,
              });
            }
          }
        }
      }

      // Update stock balances (OUT movements)
      for (const item of items) {
        const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (product && product.track_stock) {
          this.inventoryService._updateBalance(
            item.product_id,
            order.warehouse_id,
            -(item.qty_base ?? item.quantity),
            'sale',
            'order',
            orderId,
            `Sale via order ${order.order_number}`,
            order.user_id
          );
        }
      }

      // Create receipt snapshot
      const receiptId = randomUUID();
      const receiptNumber = `REC-${Date.now()}`;
      const receiptData = JSON.stringify({
        order: order,
        items: items,
        payments: payments,
        finalized_at: now,
      });

      this.db.prepare(`
        INSERT INTO receipts (id, order_id, receipt_number, receipt_data, printed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        orderId,
        receiptNumber,
        receiptData,
        null,
        now
      );

      // Update customer stats if applicable
      if (order.customer_id) {
        this.db.prepare(`
          UPDATE customers 
          SET total_sales = total_sales + ?,
              total_orders = total_orders + 1,
              last_order_date = ?,
              -- Balance logic (system-wide): negative = debt, positive = prepaid/credit.
              -- Credit sales create debt, so we SUBTRACT creditAmount (make balance more negative).
              balance = balance - ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          order.total_amount,
          now,
          creditAmount,
          now,
          order.customer_id
        );

        this._accrueCustomerLoyalty({
          customerId: order.customer_id,
          paidAmount: totalPaid,
          orderTotalAmount: order.total_amount,
          orderId,
          orderNumber: order.order_number,
          createdBy: order.user_id,
          now,
          skipWalkInCustomerId: 'default-customer-001',
        });
      }

      return this._getOrderWithDetails(orderId);
    })();
  }

  /**
   * Complete POS order (atomic operation - create order, add items, finalize with payments)
   * This matches the frontend's createOrder API that expects to pass complete order data at once
   * 
   * Uses SQLite transaction for atomicity and concurrency safety.
   * All operations (order creation, stock updates, payments) happen in single transaction.
   */
  completePOSOrder(orderData, itemsData, paymentsData) {
    // Known default IDs from migrations (see 013_ensure_seed_data.sql)
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    const MAIN_WAREHOUSE_ID = 'main-warehouse-001'; // SINGLE WAREHOUSE SYSTEM
    const KNOWN_DEFAULT_CUSTOMER = 'default-customer-001'; // Walk-in customer
    
    // FORCE Real Admin ID: Always use 'default-admin-001' for user_id
    // This ensures FK constraint is satisfied (user exists in users table)
    let userId = orderData.user_id || orderData.cashier_id;
    
    // Verify the user exists in users table (not profiles)
    if (userId && userId !== KNOWN_DEFAULT_USER) {
      const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (!userExists) {
        console.warn('⚠️ Provided user_id does not exist in users table, using default:', userId);
        userId = null;
      }
    }
    
    // Force to known default if not valid
    if (!userId || userId !== KNOWN_DEFAULT_USER) {
      // Verify default user exists
      const defaultUser = this.db.prepare('SELECT id FROM users WHERE id = ?').get(KNOWN_DEFAULT_USER);
      if (defaultUser) {
        userId = KNOWN_DEFAULT_USER;
        console.log('👤 FORCED to known default user:', userId);
      } else {
        // Last resort: use the ID anyway (migration should have created it)
        userId = KNOWN_DEFAULT_USER;
        console.warn('⚠️ Using default user ID (not verified in DB):', userId);
      }
    }
    
    // Update orderData with FORCED user_id
    orderData.user_id = userId;
    orderData.cashier_id = userId;

    // SINGLE WAREHOUSE SYSTEM: Always use main-warehouse-001
    let warehouseId = orderData.warehouse_id;
    let shiftId = orderData.shift_id;
    
    // Ensure main warehouse exists (create if missing)
    const warehouseExists = this.db.prepare('SELECT id FROM warehouses WHERE id = ?').get(MAIN_WAREHOUSE_ID);
    if (!warehouseExists) {
      console.log('⚠️  [SalesService.completePOSOrder] Main warehouse not found, creating it...');
      this.db.prepare(`
        INSERT INTO warehouses (id, code, name, is_active, created_at, updated_at)
        VALUES (?, 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'))
      `).run(MAIN_WAREHOUSE_ID);
      console.log('✅ [SalesService.completePOSOrder] Main warehouse created');
    }
    
    // Always use main warehouse (ignore any provided warehouseId)
    warehouseId = MAIN_WAREHOUSE_ID;
    console.log('📦 [SalesService.completePOSOrder] Using main warehouse:', warehouseId);

    // CRITICAL FIX: ALWAYS find and link active shift before creating order
    // This ensures all sales are linked to shifts for proper shift closing calculations
    if (!shiftId) {
      console.log('🔍 No shift_id provided. Looking for active shift...');
      console.log('   User ID:', orderData.user_id);
      console.log('   Warehouse ID:', warehouseId);
      
      // Find the ACTIVE SHIFT for the user/warehouse
      const activeShift = this.db.prepare(`
        SELECT id FROM shifts 
        WHERE (user_id = ? OR cashier_id = ?) 
          AND warehouse_id = ? 
          AND status = 'open' 
          AND closed_at IS NULL
        ORDER BY opened_at DESC 
        LIMIT 1
      `).get(orderData.user_id, orderData.user_id, warehouseId);

      if (!activeShift) {
        console.error('❌ ERROR: No active shift found for user/warehouse');
        throw createError(ERROR_CODES.SHIFT_CLOSED, 
          'CANNOT SELL: No active shift found. Please open a shift first.',
          { userId: orderData.user_id, warehouseId });
      }
      
      shiftId = activeShift.id;
      console.log('✅ Found active shift:', shiftId);
    } else {
      // CRITICAL: Validate that provided shift_id exists and is open
      const shift = this.db.prepare(`
        SELECT id, status, closed_at FROM shifts WHERE id = ?
      `).get(shiftId);
      
      if (!shift) {
        console.error('❌ ERROR: Provided shift_id does not exist:', shiftId);
        throw createError(ERROR_CODES.NOT_FOUND, 
          `Shift not found: ${shiftId}. Please open a shift first.`);
      }
      
      if (shift.status !== 'open' || shift.closed_at !== null) {
        console.error('❌ ERROR: Provided shift is not open:', shiftId, 'Status:', shift.status);
        throw createError(ERROR_CODES.SHIFT_CLOSED, 
          `Shift is ${shift.status}. Please open a new shift before processing sales.`);
      }
      
      console.log('✅ Provided shift_id validated and is open:', shiftId);
    }

    // FORCE Default Customer: If customer_id is missing or null, use 'default-customer-001'
    let customerId = orderData.customer_id;
    if (!customerId) {
      // Verify default customer exists
      const defaultCustomer = this.db.prepare('SELECT id FROM customers WHERE id = ?').get(KNOWN_DEFAULT_CUSTOMER);
      if (defaultCustomer) {
        customerId = KNOWN_DEFAULT_CUSTOMER;
        console.log('👥 FORCED to default customer:', customerId);
      } else {
        // Last resort: use the ID anyway (migration should have created it)
        customerId = KNOWN_DEFAULT_CUSTOMER;
        console.warn('⚠️ Using default customer ID (not verified in DB):', customerId);
      }
    } else {
      // Verify provided customer exists - NEVER silently use default when customer_id was explicitly provided
      const customerExists = this.db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
      if (!customerExists) {
        console.error('❌ Provided customer_id does not exist in database:', customerId);
        throw createError(ERROR_CODES.NOT_FOUND,
          `Mijoz topilmadi (ID: ${customerId}). Iltimos, mijozlar ro'yxatida mavjud mijozni tanlang yoki yangi mijoz qo'shing.`);
      }
    }
    
    // Update orderData with FORCED values
    orderData.warehouse_id = warehouseId;
    orderData.customer_id = customerId;
    orderData.shift_id = shiftId; // CRITICAL: Always use the resolved shiftId (never null at this point)

    // Idempotency + device tracking
    const hasOrderUuid = this._hasOrderCol('order_uuid');
    const hasDeviceId = this._hasOrderCol('device_id');
    if (hasDeviceId && !orderData.device_id) {
      orderData.device_id = this._getDeviceId();
    }
    if (hasOrderUuid) {
      if (!orderData.order_uuid) {
        orderData.order_uuid = randomUUID();
        console.warn('⚠️ Missing order_uuid from client, generated server-side:', orderData.order_uuid);
      }
      const existing = this.db.prepare('SELECT id FROM orders WHERE order_uuid = ?').get(orderData.order_uuid);
      if (existing?.id) {
        console.warn('🛡️ Duplicate order_uuid detected, returning existing order:', {
          order_uuid: orderData.order_uuid,
          existing_order_id: existing.id,
        });
        return this._getOrderWithDetails(existing.id);
      }
    }

    // Pricing tier resolution + permissions
    const roleCodes = this._getUserRoleCodes(orderData.user_id);
    const maxDiscountPercent = this._getMaxDiscountPercent(roleCodes);
    const canOverrideTier = roleCodes.some((r) => r === 'admin' || r === 'manager');
    const canManualOverride = roleCodes.some((r) => r === 'admin' || r === 'manager');

    let customerTier = null;
    if (orderData.customer_id) {
      try {
        const row = this.db.prepare('SELECT pricing_tier FROM customers WHERE id = ?').get(orderData.customer_id);
        if (row?.pricing_tier) customerTier = String(row.pricing_tier);
      } catch {
        // ignore
      }
    }

    const requestedTier = orderData.price_tier_code || orderData.price_tier || null;
    let tierCode = customerTier || requestedTier || 'retail';

    if (customerTier && requestedTier && requestedTier !== customerTier && !canOverrideTier) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Tier override is not allowed for this role');
    }

    if (!customerTier && tierCode !== 'retail' && !canOverrideTier) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Tier change is not allowed for this role');
    }

    if (this.pricingService && typeof this.pricingService.getTierByCode === 'function') {
      const tierRow = this.pricingService.getTierByCode(tierCode) || this.pricingService.getTierByCode('retail');
      orderData.price_tier_id = tierRow?.id || null;
      orderData.price_tier_code = tierRow?.code || 'retail';
      tierCode = orderData.price_tier_code;
    }

    // DIAGNOSTIC: Log shift and order data before transaction
    console.log('[SALE] Order completion - Pre-transaction diagnostics:', {
      shiftId: orderData.shift_id,
      warehouseId: orderData.warehouse_id,
      userId: orderData.user_id,
      cashierId: orderData.cashier_id,
      customerId: orderData.customer_id,
      totalAmount: orderData.total_amount,
      itemsCount: itemsData?.length || 0,
      paymentsCount: paymentsData?.length || 0
    });

    if (!itemsData || !Array.isArray(itemsData) || itemsData.length === 0) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Order must have at least one item');
    }

    // CRITICAL FIX: Filter out zero-amount payments and allow empty payments for full credit sales.
    // IMPORTANT: A "credit" entry is NOT real money received; do NOT count it toward paid_amount.
    const validPayments = (paymentsData || []).filter((p) => Number(p.amount) > 0);

    const isCreditMethod = (method) => {
      const m = String(method || '').toLowerCase();
      return m === 'credit' || m === 'on_credit' || m === 'debt';
    };

    const isPayoutMethod = (method) => String(method || '').toLowerCase() === 'refund_cash';

    const intakePayments = validPayments.filter(
      (p) => !isCreditMethod(p.payment_method) && !isPayoutMethod(p.payment_method)
    );
    const payoutPayments = validPayments.filter((p) => isPayoutMethod(p.payment_method));
    const creditPayments = validPayments.filter((p) => isCreditMethod(p.payment_method));

    const totalPaidIntake = intakePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalPayout = payoutPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const orderTotalSigned = Number(orderData.total_amount || 0);
    let creditAmount = 0;
    if (orderTotalSigned > 0) {
      creditAmount = Math.max(0, orderTotalSigned - totalPaidIntake);
    }

    const payEps = 0.02;

    if (orderTotalSigned > 0) {
      if (payoutPayments.length > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'refund_cash faqat jami manfiy (mijozga qaytim) bo‘lganda'
        );
      }
      if (totalPaidIntake === 0 && creditAmount === 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Order must have at least one payment with amount > 0, or be a credit sale (creditAmount > 0)'
        );
      }
    } else if (orderTotalSigned === 0) {
      if (payoutPayments.length > 0 || totalPayout > payEps) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Nol jami uchun to‘lov/qaytim qatorlari bo‘lmasin');
      }
      if (creditPayments.length > 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Nol jami uchun qarz (credit) qo‘llanmaydi');
      }
      if (totalPaidIntake > payEps) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Nol jami uchun kirim to‘lovi bo‘lmasin');
      }
    } else {
      if (creditPayments.length > 0 || creditAmount > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Manfiy jami (almashuv qaytimi) bilan qarz sotuvi qo‘llanmaydi'
        );
      }
      if (totalPaidIntake > payEps) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Manfiy jami buyurtmada kirim to‘lovi bo‘lmasin'
        );
      }
      const needPayout = Math.abs(orderTotalSigned);
      if (payoutPayments.length === 0 || Math.abs(totalPayout - needPayout) > payEps) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Mijozga ${Math.round(needPayout)} so‘m qaytarish kerak (refund_cash).`
        );
      }
    }

    // Diagnostic: if client sent explicit credit payment lines, ensure they match computed credit
    const creditFromPayments = creditPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    if (creditFromPayments > 0 && Math.abs(creditFromPayments - creditAmount) > 0.01) {
      console.warn('⚠️ Credit amount mismatch (payments vs computed):', {
        creditFromPayments,
        computedCreditAmount: creditAmount,
        total: orderData.total_amount,
        paidNonCredit: totalPaidIntake,
      });
    }
    
    // CRITICAL: For credit sales, require a real customer (not default walk-in)
    if (creditAmount > 0) {
      if (!orderData.customer_id) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          'Credit sales require a registered customer. Please select a customer.');
      }
      
      // Verify customer exists and is not the default walk-in customer
      const customer = this.db.prepare('SELECT id, name FROM customers WHERE id = ?').get(orderData.customer_id);
      if (!customer) {
        throw createError(ERROR_CODES.NOT_FOUND, 
          `Customer not found: ${orderData.customer_id}. Cannot process credit sale.`);
      }
      
      // Check if it's the default walk-in customer (should not allow credit for walk-in)
      if (orderData.customer_id === KNOWN_DEFAULT_CUSTOMER) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          'Credit sales are not allowed for walk-in customers. Please select a registered customer.');
      }
      
      console.log('✅ Credit sale validated:', {
        customer_id: orderData.customer_id,
        customer_name: customer.name,
        creditAmount,
        totalPaid: totalPaidIntake
      });
    }

      // DIAGNOSTIC: Log final order data before transaction (redundant but kept for compatibility)
      console.log('[SALE] Final order data before transaction:', {
        user_id: orderData.user_id,
        cashier_id: orderData.cashier_id,
        warehouse_id: orderData.warehouse_id,
        customer_id: orderData.customer_id,
        shift_id: orderData.shift_id,
        total_amount: orderData.total_amount,
        items_count: itemsData.length,
        payments_count: paymentsData.length
      });

    return this.db.transaction(() => {
      // Generate orderId ONCE and use it consistently throughout
      const orderId = randomUUID();
      const orderNumber = orderData.order_number || `ORD-${Date.now()}`;
      // CRITICAL FIX: Use SQLite-friendly datetime format instead of ISO string
      // SQLite format: 'YYYY-MM-DD HH:MM:SS' (no 'T' or 'Z', no fractional seconds)
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      const batchActive = !!this.batchService?.isBatchModeActive?.(now);

      // Create order with 'hold' status initially
      // CRITICAL: Use FORCED values to ensure FK constraints are satisfied
      const hasPriceTierId = this._hasOrderCol('price_tier_id');
      const orderCols = [
        'id',
        'order_number',
        'customer_id',
        'cashier_id',
        'user_id',
        'warehouse_id',
        'shift_id',
        'subtotal',
        'discount_amount',
        'discount_percent',
        'tax_amount',
        'total_amount',
        'paid_amount',
        'change_amount',
        'credit_amount',
        'status',
        'payment_status',
        'notes',
        'created_at',
        'updated_at',
        ...(hasOrderUuid ? ['order_uuid'] : []),
        ...(hasDeviceId ? ['device_id'] : []),
        ...(hasPriceTierId ? ['price_tier_id'] : []),
      ];
      const orderVals = [
        orderId,
        orderNumber,
        orderData.customer_id, // FORCED: 'default-customer-001' if null
        orderData.cashier_id,  // FORCED: 'default-admin-001'
        orderData.user_id,     // FORCED: 'default-admin-001'
        orderData.warehouse_id, // FORCED: 'main-warehouse-001'
        orderData.shift_id || null,
        orderData.subtotal || 0,
        orderData.discount_amount || 0,
        orderData.discount_percent || 0,
        orderData.tax_amount || 0,
        orderData.total_amount || 0,
        0, // paid_amount - will be calculated from payments
        0, // change_amount - will be calculated
        0, // credit_amount - will be calculated
        'hold', // status - will be set to 'completed' after finalization
        'pending', // payment_status - will be updated
        orderData.notes || null,
        now, // created_at - use SQLite datetime format
        now, // updated_at - use SQLite datetime format
        ...(hasOrderUuid ? [orderData.order_uuid || null] : []),
        ...(hasDeviceId ? [orderData.device_id || null] : []),
        ...(hasPriceTierId ? [orderData.price_tier_id || null] : []),
      ];
      this.db
        .prepare(`INSERT INTO orders (${orderCols.join(', ')}) VALUES (${orderCols.map(() => '?').join(', ')})`)
        .run(...orderVals);

      // Runtime guard: Verify order exists before inserting children
      const orderExists = this.db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId);
      if (!orderExists) {
        console.error('FK Guard Failed: Order not found after insert', { orderId, orderNumber, payload: orderData });
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          `Order ${orderId} was not created successfully. Cannot insert order_items.`);
      }

      // Add all items
      // Note: Stock availability check happens in _updateBalance to ensure atomicity
      // This prevents race conditions when multiple orders are processed simultaneously
      for (const itemData of itemsData) {
        const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(itemData.product_id);
        if (!product) {
          throw createError(ERROR_CODES.NOT_FOUND, `Product ${itemData.product_id} not found`);
        }
        const qtySale = Number(itemData.qty_sale ?? itemData.quantity ?? 0) || 0;
        const qtyBase = Number(itemData.qty_base ?? qtySale) || 0;

        // CRITICAL FIX: Stock availability check using inventory_movements (not stock_balances)
        // Pre-check here for early validation (non-atomic, but provides better UX)
        if (product.track_stock && qtyBase > 0) {
          // Calculate available stock from inventory_movements
          const stockResult = this.db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) as total
            FROM inventory_movements
            WHERE product_id = ?
          `).get(itemData.product_id);
          
          const available = stockResult?.total || 0;
          
          // Check if negative stock is allowed
          const allowNegativeStock = this.db.prepare(`
            SELECT value FROM settings WHERE key = 'allow_negative_stock'
          `).get();
          const canGoNegative = allowNegativeStock?.value === '1';
          
          if (!canGoNegative && qtyBase > available) {
            throw createError(ERROR_CODES.INSUFFICIENT_STOCK, 
              `Insufficient stock for ${product.name}. Available: ${available}, Requested: ${qtyBase}`,
              { productId: product.id, productName: product.name, available, requested: qtyBase });
          }
        }

        const itemId = randomUUID();
        const saleUnit = itemData.sale_unit ?? product.unit ?? product.base_unit ?? null;
        const unitForPrice = saleUnit ?? product.base_unit ?? product.unit ?? 'pcs';
        const manualOverride =
          itemData.price_source === 'manual' ||
          itemData.override_price !== undefined ||
          itemData.manual_price === true;

        if (manualOverride && !canManualOverride) {
          throw createError(ERROR_CODES.FORBIDDEN, 'Manual price override is not allowed for this role');
        }

        let resolvedUnitPrice = itemData.unit_price;
        if (!manualOverride) {
          if (this.pricingService && typeof this.pricingService.getPriceForProduct === 'function') {
            try {
              const price = this.pricingService.getPriceForProduct({
                product_id: product.id,
                tier_code: tierCode,
                currency: orderData.currency || 'UZS',
                unit: unitForPrice,
              });
              if (price != null && price > 0) {
                resolvedUnitPrice = price;
              } else {
                // Fallback: use frontend price or product's sale/master price
                resolvedUnitPrice = itemData.unit_price
                  || (tierCode === 'master' ? (product.master_price ?? product.sale_price) : product.sale_price);
                console.warn(`⚠️ No price found in product_prices for product ${product.id} tier ${tierCode} unit ${unitForPrice}. Using fallback: ${resolvedUnitPrice}`);
              }
            } catch (priceError) {
              // Pricing service error - use frontend price or product's direct price
              resolvedUnitPrice = itemData.unit_price
                || (tierCode === 'master' ? (product.master_price ?? product.sale_price) : product.sale_price);
              console.warn(`⚠️ Pricing service error for product ${product.id}: ${priceError.message}. Using fallback: ${resolvedUnitPrice}`);
            }
          } else {
            resolvedUnitPrice = tierCode === 'master' ? (product.master_price ?? product.sale_price) : product.sale_price;
          }
        }

        const unitPrice = Number(resolvedUnitPrice || 0) || 0;
        const priceTier = itemData.price_tier || tierCode || 'retail';
        const discountAmount = Number(itemData.discount_amount || 0) || 0;
        const lineTotal = (unitPrice * qtySale) - discountAmount;

        let retailPrice = product.sale_price;
        let masterPrice = product.master_price;
        try {
          const rp = this.pricingService?.getPriceForProduct?.({
            product_id: product.id,
            tier_code: 'retail',
            currency: orderData.currency || 'UZS',
            unit: unitForPrice,
          });
          if (rp != null) retailPrice = rp;
        } catch { /* ignore - use product.sale_price */ }
        try {
          const mp = this.pricingService?.getPriceForProduct?.({
            product_id: product.id,
            tier_code: 'master',
            currency: orderData.currency || 'UZS',
            unit: unitForPrice,
          });
          if (mp != null) masterPrice = mp;
        } catch { /* ignore - use product.master_price */ }

        const basePrice = itemData.base_price ?? retailPrice ?? unitPrice;
        const ustaPrice = itemData.usta_price ?? (masterPrice ?? null);
        const discountType = itemData.discount_type ?? (discountAmount > 0 ? 'fixed' : 'none');
        const discountValue =
          itemData.discount_value ?? (qtySale !== 0 ? discountAmount / Math.abs(qtySale) : 0);
        const finalUnitPrice =
          itemData.final_unit_price ?? (qtySale !== 0 ? lineTotal / qtySale : unitPrice);
        const finalTotal = itemData.final_total ?? lineTotal;
        const priceSource = itemData.price_source ??
          (manualOverride ? 'manual' : priceTier === 'master' ? 'usta' : priceTier === 'retail' ? 'base' : 'tier');

        if (qtySale !== 0 && discountAmount > 0 && maxDiscountPercent > 0) {
          const denom = Math.abs(unitPrice * qtySale);
          const pct = denom > 0 ? (discountAmount / denom) * 100 : 0;
          if (pct > maxDiscountPercent + 0.0001) {
            throw createError(
              ERROR_CODES.FORBIDDEN,
              `Discount percent ${pct.toFixed(2)} exceeds role limit ${maxDiscountPercent}`
            );
          }
        }

        const hasPriceTier = this._hasOrderItemCol('price_tier');
        const hasSaleUnit = this._hasOrderItemCol('sale_unit');
        const hasQtySale = this._hasOrderItemCol('qty_sale');
        const hasQtyBase = this._hasOrderItemCol('qty_base');
        const hasBasePrice = this._hasOrderItemCol('base_price');
        const hasUstaPrice = this._hasOrderItemCol('usta_price');
        const hasDiscountType = this._hasOrderItemCol('discount_type');
        const hasDiscountValue = this._hasOrderItemCol('discount_value');
        const hasFinalUnitPrice = this._hasOrderItemCol('final_unit_price');
        const hasFinalTotal = this._hasOrderItemCol('final_total');
        const hasPriceSource = this._hasOrderItemCol('price_source');
        const hasCostPrice = this._hasOrderItemCol('cost_price');
        const hasPromotionId = this._hasOrderItemCol('promotion_id');

        // Batch mode: allocate FIFO batches BEFORE insert so cost_price can be frozen correctly.
        if (batchActive && this.batchService && product.track_stock && qtyBase > 0) {
          this.batchService.allocateFIFOForOrderItem(itemId, product.id, warehouseId, qtyBase);
        }

        const unitCost =
          hasCostPrice && this.costService && qtyBase > 0
            ? this.costService.resolveCostForSale(product.id, qtyBase, warehouseId, itemId)
            : 0;
        const cols = [
          'id',
          'order_id',
          'product_id',
          'product_name',
          'product_sku',
          'unit_price',
          ...(hasPriceTier ? ['price_tier'] : []),
          'quantity',
          'discount_amount',
          'line_total',
          'created_at',
          ...(hasSaleUnit ? ['sale_unit'] : []),
          ...(hasQtySale ? ['qty_sale'] : []),
          ...(hasQtyBase ? ['qty_base'] : []),
          ...(hasBasePrice ? ['base_price'] : []),
          ...(hasUstaPrice ? ['usta_price'] : []),
          ...(hasDiscountType ? ['discount_type'] : []),
          ...(hasDiscountValue ? ['discount_value'] : []),
          ...(hasFinalUnitPrice ? ['final_unit_price'] : []),
          ...(hasFinalTotal ? ['final_total'] : []),
          ...(hasPriceSource ? ['price_source'] : []),
          ...(hasCostPrice ? ['cost_price'] : []),
          ...(hasPromotionId ? ['promotion_id'] : []),
        ];
        const vals = [
          itemId,
          orderId,
          product.id,
          itemData.product_name || product.name,
          product.sku,
          unitPrice,
          ...(hasPriceTier ? [priceTier] : []),
          qtySale,
          discountAmount,
          lineTotal,
          now,
          ...(hasSaleUnit ? [saleUnit] : []),
          ...(hasQtySale ? [qtySale] : []),
          ...(hasQtyBase ? [qtyBase] : []),
          ...(hasBasePrice ? [basePrice] : []),
          ...(hasUstaPrice ? [ustaPrice] : []),
          ...(hasDiscountType ? [discountType] : []),
          ...(hasDiscountValue ? [discountValue] : []),
          ...(hasFinalUnitPrice ? [finalUnitPrice] : []),
          ...(hasFinalTotal ? [finalTotal] : []),
          ...(hasPriceSource ? [priceSource] : []),
          ...(hasCostPrice ? [unitCost] : []),
          ...(hasPromotionId ? [itemData.promotion_id || null] : []),
        ];
        const placeholders = cols.map(() => '?').join(', ');
        const insertResult = this.db
          .prepare(`INSERT INTO order_items (${cols.join(', ')}) VALUES (${placeholders})`)
          .run(...vals);
        
        console.log(`[SALE] Inserted order_item:`, {
          itemId,
          orderId,
          productId: product.id,
          productName: itemData.product_name || product.name,
          quantity: qtySale,
          insertChanges: insertResult.changes,
        });

        if (hasCostPrice && !(Number(unitCost) >= 0)) {
          console.warn('[SALE] cost_price resolved to invalid value, defaulting to 0:', {
            productId: product.id,
            orderItemId: itemId,
            unitCost,
          });
        }

        if (this.promotionService && itemData.promotion_id && discountAmount > 0) {
          this.promotionService.recordUsage(itemData.promotion_id, orderId, itemId, discountAmount);
        }
      }

      // CRITICAL: Verify items were actually inserted
      const insertedItemsCount = this.db.prepare('SELECT COUNT(*) as count FROM order_items WHERE order_id = ?').get(orderId);
      console.log(`[SALE] Verification: ${insertedItemsCount?.count || 0} items found in DB for order ${orderId} after insertion`);
      
      if ((insertedItemsCount?.count || 0) === 0) {
        console.error('[SALE] ⚠️⚠️⚠️ CRITICAL: NO ITEMS FOUND AFTER INSERTION ⚠️⚠️⚠️');
        console.error('[SALE] This order will fail when trying to create a return');
        console.error('[SALE] Order ID:', orderId);
        console.error('[SALE] Items data count:', itemsData.length);
      }

      // Recalculate totals (in case items don't match orderData)
      this._recalculateOrderTotals(orderId);

      // Get updated order totals
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

      // Runtime guard: Verify order still exists before inserting payments
      if (!order) {
        console.error('FK Guard Failed: Order not found before payments', { orderId, orderNumber, payload: orderData });
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          `Order ${orderId} not found. Cannot insert payments.`);
      }

      // Process payments - use filtered validPayments (amount > 0)
      // Note: validPayments was already filtered in validation (amount > 0)
      let totalPaid = 0;
      const payments = [];

      // CRITICAL: Use validPayments (filtered earlier) instead of paymentsData
      // All payments in validPayments already have amount > 0, so no need to check again
      for (const payment of validPayments) {

        if (!payment.payment_method) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment method is required');
        }

        // Validate payment_method exists in payment_methods table (if table exists)
        // Common values: 'cash', 'card', 'transfer', etc.
        // If validation fails, default to 'cash'
        let paymentMethod = payment.payment_method;
        try {
          const methodExists = this.db.prepare('SELECT slug FROM payment_methods WHERE slug = ?').get(paymentMethod);
          if (!methodExists) {
            console.warn('⚠️ Payment method not found in payment_methods table:', paymentMethod, '- using as-is');
            // Continue anyway - payment_methods table might not be required
          }
        } catch (error) {
          // payment_methods table might not exist, continue anyway
          console.log('ℹ️ payment_methods table check skipped:', error.message);
        }

        totalPaid += payment.amount;

        const paymentId = randomUUID();
        const paymentNumber = payment.payment_number || `PAY-${Date.now()}-${payments.length}`;

        this.db.prepare(`
          INSERT INTO payments (
            id, order_id, payment_number, payment_method, amount,
            reference_number, notes, paid_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          paymentId,
          orderId,
          paymentNumber,
          paymentMethod, // Use validated payment method
          payment.amount,
          payment.reference_number || null,
          payment.notes || null,
          now, // ✅ Already normalized to SQLite format
          now  // ✅ Already normalized to SQLite format
        );

        payments.push({ id: paymentId, payment_number: paymentNumber, ...payment });

        // Create cash movement if cash payment
        if (payment.payment_method === 'cash') {
          // CRITICAL: Use the shift_id from orderData (already validated and set earlier)
          // This shift_id should NEVER be null at this point because we require an active shift
          const validShiftId = orderData.shift_id;
          
          // DIAGNOSTIC: Log values before cash_movements INSERT
          console.log('[SALE] Cash payment - preparing cash_movements INSERT:', {
            payment_method: payment.payment_method,
            shift_id: validShiftId,
            order_id: orderId,
            payment_id: paymentId,
            user_id: orderData.user_id,
            warehouse_id: orderData.warehouse_id,
            amount: payment.amount
          });

          // Validate shift_id exists (should always pass, but double-check for safety)
          if (!validShiftId) {
            console.error('[SALE] ❌ CRITICAL: shift_id is null for cash payment! This should not happen.');
            throw createError(ERROR_CODES.VALIDATION_ERROR, 
              'Cannot create cash movement: shift_id is required but was not set. Please open a shift first.');
          }
          
          // Double-check shift exists
          const shiftExists = this.db.prepare('SELECT id FROM shifts WHERE id = ?').get(validShiftId);
          if (!shiftExists) {
            console.error('[SALE] ❌ CRITICAL: shift_id does not exist in shifts table:', validShiftId);
            throw createError(ERROR_CODES.NOT_FOUND, 
              `Cannot create cash movement: shift ${validShiftId} not found.`);
          }
          
          console.log('[SALE] ✅ Cash movement shift_id validated:', validShiftId);

          // CRITICAL: Validate created_by FK - must exist in users table
          // orderData.user_id should already be forced to 'default-admin-001'
          const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(orderData.user_id);
          if (!userExists) {
            console.error('[SALE] ❌ FK Constraint Error: user_id does not exist in users table:', orderData.user_id);
            throw createError(ERROR_CODES.VALIDATION_ERROR, 
              `Cannot create cash movement: user_id '${orderData.user_id}' does not exist in users table.`);
          }

          console.log('[SALE] ✅ Cash movement FK validation passed:', {
            shift_id: validShiftId,
            created_by: orderData.user_id
          });

          const cashMovementId = randomUUID();
          const cashMovementNumber = `CASH-${Date.now()}-${cashMovementId.substring(0, 8)}`;
          
          try {
            this.db.prepare(`
              INSERT INTO cash_movements (
                id, movement_number, shift_id, movement_type, amount,
                reference_type, reference_id, created_by, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              cashMovementId,
              cashMovementNumber,
              validShiftId, // Use validated shift_id (null if invalid)
              'sale',
              payment.amount,
              'order',
              orderId,
              orderData.user_id, // FORCED: 'default-admin-001'
              now
            );
            console.log('[SALE] ✅ Cash movement created successfully:', {
              cashMovementId,
              shift_id: validShiftId,
              amount: payment.amount,
              order_id: orderId
            });
          } catch (error) {
            console.error('[SALE] ❌ Cash movement INSERT failed:', error);
            console.error('[SALE] ❌ Failed values:', {
              shift_id: validShiftId,
              created_by: orderData.user_id,
              reference_id: orderId,
              amount: payment.amount
            });
            throw error; // Re-throw to trigger transaction rollback
          }
        } else if (String(payment.payment_method || '').toLowerCase() === 'refund_cash') {
          const validShiftId = orderData.shift_id;
          if (!validShiftId) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              'Cannot record refund cash movement: shift_id is required. Please open a shift first.'
            );
          }
          const shiftExists = this.db.prepare('SELECT id FROM shifts WHERE id = ?').get(validShiftId);
          if (!shiftExists) {
            throw createError(ERROR_CODES.NOT_FOUND, `Cannot record refund: shift ${validShiftId} not found.`);
          }
          const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(orderData.user_id);
          if (!userExists) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              `Cannot record refund: user_id '${orderData.user_id}' does not exist in users table.`
            );
          }
          const cashMovementId = randomUUID();
          const cashMovementNumber = `REF-${Date.now()}-${cashMovementId.substring(0, 8)}`;
          this.db
            .prepare(`
              INSERT INTO cash_movements (
                id, movement_number, shift_id, movement_type, amount,
                reference_type, reference_id, created_by, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              cashMovementId,
              cashMovementNumber,
              validShiftId,
              'refund',
              payment.amount,
              'order',
              orderId,
              orderData.user_id,
              now
            );
          console.log('[SALE] ✅ Refund cash movement (customer payout):', {
            cashMovementId,
            shift_id: validShiftId,
            amount: payment.amount,
            order_id: orderId,
          });
        }
      }

      // CRITICAL FIX: Use pre-calculated values from validation (already calculated from validPayments)
      // These values are consistent and account for zero-amount payments being filtered out
      const finalTotalPaid = totalPaidIntake;
      const finalCreditAmount = creditAmount;
      const orderTotalAfterRecalc = Number(order.total_amount || 0);
      const clientDeclaredTotal = Number(orderData.total_amount || 0);
      // _recalculateOrderTotals() can diverge from POS-declared total (qty/unit/tax rounding).
      // If DB total is inflated vs client, naive overpay = paid - db_total becomes 0 and prior debt is never reduced.
      // Use the lower of the two as "merchandise total" for overpay / debt allocation only.
      let merchandiseTotalForOverpay = orderTotalAfterRecalc;
      if (clientDeclaredTotal > 0 && orderTotalAfterRecalc > 0) {
        merchandiseTotalForOverpay = Math.min(orderTotalAfterRecalc, clientDeclaredTotal);
      } else if (clientDeclaredTotal > 0) {
        merchandiseTotalForOverpay = clientDeclaredTotal;
      }

      const rawOverpay =
        merchandiseTotalForOverpay > 0 && finalTotalPaid > merchandiseTotalForOverpay
          ? finalTotalPaid - merchandiseTotalForOverpay
          : 0;

      // Overpay: default = naqd qaytim. Ro‘yxatdan mijoz (qarzi bor) uchun butun ortiqcha hisobga:
      // qarzni yopadi, ortiqchasi oldindan to‘lov (musbat balans) — 0 da “tiqilib” qolmaydi.
      let debtPaidFromOverpay = 0;
      let changeAmount = rawOverpay;
      const applyOverpayAsPrepaid =
        orderData.apply_overpay_as_prepaid === true ||
        orderData.apply_overpay_as_prepaid === 1 ||
        String(orderData.apply_overpay_as_prepaid || '').toLowerCase() === 'true';
      if (rawOverpay > payEps && orderData.customer_id && orderData.customer_id !== KNOWN_DEFAULT_CUSTOMER) {
        try {
          const balRow = this.db.prepare('SELECT balance FROM customers WHERE id = ?').get(orderData.customer_id);
          const bal0 = Number(balRow?.balance) || 0;
          if (bal0 < 0) {
            debtPaidFromOverpay = rawOverpay;
            changeAmount = 0;
          } else if (applyOverpayAsPrepaid) {
            // POS nasiya: savatdan oshiq to‘lovni naqd qaytim emas, mijoz oldindan to‘lovi (balance > 0)
            debtPaidFromOverpay = rawOverpay;
            changeAmount = 0;
          }
        } catch (e) {
          console.warn('[SALE] Could not allocate overpay to customer debt:', e?.message || e);
        }
      }
      if (debtPaidFromOverpay > payEps) {
        console.log('[SALE] Overpay applied to customer balance (debt / prepaid):', {
          customer_id: orderData.customer_id,
          rawOverpay,
          debtPaidFromOverpay,
          changeAmount,
        });
      }

      // Determine payment status
      let paymentStatus = 'paid';
      if (finalCreditAmount > 0) {
        paymentStatus = orderData.customer_id ? 'on_credit' : 'partial';
      } else if (merchandiseTotalForOverpay > 0 && finalTotalPaid < merchandiseTotalForOverpay) {
        paymentStatus = 'partial';
      } else if (orderTotalAfterRecalc < 0 && totalPayout > 0) {
        paymentStatus = 'paid';
      }

      // Update order to completed status
      this.db.prepare(`
        UPDATE orders 
        SET status = ?, payment_status = ?, paid_amount = ?, change_amount = ?, credit_amount = ?, updated_at = ?
        WHERE id = ?
      `).run(
        'completed',
        paymentStatus,
        finalTotalPaid, // ✅ Use pre-calculated value
        changeAmount,
        finalCreditAmount, // ✅ Use pre-calculated value
        now,
        orderId
      );

      // CRITICAL FIX: Decrement stock using InventoryService._updateBalance
      // This updates stock_balances AND creates stock_moves records atomically
      // CRITICAL: Use FORCED user_id ('default-admin-001') for created_by FK
      const forcedUserId = orderData.user_id; // Already forced to 'default-admin-001'
      const MAIN_WAREHOUSE_ID = 'main-warehouse-001'; // SINGLE WAREHOUSE SYSTEM
      
      console.log(`📦 Starting stock decrease for order ${orderId} (${itemsData.length} items)`);
      console.log(`📦 Using main warehouse: ${MAIN_WAREHOUSE_ID}`);
      
      // Ensure inventoryService is available
      if (!this.inventoryService) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          'InventoryService is not available. Cannot update stock.');
      }
      
      for (const itemData of itemsData) {
        const product = this.db.prepare('SELECT * FROM products WHERE id = ?').get(itemData.product_id);
        
        if (!product) {
          console.error(`❌ Product not found: ${itemData.product_id}`);
          throw createError(ERROR_CODES.NOT_FOUND, `Product ${itemData.product_id} not found`);
        }
        
        // Verify product_id mapping
        if (itemData.product_id !== product.id) {
          console.error(`❌ Product ID mismatch: itemData.product_id=${itemData.product_id}, product.id=${product.id}`);
          throw createError(ERROR_CODES.VALIDATION_ERROR, 
            `Product ID mismatch: expected ${product.id}, got ${itemData.product_id}`);
        }
        
        if (product.track_stock) {
          // CRITICAL: Use InventoryService._updateBalance to decrement stock
          // This method:
          // 1. Updates stock_balances table
          // 2. Creates stock_moves record
          // 3. Updates products.current_stock
          // 4. Validates stock availability (throws if insufficient)
          // All within the same transaction
          try {
            const qtyBase = Number(itemData.qty_base ?? itemData.quantity ?? 0) || 0;
            const quantityToDecrement = -qtyBase; // sale qtyBase>0 → decrease; return qtyBase<0 → increase
            
            console.log(`📦 Stock delta for product ${product.name} (${itemData.product_id}): ${quantityToDecrement}`);
            
            const stockUpdate = this.inventoryService._updateBalance(
              itemData.product_id,
              MAIN_WAREHOUSE_ID, // Always use main warehouse
              quantityToDecrement, // Negative quantity = decrease
              qtyBase < 0 ? 'return' : 'sale', // move_type
              'order', // reference_type
              orderId, // reference_id
              qtyBase < 0
                ? `Exchange return via order ${orderNumber}`
                : `Sale via order ${orderNumber}`, // reason
              forcedUserId // created_by
            );
            
            console.log(`✅ Stock updated: ${stockUpdate.beforeQuantity} -> ${stockUpdate.afterQuantity} (moveId: ${stockUpdate.moveId})`);
          } catch (stockError) {
            // If stock update fails, transaction will rollback automatically
            console.error(`❌ Stock update failed for product ${product.name}:`, stockError);
            throw stockError; // Re-throw to trigger transaction rollback
          }
        } else {
          console.log(`ℹ️ Product ${product.name} does not track stock, skipping inventory update`);
        }
      }
      
      console.log(`✅ Stock decrease completed for order ${orderId}`);

      // Create receipt snapshot
      const receiptId = randomUUID();
      const receiptNumber = `REC-${Date.now()}`;
      const receiptData = JSON.stringify({
        order: order,
        items: itemsData,
        payments: payments,
        finalized_at: now,
      });

      this.db.prepare(`
        INSERT INTO receipts (id, order_id, receipt_number, receipt_data, printed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        orderId,
        receiptNumber,
        receiptData,
        null,
        now
      );

      // Update customer stats and balance for ALL sales (credit or fully paid)
      if (orderData.customer_id && orderData.customer_id !== KNOWN_DEFAULT_CUSTOMER) {
        const customerBefore = this.db.prepare('SELECT balance FROM customers WHERE id = ?').get(orderData.customer_id);
        const currentBalance = Number(customerBefore?.balance) || 0;
        // Almashuv: jami manfiy (mijozga naqd qaytim) — agar mijozda qarz bo'lsa, returnsService dagi
        // kabi qisman kamaytirish kerak; aks holda balans 0 bo'lsa faqat kassa harakati (hisob o'zgarishi yo'q).
        let refundDebtReduction = 0;
        if (orderTotalAfterRecalc < -payEps) {
          const refundMag = Math.abs(orderTotalAfterRecalc);
          const debtMag = Math.max(0, -currentBalance);
          refundDebtReduction = Math.min(refundMag, debtMag);
        }
        const balanceCreditIn =
          Number(debtPaidFromOverpay || 0) + Number(refundDebtReduction || 0);
        const newBalance = currentBalance - finalCreditAmount + balanceCreditIn;

        console.log('💰 Updating customer stats:', {
          customer_id: orderData.customer_id,
          current_balance: currentBalance,
          creditAmount: finalCreditAmount,
          debtPaidFromOverpay,
          refundDebtReduction,
          new_balance: newBalance,
          order_total: order.total_amount,
          client_declared_total: clientDeclaredTotal,
          merchandise_total_for_overpay: merchandiseTotalForOverpay,
          paid_amount: finalTotalPaid,
          is_credit_sale: finalCreditAmount > 0,
        });

        this.db.prepare(`
          UPDATE customers 
          SET total_sales = total_sales + ?,
              total_orders = total_orders + 1,
              last_order_date = ?,
              balance = balance - ? + ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          order.total_amount,
          now,
          finalCreditAmount,
          balanceCreditIn,
          now,
          orderData.customer_id
        );

        // Insert ledger entry for sale (both credit and fully paid)
        try {
          const tableExists = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='customer_ledger'
          `).get();

          if (tableExists) {
            const ledgerId = randomUUID();
            const ledgerAmount =
              finalCreditAmount > 0
                ? -finalCreditAmount
                : refundDebtReduction > 0
                  ? refundDebtReduction
                  : 0;
            const ledgerType =
              finalCreditAmount > 0 ? 'sale' : refundDebtReduction > 0 ? 'refund' : 'sale';
            const ledgerNote =
              finalCreditAmount > 0
                ? `Sotuv: ${order.order_number} (Qarz: ${finalCreditAmount} so'm)`
                : refundDebtReduction > 0
                  ? `POS almashuv / qaytim: ${order.order_number} (qarzdan ${refundDebtReduction} so'm)`
                  : debtPaidFromOverpay > 0
                    ? `Sotuv: ${order.order_number} (To'liq to'langan: ${order.total_amount} so'm; hisobga ortiqcha ${debtPaidFromOverpay} so'm)`
                    : `Sotuv: ${order.order_number} (To'liq to'langan: ${order.total_amount} so'm)`;

            this.db.prepare(`
              INSERT INTO customer_ledger (
                id, customer_id, type, ref_id, ref_no, amount, balance_after, note, created_at, created_by
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              ledgerId,
              orderData.customer_id,
              ledgerType,
              orderId,
              order.order_number,
              ledgerAmount,
              newBalance,
              ledgerNote,
              now,
              orderData.cashier_id || orderData.user_id || null
            );
            console.log('✅ Ledger entry inserted for sale:', {
              customerId: orderData.customer_id,
              amount: ledgerAmount,
              type: ledgerType,
              newBalance,
            });
          }
        } catch (ledgerError) {
          console.error('❌ Failed to insert ledger entry for sale (non-critical):', ledgerError.message);
        }

        this._applyLoyaltyRedeemOnOrder({
          orderData,
          orderId,
          orderNumber: order.order_number,
          customerId: orderData.customer_id,
          skipWalkInCustomerId: KNOWN_DEFAULT_CUSTOMER,
          createdBy: orderData.cashier_id || orderData.user_id || null,
          now,
        });

        this._accrueCustomerLoyalty({
          customerId: orderData.customer_id,
          paidAmount: Math.max(0, finalTotalPaid - debtPaidFromOverpay),
          orderTotalAmount: order.total_amount,
          orderId,
          orderNumber: order.order_number,
          createdBy: orderData.cashier_id || orderData.user_id || null,
          now,
          skipWalkInCustomerId: KNOWN_DEFAULT_CUSTOMER,
        });
        
        // Verify update
        const customerAfter = this.db.prepare('SELECT balance FROM customers WHERE id = ?').get(orderData.customer_id);
        console.log('✅ Customer stats updated:', {
          before: currentBalance,
          after: customerAfter?.balance,
          expected: newBalance,
          match: customerAfter?.balance === newBalance
        });
      } else if (finalCreditAmount > 0 && !orderData.customer_id) {
        console.error('❌ CRITICAL: Credit amount > 0 but no customer_id - this should have been caught in validation!');
      }

      // Return order details (include customer new_balance when credit sale happened)
      let new_balance;
      if (orderData.customer_id) {
        try {
          const customerAfter = this.db.prepare('SELECT balance FROM customers WHERE id = ?').get(orderData.customer_id);
          if (customerAfter && customerAfter.balance !== undefined) {
            new_balance = Number(customerAfter.balance) || 0;
          }
        } catch (_e) {
          // ignore
        }
      }

      return {
        order_id: orderId,
        order_number: orderNumber,
        ...(new_balance !== undefined ? { new_balance } : {}),
      };
    })();
  }

  async refundOrder(orderId, refundItems, userId = 'default-admin-001') {
    console.log('🛑 HARD RESET REFUND LOGIC STARTED');
    console.log('Input Items Type:', typeof refundItems);
    console.log('Input Items Value:', refundItems);

    const MAIN_WAREHOUSE_ID = 'main-warehouse-001'; // SINGLE WAREHOUSE SYSTEM

    return this.db.transaction(() => {
      // 1. Validate Order
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new Error('Order not found');

      // 2. FORCE FIX: Handle Invalid Input
      // The frontend is sending the string "Qaytarish", which crashes the app.
      // If input is NOT an array, we IGNORE it and fetch items from the database.
      let itemsToProcess = refundItems;
      
      if (!Array.isArray(refundItems) || typeof refundItems === 'string') {
        console.log('⚠️ Input is not an array (Frontend Bug). Fetching items from DB...');
        itemsToProcess = this.db.prepare(`
          SELECT product_id, quantity, unit_price as price 
          FROM order_items 
          WHERE order_id = ?
        `).all(orderId);
      }

      console.log('✅ Resolved Items for Refund:', itemsToProcess);

      if (!itemsToProcess || itemsToProcess.length === 0) {
        throw new Error('No items found to refund.');
      }

      // 3. Update Order Status (Safe Update)
      // CRITICAL: Use 'refunded' to match frontend expectations
      const statusUpdateResult = this.db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(orderId);
      console.log(`✅ Order status updated to 'refunded': Changed ${statusUpdateResult.changes} rows`);

      // 4. Create Return Record
      // CRITICAL FIX: Use sales_returns table (NOT returns)
      const returnId = require('crypto').randomUUID();
      const returnNumber = `RET-${Date.now()}`;
      const totalAmount = itemsToProcess.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      
      // Use same structure as ReturnsService.createReturn
      this.db.prepare(`
        INSERT INTO sales_returns (
          id, return_number, order_id, customer_id, cashier_id, user_id, warehouse_id,
          return_reason, total_amount, refund_amount, refund_method, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        returnId,
        returnNumber,
        orderId,
        order.customer_id || null,
        userId, // cashier_id
        userId, // user_id
        MAIN_WAREHOUSE_ID, // warehouse_id (SINGLE WAREHOUSE SYSTEM)
        'Refund via refundOrder method', // return_reason
        totalAmount, // total_amount
        totalAmount, // refund_amount
        'cash', // refund_method
        'completed', // status
        now // created_at
      );
      
      console.log(`✅ Return record created in sales_returns: ${returnNumber} (${returnId})`);

      // 5. RESTOCK INVENTORY & Record Items
      // CRITICAL FIX: Use return_items table with correct columns (matching 000_init.sql)
      const insertItemStmt = this.db.prepare(`
        INSERT INTO return_items (
          id, return_id, order_item_id, product_id, product_name, quantity, unit_price, line_total, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // CRITICAL FIX: Use stock_balances table (not "inventory")
      const updateStockStmt = this.db.prepare(`
        UPDATE stock_balances 
        SET quantity = quantity + ? 
        WHERE product_id = ? AND warehouse_id = ?
      `);

      for (const item of itemsToProcess) {
        // Handle potential ID mismatch (product_id vs id)
        const pId = item.product_id || item.id;
        const itemPrice = item.price || item.unit_price || 0;
        const itemQuantity = item.quantity || 0;
        
        console.log(`\n🔍 Processing Refund Item:`);
        console.log(`   Product ID: ${pId}`);
        console.log(`   Quantity: ${itemQuantity}`);
        console.log(`   Price: ${itemPrice}`);
        console.log(`   Warehouse ID: ${MAIN_WAREHOUSE_ID}`);
        
        // Insert return item record
        // CRITICAL: Get order_item_id and product_name from order_items
        const orderItem = this.db.prepare(`
          SELECT id, product_name 
          FROM order_items 
          WHERE order_id = ? AND product_id = ? 
          LIMIT 1
        `).get(orderId, pId);
        
        const orderItemId = orderItem?.id || null;
        const productName = orderItem?.product_name || 'Noma\'lum mahsulot';
        const lineTotal = itemPrice * itemQuantity;
        
        insertItemStmt.run(
          require('crypto').randomUUID(), // id
          returnId, // return_id
          orderItemId, // order_item_id (can be null if not found)
          pId, // product_id
          productName, // product_name
          itemQuantity, // quantity
          itemPrice, // unit_price
          lineTotal, // line_total
          now // created_at
        );
        
        console.log(`✅ Return item inserted: product=${productName}, qty=${itemQuantity}`);
        
        // Update inventory (stock_balances)
        console.log(`📈 Attempting to restock inventory for product ${pId}...`);
          const info = updateStockStmt.run(itemQuantity, pId, MAIN_WAREHOUSE_ID);
        console.log(`🔍 Inventory Update Result for ${pId}: Changed ${info.changes} rows`);
        
        // Fallback if stock_balances row doesn't exist
        if (info.changes === 0) {
          console.log(`⚠️ No stock_balances row found for product ${pId} in warehouse ${MAIN_WAREHOUSE_ID}. Creating new row...`);
          try {
            this.db.prepare(`
              INSERT INTO stock_balances (id, product_id, warehouse_id, quantity)
              VALUES (?, ?, ?, ?)
            `).run(require('crypto').randomUUID(), pId, MAIN_WAREHOUSE_ID, itemQuantity);
            console.log(`✅ Created new stock_balances record: product=${pId}, warehouse=${MAIN_WAREHOUSE_ID}, quantity=${itemQuantity}`);
          } catch (insertError) {
            console.error(`❌ ERROR creating stock_balances record:`, insertError);
            throw insertError;
          }
        } else {
          console.log(`✅ Successfully restocked: product ${pId} increased by ${itemQuantity} in warehouse ${MAIN_WAREHOUSE_ID}`);
        }
      }

      return { success: true, returnId };
    })();
  }

  /**
   * Recalculate order totals
   */
  _recalculateOrderTotals(orderId) {
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    // Read current order row to preserve order-level discount (if any).
    const orderRow = this.db.prepare('SELECT discount_amount, discount_percent FROM orders WHERE id = ?').get(orderId) || {};

    // IMPORTANT:
    // - In this schema, `orders.subtotal` is expected to be BEFORE discount (sum(unit_price * qty)).
    // - `order_items.line_total` is net per-line amount (unit_price * qty - item.discount_amount).
    // - Some flows apply discount at ORDER level (order.discount_amount) without distributing it into item discounts.
    //   Previously we overwrote order.discount_amount with item discount sum, losing order-level discount and causing
    //   paid orders to appear as "partial" (paid == discounted total, but total_amount got recomputed without discount).

    const grossSubtotal = items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0);
    const itemsDiscountSum = items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);

    const existingOrderDiscount = Number(orderRow.discount_amount || 0);
    const existingOrderDiscountPercent = Number(orderRow.discount_percent || 0);

    // Choose effective discount:
    // - If item discounts exist, assume discount has been distributed per-item.
    // - Otherwise preserve the existing order-level discount.
    const effectiveDiscountAmount = itemsDiscountSum > 0 ? itemsDiscountSum : existingOrderDiscount;

    // Prefer percent from item distribution, otherwise keep existing order-level percent (if any).
    const discountPercent =
      grossSubtotal > 0 && itemsDiscountSum > 0
        ? (itemsDiscountSum / grossSubtotal) * 100
        : existingOrderDiscountPercent;

    // Get tax rate from settings
    const taxRateSetting = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('tax_rate');
    const taxRate = taxRateSetting ? parseFloat(taxRateSetting.value) : 0;
    const taxAmount = (grossSubtotal - effectiveDiscountAmount) * taxRate;

    const totalAmount = grossSubtotal - effectiveDiscountAmount + taxAmount;

    // CRITICAL FIX: Normalize timestamp to SQLite format
    const nowNormalized = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
    
    this.db.prepare(`
      UPDATE orders 
      SET subtotal = ?, discount_amount = ?, discount_percent = ?, tax_amount = ?, total_amount = ?, updated_at = ?
      WHERE id = ?
    `).run(
      grossSubtotal,
      effectiveDiscountAmount,
      discountPercent,
      taxAmount,
      totalAmount,
      nowNormalized, // ✅ Normalized to SQLite format
      orderId
    );
  }

  /**
   * List orders with filters
   */
  list(filters = {}) {
    console.log('📋 SalesService.list called with filters:', filters);
    
    let query = `
      SELECT 
        o.*,
        COALESCE(c.name, 'Yangi mijoz') AS customer_name,
        c.phone AS customer_phone,
        u.username as cashier_name,
        u.full_name as cashier_full_name,
        COALESCE(GROUP_CONCAT(DISTINCT p.payment_method), '') as payment_methods
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON o.cashier_id = u.id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    // CRITICAL FIX: Date filters - handle ISO format timestamps
    // Don't use datetime() function on created_at as it may return NULL for ISO strings
    // Instead, normalize the filter values and compare strings directly
    if (filters.date_from) {
      // Normalize ISO timestamp to SQLite format: YYYY-MM-DD HH:MM:SS
      const normalizedDate = filters.date_from.replace('T', ' ').replace('Z', '').substring(0, 19);
      // Compare as strings (SQLite string comparison works for ISO format)
      // CRITICAL: replace 'Z' with '' (empty string), not ')' - was causing wrong date filtering
      query += " AND replace(replace(o.created_at, 'T', ' '), 'Z', '') >= ?";
      params.push(normalizedDate);
    }

    if (filters.date_to) {
      const normalizedDate = filters.date_to.replace('T', ' ').replace('Z', '').substring(0, 19);
      // Compare as strings (SQLite string comparison works for ISO format)
      query += " AND replace(replace(o.created_at, 'T', ' '), 'Z', '') <= ?";
      params.push(normalizedDate);
    }

    if (filters.customer_id) {
      query += ' AND o.customer_id = ?';
      params.push(filters.customer_id);
    }

    if (filters.cashier_id) {
      query += ' AND o.cashier_id = ?';
      params.push(filters.cashier_id);
    }

    if (filters.status) {
      query += ' AND o.status = ?';
      params.push(filters.status);
    }

    if (filters.payment_status) {
      query += ' AND o.payment_status = ?';
      params.push(filters.payment_status);
    }

    if (filters.payment_method) {
      // Use EXISTS to avoid changing the GROUP_CONCAT join semantics
      query += ` AND EXISTS (
        SELECT 1 FROM payments p2
        WHERE p2.order_id = o.id AND p2.payment_method = ?
      )`;
      params.push(filters.payment_method);
    }

    if (filters.search) {
      const term = `%${String(filters.search).trim()}%`;
      query += ' AND (o.order_number LIKE ? OR COALESCE(c.name, \'\') LIKE ? OR COALESCE(c.phone, \'\') LIKE ?)';
      params.push(term, term, term);
    }

    if (filters.warehouse_id) {
      query += ' AND o.warehouse_id = ?';
      params.push(filters.warehouse_id);
    }

    // Note: No store_id filter - orders table doesn't have store_id column

    query += ' GROUP BY o.id';
    // Sorting (whitelist)
    const sortByRaw = String(filters.sort_by || '').trim();
    const sortOrder = String(filters.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const sortBy = (() => {
      switch (sortByRaw) {
        case 'total_amount':
          return 'o.total_amount';
        case 'order_number':
          return 'o.order_number';
        case 'created_at':
        default:
          return 'o.created_at';
      }
    })();
    query += ` ORDER BY ${sortBy} ${sortOrder}`;

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    } else {
      // Default limit to prevent huge result sets
      query += ' LIMIT 1000';
    }

    const orders = this.db.prepare(query).all(params);
    console.log(`✅ SalesService.list returned ${orders.length} orders`);
    
    // STEP 4: Verify orders include required fields (id and order_number)
    if (orders.length > 0) {
      const firstOrder = orders[0];
      console.log('[SALES] First order structure:', {
        has_id: !!firstOrder.id,
        has_order_number: !!firstOrder.order_number,
        id: firstOrder.id,
        order_number: firstOrder.order_number,
        all_keys: Object.keys(firstOrder),
      });
      
      // Warn if critical fields are missing
      if (!firstOrder.id) {
        console.warn('[SALES] ⚠️ Orders list missing id field!');
      }
      if (!firstOrder.order_number) {
        console.warn('[SALES] ⚠️ Orders list missing order_number field!');
      }
    }
    
    return orders;
  }

  /**
   * Get orders by customer ID
   */
  getByCustomer(customerId) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const orders = this.db.prepare(`
      SELECT * FROM orders 
      WHERE customer_id = ? 
      ORDER BY created_at DESC
    `).all(customerId);

    return orders.map(order => {
      const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const payments = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').all(order.id);
      const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      
      return {
        ...order,
        items,
        payments,
        customer,
      };
    });
  }

  /**
   * Get order with details
   */
  _getOrderWithDetails(orderId) {
    console.log('[SALES] _getOrderWithDetails called for orderId:', orderId);
    console.log('[SALES] orderId type:', typeof orderId);
    console.log('[SALES] orderId value:', JSON.stringify(orderId));
    
    // CRITICAL: Validate orderId is not empty/null/undefined
    if (!orderId) {
      console.error('[SALES] ❌ orderId is required but was:', orderId);
      throw new Error('Order ID is required (saleId/orderId cannot be undefined)');
    }
    
    if (typeof orderId !== 'string') {
      console.error('[SALES] ❌ orderId must be a string, got:', typeof orderId, orderId);
      throw new Error(`Order ID must be a string (UUID), got ${typeof orderId}`);
    }
    
    if (orderId.trim() === '') {
      console.error('[SALES] ❌ orderId cannot be empty string');
      throw new Error('Order ID cannot be empty');
    }
    
    // Validate it looks like a UUID (basic check)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(orderId)) {
      console.warn('[SALES] ⚠️ orderId does not look like a UUID:', orderId);
      console.warn('[SALES] This might be an order_number instead of order.id (UUID)');
    }
    
    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      console.warn('[SALES] Order not found with id:', orderId);
      
      // DEBUG: Check if order exists by order_number (in case frontend sent wrong ID)
      const orderByNumber = this.db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderId);
      if (orderByNumber) {
        console.warn('[SALES] Order found by order_number instead of id:', orderByNumber.id);
        console.warn('[SALES] Frontend should use order.id, not order.order_number');
      }
      
      // DEBUG: List all order IDs to help debug
      const allOrderIds = this.db.prepare('SELECT id, order_number FROM orders ORDER BY created_at DESC LIMIT 10').all();
      console.log('[SALES] Recent order IDs in DB:', allOrderIds.map(o => ({ id: o.id, order_number: o.order_number })));
      
      return null;
    }

    console.log('[SALES] Order found:', {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      total_amount: order.total_amount,
    });

    // Get order items (already includes product_name, product_sku from snapshot)
    // CRITICAL: Include returned_quantity and calculate remaining_quantity
    const items = this.db.prepare(`
      SELECT 
        *,
        COALESCE(returned_quantity, 0) as returned_quantity,
        (quantity - COALESCE(returned_quantity, 0)) as remaining_quantity
      FROM order_items 
      WHERE order_id = ?
    `).all(orderId);
    console.log(`[SALES] Found ${items.length} items for order ${orderId}`);
    
    // DEBUG: If no items found, check if items exist with different query
    if (items.length === 0) {
      console.warn('[SALES] ⚠️ NO ITEMS FOUND for order:', orderId);
      
      // Sanity check: Count all items in order_items table
      const totalItemsCount = this.db.prepare('SELECT COUNT(*) as count FROM order_items').get();
      console.log('[SALES] Total items in order_items table:', totalItemsCount?.count || 0);
      
      // Check if items exist with this order_id in any form
      const itemsByOrderId = this.db.prepare(`
        SELECT id, order_id, product_id, product_name, quantity 
        FROM order_items 
        WHERE order_id = ? 
        LIMIT 5
      `).all(orderId);
      console.log('[SALES] Items query result (raw):', itemsByOrderId);
      
      // Check if order_id column exists and has correct type
      const testQuery = this.db.prepare(`
        SELECT order_id, COUNT(*) as count 
        FROM order_items 
        GROUP BY order_id 
        ORDER BY count DESC 
        LIMIT 5
      `).all();
      console.log('[SALES] Sample order_ids in order_items:', testQuery);
      
      // Check if there are items for this specific order using LIKE (in case of type mismatch)
      const itemsLike = this.db.prepare(`
        SELECT * FROM order_items 
        WHERE CAST(order_id AS TEXT) = CAST(? AS TEXT)
      `).all(orderId);
      console.log('[SALES] Items found with CAST comparison:', itemsLike.length);
    } else {
      console.log('[SALES] Items found:', items.map(i => ({
        id: i.id,
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
      })));
    }

    // Get payments
    const payments = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId);
    console.log(`[SALES] Found ${payments.length} payments for order ${orderId}`);

    // Get customer if exists
    let customer = null;
    if (order.customer_id) {
      customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      console.log(`[SALES] Customer found:`, customer ? customer.name : 'null');
    }

    // Get cashier/user info (for UI: OrderDetail, receipts)
    let cashier = null;
    try {
      if (order.cashier_id) {
        cashier = this.db
          .prepare(
            `
            SELECT 
              u.id,
              u.username,
              u.full_name,
              u.email,
              (
                SELECT r.code
                FROM user_roles ur
                INNER JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.is_active = 1
                ORDER BY ur.assigned_at DESC
                LIMIT 1
              ) AS role,
              u.is_active,
              u.last_login,
              u.created_at,
              u.updated_at
            FROM users
            u
            WHERE u.id = ?
          `
          )
          .get(order.cashier_id);
      }
    } catch (err) {
      console.warn('[SALES] Could not load cashier for order:', order.cashier_id, err?.message || err);
      cashier = null;
    }

    // Enhance items with product info (optional - for current product data)
    // Note: order_items already has product_name and product_sku snapshots
    const enrichedItems = items.map(item => {
      // Try to get current product info (optional enhancement)
      const product = this.db.prepare('SELECT id, name, sku, barcode FROM products WHERE id = ?').get(item.product_id);
      
      // CRITICAL: Ensure returned_quantity and remaining_quantity are numbers
      const returnedQty = Number(item.returned_quantity || 0);
      const originalQty = Number(item.quantity || 0);
      const remainingQty = Number(item.remaining_quantity || (originalQty - returnedQty));
      
      return {
        ...item,
        // Use snapshot data (product_name, product_sku) as primary, fallback to current product
        product: product ? {
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
        } : null,
        // Keep snapshot fields for compatibility
        product_name: item.product_name,
        product_sku: item.product_sku,
        // CRITICAL: Return quantity tracking
        returned_quantity: returnedQty,
        remaining_quantity: remainingQty,
        quantity: originalQty, // Original quantity
      };
    });

    const result = {
      ...order,
      items: enrichedItems,
      payments,
      customer: customer || null,
      cashier: cashier || null,
    };

    console.log('[SALES] _getOrderWithDetails returning order:', {
      id: result.id,
      order_number: result.order_number,
      items_count: result.items.length,
      payments_count: result.payments.length,
      has_customer: !!result.customer,
    });

    // CRITICAL: If items are empty, log warning but still return order
    if (result.items.length === 0) {
      console.error('[SALES] ⚠️⚠️⚠️ RETURNING ORDER WITH ZERO ITEMS ⚠️⚠️⚠️');
      console.error('[SALES] This will cause "Bu buyurtmada mahsulotlar topilmadi" error in UI');
      console.error('[SALES] Order ID:', result.id);
      console.error('[SALES] Order Number:', result.order_number);
    }

    return result;
  }
}

module.exports = SalesService;


