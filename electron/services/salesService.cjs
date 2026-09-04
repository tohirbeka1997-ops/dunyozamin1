const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const { readConfig } = require('../config/appConfig.cjs');
const { UZBEKISTAN_TZ_SQLITE_OFFSET, parseDbTimestamp } = require('../lib/timezone.cjs');
const {
  hasCustomerBalanceUsd,
  hasCustomerLedgerCurrency,
  hasCustomerLedgerRef,
  normalizeCustomerCurrency,
  readCustomerBalances,
  readBalanceInCurrency,
  applyCustomerBalanceDeltaOnce,
  orderSalesStatUzs,
  computeSaleCreditAmount,
  assertCreditAmountAligned,
  paymentAmountInSaleCurrency,
  writeDebtAdvanceNet,
  readCustomerDebtAdvance,
} = require('../lib/customerBalance.cjs');
const {
  computeCustomerPosition,
  totalExposure,
  assertCreditExposure,
  allocateInboundToOpenOrders,
  insertPaymentAllocation,
  syncCustomerDebtFromPosition,
  settleAdvanceAgainstOpenDebt,
  roundMoney: roundCustomerMoney,
  OP: CUSTOMER_OP,
  appendLedgerAuditCols,
} = require('../lib/customerPosition.cjs');
const { recordPaymentFee } = require('../lib/paymentFee.cjs');
const { allocateOrderDiscountOntoItems } = require('../lib/allocateOrderDiscount.cjs');
const {
  allocatePaymentInToDebtAndAdvance,
  assertDueDateNotBeforeToday,
  parseNonNegativeMoneyAmount,
  isZeroTotalSaleAllowed,
  computeOrderReturnMoney,
  isProductSalePriceSellable,
  isProductFreeSaleAllowed,
} = require('../lib/posHardening.cjs');

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
    /** @type {null | { findOpenRevision?: (warehouseId: string) => any }} */
    this.inventoryRevisions = null;
    /** @type {null | { recordDrawerPaymentOnly?: Function }} */
    this.customers = null;
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

  _normalizeUnitCode(unit) {
    return String(unit || 'pcs').trim().toLowerCase() || 'pcs';
  }

  /**
   * True when POS/cashier explicitly set a free (erkin) unit price that must not be
   * re-resolved from catalog / product_prices.
   */
  _isManualPriceOverride(itemData = {}) {
    if (!itemData || typeof itemData !== 'object') return false;
    if (itemData.price_source === 'manual') return true;
    if (itemData.manual_price === true || itemData.manual_price === 1 || itemData.manual_price === '1') {
      return true;
    }
    if (
      itemData.is_price_overridden === true ||
      itemData.is_price_overridden === 1 ||
      itemData.is_price_overridden === '1'
    ) {
      return true;
    }
    // Quotes / legacy payloads
    if (itemData.override_price !== undefined && itemData.override_price !== null) return true;
    return false;
  }

  /**
   * Resolve line unit price from product_prices / product_units (same rules as completePOSOrder).
   */
  _resolveCatalogUnitPrice(product, { saleUnit = null, tierCode = 'retail', explicitUnitPrice = null, manualOverride = false } = {}) {
    if (manualOverride && explicitUnitPrice != null && Number(explicitUnitPrice) >= 0) {
      return Number(explicitUnitPrice) || 0;
    }
    const unitForPrice = this._normalizeUnitCode(
      saleUnit ?? product.base_unit ?? product.unit ?? 'pcs',
    );
    const tier = tierCode === 'master' ? 'master' : 'retail';
    if (this.pricingService?.getPriceForProduct) {
      try {
        const p = this.pricingService.getPriceForProduct({
          product_id: product.id,
          tier_code: tier,
          currency: 'UZS',
          unit: unitForPrice,
        });
        if (p != null && Number(p) > 0) return Number(p);
      } catch {
        /* fallback */
      }
    }
    if (explicitUnitPrice != null && Number(explicitUnitPrice) > 0) {
      return Number(explicitUnitPrice);
    }
    try {
      const byUnit = this.db
        .prepare(`SELECT sale_price FROM product_units WHERE product_id = ? AND unit = ?`)
        .get(product.id, unitForPrice);
      if (byUnit?.sale_price != null && Number(byUnit.sale_price) > 0) {
        return Number(byUnit.sale_price);
      }
      const def = this.db
        .prepare(`SELECT sale_price FROM product_units WHERE product_id = ? AND is_default = 1`)
        .get(product.id);
      if (def?.sale_price != null && Number(def.sale_price) > 0) {
        return Number(def.sale_price);
      }
    } catch {
      /* product_units may be missing */
    }
    if (tier === 'master') {
      return Number(product.master_price ?? product.sale_price ?? 0) || 0;
    }
    return Number(product.sale_price ?? 0) || 0;
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

  /**
   * Accept UI aliases (`method`, `transactionReference`) and canonical
   * `payment_method` / `reference_number` so mixed checkout never arrives empty.
   */
  _normalizePaymentLines(paymentsData) {
    const list = Array.isArray(paymentsData) ? paymentsData : [];
    return list.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const method = String(raw.payment_method || raw.method || '')
        .trim()
        .toLowerCase();
      const amount = Number(raw.amount);
      if (Number.isFinite(amount) && amount < 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Manfiy to‘lov qabul qilinmaydi.');
      }
      const ref =
        raw.transactionReference ||
        raw.transaction_reference ||
        raw.reference_number ||
        null;
      return {
        ...raw,
        payment_method: method || raw.payment_method,
        method: method || raw.method,
        amount: Number.isFinite(amount) ? amount : raw.amount,
        currency: raw.currency || null,
        reference_number: raw.reference_number || ref,
        transactionReference: ref,
      };
    });
  }

  _hasTable(tableName) {
    try {
      return !!this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(tableName);
    } catch {
      return false;
    }
  }

  _hasTableColumn(tableName, columnName) {
    try {
      return this.db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .some((c) => c.name === columnName);
    } catch {
      return false;
    }
  }

  _hasWebOrdersTable() {
    return this._hasTable('web_orders');
  }

  _resolveSalesChannel(orderData = {}) {
    const raw = String(orderData.sales_channel || orderData.channel || 'pos').trim().toLowerCase();
    if (raw === 'staff_mobile' || raw === 'mobile' || raw === 'staff') return 'staff_mobile';
    return 'pos';
  }

  _webStatusesForPosFilter(posStatus) {
    const s = String(posStatus || '').toLowerCase();
    if (!s || s === 'all') return null;
    if (s === 'completed') return ['delivered'];
    if (s === 'cancelled' || s === 'voided' || s === 'returned') return ['cancelled'];
    if (s === 'pending' || s === 'hold') {
      return ['new', 'paid', 'processing', 'ready', 'out_for_delivery'];
    }
    return [];
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

  _isTruthySetting(key, defaultTrue = false) {
    const raw = (this._getSettingRaw(key) || '').trim().toLowerCase();
    if (!raw) return defaultTrue;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    return defaultTrue;
  }

  /**
   * Soft-lock twin of InventoryService.adjustStock: block stock-affecting POS
   * completion while a warehouse revision is draft/in_progress.
   * Setting inventory.revision_block_sales=false disables the hard block.
   */
  _assertNoOpenRevisionBlockingSales(warehouseId) {
    if (!this._isTruthySetting('inventory.revision_block_sales', true)) return;
    const findOpen = this.inventoryRevisions?.findOpenRevision;
    if (typeof findOpen !== 'function') return;
    const open = findOpen.call(this.inventoryRevisions, warehouseId || 'main-warehouse-001');
    if (!open) return;
    throw createError(
      ERROR_CODES.VALIDATION_ERROR,
      `Ochiq ombor reviziyasi bor (${open.revision_number}). Sotuv bloklangan — avval reviziyani yakunlang yoki bekor qiling.`
    );
  }

  /**
   * Server-side nasiya gate (POS UI is not enough).
   * - credit_limit must be > 0 to allow any credit sale
   * - projected |debt| must not exceed credit_limit
   * - allow_debt / allow_credit: when sales.credit.require_allow_debt=true,
   *   at least one flag OR a positive credit_limit is required
   */
  _assertCustomerCreditAllowed(customerId, creditAmount, saleCurrency, opts = {}) {
    const credit = Number(creditAmount) || 0;
    if (!(credit > 0.009)) return;

    const hasUsd = hasCustomerBalanceUsd(this.db);
    const row = this.db
      .prepare(
        `SELECT id, name, status, credit_limit, allow_debt, allow_credit, balance${
          hasUsd ? ', balance_usd' : ''
        } FROM customers WHERE id = ?`
      )
      .get(customerId);
    if (!row) {
      throw createError(
        ERROR_CODES.NOT_FOUND,
        `Customer not found: ${customerId}. Cannot process credit sale.`
      );
    }

    const status = String(row.status || '').trim().toLowerCase();
    if (status && status !== 'active') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Faol bo‘lmagan mijozga nasiya qilib bo‘lmaydi: "${row.name}".`
      );
    }

    const allowDebt = Number(row.allow_debt) === 1 || Number(row.allow_credit) === 1;
    const limit = Number(row.credit_limit) || 0;
    const requireAllowFlag = this._isTruthySetting('sales.credit.require_allow_debt', false);
    if (requireAllowFlag && !allowDebt && !(limit > 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Nasiya ruxsat etilmagan: "${row.name}" uchun allow_debt/allow_credit yoqilmagan va kredit limiti belgilanmagan.`
      );
    }

    if (!(limit > 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Qarz berib bo‘lmaydi: mijoz kredit limiti belgilanmagan.',
        { code: 'CREDIT_LIMIT_NOT_SET', credit_limit: 0 }
      );
    }

    const currency = normalizeCustomerCurrency(saleCurrency);
    const pos = computeCustomerPosition(this.db, customerId, currency, {
      excludeOrderId: opts.excludeOrderId || null,
    });
    const exposure = totalExposure(pos, Number(opts.pendingUnpostedDebt) || 0);
    const gate = assertCreditExposure({
      totalExposure: exposure,
      newDebtAmount: credit,
      creditLimit: limit,
      allowOverride: Boolean(opts.allowOverride),
      overrideReason: opts.overrideReason,
      overrideApproverId: opts.overrideApproverId,
    });
    if (!gate.ok) {
      const curLabel = currency === 'USD' ? 'USD' : "so'm";
      throw createError(ERROR_CODES.VALIDATION_ERROR, gate.error, {
        code: gate.code,
        credit_limit: gate.credit_limit,
        current_debt: gate.current_debt,
        new_amount: gate.new_amount,
        projected: gate.projected,
        over_by: gate.over_by,
        currency: curLabel,
      });
    }
  }

  _recordPaymentFee(paymentId, order, paymentMethod, paymentAmount, paidAt) {
    try {
      recordPaymentFee(this.db, {
        paymentId,
        orderId: order?.id || null,
        paymentMethod,
        paymentAmount,
        currency: order?.currency || 'UZS',
        fxRate: order?.fx_rate,
        createdAt: paidAt,
      });
    } catch (err) {
      console.warn('[SALE] payment fee record skipped:', err?.message || err);
    }
  }

  _getCreditDueDefaultDays() {
    const v = Number(this._getSettingRaw('credit.due.default_days'));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
  }

  _dbLocalTodayYmd() {
    try {
      const row = this.db.prepare(`SELECT date('now', 'localtime') AS d`).get();
      return row?.d ? String(row.d).slice(0, 10) : null;
    } catch {
      return null;
    }
  }

  _normalizeDueDate(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  _normalizeReminderNote(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (!s) return null;
    return s.slice(0, 500);
  }

  _isCreditPaymentStatus(paymentStatus) {
    const ps = String(paymentStatus || '').toLowerCase();
    return ps === 'on_credit' || ps === 'partial' || ps === 'partially_paid';
  }

  _resolveOrderDueDate(orderData, paymentStatus, creditAmount) {
    if (!this._hasOrderCol('due_date')) return null;
    const credit = Number(creditAmount || 0);
    if (credit <= 0.009 || !this._isCreditPaymentStatus(paymentStatus)) return null;
    const explicit = this._normalizeDueDate(orderData?.due_date);
    if (explicit) {
      const check = assertDueDateNotBeforeToday(explicit, this._dbLocalTodayYmd());
      if (!check.ok) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, check.error);
      }
      return check.due_date;
    }
    let days = this._getCreditDueDefaultDays();
    try {
      const cid = orderData?.customer_id;
      if (cid && this._hasCustomersCol?.('credit_term_days') !== false) {
        const crow = this.db
          .prepare(`SELECT credit_term_days FROM customers WHERE id = ?`)
          .get(cid);
        const term = Number(crow?.credit_term_days);
        if (Number.isFinite(term) && term > 0) days = Math.floor(term);
      }
    } catch {
      /* column may be missing */
    }
    const row = this.db
      .prepare(`SELECT date('now', 'localtime', '+' || ? || ' days') AS d`)
      .get(days);
    return row?.d || null;
  }

  _resolveOrderReminderNote(orderData, paymentStatus, creditAmount) {
    if (!this._hasOrderCol('credit_reminder_note')) return null;
    const credit = Number(creditAmount || 0);
    if (credit <= 0.009 || !this._isCreditPaymentStatus(paymentStatus)) return null;
    return this._normalizeReminderNote(
      orderData?.credit_reminder_note ?? orderData?.reminder_note,
    );
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
    const raw = (this._getSettingRaw('loyalty.earn.scope') || 'all_customers').trim().toLowerCase();
    if (raw === 'off' || raw === 'disabled' || raw === 'none') return 'off';
    if (raw === 'all_customers' || raw === 'all_registered') return 'all_registered';
    if (raw === 'exclude_walk_in') return 'exclude_walk_in';
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
   * Reverse loyalty earn/redeem tied to an order before POS amend replaces it.
   * Prevents double bonus accrual when the amended sale is re-completed.
   */
  _reverseLoyaltyForAmendedOrder(orderId, { userId, now }) {
    if (!this._hasBonusLedgerTable() || !this._hasCustomersCol('bonus_points') || !orderId) return;

    const already = this.db
      .prepare(
        `SELECT 1 FROM customer_bonus_ledger
         WHERE order_id = ? AND type = 'adjust' AND note LIKE 'Tahrir:%' LIMIT 1`,
      )
      .get(orderId);
    if (already) return;

    const rows = this.db
      .prepare(
        `SELECT customer_id, type, points FROM customer_bonus_ledger
         WHERE order_id = ? AND type IN ('earn', 'redeem')`,
      )
      .all(orderId);

    for (const row of rows) {
      const pts = Math.floor(Number(row.points) || 0);
      if (pts <= 0 || !row.customer_id) continue;

      if (row.type === 'earn') {
        this.db
          .prepare(
            `UPDATE customers
             SET bonus_points = CASE
               WHEN COALESCE(bonus_points, 0) - ? < 0 THEN 0
               ELSE COALESCE(bonus_points, 0) - ?
             END,
             updated_at = ?
             WHERE id = ?`,
          )
          .run(pts, pts, now, row.customer_id);
        this._insertBonusLedgerRow({
          customerId: row.customer_id,
          type: 'adjust',
          points: -pts,
          orderId,
          note: 'Tahrir: avvalgi sotuv bonusi bekor',
          createdBy: userId,
          now,
        });
      } else if (row.type === 'redeem') {
        this.db
          .prepare(
            'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) + ?, updated_at = ? WHERE id = ?',
          )
          .run(pts, now, row.customer_id);
        this._insertBonusLedgerRow({
          customerId: row.customer_id,
          type: 'adjust',
          points: pts,
          orderId,
          note: 'Tahrir: ball ishlatish qaytarildi',
          createdBy: userId,
          now,
        });
      }
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
   * Buyer earn uses paid amount only (excludes unpaid credit). Usta/referrer earn uses full order total.
   * Idempotent per order (earn).
   */
  _accrueCustomerLoyalty({
    customerId,
    bonusReferrerCustomerId,
    paidAmount,
    orderTotalAmount,
    orderId,
    orderNumber,
    createdBy,
    now,
    skipWalkInCustomerId,
  }) {
    const recipientId = bonusReferrerCustomerId || customerId;
    if (!recipientId) return;
    if (!bonusReferrerCustomerId) {
      if (skipWalkInCustomerId && customerId === skipWalkInCustomerId) return;
    } else if (skipWalkInCustomerId && recipientId === skipWalkInCustomerId) return;
    if (!this._hasCustomersCol('bonus_points')) return;
    const earnBase = bonusReferrerCustomerId
      ? Number(orderTotalAmount) || 0
      : Number(paidAmount) || 0;
    if (earnBase <= 0) return;

    if (this._hasEarnLedgerForOrder(recipientId, orderId)) return;

    const minOrder = this._getLoyaltyMinOrderUzs();
    const orderTotal = Number(orderTotalAmount) || 0;
    if (minOrder > 0 && orderTotal < minOrder) return;

    const cust = this.db.prepare('SELECT pricing_tier FROM customers WHERE id = ?').get(recipientId);
    const tier = String(cust?.pricing_tier || 'retail');

    if (this._isLoyaltyMasterEnabled() && tier === 'master') {
      const perUzs = this._getLoyaltyPointsPerUzs();
      const earned = Math.floor(earnBase / perUzs);
      if (earned <= 0) return;
      this.db
        .prepare(
          'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) + ?, updated_at = ? WHERE id = ?'
        )
        .run(earned, now, recipientId);
      this._insertBonusLedgerRow({
        customerId: recipientId,
        type: 'earn',
        points: earned,
        orderId,
        note: bonusReferrerCustomerId
          ? `Usta bonus: sotuv ${orderNumber || orderId || ''}`.trim()
          : `Usta sotuv ${orderNumber || orderId || ''}`.trim(),
        createdBy,
        now,
      });
      return;
    }

    if (!this._isLoyaltyGeneralEnabled()) return;

    const scope = this._getLoyaltyEarnScope();
    if (scope === 'off') return;
    // "master_only" = ball faqat usta (master) toifasidagi mijozlarga; chakanaga emas.
    if (scope === 'master_only' && tier !== 'master') return;
    if (!bonusReferrerCustomerId && skipWalkInCustomerId && customerId === skipWalkInCustomerId) return;

    const perUzs = this._getLoyaltyGeneralPointsPerUzs();
    const earned = Math.floor(earnBase / perUzs);
    if (earned <= 0) return;

    this.db
      .prepare(
        'UPDATE customers SET bonus_points = COALESCE(bonus_points, 0) + ?, updated_at = ? WHERE id = ?'
      )
      .run(earned, now, recipientId);
    this._insertBonusLedgerRow({
      customerId: recipientId,
      type: 'earn',
      points: earned,
      orderId,
      note: bonusReferrerCustomerId
        ? `Usta bonus: sotuv ${orderNumber || orderId || ''}`.trim()
        : `Sotuv ${orderNumber || orderId || ''}`.trim(),
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
    const hasSalesChannel = this._hasOrderCol('sales_channel');
    const salesChannel = this._resolveSalesChannel(data);
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
      ...(hasSalesChannel ? ['sales_channel'] : []),
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
      ...(hasSalesChannel ? [salesChannel] : []),
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
    const priceTier = itemData.price_tier === 'master' ? 'master' : 'retail';
    const manualOverride = this._isManualPriceOverride(itemData);
    const unitPrice = this._resolveCatalogUnitPrice(product, {
      saleUnit,
      tierCode: priceTier,
      explicitUnitPrice: itemData.unit_price,
      manualOverride,
    });
    const discountAmount = itemData.discount_amount || 0;
    const grossLine = unitPrice * qtySale;
    const lineTotal =
      itemData.final_total != null && Number.isFinite(Number(itemData.final_total))
        ? Number(itemData.final_total)
        : grossLine - discountAmount;
    const effectiveDiscount = Math.max(0, grossLine - lineTotal);
    const basePrice = itemData.base_price ?? unitPrice;
    const ustaPrice = itemData.usta_price ?? null;
    const discountType = itemData.discount_type ?? (discountAmount > 0 ? 'fixed' : 'none');
    const discountValue =
      itemData.discount_value ?? (qtySale > 0 ? discountAmount / qtySale : 0);
    const finalUnitPrice =
      itemData.final_unit_price ?? (qtySale > 0 ? lineTotal / qtySale : unitPrice);
    const finalTotal = itemData.final_total ?? lineTotal;
    const priceSource = manualOverride
      ? 'manual'
      : itemData.price_source ?? (priceTier === 'master' ? 'usta' : 'base');

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
    const hasLineProfit = this._hasOrderItemCol('line_profit');

    const unitCost = hasCostPrice && this.costService
      ? this.costService.resolveCostForSale(product.id, qtyBase, order.warehouse_id, null)
      : 0;
    const signedQty = Number(qtyBase || qtySale || 0);
    const lineProfit = lineTotal - (Number(unitCost) || 0) * signedQty;

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
      ...(hasLineProfit ? ['line_profit'] : []),
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
      effectiveDiscount,
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
      ...(hasLineProfit ? [lineProfit] : []),
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

    const orderPreview = this.db.prepare('SELECT warehouse_id, status FROM orders WHERE id = ?').get(orderId);
    if (orderPreview?.status === 'hold') {
      this._assertNoOpenRevisionBlockingSales(orderPreview.warehouse_id || 'main-warehouse-001');
    }

    // Use transaction for atomicity and concurrency safety
    // better-sqlite3's transaction() provides serializable isolation
    return this.db.transaction(() => {
      let order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) {
        throw createError(ERROR_CODES.NOT_FOUND, `Order ${orderId} not found`);
      }

      if (order.status !== 'hold') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Can only finalize draft orders');
      }

      // Qoralama buyurtmada shift_id bo‘lmasa, joriy ochiq smenaga bog‘lash (yakunda smena xulosasi 0 bo‘lib qolmasin)
      if (!order.shift_id) {
        const wh = order.warehouse_id || 'main-warehouse-001';
        const uid = order.cashier_id || order.user_id;
        if (uid) {
          const activeShift = this.db.prepare(`
            SELECT id FROM shifts 
            WHERE (user_id = ? OR cashier_id = ?) 
              AND warehouse_id = ? 
              AND status = 'open' 
              AND closed_at IS NULL
            ORDER BY opened_at DESC 
            LIMIT 1
          `).get(uid, uid, wh);
          if (activeShift?.id) {
            const iso = new Date().toISOString();
            this.db.prepare('UPDATE orders SET shift_id = ?, updated_at = ? WHERE id = ?').run(
              activeShift.id,
              iso,
              orderId
            );
            order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
          }
        }
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

        const payMethod = String(payment.payment_method || '').toLowerCase();
        const isCreditPay =
          payMethod === 'credit' || payMethod === 'on_credit' || payMethod === 'debt';
        if (!isCreditPay) totalPaid += payment.amount;

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
        this._recordPaymentFee(paymentId, order, payment.payment_method, payment.amount, now);

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
      const creditAmount = computeSaleCreditAmount(order.total_amount, totalPaid, 0, 0.02);
      assertCreditAmountAligned(order.total_amount, totalPaid, creditAmount, 0, 0.02);

      if (creditAmount > 0.009) {
        const KNOWN_DEFAULT_CUSTOMER = 'default-customer-001';
        if (!order.customer_id || order.customer_id === KNOWN_DEFAULT_CUSTOMER) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'Credit sales require a registered customer. Please select a customer.'
          );
        }
        this._assertCustomerCreditAllowed(
          order.customer_id,
          creditAmount,
          order.currency || 'UZS'
        );
      }

      // Determine payment status
      let paymentStatus = 'paid';
      if (creditAmount > 0) {
        paymentStatus = order.customer_id ? 'on_credit' : 'partial';
      } else if (totalPaid < order.total_amount) {
        paymentStatus = 'partial';
      }

      const dueDate = this._resolveOrderDueDate(order, paymentStatus, creditAmount);
      const reminderNote = this._resolveOrderReminderNote(order, paymentStatus, creditAmount);
      const finalizeSet = [
        'status = ?',
        'payment_status = ?',
        'paid_amount = ?',
        'change_amount = ?',
        'credit_amount = ?',
        'updated_at = ?',
      ];
      const finalizeVals = [
        'completed',
        paymentStatus,
        totalPaid,
        changeAmount,
        creditAmount,
        now,
      ];
      if (this._hasOrderCol('due_date')) {
        finalizeSet.push('due_date = ?');
        finalizeVals.push(dueDate);
      }
      if (this._hasOrderCol('credit_reminder_note')) {
        finalizeSet.push('credit_reminder_note = ?');
        finalizeVals.push(reminderNote);
      }
      finalizeVals.push(orderId);
      this.db
        .prepare(`UPDATE orders SET ${finalizeSet.join(', ')} WHERE id = ?`)
        .run(...finalizeVals);

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
              this.batchService.allocateFIFOWithFallback({
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
          bonusReferrerCustomerId: order.bonus_referrer_customer_id || null,
          paidAmount: totalPaid,
          orderTotalAmount: order.total_amount,
          orderId,
          orderNumber: order.order_number,
          createdBy: order.user_id,
          now,
          skipWalkInCustomerId: 'default-customer-001',
        });
      } else if (order.bonus_referrer_customer_id) {
        this._accrueCustomerLoyalty({
          customerId: order.customer_id,
          bonusReferrerCustomerId: order.bonus_referrer_customer_id,
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
    paymentsData = this._normalizePaymentLines(paymentsData);
    // Known default IDs from migrations (see 013_ensure_seed_data.sql)
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    const MAIN_WAREHOUSE_ID = 'main-warehouse-001'; // SINGLE WAREHOUSE SYSTEM
    const KNOWN_DEFAULT_CUSTOMER = 'default-customer-001'; // Walk-in customer

    // Authenticated cashier from session — validate FK against users, fallback only when missing/invalid
    let userId = orderData.user_id || orderData.cashier_id || null;
    if (userId) {
      const userExists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (!userExists) {
        console.warn('⚠️ Provided cashier_id does not exist in users table:', userId);
        userId = null;
      }
    }
    if (!userId) {
      const defaultUser = this.db.prepare('SELECT id FROM users WHERE id = ?').get(KNOWN_DEFAULT_USER);
      if (defaultUser) {
        userId = KNOWN_DEFAULT_USER;
        console.log('👤 No valid cashier provided; using default user:', userId);
      } else {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Cashier user ID is required and default user was not found in users table'
        );
      }
    }
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

    // Soft-lock: open inventory revision blocks stock-affecting sales (see adjustStock).
    this._assertNoOpenRevisionBlockingSales(warehouseId);

    // CRITICAL FIX: ALWAYS find and link active shift before creating order
    // This ensures all sales are linked to shifts for proper shift closing calculations
    if (!shiftId) {
      console.log('🔍 No shift_id provided. Looking for active shift...');
      console.log('   User ID:', orderData.user_id);
      console.log('   Warehouse ID:', warehouseId);

      const tryUserIds = [];
      const seen = new Set();
      const pushUid = (uid) => {
        if (!uid || seen.has(uid)) return;
        const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (row?.id) {
          seen.add(uid);
          tryUserIds.push(uid);
        }
      };
      pushUid(orderData.user_id);
      pushUid(orderData.cashier_id);

      let activeShift = null;
      for (const uid of tryUserIds) {
        activeShift = this.db.prepare(`
        SELECT id FROM shifts 
        WHERE (user_id = ? OR cashier_id = ?) 
          AND warehouse_id = ? 
          AND status = 'open' 
          AND closed_at IS NULL
        ORDER BY opened_at DESC 
        LIMIT 1
      `).get(uid, uid, warehouseId);
        if (activeShift) break;
      }

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

    // Optional usta/referrer — bonus routing only (sale/debt stay on customer_id)
    let bonusReferrerCustomerId =
      orderData.bonus_referrer_customer_id ?? orderData.referrer_customer_id ?? null;
    if (bonusReferrerCustomerId != null && String(bonusReferrerCustomerId).trim() === '') {
      bonusReferrerCustomerId = null;
    }
    if (bonusReferrerCustomerId) {
      bonusReferrerCustomerId = String(bonusReferrerCustomerId).trim();
      if (bonusReferrerCustomerId === KNOWN_DEFAULT_CUSTOMER) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Usta (bonus) uchun yuruvchi mijoz tanlanmaydi.'
        );
      }
      const refExists = this.db
        .prepare('SELECT id FROM customers WHERE id = ?')
        .get(bonusReferrerCustomerId);
      if (!refExists) {
        throw createError(
          ERROR_CODES.NOT_FOUND,
          `Usta (bonus) mijozi topilmadi (ID: ${bonusReferrerCustomerId}).`
        );
      }
    } else {
      bonusReferrerCustomerId = null;
    }
    orderData.bonus_referrer_customer_id = bonusReferrerCustomerId;

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
        const existingOrder = this._getOrderWithDetails(existing.id);
        return {
          order_id: existing.id,
          order_number: existingOrder?.order_number || null,
        };
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

    const declaredTotal = Number(orderData.total_amount || 0);
    if (Math.abs(declaredTotal) < 0.005) {
      const roleCodesForZero = this._getUserRoleCodes(orderData.user_id || orderData.cashier_id);
      const authorizedZero = roleCodesForZero.some((r) => r === 'admin' || r === 'manager');
      const disc = Number(orderData.discount_amount || 0);
      const sub = Number(orderData.subtotal || 0);
      const loyaltyPts = Number(orderData.loyalty_redeem_points || 0);
      const hasPromo =
        Boolean(orderData.promo_code) ||
        String(orderData.discount_type || '').toLowerCase() === 'promo';
      if (
        !isZeroTotalSaleAllowed({
          subtotal: sub,
          discountAmount: disc,
          loyaltyRedeemPoints: loyaltyPts,
          hasPromo,
          authorized: authorizedZero,
        })
      ) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Zero-total sale requires 100% discount, promo, bonus points, or authorized role',
        );
      }
    }

    // CRITICAL FIX: Filter out zero-amount payments and allow empty payments for full credit sales.
    // IMPORTANT: A "credit" entry is NOT real money received; do NOT count it toward paid_amount.
    const validPayments = (paymentsData || []).filter((p) => Number(p.amount) > 0);

    const isCreditMethod = (method) => {
      const m = String(method || '').toLowerCase();
      return m === 'credit' || m === 'on_credit' || m === 'debt';
    };

    const isPayoutMethod = (method) => {
      const m = String(method || '').toLowerCase();
      return m === 'refund_cash' || m === 'refund_balance';
    };
    const isRefundCashPayout = (method) => String(method || '').toLowerCase() === 'refund_cash';
    const isRefundBalancePayout = (method) => String(method || '').toLowerCase() === 'refund_balance';

    const intakePayments = validPayments.filter(
      (p) => !isCreditMethod(p.payment_method) && !isPayoutMethod(p.payment_method)
    );
    const payoutPayments = validPayments.filter((p) => isPayoutMethod(p.payment_method));
    const creditPayments = validPayments.filter((p) => isCreditMethod(p.payment_method));

    const hasOrderCurrencyPre = this._hasOrderCol('currency');
    const saleCurrencyForPay =
      hasOrderCurrencyPre && String(orderData.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const saleFxRateForPay =
      saleCurrencyForPay === 'USD' ? Number(orderData.fx_rate ?? orderData.exchange_rate ?? 0) : null;
    if (saleCurrencyForPay === 'USD' && hasOrderCurrencyPre) {
      if (!Number.isFinite(saleFxRateForPay) || saleFxRateForPay <= 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'fx_rate is required for USD sales (UZS per 1 USD)'
        );
      }
    }

    const amountInSaleCurrency = (payment) => {
      try {
        return paymentAmountInSaleCurrency(payment, saleCurrencyForPay, saleFxRateForPay);
      } catch (err) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, err.message || String(err));
      }
    };

    const totalPaidIntake = intakePayments.reduce((sum, p) => sum + amountInSaleCurrency(p), 0);
    const totalPayout = payoutPayments.reduce((sum, p) => sum + amountInSaleCurrency(p), 0);
    const prepaidApplied = Math.max(0, Number(orderData.prepaid_applied || 0) || 0);

    const orderTotalSigned = Number(orderData.total_amount || 0);
    let creditAmount = 0;
    if (orderTotalSigned > 0) {
      creditAmount = Math.max(0, orderTotalSigned - totalPaidIntake - prepaidApplied);
    }

    const payEps = 0.02;

    if (orderTotalSigned > 0) {
      if (payoutPayments.length > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'refund_cash / refund_balance faqat jami manfiy (mijozga qaytim) bo‘lganda'
        );
      }
      if (prepaidApplied > orderTotalSigned + payEps) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Oldindan to‘lov miqdori savat jamiidan oshmasligi kerak'
        );
      }
      if (totalPaidIntake === 0 && creditAmount === 0 && prepaidApplied <= payEps) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Order must have at least one payment with amount > 0, or be a credit sale (creditAmount > 0)'
        );
      }
      const mixedIntakeCount = intakePayments.length;
      // Mixed (2+ intake methods) must cover the ticket: underpay is not a silent nasiya.
      if (mixedIntakeCount > 1 && totalPaidIntake + prepaidApplied + payEps < orderTotalSigned) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Aralash to‘lov yig‘indisi buyurtma jamiiga teng bo‘lishi kerak. Qolganini nasiya tabida yopping.'
        );
      }
      if (mixedIntakeCount > 1 && totalPaidIntake > orderTotalSigned + payEps) {
        const hasRegistered =
          orderData.customer_id && orderData.customer_id !== KNOWN_DEFAULT_CUSTOMER;
        if (!hasRegistered) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'Ortiqcha aralash to‘lov faqat mijoz tanlanganda avansga o‘tadi.'
          );
        }
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
          `Mijozga ${Math.round(needPayout)} so‘m qaytarish kerak (refund_cash yoki refund_balance).`
        );
      }
      const cashPayoutLines = payoutPayments.filter((p) => isRefundCashPayout(p.payment_method));
      const balancePayoutLines = payoutPayments.filter((p) => isRefundBalancePayout(p.payment_method));
      if (cashPayoutLines.length > 0 && balancePayoutLines.length > 0) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          'Bir almashuvda naqd qaytim va balansga qaytim bir vaqtda bo‘lmasin'
        );
      }
      if (balancePayoutLines.length > 0) {
        if (!orderData.customer_id || orderData.customer_id === KNOWN_DEFAULT_CUSTOMER) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'Balansga qaytim uchun ro‘yxatdan o‘tgan mijoz tanlanishi kerak'
          );
        }
        const balanceCustomer = this.db
          .prepare('SELECT id, name FROM customers WHERE id = ?')
          .get(orderData.customer_id);
        if (!balanceCustomer) {
          throw createError(
            ERROR_CODES.NOT_FOUND,
            `Balansga qaytim: mijoz topilmadi (${orderData.customer_id})`
          );
        }
      }
    }

    // Diagnostic: if client sent explicit credit payment lines, ensure they match computed credit
    const creditFromPayments = creditPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    if (creditFromPayments > 0 && Math.abs(creditFromPayments - creditAmount) > payEps) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `credit_amount (${creditFromPayments}) must equal total_amount − paid_amount (${creditAmount})`
      );
    }
    
    // CRITICAL: For credit sales, require a real customer (not default walk-in)
    if (creditAmount > 0) {
      if (!orderData.customer_id) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          'Credit sales require a registered customer. Please select a customer.');
      }
      
      // Verify customer exists and is not the default walk-in customer
      const customer = this.db
        .prepare('SELECT id, name, status FROM customers WHERE id = ?')
        .get(orderData.customer_id);
      if (!customer) {
        throw createError(ERROR_CODES.NOT_FOUND, 
          `Customer not found: ${orderData.customer_id}. Cannot process credit sale.`);
      }

      const custStatus = String(customer.status || '').trim().toLowerCase();
      if (custStatus && custStatus !== 'active') {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Cannot sell on credit to inactive customer: "${customer.name}".`
        );
      }
      
      // Check if it's the default walk-in customer (should not allow credit for walk-in)
      if (orderData.customer_id === KNOWN_DEFAULT_CUSTOMER) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          'Credit sales are not allowed for walk-in customers. Please select a registered customer.');
      }

      // Explicit nasiya due date cannot be in the past (server-side).
      if (orderData.due_date != null && String(orderData.due_date).trim() !== '') {
        const dueCheck = assertDueDateNotBeforeToday(orderData.due_date, this._dbLocalTodayYmd());
        if (!dueCheck.ok) {
          throw createError(ERROR_CODES.VALIDATION_ERROR, dueCheck.error);
        }
      }

      const saleCurrencyForCredit = normalizeCustomerCurrency(
        orderData.currency || orderData.sale_currency || 'UZS'
      );
      this._assertCustomerCreditAllowed(orderData.customer_id, creditAmount, saleCurrencyForCredit);
      
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
        payments_count: paymentsData.length,
        replaces_order_id: orderData.replaces_order_id || orderData.amend_order_id || orderData.replace_order_id || null,
      });

    const replacesOrderId =
      orderData.replaces_order_id || orderData.amend_order_id || orderData.replace_order_id || null;

    const __runSaleTx = this.db.transaction(() => {
      // Generate orderId ONCE and use it consistently throughout
      const orderId = randomUUID();
      const orderNumber = orderData.order_number || `ORD-${Date.now()}`;
      // CRITICAL FIX: Use SQLite-friendly datetime format instead of ISO string
      // SQLite format: 'YYYY-MM-DD HH:MM:SS' (no 'T' or 'Z', no fractional seconds)
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
      const batchActive = !!this.batchService?.isBatchModeActive?.(now);

      const ledgerEventAt = replacesOrderId ? this._bumpSqliteDatetime(now, 1) : now;

      if (replacesOrderId) {
        this._reverseOrderForAmend(replacesOrderId, {
          userId: orderData.user_id,
          now,
        });
      }

      // Create order with 'hold' status initially
      // CRITICAL: Use FORCED values to ensure FK constraints are satisfied
      const freeSaleReasonRaw = String(orderData.free_sale_reason || '').trim();
      let orderNotes = orderData.notes != null ? String(orderData.notes) : '';
      if (freeSaleReasonRaw) {
        const tagged = `[FREE_SALE] ${freeSaleReasonRaw}`;
        orderNotes = orderNotes.trim()
          ? `${tagged}\n${orderNotes.trim()}`
          : tagged;
      }

      const hasPriceTierId = this._hasOrderCol('price_tier_id');
      const hasOrderCurrency = this._hasOrderCol('currency');
      const hasOrderFxRate = this._hasOrderCol('fx_rate');
      const hasOrderTotalUsd = this._hasOrderCol('total_usd');
      const hasSalesChannel = this._hasOrderCol('sales_channel');
      const hasBonusReferrer = this._hasOrderCol('bonus_referrer_customer_id');
      const salesChannel = this._resolveSalesChannel(orderData);
      const saleCurrency =
        hasOrderCurrency && String(orderData.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      const saleFxRate =
        saleCurrency === 'USD' ? Number(orderData.fx_rate ?? orderData.exchange_rate ?? 0) : null;
      if (saleCurrency === 'USD' && hasOrderCurrency) {
        if (!Number.isFinite(saleFxRate) || saleFxRate <= 0) {
          throw createError(
            ERROR_CODES.VALIDATION_ERROR,
            'fx_rate is required for USD sales (UZS per 1 USD)'
          );
        }
      }
      const totalUsdSnapshot =
        saleCurrency === 'USD' && hasOrderTotalUsd ? Number(orderData.total_amount || 0) : null;
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
        ...(hasOrderCurrency ? ['currency'] : []),
        ...(hasOrderFxRate ? ['fx_rate'] : []),
        ...(hasOrderTotalUsd ? ['total_usd'] : []),
        ...(hasSalesChannel ? ['sales_channel'] : []),
        ...(hasBonusReferrer ? ['bonus_referrer_customer_id'] : []),
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
        orderNotes || null,
        now, // created_at - use SQLite datetime format
        now, // updated_at - use SQLite datetime format
        ...(hasOrderUuid ? [orderData.order_uuid || null] : []),
        ...(hasDeviceId ? [orderData.device_id || null] : []),
        ...(hasPriceTierId ? [orderData.price_tier_id || null] : []),
        ...(hasOrderCurrency ? [saleCurrency] : []),
        ...(hasOrderFxRate ? [saleCurrency === 'USD' ? saleFxRate : null] : []),
        ...(hasOrderTotalUsd ? [totalUsdSnapshot] : []),
        ...(hasSalesChannel ? [salesChannel] : []),
        ...(hasBonusReferrer ? [orderData.bonus_referrer_customer_id || null] : []),
      ];
      this.db
        .prepare(`INSERT INTO orders (${orderCols.join(', ')}) VALUES (${orderCols.map(() => '?').join(', ')})`)
        .run(...orderVals);

      if (freeSaleReasonRaw) {
        try {
          const hasAudit = this.db
            .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='audit_log'`)
            .get();
          if (hasAudit) {
            this.db
              .prepare(
                `INSERT INTO audit_log (
                  id, user_id, action, entity_type, entity_id,
                  old_values, new_values, ip_address, user_agent, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                randomUUID(),
                orderData.user_id || null,
                'free_sale',
                'order',
                orderId,
                null,
                JSON.stringify({
                  order_number: orderNumber,
                  reason: freeSaleReasonRaw,
                  total_amount: orderData.total_amount || 0,
                }),
                null,
                null,
                new Date().toISOString(),
              );
          }
        } catch (err) {
          console.warn('[SALES] free_sale audit log failed:', err?.message || err);
        }
      }

      // Runtime guard: Verify order exists before inserting children
      const orderExists = this.db.prepare('SELECT 1 FROM orders WHERE id = ?').get(orderId);
      if (!orderExists) {
        console.error('FK Guard Failed: Order not found after insert', { orderId, orderNumber, payload: orderData });
        throw createError(ERROR_CODES.VALIDATION_ERROR, 
          `Order ${orderId} was not created successfully. Cannot insert order_items.`);
      }

      this._allocateOrderDiscountOntoItems(itemsData, Number(orderData.discount_amount || 0) || 0);

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
          
          const canGoNegative = this.inventoryService?.isNegativeStockAllowed?.() ?? false;
          
          if (!canGoNegative && qtyBase > available) {
            throw createError(ERROR_CODES.INSUFFICIENT_STOCK, 
              `Insufficient stock for ${product.name}. Available: ${available}, Requested: ${qtyBase}`,
              {
                productId: product.id,
                productName: product.name,
                available,
                requested: qtyBase,
                available_stock: available,
                requested_qty: qtyBase,
                product_name: product.name,
              });
          }
        }

        const itemId = randomUUID();
        const saleUnit = itemData.sale_unit ?? product.unit ?? product.base_unit ?? null;
        const unitForPrice = saleUnit ?? product.base_unit ?? product.unit ?? 'pcs';
        const manualOverride = this._isManualPriceOverride(itemData);

        if (manualOverride && !canManualOverride) {
          throw createError(ERROR_CODES.FORBIDDEN, 'Manual price override is not allowed for this role');
        }

        const resolvedUnitPrice = this._resolveCatalogUnitPrice(product, {
          saleUnit: unitForPrice,
          tierCode,
          explicitUnitPrice: itemData.unit_price,
          manualOverride,
        });
        let unitPrice = Number(resolvedUnitPrice || 0) || 0;
        if (unitPrice <= 0 && qtySale !== 0) {
          const inferredLine =
            itemData.final_total != null && Number.isFinite(Number(itemData.final_total))
              ? Number(itemData.final_total)
              : itemData.line_total != null && Number.isFinite(Number(itemData.line_total))
                ? Number(itemData.line_total)
                : null;
          if (inferredLine != null) {
            const inferredUnit = inferredLine / qtySale;
            if (Number.isFinite(inferredUnit) && inferredUnit > 0) {
              unitPrice = inferredUnit;
            }
          }
        }

        // P0: block free/zero-price sale unless product allows free sale + cashier reason.
        if (unitPrice <= 0 && qtySale !== 0) {
          const catalogSellable = isProductSalePriceSellable(product);
          const freeAllowed = isProductFreeSaleAllowed(product);
          const freeReason = String(
            itemData.free_sale_reason ||
              orderData.free_sale_reason ||
              orderData.notes ||
              '',
          ).trim();
          const looksFreeReason =
            freeReason.length > 0 &&
            (/\[FREE_SALE\]/i.test(freeReason) ||
              Boolean(itemData.free_sale_reason) ||
              Boolean(orderData.free_sale_reason));
          if (!catalogSellable || !freeAllowed || !looksFreeReason) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              `Zero-price sale blocked for ${product.name || product.sku || product.id}`,
              {
                code: 'ZERO_PRICE_BLOCKED',
                productId: product.id,
                productName: product.name,
                sku: product.sku,
              },
            );
          }
        }
        const priceTier = itemData.price_tier || tierCode || 'retail';
        const discountAmount = Number(itemData.discount_amount || 0) || 0;
        const grossLine = unitPrice * qtySale;
        const lineTotal =
          itemData.final_total != null && Number.isFinite(Number(itemData.final_total))
            ? Number(itemData.final_total)
            : itemData.line_total != null && Number.isFinite(Number(itemData.line_total))
              ? Number(itemData.line_total)
              : grossLine - discountAmount;
        const effectiveDiscount = Math.max(0, grossLine - lineTotal);

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
        const priceSource = manualOverride
          ? 'manual'
          : itemData.price_source ??
            (priceTier === 'master' ? 'usta' : priceTier === 'retail' ? 'base' : 'tier');

        if (qtySale !== 0 && effectiveDiscount > 0 && maxDiscountPercent > 0) {
          const denom = Math.abs(unitPrice * qtySale);
          const pct = denom > 0 ? (effectiveDiscount / denom) * 100 : 0;
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
        const hasLineProfit = this._hasOrderItemCol('line_profit');
        const hasPromotionId = this._hasOrderItemCol('promotion_id');

        // Batch mode: allocate FIFO batches BEFORE insert so cost_price can be frozen correctly.
        if (batchActive && this.batchService && product.track_stock && qtyBase > 0) {
          this.batchService.allocateFIFOWithFallback(itemId, product.id, warehouseId, qtyBase);
        }

        const unitCost =
          hasCostPrice && this.costService && qtyBase > 0
            ? this.costService.resolveCostForSale(product.id, qtyBase, warehouseId, itemId)
            : 0;
        const signedQty = Number(qtyBase || qtySale || 0);
        const lineProfit = lineTotal - (Number(unitCost) || 0) * signedQty;
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
          ...(hasLineProfit ? ['line_profit'] : []),
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
          effectiveDiscount,
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
          ...(hasLineProfit ? [lineProfit] : []),
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

        if (this.promotionService && itemData.promotion_id && effectiveDiscount > 0) {
          this.promotionService.recordUsage(itemData.promotion_id, orderId, itemId, effectiveDiscount);
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
      this._refreshOrderItemLineProfits(orderId);

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

        totalPaid += amountInSaleCurrency(payment);

        const paymentId = randomUUID();
        const paymentNumber = payment.payment_number || `PAY-${Date.now()}-${payments.length}`;
        const paymentAmountStored = amountInSaleCurrency(payment);

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
          paymentAmountStored,
          payment.reference_number || null,
          payment.notes || null,
          now, // ✅ Already normalized to SQLite format
          now  // ✅ Already normalized to SQLite format
        );

        payments.push({ id: paymentId, payment_number: paymentNumber, ...payment });
        this._recordPaymentFee(paymentId, order, paymentMethod, paymentAmountStored, now);

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
      const orderTotalAfterRecalc = Number(order.total_amount || 0);
      const clientDeclaredTotal = Number(orderData.total_amount || 0);
      const finalCreditAmount = computeSaleCreditAmount(
        orderTotalAfterRecalc,
        finalTotalPaid,
        prepaidApplied,
        payEps
      );
      assertCreditAmountAligned(
        orderTotalAfterRecalc,
        finalTotalPaid,
        finalCreditAmount,
        prepaidApplied,
        payEps
      );
      if (creditAmount > payEps && Math.abs(finalCreditAmount - creditAmount) > payEps) {
        console.warn('[SALE] Credit amount adjusted after order total recalculation:', {
          client_declared_total: clientDeclaredTotal,
          recalculated_total: orderTotalAfterRecalc,
          credit_from_client: creditAmount,
          credit_authoritative: finalCreditAmount,
          paid: finalTotalPaid,
          prepaid: prepaidApplied,
        });
      }
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
          const mixedIntake = intakePayments.length > 1;
          if (bal0 < 0) {
            debtPaidFromOverpay = rawOverpay;
            changeAmount = 0;
          } else if (applyOverpayAsPrepaid || mixedIntake) {
            // POS: savatdan oshiq to‘lov naqd qaytim emas, mijoz avansi
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

      const dueDate = this._resolveOrderDueDate(orderData, paymentStatus, finalCreditAmount);
      const reminderNote = this._resolveOrderReminderNote(orderData, paymentStatus, finalCreditAmount);
      const completeSet = [
        'status = ?',
        'payment_status = ?',
        'paid_amount = ?',
        'change_amount = ?',
        'credit_amount = ?',
        'updated_at = ?',
      ];
      const completeVals = [
        'completed',
        paymentStatus,
        finalTotalPaid,
        changeAmount,
        finalCreditAmount,
        now,
      ];
      if (this._hasOrderCol('due_date')) {
        completeSet.push('due_date = ?');
        completeVals.push(dueDate);
      }
      if (this._hasOrderCol('credit_reminder_note')) {
        completeSet.push('credit_reminder_note = ?');
        completeVals.push(reminderNote);
      }
      completeVals.push(orderId);
      this.db
        .prepare(`UPDATE orders SET ${completeSet.join(', ')} WHERE id = ?`)
        .run(...completeVals);

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
        const hasFinCurrency = this._hasOrderCol('currency');
        const hasFinFxRate = this._hasOrderCol('fx_rate');
        const finCols = ['total_amount'];
        if (hasFinCurrency) finCols.unshift('currency');
        if (hasFinFxRate) {
          const curIdx = finCols.indexOf('currency');
          if (curIdx >= 0) finCols.splice(curIdx + 1, 0, 'fx_rate');
          else finCols.unshift('fx_rate');
        }
        const orderFin = this.db
          .prepare(`SELECT ${finCols.join(', ')} FROM orders WHERE id = ?`)
          .get(orderId);
        const saleCurrency = normalizeCustomerCurrency(hasFinCurrency ? orderFin?.currency : 'UZS');
        const currentBalance = readBalanceInCurrency(this.db, orderData.customer_id, saleCurrency);
        const bucketsBeforeSale = readCustomerDebtAdvance(this.db, orderData.customer_id, saleCurrency);
        const curLabel = saleCurrency === 'USD' ? 'USD' : "so'm";
        // Optional atomic prior-debt close folded into this sale TX (POS nasiya).
        let priorDebtPayment = 0;
        if (orderData.prior_debt_payment != null && orderData.prior_debt_payment !== '') {
          const priorParsed = parseNonNegativeMoneyAmount(orderData.prior_debt_payment);
          if (!priorParsed.ok) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, priorParsed.error);
          }
          priorDebtPayment = priorParsed.amount;
        }
        // Almashuv: jami manfiy — faqat refund_balance to‘lovida balansga yoziladi (naqd refund_cash emas).
        let refundDebtReduction = 0;
        let refundMagForBalance = 0;
        const hasRefundBalancePayout = payoutPayments.some((p) =>
          isRefundBalancePayout(p.payment_method)
        );
        if (orderTotalAfterRecalc < -payEps && hasRefundBalancePayout) {
          const refundMag = Math.abs(orderTotalAfterRecalc);
          const debtMag = Math.max(0, -currentBalance);
          refundDebtReduction = Math.min(refundMag, debtMag);
          refundMagForBalance = refundMag;
        }
        const balanceCreditIn =
          Number(debtPaidFromOverpay || 0) +
          Number(refundMagForBalance || 0) +
          Number(priorDebtPayment || 0);
        const prepaidConsumed = Math.max(0, Number(orderData.prepaid_applied || 0) || 0);
        const balanceDelta = -finalCreditAmount + balanceCreditIn - prepaidConsumed;
        const salesStatUzs = orderSalesStatUzs(orderFin);
        const paymentAlloc = allocatePaymentInToDebtAndAdvance(
          currentBalance,
          Number(debtPaidFromOverpay || 0) + Number(priorDebtPayment || 0)
        );

        console.log('💰 Updating customer stats:', {
          customer_id: orderData.customer_id,
          sale_currency: saleCurrency,
          current_balance: currentBalance,
          creditAmount: finalCreditAmount,
          prepaid_consumed: prepaidConsumed,
          debtPaidFromOverpay,
          prior_debt_payment: priorDebtPayment,
          debt_portion: paymentAlloc.debt_portion,
          advance_portion: paymentAlloc.advance_portion,
          refundDebtReduction,
          refundMagForBalance,
          balance_delta: balanceDelta,
          order_total: order.total_amount,
          client_declared_total: clientDeclaredTotal,
          merchandise_total_for_overpay: merchandiseTotalForOverpay,
          paid_amount: finalTotalPaid,
          is_credit_sale: finalCreditAmount > 0,
        });

        if (!hasCustomerLedgerRef(this.db, orderId)) {
        this.db
          .prepare(
            `
            UPDATE customers 
            SET total_sales = total_sales + ?,
                total_orders = total_orders + 1,
                last_order_date = ?,
                updated_at = ?
            WHERE id = ?
          `
          )
          .run(salesStatUzs, now, now, orderData.customer_id);

        this._assertCustomerCreditAllowed(
          orderData.customer_id,
          finalCreditAmount,
          saleCurrency,
          { excludeOrderId: orderId }
        );

        const inboundCash = Number(debtPaidFromOverpay || 0) + Number(priorDebtPayment || 0);
        if (prepaidConsumed > payEps) {
          const b = readCustomerDebtAdvance(this.db, orderData.customer_id, saleCurrency);
          writeDebtAdvanceNet(
            this.db,
            orderData.customer_id,
            saleCurrency,
            b.debt,
            roundCustomerMoney(Math.max(0, b.advance - prepaidConsumed)),
            now
          );
          insertPaymentAllocation(this.db, {
            payment_id: orderId,
            customer_id: orderData.customer_id,
            order_id: orderId,
            applied_amount: prepaidConsumed,
            order_balance_before: roundCustomerMoney(finalCreditAmount + prepaidConsumed),
            order_balance_after: finalCreditAmount,
            remainder_to_advance: 0,
            currency: saleCurrency,
            created_at: now,
            created_by: orderData.cashier_id || orderData.user_id || null,
            payment_method: 'advance',
            allocation_type: 'advance_used',
          });
        }
        if (inboundCash > payEps) {
          const inboundAlloc = allocateInboundToOpenOrders(this.db, {
            customerId: orderData.customer_id,
            paymentId: orderId,
            amount: inboundCash,
            currency: saleCurrency,
            createdAt: now,
            createdBy: orderData.cashier_id || orderData.user_id || null,
            paymentMethod: 'cash',
          });
          if (inboundAlloc.remainder > payEps) {
            const b = readCustomerDebtAdvance(this.db, orderData.customer_id, saleCurrency);
            writeDebtAdvanceNet(
              this.db,
              orderData.customer_id,
              saleCurrency,
              b.debt,
              roundCustomerMoney(b.advance + inboundAlloc.remainder),
              now
            );
          }
        }
        if (refundMagForBalance > payEps) {
          applyCustomerBalanceDeltaOnce(
            this.db,
            orderData.customer_id,
            refundMagForBalance,
            saleCurrency,
            `${orderId}:refund`,
            now
          );
        }
        // Credit increases debt_uzs without consuming advance (dual buckets).
        // applyCustomerBalanceDelta(-credit) would wrongly eat ortiqcha first.
        // Prepaid / inbound overpay / refund paths above already adjusted buckets.
        if (finalCreditAmount > payEps) {
          const b = readCustomerDebtAdvance(this.db, orderData.customer_id, saleCurrency);
          writeDebtAdvanceNet(
            this.db,
            orderData.customer_id,
            saleCurrency,
            roundCustomerMoney(b.debt + finalCreditAmount),
            b.advance,
            now
          );
        }
        const posSale = computeCustomerPosition(this.db, orderData.customer_id, saleCurrency);
        writeDebtAdvanceNet(
          this.db,
          orderData.customer_id,
          saleCurrency,
          posSale.total_debt,
          posSale.advance,
          now
        );
        // Sale TX (not list/getById): if ortiqcha fully covers new open nasiya, apply it now.
        let posAfterSale = posSale;
        if (
          Number(posSale.advance || 0) > 0.009 &&
          Number(posSale.open_order_debt || 0) > 0.009 &&
          Number(posSale.advance || 0) + 0.01 >= Number(posSale.open_order_debt || 0)
        ) {
          try {
            const settled = settleAdvanceAgainstOpenDebt(this.db, orderData.customer_id, saleCurrency, {
              createdAt: now,
              createdBy: orderData.cashier_id || orderData.user_id || null,
              refNo: order.order_number || orderId,
              note: `Sotuv — ortiqcha ochiq nasiyaga qo‘llandi: ${order.order_number || orderId}`,
            });
            if ((settled.applied_to_orders || 0) > 0.009) {
              posAfterSale = computeCustomerPosition(this.db, orderData.customer_id, saleCurrency);
              writeDebtAdvanceNet(
                this.db,
                orderData.customer_id,
                saleCurrency,
                posAfterSale.total_debt,
                posAfterSale.advance,
                now
              );
            }
          } catch (settleSaleErr) {
            console.warn(
              '[SALE] settleAdvanceAgainstOpenDebt skipped:',
              settleSaleErr?.message || settleSaleErr
            );
          }
        }
        const bucketsSale = readCustomerDebtAdvance(this.db, orderData.customer_id, saleCurrency);
        void posAfterSale;

        const balancesAfter = readCustomerBalances(this.db, orderData.customer_id);
        const newBalance = readBalanceInCurrency(this.db, orderData.customer_id, saleCurrency);

        // Insert ledger entries for sale and, when applicable, the part of cash that closes prior debt.
        try {
          const tableExists = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='customer_ledger'
          `).get();

          if (tableExists) {
            const ledgerCols = this.db.prepare(`PRAGMA table_info(customer_ledger)`).all().map((c) => c.name);
            const hasLedgerMethod = ledgerCols.includes('method');
            const hasLedgerCur = hasCustomerLedgerCurrency(this.db);
            const hasLedgerBalUsd = ledgerCols.includes('balance_after_usd');
            const insertLedger = (entry) => {
              const cols = [
                'id',
                'customer_id',
                'type',
                'ref_id',
                'ref_no',
                'amount',
                'balance_after',
                'note',
              ];
              const values = [
                entry.id,
                orderData.customer_id,
                entry.type,
                orderId,
                order.order_number,
                entry.amount,
                entry.balance_after,
                entry.note,
              ];
              if (hasLedgerCur) {
                cols.push('currency');
                values.push(saleCurrency);
              }
              if (hasLedgerBalUsd) {
                cols.push('balance_after_usd');
                values.push(balancesAfter.usd);
              }
              if (hasLedgerMethod) {
                cols.push('method');
                values.push(entry.method || null);
              }
              appendLedgerAuditCols(this.db, cols, values, {
                op_code: entry.op_code || null,
                debt_before: entry.debt_before,
                debt_after: entry.debt_after,
                advance_before: entry.advance_before,
                advance_after: entry.advance_after,
              });
              cols.push('created_at', 'created_by');
              values.push(ledgerEventAt, orderData.cashier_id || orderData.user_id || null);
              const placeholders = cols.map(() => '?').join(', ');
              this.db
                .prepare(`INSERT INTO customer_ledger (${cols.join(', ')}) VALUES (${placeholders})`)
                .run(...values);
            };

            const ledgerId = randomUUID();
            const ledgerAmount =
              finalCreditAmount > 0
                ? -finalCreditAmount
                : refundMagForBalance > 0
                  ? refundMagForBalance
                  : Number(finalTotalPaid || order.total_amount || 0);
            const ledgerType =
              finalCreditAmount > 0 ? 'sale' : refundMagForBalance > 0 ? 'refund' : 'sale';
            const ledgerSurplus =
              refundMagForBalance > refundDebtReduction ? refundMagForBalance - refundDebtReduction : 0;
            const methodLabels = { cash: 'Naqd', card: 'Karta', qr: 'QR' };
            const payMethodsLabel = (intakePayments || [])
              .map((p) => {
                const slug = String(p.payment_method || '').toLowerCase();
                const label = methodLabels[slug] || slug;
                const amt = Math.round(amountInSaleCurrency(p));
                return `${label} ${amt}`;
              })
              .filter((s) => s.trim())
              .join(' + ');
            const discAmt = Number(order.discount_amount || orderData.discount_amount || 0) || 0;
            const saleTotal = Number(order.total_amount || orderData.total_amount || 0);
            const ledgerNote =
              finalCreditAmount > 0
                ? `Sotuv: ${order.order_number} (Jami ${saleTotal} ${curLabel}; to‘lov ${finalTotalPaid}; nasiya ${finalCreditAmount}; avans ${prepaidConsumed}; chegirma ${discAmt})`
                : refundMagForBalance > 0
                  ? ledgerSurplus > 0 && refundDebtReduction > 0
                    ? `POS almashuv / qaytim: ${order.order_number} (jami ${refundMagForBalance} ${curLabel} — qarz ${refundDebtReduction}; haqdor ${ledgerSurplus})`
                    : `POS almashuv / qaytim: ${order.order_number} (${refundMagForBalance} ${curLabel})`
                  : `Sotuv: ${order.order_number} (Jami ${saleTotal} ${curLabel}; to‘lov ${finalTotalPaid}; usul: ${payMethodsLabel || '—'}; chegirma ${discAmt}; avans ${prepaidConsumed})`;
            const inboundPayTotal =
              Number(debtPaidFromOverpay || 0) + Number(priorDebtPayment || 0);
            const saleBalanceAfter =
              inboundPayTotal > 0 ? newBalance - inboundPayTotal : newBalance;
            const saleOpCode =
              finalCreditAmount > 0
                ? CUSTOMER_OP.CREDIT_SALE
                : refundMagForBalance > 0
                  ? CUSTOMER_OP.SALE_RETURN
                  : CUSTOMER_OP.SALE_PAYMENT;

            insertLedger({
              id: ledgerId,
              type: ledgerType,
              amount: ledgerAmount,
              balance_after: saleBalanceAfter,
              note: ledgerNote,
              method: hasRefundBalancePayout
                ? 'refund_balance'
                : payMethodsLabel || null,
              op_code: saleOpCode,
              debt_before: bucketsBeforeSale.debt,
              debt_after: posSale.total_debt,
              advance_before: bucketsBeforeSale.advance,
              advance_after: bucketsSale.advance,
            });
            console.log('✅ Ledger entry inserted for sale:', {
              customerId: orderData.customer_id,
              amount: ledgerAmount,
              type: ledgerType,
              balanceAfter: saleBalanceAfter,
            });

            let balCursor = currentBalance;
            const payMethod =
              validPayments.find((p) => Number(p.amount) > 0)?.payment_method || null;

            if (priorDebtPayment > payEps) {
              const priorAlloc = allocatePaymentInToDebtAndAdvance(balCursor, priorDebtPayment);
              balCursor = priorAlloc.new_balance;
              insertLedger({
                id: randomUUID(),
                type: 'payment_in',
                amount: priorDebtPayment,
                balance_after: balCursor,
                note: `Oldingi qarz to'lovi (nasiya): ${order.order_number} (qarz: ${priorAlloc.debt_portion}; oldindan: ${priorAlloc.advance_portion} ${curLabel})`,
                method: payMethod || 'cash',
                op_code:
                  priorAlloc.debt_portion > 0.009
                    ? CUSTOMER_OP.DEBT_PAYMENT_RECEIVED
                    : CUSTOMER_OP.ADVANCE_RECEIVED,
                debt_before: bucketsBeforeSale.debt,
                debt_after: Math.max(0, Number(bucketsBeforeSale.debt || 0) - Number(priorAlloc.debt_portion || 0)),
                advance_before: bucketsBeforeSale.advance,
                advance_after: Number(bucketsBeforeSale.advance || 0) + Number(priorAlloc.advance_portion || 0),
              });
            }

            if (debtPaidFromOverpay > payEps) {
              const overAlloc = allocatePaymentInToDebtAndAdvance(balCursor, debtPaidFromOverpay);
              balCursor = overAlloc.new_balance;
              insertLedger({
                id: randomUUID(),
                type: 'payment_in',
                amount: debtPaidFromOverpay,
                balance_after: newBalance,
                note: `To'lovdan hisobga: ${order.order_number} (qarz: ${overAlloc.debt_portion}; oldindan: ${overAlloc.advance_portion} ${curLabel})`,
                method: payMethod,
                op_code:
                  overAlloc.debt_portion > 0.009
                    ? CUSTOMER_OP.DEBT_PAYMENT_RECEIVED
                    : CUSTOMER_OP.ADVANCE_RECEIVED,
                debt_before: bucketsBeforeSale.debt,
                debt_after: posSale.total_debt,
                advance_before: bucketsBeforeSale.advance,
                advance_after: bucketsSale.advance,
              });
              console.log('✅ Ledger entry inserted for prior debt / overpay:', {
                customerId: orderData.customer_id,
                amount: debtPaidFromOverpay,
                balanceAfter: newBalance,
                debt_portion: overAlloc.debt_portion,
                advance_portion: overAlloc.advance_portion,
              });
            }
          }
        } catch (ledgerError) {
          console.error('❌ Failed to insert ledger entry for sale (critical, rolling back):', ledgerError.message);
          throw createError(
            ERROR_CODES.DB_ERROR,
            `Failed to record customer ledger for sale: ${ledgerError.message || ledgerError}`
          );
        }

        // Shift expected cash uses customer_payments (not ledger). Fold prior-debt
        // cash into the same sale TX so drawer rollup matches cash collected.
        if (priorDebtPayment > payEps) {
          const custSvc = this.customers;
          if (!custSvc || typeof custSvc.recordDrawerPaymentOnly !== 'function') {
            throw createError(
              ERROR_CODES.DB_ERROR,
              'Customers service unavailable for prior debt drawer payment'
            );
          }
          try {
            const priorDrawer = custSvc.recordDrawerPaymentOnly({
              customerId: orderData.customer_id,
              amount: priorDebtPayment,
              // POS prior-debt collection is physical cash for the drawer.
              paymentMethod: 'cash',
              notes: `Oldingi qarz to'lovi (nasiya): ${order.order_number}`,
              receivedBy: orderData.cashier_id || orderData.user_id || null,
              orderId,
              shiftId: orderData.shift_id || null,
              oldBalance: currentBalance,
              newBalance: currentBalance + priorDebtPayment,
              operation: 'payment_in',
              paidAt: now,
            });
            console.log('✅ Prior debt customer_payments row for shift drawer:', {
              customerId: orderData.customer_id,
              amount: priorDebtPayment,
              payment_id: priorDrawer.payment_id,
              shift_id: priorDrawer.shift_id,
            });
          } catch (drawerPayErr) {
            console.error(
              '❌ Failed to record prior debt drawer payment (critical, rolling back):',
              drawerPayErr.message || drawerPayErr
            );
            throw createError(
              ERROR_CODES.DB_ERROR,
              `Failed to record prior debt cash for shift: ${drawerPayErr.message || drawerPayErr}`
            );
          }
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
        
        // Verify update
        const customerAfter = this.db.prepare('SELECT balance FROM customers WHERE id = ?').get(orderData.customer_id);
        console.log('✅ Customer stats updated:', {
          before: currentBalance,
          after: customerAfter?.balance,
          expected: newBalance,
          match: customerAfter?.balance === newBalance
        });
        } else {
          console.log('🛡️ Customer sale ledger already recorded for order — skipping balance/stats replay:', orderId);
        }
      } else if (finalCreditAmount > 0 && !orderData.customer_id) {
        console.error('❌ CRITICAL: Credit amount > 0 but no customer_id - this should have been caught in validation!');
      }

      // Loyalty earn — idempotent; usta/referrer uses order total (credit counts).
      this._accrueCustomerLoyalty({
        customerId: orderData.customer_id,
        bonusReferrerCustomerId: orderData.bonus_referrer_customer_id || null,
        paidAmount: Math.max(0, finalTotalPaid - (debtPaidFromOverpay || 0)),
        orderTotalAmount: order.total_amount,
        orderId,
        orderNumber: order.order_number,
        createdBy: orderData.cashier_id || orderData.user_id || null,
        now,
        skipWalkInCustomerId: KNOWN_DEFAULT_CUSTOMER,
      });

      // Return order details (include customer new_balance when credit sale happened)
      let new_balance;
      let balanceNotifyDelta = 0;
      let balanceNotifyCurrency = 'UZS';
      if (orderData.customer_id) {
        try {
          const hasFinCurrency = this._hasOrderCol('currency');
          const orderFinCur = this.db
            .prepare(
              `SELECT ${hasFinCurrency ? 'currency, ' : ''}total_amount FROM orders WHERE id = ?`,
            )
            .get(orderId);
          balanceNotifyCurrency = normalizeCustomerCurrency(
            hasFinCurrency ? orderFinCur?.currency : 'UZS',
          );
          const customerAfter = this.db
            .prepare(
              `SELECT balance${hasCustomerBalanceUsd(this.db) ? ', balance_usd' : ''} FROM customers WHERE id = ?`,
            )
            .get(orderData.customer_id);
          if (customerAfter) {
            new_balance =
              balanceNotifyCurrency === 'USD' && customerAfter.balance_usd != null
                ? Number(customerAfter.balance_usd) || 0
                : Number(customerAfter.balance) || 0;
          }
          // Recompute delta for notify (same formula as ledger path)
          const balanceCreditIn =
            Number(debtPaidFromOverpay || 0) +
            (orderTotalAfterRecalc < -payEps &&
            payoutPayments.some((p) => isRefundBalancePayout(p.payment_method))
              ? Math.abs(orderTotalAfterRecalc)
              : 0);
          const prepaidConsumed = Math.max(0, Number(orderData.prepaid_applied || 0) || 0);
          balanceNotifyDelta = -finalCreditAmount + balanceCreditIn - prepaidConsumed;
        } catch (_e) {
          // ignore
        }
      }

      return {
        order_id: orderId,
        order_number: orderNumber,
        customer_id: orderData.customer_id || null,
        balance_delta: balanceNotifyDelta,
        currency: balanceNotifyCurrency,
        ...(new_balance !== undefined ? { new_balance } : {}),
        credit_amount: typeof finalCreditAmount === 'number' ? finalCreditAmount : 0,
      };
    });

    // Idempotency safety net (POS checkout double-submit / 429 retry).
    //
    // The client binds a single `order_uuid` to a checkout session and reuses
    // it across retries (slow response / HTTP 429). The fast path above already
    // returns the existing order when that uuid is found before the
    // transaction. This catch closes the remaining race window: if two
    // requests with the same uuid run concurrently, the UNIQUE index on
    // orders.order_uuid makes the second INSERT fail and rolls back its ENTIRE
    // transaction — so stock is decremented exactly once. We resolve that race
    // by returning the already-committed order instead of surfacing a confusing
    // duplicate-key error to the cashier.
    try {
      const saleResult = __runSaleTx.immediate();
      this._notifyCreditSaleReport(saleResult);
      this._notifyBalanceChangeFromSale(saleResult);
      return saleResult;
    } catch (txErr) {
      const msg = String(txErr && txErr.message ? txErr.message : txErr);
      if (
        hasOrderUuid &&
        orderData.order_uuid &&
        /UNIQUE constraint failed:\s*orders\.order_uuid/i.test(msg)
      ) {
        const existing = this.db
          .prepare('SELECT id FROM orders WHERE order_uuid = ?')
          .get(orderData.order_uuid);
        if (existing && existing.id) {
          const existingOrder = this._getOrderWithDetails(existing.id);
          console.warn(
            '🛡️ Concurrent duplicate order_uuid resolved post-insert — returning existing order:',
            { order_uuid: orderData.order_uuid, existing_order_id: existing.id }
          );
          return {
            order_id: existing.id,
            order_number: existingOrder ? existingOrder.order_number : null,
          };
        }
      }
      throw txErr;
    }
  }

  /**
   * Reverse stock + customer ledger for a completed order before POS re-sale (order amend).
   * Delegates to ReturnsService.createReturn (full remaining qty) so inventory_movements
   * and customer_ledger stay consistent — avoids double stock decrement / double debt.
   */
  _bumpSqliteDatetime(sqliteNow, deltaSeconds = 1) {
    const raw = String(sqliteNow || '').trim();
    if (!raw) return raw;
    const d = new Date(raw.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return raw;
    d.setSeconds(d.getSeconds() + deltaSeconds);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  }

  _reverseOrderForAmend(replacesOrderId, { userId, now }) {
    if (!this.returnsService || typeof this.returnsService.createReturn !== 'function') {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        'ReturnsService is not wired into SalesService; cannot amend order',
      );
    }

    const KNOWN_DEFAULT_CUSTOMER = 'default-customer-001';
    const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(replacesOrderId);
    if (!order) {
      throw createError(ERROR_CODES.NOT_FOUND, `Order ${replacesOrderId} not found`);
    }

    const status = String(order.status || '').toLowerCase().trim();
    if (status === 'amended' || status === 'voided' || status === 'refunded' || status === 'returned') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Order ${replacesOrderId} cannot be amended (status: ${status})`,
      );
    }
    // Hold/draft orders were never finalized — no stock or ledger to reverse.
    // Void the draft so POS checkout can create a fresh completed sale.
    if (status === 'hold' || status === 'pending' || status === 'on_hold' || status === 'draft') {
      this.db
        .prepare("UPDATE orders SET status = 'voided', updated_at = ? WHERE id = ?")
        .run(now, replacesOrderId);
      return;
    }
    if (status !== 'completed') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Only completed orders can be amended (status: ${status})`,
      );
    }

    const rows = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(replacesOrderId);
    const lineItems = [];
    for (const r of rows) {
      const sold = Number(r.qty_sale ?? r.quantity ?? 0);
      let already = Number(r.returned_quantity || 0);
      if (typeof this.returnsService._sumCompletedReturnedQtyForOrderItem === 'function') {
        already = Math.max(already, this.returnsService._sumCompletedReturnedQtyForOrderItem(r.id));
      }
      const remaining = sold - already;
      if (remaining > 0) {
        lineItems.push({ order_item_id: r.id, quantity: remaining });
      }
    }

    if (lineItems.length === 0) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Order has no remaining items to amend (already fully returned)',
      );
    }

    const creditOnOrder = Number(order.credit_amount || 0);
    const paidOnOrder = Number(order.paid_amount || 0);
    const totalOnOrder = Number(order.total_amount || 0);
    const ps = String(order.payment_status || '').toLowerCase();
    const outstandingOnOrder = Math.max(0, totalOnOrder - paidOnOrder);
    const orderHadUnpaidCredit =
      creditOnOrder > 0.009 || ps === 'on_credit' || outstandingOnOrder > 0.02;
    const refundMethod = orderHadUnpaidCredit ? 'customer_account' : 'cash';

    this.returnsService.createReturn({
      order_id: replacesOrderId,
      items: lineItems,
      return_reason: 'POS buyurtma tahriri (avvalgi sotuv bekor)',
      refund_method: refundMethod,
      user_id: userId,
      cashier_id: userId,
      created_at: now,
    });

    this._reverseLoyaltyForAmendedOrder(replacesOrderId, { userId, now });

    if (
      order.customer_id &&
      String(order.customer_id) !== KNOWN_DEFAULT_CUSTOMER &&
      orderHadUnpaidCredit &&
      paidOnOrder > 0.02
    ) {
      // createReturn(customer_account) credits full merchandise; naqd/qisman qismi allaqachon
      // kassada — balansga qayta yozilmasligi kerak (aks holda tahrirda qarz past bo‘lib qoladi).
      this.db
        .prepare(
          `UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        )
        .run(paidOnOrder, now, order.customer_id);
    }

    if (
      order.customer_id &&
      String(order.customer_id) !== KNOWN_DEFAULT_CUSTOMER
    ) {
      const salesStatUzs = orderSalesStatUzs(order);
      this.db
        .prepare(
          `
        UPDATE customers
        SET total_sales = COALESCE(total_sales, 0) - ?,
            total_orders = COALESCE(total_orders, 0) - 1,
            updated_at = ?
        WHERE id = ?
      `,
        )
        .run(salesStatUzs, now, order.customer_id);
    }

    this.db
      .prepare(`UPDATE orders SET status = 'amended', updated_at = ? WHERE id = ?`)
      .run(now, replacesOrderId);

    console.log('[SALE] Order amend reversal completed:', {
      replaces_order_id: replacesOrderId,
      items_reversed: lineItems.length,
      refund_method: refundMethod,
    });
  }

  async refundOrder(orderId, refundItems, userId = 'default-admin-001') {
    // AUDIT #5 + #15: route refunds through the canonical returns path so that
    // stock movements (inventory_movements + stock_moves via
    // InventoryService._updateBalance), customer balance/USD ledger, and shift
    // linkage stay consistent — instead of poking stock_balances directly and
    // skipping the ledger (which is what this method used to do, duplicating
    // returnsService incorrectly). Also rejects double-refunds.
    if (!this.returnsService || typeof this.returnsService.createReturn !== 'function') {
      throw createError(
        ERROR_CODES.INTERNAL_ERROR,
        'ReturnsService is not wired into SalesService; cannot process refund',
      );
    }

    return this.db.transaction(() => {
      // 1. Validate order
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw createError(ERROR_CODES.NOT_FOUND, 'Order not found');

      // 2. Idempotency / status guard (audit #15): never refund the same order
      // twice (would double-restock and double-reverse the customer balance).
      const status = String(order.status || '').toLowerCase().trim();
      if (status === 'refunded' || status === 'cancelled') {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Order ${orderId} is already ${status}; refund rejected`,
        );
      }

      // 3. Resolve refund lines -> [{ order_item_id, quantity }].
      // The frontend historically sent a non-array (e.g. the string
      // "Qaytarish"); in that case fall back to a full refund of all
      // not-yet-returned order lines.
      const lineItems = [];
      if (Array.isArray(refundItems) && refundItems.length > 0) {
        for (const it of refundItems) {
          if (!it || typeof it !== 'object') continue;
          const qty = Number(it.quantity ?? it.qty_sale ?? 0);
          if (!(qty > 0)) continue;
          let orderItemId = it.order_item_id || it.orderItemId || it.id || null;
          // Verify the id is actually an order_items.id for this order.
          const valid = orderItemId
            ? this.db
                .prepare('SELECT id FROM order_items WHERE id = ? AND order_id = ?')
                .get(orderItemId, orderId)
            : null;
          if (!valid) {
            const pid = it.product_id || it.id;
            const oi = pid
              ? this.db
                  .prepare('SELECT id FROM order_items WHERE order_id = ? AND product_id = ? LIMIT 1')
                  .get(orderId, pid)
              : null;
            orderItemId = oi?.id || null;
          }
          if (orderItemId) lineItems.push({ order_item_id: orderItemId, quantity: qty });
        }
      }

      if (lineItems.length === 0) {
        const rows = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
        for (const r of rows) {
          const sold = Number(r.qty_sale ?? r.quantity ?? 0);
          const already = Number(r.returned_quantity || 0);
          const remaining = sold - already;
          if (remaining > 0) lineItems.push({ order_item_id: r.id, quantity: remaining });
        }
      }

      if (lineItems.length === 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'No items found to refund.');
      }

      const paymentRows = this.db
        .prepare(
          `SELECT payment_method, amount FROM payments WHERE order_id = ? ORDER BY rowid ASC`,
        )
        .all(orderId);
      const creditPaid =
        paymentRows.some(
          (p) => String(p.payment_method || '').toLowerCase() === 'credit' && Number(p.amount || 0) > 0,
        ) ||
        Number(order.credit_amount || 0) > 0 ||
        String(order.payment_status || '').toLowerCase().includes('credit');
      const refundMethod = creditPaid ? 'credit' : 'cash';
      const mismatchReason =
        typeof refundItems === 'string' && refundItems.trim()
          ? refundItems.trim()
          : 'System refund via refundOrder';

      // 4. Delegate to the canonical returns flow (single, completed return).
      // This validates quantities, restocks via the inventory ledger, reverses
      // the customer balance/ledger when the order carried debt, and links the
      // order's shift — all atomically inside this transaction.
      const result = this.returnsService.createReturn({
        order_id: orderId,
        items: lineItems,
        return_reason: mismatchReason,
        refund_method: refundMethod,
        method_mismatch_reason:
          refundMethod === 'cash' && creditPaid ? mismatchReason : undefined,
        cashier_id: userId,
        user_id: userId,
      });

      // 5. Preserve the original contract: refundOrder marks the order refunded.
      this.db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(orderId);

      return { success: true, returnId: result.id };
    })();
  }

  /**
   * Distribute remaining order-level discount onto line final_total / discount_amount
   * so line_profit and soldLineRevenueSql stay aligned. Skips when lines already net of that discount.
   */
  _allocateOrderDiscountOntoItems(itemsData, orderDiscountAmount) {
    return allocateOrderDiscountOntoItems(itemsData, orderDiscountAmount);
  }

  _refreshOrderItemLineProfits(orderId) {
    if (!this._hasOrderItemCol('line_profit')) return;
    const hasFinalTotal = this._hasOrderItemCol('final_total');
    const hasCost = this._hasOrderItemCol('cost_price');
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const upd = this.db.prepare(
      hasFinalTotal
        ? `UPDATE order_items SET final_total = ?, line_profit = ? WHERE id = ?`
        : `UPDATE order_items SET line_profit = ? WHERE id = ?`
    );
    for (const item of items) {
      const qty = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
      const qtyBase = Number(item.qty_base ?? qty) || 0;
      const revenue =
        hasFinalTotal && Number(item.final_total || 0) !== 0
          ? Number(item.final_total)
          : Number(item.line_total || 0) !== 0
            ? Number(item.line_total)
            : Number(item.unit_price || 0) * qty - Number(item.discount_amount || 0);
      const cogs = hasCost ? (Number(item.cost_price || 0) || 0) * qtyBase : 0;
      const profit = revenue - cogs;
      const finalTotal = Number.isFinite(revenue) ? revenue : Number(item.line_total || 0);
      if (hasFinalTotal) upd.run(finalTotal, profit, item.id);
      else upd.run(profit, item.id);
    }
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

    const grossSubtotal = items.reduce((sum, item) => {
      const q = Number(item.qty_sale ?? item.quantity ?? 0);
      return sum + Number(item.unit_price || 0) * q;
    }, 0);
    const itemsDiscountSum = items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0);
    const sumLineTotal = items.reduce(
      (sum, item) => sum + Number(item.line_total ?? item.final_total ?? 0),
      0
    );

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

    // Net merchandise before tax (same as legacy: gross − effective discount).
    const netFromQtyPath = grossSubtotal - effectiveDiscountAmount;
    let netMerchandise = netFromQtyPath;
    const eps = 0.02;
    // Exchange / qaytarish: ba'zi qatorlarda `qty_sale` bilan tiklangan jami va `quantity` noto‘g‘ri
    // bo‘lishi mumkin — qator `line_total`lari manfiy bo‘lsa, lekin qty yo‘li ~0/musbat bo‘lsa,
    // `orders.total_amount` musbatga aylanadi va mijozga haqdorlik balansga tushmaydi.
    if (items.length && sumLineTotal < -eps && netFromQtyPath >= -eps) {
      netMerchandise = sumLineTotal;
    }

    // Get tax rate from settings
    const taxRateSetting = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('tax_rate');
    const taxRate = taxRateSetting ? parseFloat(taxRateSetting.value) : 0;
    const taxAmount = netMerchandise * taxRate;

    const totalAmount = netMerchandise + taxAmount;

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
   * List POS register orders (orders table only).
   */
  _listPosOrders(filters = {}) {
    const salesChannelCol = this._hasOrderCol('sales_channel')
      ? "COALESCE(o.sales_channel, 'pos')"
      : "'pos'";

    let query = `
      SELECT 
        o.*,
        ${salesChannelCol} AS sales_channel,
        'pos' AS order_source,
        COALESCE(c.name, 'Yangi mijoz') AS customer_name,
        c.phone AS customer_phone,
        u.username as cashier_name,
        u.full_name as cashier_full_name,
        COALESCE(GROUP_CONCAT(DISTINCT p.payment_method), '') as payment_methods,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN ABS(COALESCE(oi.quantity, 0)) < 1e-9 THEN 0
              ELSE ABS(COALESCE(
                oi.final_total,
                oi.line_total,
                (COALESCE(oi.unit_price, 0) * ABS(oi.quantity))
              )) * MIN(1.0, COALESCE(oi.returned_quantity, 0) / ABS(oi.quantity))
            END
          )
          FROM order_items oi WHERE oi.order_id = o.id
        ), 0) AS returned_total,
        COALESCE((
          SELECT CASE
            WHEN SUM(CASE WHEN ABS(COALESCE(oi.quantity, 0)) > 0 THEN 1 ELSE 0 END) = 0
              THEN 'not_returned'
            WHEN SUM(CASE WHEN COALESCE(oi.returned_quantity, 0) > 0 THEN 1 ELSE 0 END) = 0
              THEN 'not_returned'
            WHEN SUM(
              CASE
                WHEN ABS(COALESCE(oi.quantity, 0)) > 0
                  AND COALESCE(oi.returned_quantity, 0) + 1e-9 < ABS(oi.quantity)
                THEN 1 ELSE 0
              END
            ) = 0 THEN 'fully_returned'
            ELSE 'partially_returned'
          END
          FROM order_items oi WHERE oi.order_id = o.id
        ), 'not_returned') AS return_status
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON o.cashier_id = u.id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE 1=1
    `;
    const params = [];

    const orderDateExpr = `date(datetime(replace(replace(o.created_at, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
    if (filters.date_from) {
      const fromYmd = String(filters.date_from).substring(0, 10);
      query += ` AND ${orderDateExpr} >= date(?)`;
      params.push(fromYmd);
    }

    if (filters.date_to) {
      const toYmd = String(filters.date_to).substring(0, 10);
      query += ` AND ${orderDateExpr} <= date(?)`;
      params.push(toYmd);
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

    if (filters.sales_channel) {
      const ch = String(filters.sales_channel).trim().toLowerCase();
      if (ch === 'pos' || ch === 'staff_mobile') {
        if (this._hasOrderCol('sales_channel')) {
          query += ' AND o.sales_channel = ?';
          params.push(ch);
        } else if (ch === 'staff_mobile') {
          query += ' AND 1=0';
        }
      } else {
        query += ' AND 1=0';
      }
    }

    query += ' GROUP BY o.id';
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
      query += ' LIMIT 1000';
    }

    const rows = this.db.prepare(query).all(params);
    return rows.map((row) => {
      const gross = Math.max(0, Number(row.total_amount) || 0);
      const returned = Math.max(0, Number(row.returned_total) || 0);
      return {
        ...row,
        gross_total: gross,
        returned_total: Math.round(returned * 100) / 100,
        net_total: Math.round(Math.max(0, gross - returned) * 100) / 100,
        return_status: row.return_status || 'not_returned',
      };
    });
  }

  _listWebOrdersForUnified(filters = {}, fetchSize = 50) {
    if (!this._hasWebOrdersTable()) return [];

    const channelFilter = filters.sales_channel
      ? String(filters.sales_channel).trim().toLowerCase()
      : '';
    if (channelFilter === 'pos' || channelFilter === 'staff_mobile') return [];
    if (filters.customer_id || filters.warehouse_id || filters.cashier_id) return [];

    let where = '1=1';
    const params = [];

    const orderDateExpr = `date(datetime(replace(replace(wo.created_at, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
    if (filters.date_from) {
      where += ` AND ${orderDateExpr} >= date(?)`;
      params.push(String(filters.date_from).substring(0, 10));
    }
    if (filters.date_to) {
      where += ` AND ${orderDateExpr} <= date(?)`;
      params.push(String(filters.date_to).substring(0, 10));
    }
    if (filters.payment_status) {
      where += ' AND wo.payment_status = ?';
      params.push(filters.payment_status);
    }
    if (filters.payment_method) {
      where += ' AND wo.payment_method = ?';
      params.push(filters.payment_method);
    }
    if (filters.status) {
      const webStatuses = this._webStatusesForPosFilter(filters.status);
      if (Array.isArray(webStatuses) && webStatuses.length === 0) return [];
      if (webStatuses) {
        where += ` AND wo.status IN (${webStatuses.map(() => '?').join(', ')})`;
        params.push(...webStatuses);
      }
    }
    if (filters.search) {
      const term = `%${String(filters.search).trim()}%`;
      where += ` AND (wo.order_number LIKE ? OR COALESCE(mc.first_name, '') LIKE ? OR COALESCE(mc.last_name, '') LIKE ? OR COALESCE(mc.phone, '') LIKE ?)`;
      params.push(term, term, term, term);
    }
    if (channelFilter) {
      if (this._hasTableColumn('web_orders', 'sales_channel')) {
        where += ' AND wo.sales_channel = ?';
        params.push(channelFilter);
      }
    }

    const salesChannelCol = this._hasTableColumn('web_orders', 'sales_channel')
      ? 'wo.sales_channel'
      : "'telegram'";
    const discountCol = this._hasTableColumn('web_orders', 'discount_amount')
      ? 'COALESCE(wo.discount_amount, 0)'
      : '0';

    const rows = this.db
      .prepare(
        `
      SELECT
        ('web:' || wo.id) AS id,
        wo.id AS web_order_id,
        wo.order_number,
        wo.customer_id,
        wo.total_amount,
        wo.status,
        wo.payment_status,
        wo.payment_method,
        wo.created_at,
        wo.updated_at,
        ${salesChannelCol} AS sales_channel,
        'web' AS order_source,
        TRIM(COALESCE(mc.first_name, '') || ' ' || COALESCE(mc.last_name, '')) AS customer_name,
        mc.phone AS customer_phone,
        'Onlayn' AS cashier_name,
        wo.payment_method AS payment_methods,
        ${discountCol} AS discount_amount,
        0 AS subtotal,
        0 AS paid_amount,
        0 AS credit_amount,
        0 AS change_amount
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      WHERE ${where}
      ORDER BY datetime(wo.created_at) DESC
      LIMIT ?
    `,
      )
      .all(...params, fetchSize);

    return rows.map((row) => ({
      ...row,
      customer_name: String(row.customer_name || '').trim() || row.customer_phone || 'Onlayn mijoz',
    }));
  }

  _listUnifiedOrders(filters = {}) {
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 50;
    const offset = Number.isFinite(Number(filters.offset)) ? Number(filters.offset) : 0;
    const fetchSize = Math.min(5000, limit + offset);

    const posRows = this._listPosOrders({ ...filters, limit: fetchSize, offset: 0 });
    const webRows = this._listWebOrdersForUnified(filters, fetchSize);

    const sortByRaw = String(filters.sort_by || 'created_at').trim();
    const sortOrder = String(filters.sort_order || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
    const merged = [...posRows, ...webRows].sort((a, b) => {
      let cmp = 0;
      if (sortByRaw === 'total_amount') {
        cmp = Number(a.total_amount || 0) - Number(b.total_amount || 0);
      } else if (sortByRaw === 'order_number') {
        cmp = String(a.order_number || '').localeCompare(String(b.order_number || ''));
      } else {
        cmp = parseDbTimestamp(a.created_at) - parseDbTimestamp(b.created_at);
      }
      return cmp * sortOrder;
    });

    return merged.slice(offset, offset + limit);
  }

  _getWebOrderWithDetails(webOrderId) {
    if (!this._hasWebOrdersTable()) return null;
    const wid = Number.parseInt(String(webOrderId), 10);
    if (!Number.isFinite(wid)) return null;

    const wo = this.db
      .prepare(
        `
      SELECT wo.*, mc.first_name, mc.last_name, mc.phone
      FROM web_orders wo
      LEFT JOIN marketplace_customers mc ON mc.id = wo.customer_id
      WHERE wo.id = ?
    `,
      )
      .get(wid);
    if (!wo) return null;

    const items = this.db
      .prepare(
        `
      SELECT wi.id, wi.product_id, wi.quantity, wi.price_at_order AS unit_price,
             p.name AS product_name, p.sku AS product_sku,
             (wi.quantity * wi.price_at_order) AS line_total
      FROM web_order_items wi
      LEFT JOIN products p ON p.id = wi.product_id
      WHERE wi.order_id = ?
      ORDER BY wi.id ASC
    `,
      )
      .all(wid);

    const customerName = [wo.first_name, wo.last_name].filter(Boolean).join(' ').trim();
    const payments = wo.payment_method
      ? [
          {
            id: `web-pay-${wid}`,
            order_id: `web:${wid}`,
            payment_method: wo.payment_method,
            amount: Number(wo.total_amount || 0),
            payment_number: `WEB-${wid}`,
          },
        ]
      : [];

    return {
      id: `web:${wid}`,
      web_order_id: wid,
      order_source: 'web',
      order_number: wo.order_number,
      customer_id: wo.customer_id != null ? String(wo.customer_id) : null,
      cashier_id: '',
      shift_id: null,
      subtotal: Number(wo.total_amount || 0),
      discount_amount: Number(wo.discount_amount || 0),
      discount_percent: 0,
      tax_amount: 0,
      total_amount: Number(wo.total_amount || 0),
      paid_amount: wo.payment_status === 'paid' ? Number(wo.total_amount || 0) : 0,
      credit_amount: 0,
      change_amount: 0,
      status: wo.status,
      payment_status: wo.payment_status,
      notes: wo.note || null,
      created_at: wo.created_at,
      updated_at: wo.updated_at,
      sales_channel: wo.sales_channel || 'telegram',
      customer_name: customerName || wo.phone || 'Onlayn mijoz',
      customer_phone: wo.phone || null,
      cashier_name: 'Onlayn',
      payment_methods: wo.payment_method || '',
      items,
      payments,
      customer: customerName || wo.phone
        ? { id: wo.customer_id, name: customerName || wo.phone, phone: wo.phone || null }
        : undefined,
    };
  }

  enrichOrderForList(row) {
    if (!row) return null;
    if (row.order_source === 'web' || String(row.id || '').startsWith('web:')) {
      const wid = row.web_order_id ?? Number.parseInt(String(row.id).replace(/^web:/, ''), 10);
      return this._getWebOrderWithDetails(wid) || row;
    }
    return this._getOrderWithDetails(row.id);
  }

  /**
   * List orders with filters. Set include_web_orders=true to merge marketplace web_orders.
   */
  list(filters = {}) {
    console.log('📋 SalesService.list called with filters:', filters);

    const includeWeb = filters.include_web_orders === true;
    const orders = includeWeb ? this._listUnifiedOrders(filters) : this._listPosOrders(filters);
    console.log(`✅ SalesService.list returned ${orders.length} orders (unified=${includeWeb})`);
    return orders;
  }

  _listWebOrdersForPosCustomer(posCustomerId) {
    if (!this._hasWebOrdersTable()) return [];
    const bindingTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
      .get();
    if (!bindingTable?.name) return [];

    const mcIds = this.db
      .prepare(`SELECT marketplace_customer_id FROM marketplace_customer_bindings WHERE pos_customer_id = ?`)
      .all(posCustomerId)
      .map((r) => Number(r.marketplace_customer_id))
      .filter((n) => Number.isFinite(n));
    if (!mcIds.length) return [];

    const ph = mcIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id FROM web_orders WHERE customer_id IN (${ph}) ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...mcIds);
    return rows.map((r) => this._getWebOrderWithDetails(r.id)).filter(Boolean);
  }

  _ledgerLinkedPosOrderIds(customerId) {
    try {
      const tableExists = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_ledger'`)
        .get();
      if (!tableExists?.name) return [];
      const rows = this.db
        .prepare(
          `
        SELECT DISTINCT ref_id AS order_id
        FROM customer_ledger
        WHERE customer_id = ?
          AND ref_id IS NOT NULL
          AND type IN ('sale', 'refund', 'payment_in')
      `,
        )
        .all(customerId);
      return rows.map((r) => String(r.order_id || '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  _mapPosOrderRow(order) {
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const payments = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').all(order.id);
    const customer = order.customer_id
      ? this.db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)
      : null;
    return {
      ...order,
      order_source: 'pos',
      items,
      payments,
      customer,
    };
  }

  /**
   * Get orders by customer ID (POS + linked web orders + ledger-linked orphans).
   */
  getByCustomer(customerId) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const byId = new Map();

    const posOrders = this.db
      .prepare(`SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC`)
      .all(customerId);
    for (const order of posOrders) {
      byId.set(String(order.id), this._mapPosOrderRow(order));
    }

    const ledgerIds = this._ledgerLinkedPosOrderIds(customerId);
    const repairNow = new Date().toISOString().replace('T', ' ').substring(0, 19);
    for (const orderId of ledgerIds) {
      if (byId.has(orderId)) continue;
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) continue;
      if (String(order.customer_id || '') !== String(customerId)) {
        try {
          this.db
            .prepare(`UPDATE orders SET customer_id = ?, updated_at = ? WHERE id = ?`)
            .run(customerId, repairNow, order.id);
          order.customer_id = customerId;
        } catch (repairErr) {
          console.warn(
            '[SalesService.getByCustomer] customer_id repair failed for order',
            order.id,
            repairErr.message,
          );
        }
      }
      byId.set(orderId, this._mapPosOrderRow(order));
    }

    for (const webOrder of this._listWebOrdersForPosCustomer(customerId)) {
      const key = String(webOrder.id);
      if (!byId.has(key)) byId.set(key, webOrder);
    }

    return Array.from(byId.values()).sort(
      (a, b) => parseDbTimestamp(b.created_at) - parseDbTimestamp(a.created_at),
    );
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

    const money = computeOrderReturnMoney({
      grossTotal: Number(order.total_amount) || 0,
      items: enrichedItems,
    });
    result.gross_total = money.gross_total;
    result.returned_total = money.returned_total;
    result.net_total = money.net_total;
    result.return_status = money.return_status;

    console.log('[SALES] _getOrderWithDetails returning order:', {
      id: result.id,
      order_number: result.order_number,
      items_count: result.items.length,
      payments_count: result.payments.length,
      has_customer: !!result.customer,
      return_status: result.return_status,
      returned_total: result.returned_total,
      net_total: result.net_total,
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

  /**
   * Fire-and-forget Telegram report for nasiya (credit) sales. Never throws into checkout.
   */
  _notifyCreditSaleReport(saleResult) {
    try {
      const orderId = saleResult?.order_id || saleResult?.id;
      if (!orderId) return;
      const { notifyCreditSale } = require('../../public-api/lib/reportNotify.cjs');
      void notifyCreditSale(this.db, orderId).catch((e) => {
        console.warn('[sales] credit_sale telegram notify failed:', e?.message || e);
      });
    } catch (e) {
      console.warn('[sales] credit_sale telegram notify unavailable:', e?.message || e);
    }
  }

  /**
   * Fire-and-forget customer DM report for POS sales (private chat only).
   * Includes fully-paid sales (delta=0) when a customer is linked.
   */
  _notifyBalanceChangeFromSale(saleResult) {
    try {
      const customerId = saleResult?.customer_id;
      if (!customerId) return;
      const creditAmount = Number(saleResult?.credit_amount || 0);
      const delta = Number(saleResult?.balance_delta || 0);
      const { fireCustomerOpsNotify } = require('../../public-api/lib/customerOpsNotify.cjs');
      fireCustomerOpsNotify(this.db, {
        customerId,
        delta,
        balanceAfter: saleResult?.new_balance,
        currency: saleResult?.currency || 'UZS',
        reason: creditAmount > 0 ? 'credit_sale' : 'sale',
        refId: saleResult?.order_id || saleResult?.id,
        orderId: saleResult?.order_id || saleResult?.id,
        order_id: saleResult?.order_id || saleResult?.id,
        orderNumber: saleResult?.order_number || null,
        creditAmount,
      });
    } catch (e) {
      console.warn('[sales] customer ops notify unavailable:', e?.message || e);
    }
  }
}

module.exports = SalesService;


