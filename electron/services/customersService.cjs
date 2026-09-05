const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isServerMode } = require('../lib/runtime.cjs');
const {
  nowSqlInTimeZone,
  nowSqlUtc,
  sqlNormalizeDatetimeExpr,
  formatYmdInTimeZone,
  UZBEKISTAN_TZ_SQLITE_OFFSET,
} = require('../lib/timezone.cjs');
const { getCurrentUserId } = require('../lib/currentUser.cjs');
const {
  hasCustomerBalanceUsd,
  hasCustomerPaymentCurrency,
  hasCustomerLedgerCurrency,
  hasCustomerLedgerRef,
  normalizeCustomerCurrency,
  readCustomerBalances,
  readCustomerDebtAdvance,
  readBalanceInCurrency,
  applyCustomerBalanceDelta,
  applyCustomerBalanceDeltaOnce,
  applyCustomerLendDeltaOnce,
  computeSaleCreditAmount,
  assertCreditAmountAligned,
  paymentAmountInSaleCurrency,
  writeDebtAdvanceNet,
} = require('../lib/customerBalance.cjs');
const {
  OP: CUSTOMER_OP,
  computeCustomerPosition,
  totalExposure,
  assertCreditExposure,
  syncCustomerDebtFromPosition,
  allocateInboundToOpenOrders,
  attachPosition,
  classifyInboundOpType,
  ledgerOpCodeForPayment,
  appendLedgerAuditCols,
  applyReturnToOrderRemaining,
  roundMoney: roundCustomerMoney,
} = require('../lib/customerPosition.cjs');
const { normalizePhoneUz, formatPhoneUz } = require('../lib/phoneNormalize.cjs');
const { recordPaymentFee } = require('../lib/paymentFee.cjs');
const {
  parsePositiveMoneyAmount,
  assertPaymentOutAllowed,
  assertBonusCorrection,
  assertInitialBonusPoints,
  assertOptionalEmail,
  assertOptionalUzPhone,
  maskPhoneForExport,
  roleCanExportCustomers,
  roleCanReissueLoyaltyQr,
  roleCanManualPaymentAllocation,
  DEFAULT_BONUS_CORRECTION_PER_OP,
  DEFAULT_BONUS_CORRECTION_PER_DAY,
  DEFAULT_BONUS_LARGE_CORRECTION,
  DEFAULT_INITIAL_BONUS_LIMIT,
} = require('../lib/posHardening.cjs');

/**
 * Customers Service
 * Handles customer CRUD operations
 */
class CustomersService {
  constructor(db) {
    this.db = db;
    this._customersColumns = null;
  }

  _getCustomersColumns() {
    if (this._customersColumns) return this._customersColumns;
    const cols = this.db.prepare(`PRAGMA table_info(customers)`).all() || [];
    this._customersColumns = new Set(cols.map((c) => c.name));
    return this._customersColumns;
  }

  _hasCol(name) {
    try {
      return this._getCustomersColumns().has(name);
    } catch {
      return false;
    }
  }

  _resolvePhoneFields(phone) {
    const raw = phone != null ? String(phone).trim() : '';
    if (!raw) {
      return { phone: null, phone_normalized: null };
    }
    const gate = assertOptionalUzPhone(raw);
    if (!gate.ok) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, gate.error, { code: gate.code });
    }
    if (!gate.normalized) {
      return { phone: null, phone_normalized: null };
    }
    const formatted = formatPhoneUz(raw);
    return {
      phone: formatted || raw,
      phone_normalized: gate.normalized,
    };
  }

  /**
   * Parse UI / API telegram field: numeric chat id or @username.
   * Empty clears both columns.
   * @returns {{ telegram_id: number|null, telegram_username: string|null }}
   */
  _resolveTelegramFields(raw) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) {
      return { telegram_id: null, telegram_username: null };
    }
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Telegram ID noto\'g\'ri');
      }
      return { telegram_id: n, telegram_username: null };
    }
    const username = s.replace(/^@+/, '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Telegram: @username (masalan @ali) yoki raqamli chat id kiriting',
      );
    }
    return { telegram_id: null, telegram_username: username };
  }

  _applyTelegramToRow(row, data) {
    if (!this._hasCol('telegram_id') && !this._hasCol('telegram_username')) return;
    let resolved = null;
    if (data.telegram !== undefined) {
      resolved = this._resolveTelegramFields(data.telegram);
    } else if (data.telegram_id !== undefined || data.telegram_username !== undefined) {
      if (data.telegram_id !== undefined && data.telegram_username === undefined) {
        const idRaw = data.telegram_id;
        if (idRaw == null || String(idRaw).trim() === '') {
          resolved = { telegram_id: null, telegram_username: null };
        } else if (/^-?\d+$/.test(String(idRaw).trim())) {
          resolved = { telegram_id: Number(String(idRaw).trim()), telegram_username: null };
        } else {
          resolved = this._resolveTelegramFields(idRaw);
        }
      } else if (data.telegram_username !== undefined && data.telegram_id === undefined) {
        resolved = this._resolveTelegramFields(
          data.telegram_username == null ? '' : `@${String(data.telegram_username).replace(/^@+/, '')}`,
        );
      } else {
        // Both provided — prefer explicit pair after light normalize
        let telegram_id = null;
        if (data.telegram_id != null && String(data.telegram_id).trim() !== '') {
          const n = Number(data.telegram_id);
          if (!Number.isFinite(n)) {
            throw createError(ERROR_CODES.VALIDATION_ERROR, 'Telegram ID noto\'g\'ri');
          }
          telegram_id = n;
        }
        let telegram_username = null;
        if (data.telegram_username != null && String(data.telegram_username).trim() !== '') {
          telegram_username = String(data.telegram_username).replace(/^@+/, '').trim() || null;
          if (telegram_username && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegram_username)) {
            throw createError(
              ERROR_CODES.VALIDATION_ERROR,
              'Telegram: @username (masalan @ali) yoki raqamli chat id kiriting',
            );
          }
        }
        resolved = { telegram_id, telegram_username };
      }
    }
    if (!resolved) return;
    if (this._hasCol('telegram_id')) row.telegram_id = resolved.telegram_id;
    if (this._hasCol('telegram_username')) row.telegram_username = resolved.telegram_username;
  }

  _getSettingRaw(key) {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  _getCustomerPhoneMode() {
    const v = String(this._getSettingRaw('customers.phone.mode') || 'recommend').trim().toLowerCase();
    if (v === 'required' || v === 'optional') return v;
    return 'recommend';
  }

  _buildLoyaltyQrPayload(cardCode) {
    return `LOYALTY:${String(cardCode || '').trim()}`;
  }

  _buildDefaultLoyaltyCardCode(customerId, customerCode) {
    const code = String(customerCode || '').trim().toUpperCase();
    if (code) return `LC-${code}`;
    return `LC-${String(customerId).slice(0, 12).toUpperCase()}`;
  }

  /**
   * Ensure every customer has a stable loyalty card (code + QR payload).
   * @returns {{ loyalty_card_code: string, qr_payload: string }|null}
   */
  ensureLoyaltyCard(customerId, { preferredCode = null, customerCode = null } = {}) {
    if (!customerId || !this._hasCol('loyalty_card_code')) return null;

    const existing = this.db
      .prepare(`SELECT loyalty_card_code, loyalty_qr_payload FROM customers WHERE id = ?`)
      .get(customerId);
    if (existing?.loyalty_card_code) {
      return {
        loyalty_card_code: existing.loyalty_card_code,
        qr_payload: existing.loyalty_qr_payload || this._buildLoyaltyQrPayload(existing.loyalty_card_code),
      };
    }

    let cardCode = preferredCode ? String(preferredCode).trim() : null;
    if (!cardCode) {
      const row = this.db.prepare('SELECT code FROM customers WHERE id = ?').get(customerId);
      cardCode = this._buildDefaultLoyaltyCardCode(customerId, customerCode || row?.code);
    }
    const qrPayload = this._buildLoyaltyQrPayload(cardCode);
    this.db
      .prepare(
        `UPDATE customers SET loyalty_card_code = ?, loyalty_qr_payload = ?, updated_at = ? WHERE id = ?`,
      )
      .run(cardCode, qrPayload, nowSqlInTimeZone(), customerId);
    return { loyalty_card_code: cardCode, qr_payload: qrPayload };
  }

  /**
   * Reissue loyalty card/QR (admin/manager). Archives previous code in history.
   */
  reissueLoyaltyCard(customerId, actorUserId, reason) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mijoz ID kerak');
    }
    const roles = this._getUserRoleCodes(actorUserId);
    if (!roleCanReissueLoyaltyQr(roles)) {
      throw createError(ERROR_CODES.FORBIDDEN, 'Loyalty QR qayta chiqarish faqat admin/menejer uchun');
    }
    const reasonText = String(reason || '').trim();
    if (!reasonText) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Qayta chiqarish sababi majburiy');
    }
    if (!this._hasCol('loyalty_card_code')) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'loyalty_card_code ustuni yo‘q');
    }

    const existing = this.db
      .prepare(`SELECT loyalty_card_code, loyalty_qr_payload, code FROM customers WHERE id = ?`)
      .get(customerId);
    if (!existing) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Mijoz topilmadi');
    }

    const oldCode = existing.loyalty_card_code || null;
    const oldPayload = existing.loyalty_qr_payload || null;
    const newCode = `LC-${String(existing.code || customerId).slice(0, 12).toUpperCase()}-${Date.now()
      .toString(36)
      .toUpperCase()
      .slice(-4)}`;
    const newPayload = this._buildLoyaltyQrPayload(newCode);
    const now = nowSqlInTimeZone();

    this.db.transaction(() => {
      try {
        const hist = this.db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='customer_loyalty_card_history'`
          )
          .get();
        if (hist && oldCode) {
          this.db
            .prepare(
              `
            INSERT INTO customer_loyalty_card_history (
              id, customer_id, loyalty_card_code, qr_payload, status, reason, replaced_by, created_at, created_by
            ) VALUES (?, ?, ?, ?, 'replaced', ?, ?, ?, ?)
          `
            )
            .run(
              randomUUID(),
              customerId,
              oldCode,
              oldPayload,
              reasonText,
              newCode,
              now,
              actorUserId || null
            );
        }
      } catch (e) {
        console.warn('[customers] loyalty history insert skipped:', e?.message || e);
      }
      this.db
        .prepare(
          `UPDATE customers SET loyalty_card_code = ?, loyalty_qr_payload = ?, updated_at = ? WHERE id = ?`
        )
        .run(newCode, newPayload, now, customerId);
    })();

    this._safeAuditLog({
      user_id: actorUserId,
      action: 'loyalty_qr_reissue',
      entity_type: 'customer',
      entity_id: customerId,
      old_values: { loyalty_card_code: oldCode, qr_payload: oldPayload },
      new_values: { loyalty_card_code: newCode, qr_payload: newPayload, reason: reasonText },
    });

    return { loyalty_card_code: newCode, qr_payload: newPayload };
  }

  _findProbablePhonelessDuplicate(name, excludeId = null) {
    const n = String(name || '').trim();
    if (!n) return null;
    let row;
    if (excludeId) {
      row = this.db
        .prepare(
          `
          SELECT id, name, code, loyalty_card_code FROM customers
          WHERE LOWER(TRIM(name)) = LOWER(?)
            AND (phone IS NULL OR TRIM(COALESCE(phone, '')) = '')
            AND (phone_normalized IS NULL OR TRIM(COALESCE(phone_normalized, '')) = '')
            AND id != ?
          LIMIT 1
        `,
        )
        .get(n, excludeId);
    } else {
      row = this.db
        .prepare(
          `
          SELECT id, name, code, loyalty_card_code FROM customers
          WHERE LOWER(TRIM(name)) = LOWER(?)
            AND (phone IS NULL OR TRIM(COALESCE(phone, '')) = '')
            AND (phone_normalized IS NULL OR TRIM(COALESCE(phone_normalized, '')) = '')
          LIMIT 1
        `,
        )
        .get(n);
    }
    return row || null;
  }

  _throwDuplicatePhone(existing) {
    const err = createError(
      ERROR_CODES.DUPLICATE_PHONE,
      "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
    );
    err.details = {
      existing_id: existing.id,
      existing_name: existing.name,
      existing_code: existing.code,
    };
    throw err;
  }

  _assertUniquePhoneNormalized(phoneNormalized, excludeId = null) {
    if (!phoneNormalized || !this._hasCol('phone_normalized')) return;
    let row;
    if (excludeId) {
      row = this.db
        .prepare(
          `SELECT id, name, code FROM customers WHERE phone_normalized = ? AND id != ? LIMIT 1`,
        )
        .get(phoneNormalized, excludeId);
    } else {
      row = this.db
        .prepare(
          `SELECT id, name, code FROM customers WHERE phone_normalized = ? LIMIT 1`,
        )
        .get(phoneNormalized);
    }
    if (row?.id) {
      this._throwDuplicatePhone(row);
    }
  }

  _phoneLookupOrderBy() {
    return `ORDER BY datetime(replace(replace(COALESCE(created_at, ''), 'T', ' '), 'Z', '')) ASC, id ASC`;
  }

  _phoneStorageCandidates(norm) {
    const candidates = [];
    const push = (v) => {
      if (v == null || v === '') return;
      const s = String(v);
      if (!candidates.includes(s)) candidates.push(s);
    };
    push(formatPhoneUz(norm));
    push(`+${norm}`);
    push(norm);
    if (norm.length === 12 && norm.startsWith('998')) {
      push(norm.slice(3));
      push(`8${norm.slice(3)}`);
    }
    return candidates;
  }

  _backfillPhoneNormalized(row, norm) {
    if (!row?.id || !norm || !this._hasCol('phone_normalized')) return row;
    if (row.phone_normalized && String(row.phone_normalized).trim() !== '') return row;
    this.db
      .prepare(`UPDATE customers SET phone_normalized = ? WHERE id = ?`)
      .run(norm, row.id);
    row.phone_normalized = norm;
    return row;
  }

  findByNormalizedPhone(phoneNormalized) {
    const norm =
      phoneNormalized != null && String(phoneNormalized).trim() !== ''
        ? String(phoneNormalized).trim()
        : null;
    if (!norm) return null;

    const orderBy = this._phoneLookupOrderBy();

    if (this._hasCol('phone_normalized')) {
      const byNorm = this.db
        .prepare(`SELECT * FROM customers WHERE phone_normalized = ? ${orderBy} LIMIT 1`)
        .get(norm);
      if (byNorm) return byNorm;
    }

    const candidates = this._phoneStorageCandidates(norm);
    if (candidates.length) {
      const placeholders = candidates.map(() => '?').join(', ');
      const byRaw = this.db
        .prepare(
          `SELECT * FROM customers WHERE phone IN (${placeholders}) ${orderBy} LIMIT 1`,
        )
        .get(...candidates);
      if (byRaw) return this._backfillPhoneNormalized(byRaw, norm);
    }

    const legacyFilter = this._hasCol('phone_normalized')
      ? `AND (phone_normalized IS NULL OR TRIM(COALESCE(phone_normalized, '')) = '')`
      : '';
    const legacyRows = this.db
      .prepare(
        `
        SELECT * FROM customers
        WHERE phone IS NOT NULL AND TRIM(phone) != ''
        ${legacyFilter}
        ${orderBy}
      `,
      )
      .all();
    for (const row of legacyRows) {
      if (normalizePhoneUz(row.phone) === norm) {
        return this._backfillPhoneNormalized(row, norm);
      }
    }

    return null;
  }

  findByPhone(rawPhone) {
    const { phone_normalized } = this._resolvePhoneFields(rawPhone);
    if (!phone_normalized) return null;
    return this.findByNormalizedPhone(phone_normalized);
  }

  findOrCreateByPhone(data = {}) {
    const name = data.name?.trim() || 'Onlayn mijoz';
    const { phone, phone_normalized } = this._resolvePhoneFields(data.phone);

    if (phone_normalized) {
      const existing = this.findByNormalizedPhone(phone_normalized);
      if (existing) {
        const updates = {};
        if (name && name !== existing.name) updates.name = name;
        if (phone && phone !== existing.phone) updates.phone = phone;
        if (Object.keys(updates).length) {
          return this.update(existing.id, updates);
        }
        return existing;
      }
    }

    return this.create({
      ...data,
      name,
      phone,
      phone_normalized,
      _skipDuplicateCheck: true,
    });
  }

  _insertCustomerRecord(id, code, data, resolvedPhone, now) {
    const row = {
      id,
      code: code.trim().toUpperCase(),
      name: data.name.trim(),
      phone: resolvedPhone.phone,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      type: data.type || 'individual',
      company_name: data.company_name?.trim() || null,
      tax_number: data.tax_number?.trim() || null,
      credit_limit: data.credit_limit || 0,
      allow_debt: data.allow_debt ? 1 : 0,
      allow_credit: data.allow_credit ? 1 : 0,
      balance: data.balance || 0,
      status: data.status || 'active',
      notes: data.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    if (this._hasCol('pricing_tier')) {
      row.pricing_tier = data.pricing_tier === 'master' ? 'master' : 'retail';
    }
    if (this._hasCol('bonus_points')) {
      row.bonus_points = Number(data.bonus_points) || 0;
    }
    if (this._hasCol('phone_normalized')) {
      row.phone_normalized = resolvedPhone.phone_normalized;
    }
    this._applyTelegramToRow(row, data);
    const cols = Object.keys(row);
    const vals = Object.values(row);
    this.db
      .prepare(
        `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      .run(...vals);
  }

  _tzDateExpr(columnExpr) {
    return `date(datetime(replace(replace(${columnExpr}, 'T', ' '), 'Z', ''), '${UZBEKISTAN_TZ_SQLITE_OFFSET}'))`;
  }

  /**
   * customer_payments.received_by references users(id). Renderer user id may not
   * exist in users; main-process session (login) is tried next, then defaults.
   */
  _resolveReceivedByForPayment(receivedBy) {
    const KNOWN_DEFAULT_USER = 'default-admin-001';
    const candidates = [];
    const push = (v) => {
      if (v == null || v === '') return;
      const s = String(v).trim();
      if (s && !candidates.includes(s)) candidates.push(s);
    };
    push(receivedBy);
    push(getCurrentUserId());

    for (const id of candidates) {
      const row = this.db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (row?.id) return id;
    }

    if (candidates.length) {
      console.warn(
        '[CustomersService.receivePayment] received_by / session user not in users table; tried:',
        candidates
      );
    }

    const def = this.db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(KNOWN_DEFAULT_USER);
    if (def?.id) return KNOWN_DEFAULT_USER;

    let any = null;
    try {
      any = this.db
        .prepare(
          `SELECT id FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY datetime(created_at) ASC LIMIT 1`
        )
        .get();
    } catch {
      try {
        any = this.db
          .prepare(`SELECT id FROM users ORDER BY datetime(created_at) ASC LIMIT 1`)
          .get();
      } catch {
        any = null;
      }
    }
    return any?.id || null;
  }

  /**
   * Optional shift link — only if shift row exists (avoids FK issues if schema/tooling adds one).
   */
  _normalizeShiftIdForPayment(shiftId) {
    const raw =
      shiftId != null && shiftId !== '' ? String(shiftId).trim() : '';
    if (!raw) return null;
    try {
      const row = this.db.prepare(`SELECT id FROM shifts WHERE id = ?`).get(raw);
      if (row?.id) return raw;
    } catch {
      return null;
    }
    console.warn(
      '[CustomersService.receivePayment] shift_id not found in shifts; omitting:',
      raw
    );
    return null;
  }

  /**
   * customer_payments.order_id references orders(id); empty or stale IDs break FK.
   */
  _normalizeOrderIdForPayment(orderId) {
    const raw =
      orderId != null && orderId !== '' ? String(orderId).trim() : '';
    if (!raw) return null;
    const ord = this.db.prepare('SELECT id FROM orders WHERE id = ?').get(raw);
    if (ord?.id) return raw;
    console.warn(
      '[CustomersService.receivePayment] order_id not in orders; omitting:',
      raw
    );
    return null;
  }

  _applyLinkedOrderPayment(orderId, requestedAmount, payCurrency, payFx) {
    const order = this.db
      .prepare(
        `SELECT id, total_amount, paid_amount, credit_amount, currency, fx_rate, payment_status
         FROM orders WHERE id = ?`
      )
      .get(orderId);
    if (!order) return;
    const saleCur = normalizeCustomerCurrency(order.currency);
    let applied = Number(requestedAmount) || 0;
    if (payCurrency !== saleCur) {
      applied = paymentAmountInSaleCurrency(
        { amount: requestedAmount, currency: payCurrency },
        saleCur,
        Number(order.fx_rate || payFx || 0)
      );
    }
    const newPaid = Number(order.paid_amount || 0) + applied;
    const newCredit = computeSaleCreditAmount(order.total_amount, newPaid, 0, 0.02);
    assertCreditAmountAligned(order.total_amount, newPaid, newCredit, 0, 0.02);
    let paymentStatus = 'paid';
    if (newCredit > 0.02) {
      paymentStatus = Number(newPaid) > 0.02 ? 'partially_paid' : 'on_credit';
    }
    this.db
      .prepare(
        `UPDATE orders SET paid_amount = ?, credit_amount = ?, payment_status = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(newPaid, newCredit, paymentStatus, orderId);
  }

  /**
   * Apply customer advance to a specific open credit order (no cash movement).
   */
  applyAdvanceToOrder({ customerId, orderId, amount, receivedBy = null, notes = null } = {}) {
    const normalizedCustomerId = customerId != null ? String(customerId).trim() : '';
    if (!normalizedCustomerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }
    if (!orderId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'order_id majburiy.');
    }
    const amountParsed = parsePositiveMoneyAmount(amount);
    if (!amountParsed.ok) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, amountParsed.error);
    }
    const requested = amountParsed.amount;
    const resolvedReceivedBy = this._resolveReceivedByForPayment(receivedBy);
    // UTC-naive — same clock as sales/returns/payment ledger rows.
    const now = nowSqlUtc();

    return this.db.transaction(() => {
      const customer = this.getById(normalizedCustomerId);
      const order = this.db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (!order || String(order.customer_id) !== normalizedCustomerId) {
        throw createError(ERROR_CODES.NOT_FOUND, 'Buyurtma topilmadi.');
      }
      const payCurrency = normalizeCustomerCurrency(order.currency);
      const buckets = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
      if (buckets.advance + 1e-6 < requested) {
        throw createError(
          ERROR_CODES.VALIDATION_ERROR,
          `Avans yetarli emas. Mavjud: ${buckets.advance}.`
        );
      }
      const remaining = Math.max(0, Number(order.credit_amount || 0) || 0);
      const applied = roundCustomerMoney(Math.min(requested, remaining));
      if (!(applied > 0.009)) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Bu buyurtmada ochiq qarz yo‘q.');
      }
      const paymentId = randomUUID();
      const paymentNumber = `ADV-${Date.now()}-${paymentId.substring(0, 8).toUpperCase()}`;
      allocateInboundToOpenOrders(this.db, {
        customerId: normalizedCustomerId,
        paymentId,
        amount: applied,
        currency: payCurrency,
        preferredOrderId: orderId,
        paymentMethod: 'advance',
        createdAt: now,
        createdBy: resolvedReceivedBy,
        cashDocId: paymentNumber,
        allocation_type: 'advance_used',
      });
      writeDebtAdvanceNet(
        this.db,
        normalizedCustomerId,
        payCurrency,
        readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency).debt,
        roundCustomerMoney(buckets.advance - applied),
        now
      );
      const pos = computeCustomerPosition(this.db, normalizedCustomerId, payCurrency);
      writeDebtAdvanceNet(
        this.db,
        normalizedCustomerId,
        payCurrency,
        pos.open_order_debt +
          roundCustomerMoney(Math.max(0, pos.loan_issued - pos.loan_repaid)),
        roundCustomerMoney(buckets.advance - applied),
        now
      );

      const tableInfo = this.db.prepare('PRAGMA table_info(customer_payments)').all();
      const cols = [
        'id',
        'payment_number',
        'customer_id',
        'order_id',
        'amount',
        'payment_method',
        'notes',
        'received_by',
        'paid_at',
        'created_at',
      ];
      const vals = [
        paymentId,
        paymentNumber,
        normalizedCustomerId,
        orderId,
        applied,
        'advance',
        notes || 'Avans buyurtmaga qo‘llandi',
        resolvedReceivedBy,
        now,
        now,
      ];
      if (tableInfo.some((c) => c.name === 'operation')) {
        cols.push('operation');
        vals.push('payment_in');
      }
      if (tableInfo.some((c) => c.name === 'op_type')) {
        cols.push('op_type');
        vals.push(CUSTOMER_OP.ADVANCE_APPLIED_TO_ORDER);
      }
      const ph = cols.map(() => '?').join(', ');
      this.db.prepare(`INSERT INTO customer_payments (${cols.join(', ')}) VALUES (${ph})`).run(...vals);

      const ledgerExists = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_ledger'`)
        .get();
      if (ledgerExists) {
        const bucketsAfter = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
        const ledgerCols = [
          'id',
          'customer_id',
          'type',
          'ref_id',
          'ref_no',
          'amount',
          'balance_after',
          'note',
          'created_at',
          'created_by',
        ];
        const netAfter = roundCustomerMoney(bucketsAfter.advance - bucketsAfter.debt);
        const ledgerVals = [
          randomUUID(),
          normalizedCustomerId,
          'adjustment',
          paymentId,
          paymentNumber,
          0,
          netAfter,
          notes || `Avans qo‘llandi: ${order.order_number} (${applied})`,
          now,
          resolvedReceivedBy,
        ];
        appendLedgerAuditCols(this.db, ledgerCols, ledgerVals, {
          op_code: CUSTOMER_OP.ADVANCE_APPLIED_TO_ORDER,
          debt_before: buckets.debt,
          debt_after: bucketsAfter.debt,
          advance_before: buckets.advance,
          advance_after: bucketsAfter.advance,
        });
        const placeholders = ledgerCols.map(() => '?').join(', ');
        this.db
          .prepare(`INSERT INTO customer_ledger (${ledgerCols.join(', ')}) VALUES (${placeholders})`)
          .run(...ledgerVals);
      }

      this._safeAuditLog({
        user_id: resolvedReceivedBy,
        action: 'customer_advance_applied',
        entity_type: 'customer',
        entity_id: normalizedCustomerId,
        old_values: { advance: buckets.advance, order_id: orderId },
        new_values: { amount: applied, payment_id: paymentId },
      });

      return {
        success: true,
        payment_id: paymentId,
        applied_amount: applied,
        position: computeCustomerPosition(this.db, normalizedCustomerId, payCurrency),
        customer: this.getById(normalizedCustomerId),
      };
    })();
  }

  /**
   * List customers
   */
  list(filters = {}) {
    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];

    if (filters.search) {
      const trimmed = String(filters.search).trim();
      const searchTerm = `%${trimmed}%`;
      let clause =
        '(name LIKE ? COLLATE NOCASE OR phone LIKE ? OR email LIKE ? COLLATE NOCASE OR id LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length >= 3) {
        clause +=
          " OR replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE ?";
        params.push(`%${digits}%`);
      }
      query += ` AND (${clause})`;
    }

    if (filters.status && filters.status !== 'all') {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    const sortByRaw = String(filters.sortBy || 'created_at').toLowerCase();
    const sortOrderRaw = String(filters.sortOrder || 'desc').toLowerCase();
    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
      name: 'name',
      created_at: "datetime(replace(replace(created_at, 'T', ' '), 'Z', ''))",
      balance: 'COALESCE(balance, 0)',
      total_sales: 'COALESCE(total_sales, 0)',
      last_order_date: "datetime(replace(replace(COALESCE(last_order_date, created_at), 'T', ' '), 'Z', ''))",
    };
    const sortExpr = sortMap[sortByRaw] || sortMap.created_at;
    query += ` ORDER BY ${sortExpr} ${sortOrder}, name ASC`;

    const limitRaw = filters.limit != null ? Number(filters.limit) : null;
    const offsetRaw = filters.offset != null ? Number(filters.offset) : 0;
    const hasLimit = Number.isFinite(limitRaw) && limitRaw > 0;
    if (hasLimit) {
      const limit = Math.min(Math.floor(limitRaw), 500);
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const rows = this.db.prepare(query).all(params) || [];
    // Display: open-order debt + loans (computed). DB heal only if CUSTOMER_AR_HEAL=1.
    return rows.map((row) => {
      try {
        return attachPosition(row, this.db, 'UZS', { sync: true });
      } catch (err) {
        console.warn('[CustomersService.list] attachPosition failed:', err?.message || err);
        return row;
      }
    });
  }

  _hasTable(name) {
    try {
      const row = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name);
      return !!row?.name;
    } catch {
      return false;
    }
  }

  /**
   * Count POS + linked web orders and UZS-equivalent sales from source tables.
   */
  computeOrderStats(customerId) {
    const KNOWN_DEFAULT = 'default-customer-001';
    if (!customerId || customerId === KNOWN_DEFAULT) {
      return { order_count: 0, total_sales_uzs: 0 };
    }

    const hasOrderCurrency = this._hasTableColumn('orders', 'currency');
    const hasOrderFx = this._hasTableColumn('orders', 'fx_rate');
    const salesExpr = hasOrderCurrency && hasOrderFx
      ? `CASE WHEN UPPER(TRIM(COALESCE(o.currency, 'UZS'))) = 'USD'
            THEN COALESCE(o.total_amount, 0) * COALESCE(o.fx_rate, 0)
            ELSE COALESCE(o.total_amount, 0) END`
      : 'COALESCE(o.total_amount, 0)';

    const posRow = this.db
      .prepare(
        `
      SELECT COUNT(*) AS cnt, COALESCE(SUM(${salesExpr}), 0) AS sales_uzs
      FROM orders o
      WHERE o.customer_id = ?
        AND o.status NOT IN ('voided', 'cancelled', 'draft', 'hold', 'pending', 'on_hold', 'amended', 'refunded', 'returned')
    `,
      )
      .get(customerId);

    let webCnt = 0;
    let webSales = 0;
    if (this._hasTable('web_orders') && this._hasTable('marketplace_customer_bindings')) {
      const mcIds = this.db
        .prepare(
          `SELECT marketplace_customer_id FROM marketplace_customer_bindings WHERE pos_customer_id = ?`,
        )
        .all(customerId)
        .map((r) => Number(r.marketplace_customer_id))
        .filter((n) => Number.isFinite(n));
      if (mcIds.length > 0) {
        const ph = mcIds.map(() => '?').join(',');
        const webRow = this.db
          .prepare(
            `
          SELECT COUNT(*) AS cnt, COALESCE(SUM(COALESCE(total_amount, 0)), 0) AS sales_uzs
          FROM web_orders
          WHERE customer_id IN (${ph})
            AND status NOT IN ('cancelled', 'rejected')
        `,
          )
          .get(...mcIds);
        webCnt = Number(webRow?.cnt || 0);
        webSales = Number(webRow?.sales_uzs || 0);
      }
    }

    return {
      order_count: Number(posRow?.cnt || 0) + webCnt,
      total_sales_uzs: Number(posRow?.sales_uzs || 0) + webSales,
    };
  }

  _hasTableColumn(table, column) {
    try {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() || [];
      return cols.some((c) => c.name === column);
    } catch {
      return false;
    }
  }

  /**
   * Repair customers.total_orders / total_sales when counters drift from orders table.
   */
  reconcileOrderStats(customerId, { write = true } = {}) {
    const stats = this.computeOrderStats(customerId);
    if (!write) return stats;

    const stored = this.db
      .prepare(`SELECT total_orders, total_sales FROM customers WHERE id = ?`)
      .get(customerId);
    if (!stored) return stats;

    const storedOrders = Number(stored.total_orders || 0);
    const storedSales = Number(stored.total_sales || 0);
    const driftOrders = storedOrders !== stats.order_count;
    const driftSales = Math.abs(storedSales - stats.total_sales_uzs) > 0.5;
    if (!driftOrders && !driftSales) return stats;

    const now = nowSqlInTimeZone();
    this.db
      .prepare(
        `
      UPDATE customers
      SET total_orders = ?, total_sales = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(stats.order_count, stats.total_sales_uzs, now, customerId);
    return stats;
  }

  /**
   * Get customer by ID
   */
  getById(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const customer = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    
    if (!customer) {
      throw createError(ERROR_CODES.NOT_FOUND, `Customer with id ${id} not found`);
    }

    try {
      const stats = this.reconcileOrderStats(id, { write: true });
      customer.total_orders = stats.order_count;
      customer.total_sales = stats.total_sales_uzs;
    } catch (reconcileErr) {
      console.warn('[CustomersService.getById] reconcileOrderStats failed:', reconcileErr.message);
    }

    try {
      // Display overlay only by default. Heal/backfill/sync writes require CUSTOMER_AR_HEAL=1.
      attachPosition(customer, this.db, 'UZS', { sync: true });
    } catch (posErr) {
      console.warn('[CustomersService.getById] compute position failed:', posErr.message);
    }

    return customer;
  }

  /**
   * Find POS customer by marketplace loyalty QR/card code.
   * Accepted inputs:
   * - "LOYALTY:LC-123-1" (QR payload)
   * - "LC-123-1" (plain card code)
   */
  getByLoyaltyQr(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const normalized = raw.toUpperCase().startsWith('LOYALTY:')
      ? raw.slice('LOYALTY:'.length).trim()
      : raw;
    if (!normalized) return null;

    if (this._hasCol('loyalty_card_code')) {
      const byCustomer = this.db
        .prepare(
          `
          SELECT id FROM customers
          WHERE loyalty_card_code = ? OR loyalty_qr_payload = ? OR loyalty_qr_payload = ?
          LIMIT 1
        `,
        )
        .get(normalized, raw, `LOYALTY:${normalized}`);
      if (byCustomer?.id) {
        try {
          return this.getById(byCustomer.id);
        } catch {
          return null;
        }
      }
    }

    const hasBindingTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
      .get();
    if (!hasBindingTable) return null;

    const row = this.db
      .prepare(
        `
        SELECT b.pos_customer_id
        FROM marketplace_customer_bindings b
        WHERE b.loyalty_card_code = ? OR b.qr_payload = ?
        LIMIT 1
      `,
      )
      .get(normalized, raw);
    if (!row?.pos_customer_id) return null;

    try {
      const customer = this.getById(row.pos_customer_id);
      this.ensureLoyaltyCard(row.pos_customer_id, { preferredCode: normalized });
      return customer;
    } catch {
      return null;
    }
  }

  getLoyaltyCardByCustomerId(customerId) {
    if (!customerId) return null;

    if (this._hasCol('loyalty_card_code')) {
      const row = this.db
        .prepare(
          `
          SELECT loyalty_card_code, loyalty_qr_payload
          FROM customers
          WHERE id = ?
        `,
        )
        .get(customerId);
      if (row?.loyalty_card_code) {
        return {
          loyalty_card_code: row.loyalty_card_code,
          qr_payload: row.loyalty_qr_payload || this._buildLoyaltyQrPayload(row.loyalty_card_code),
          marketplace_customer_id: null,
          created_at: null,
        };
      }
    }

    const hasBindingTable = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marketplace_customer_bindings'`)
      .get();
    if (!hasBindingTable) {
      return this.ensureLoyaltyCard(customerId);
    }
    const binding = this.db
      .prepare(
        `
        SELECT loyalty_card_code, qr_payload, marketplace_customer_id, created_at
        FROM marketplace_customer_bindings
        WHERE pos_customer_id = ?
        LIMIT 1
      `,
      )
      .get(customerId);
    if (binding?.loyalty_card_code) {
      this.ensureLoyaltyCard(customerId, { preferredCode: binding.loyalty_card_code });
      return binding;
    }
    return this.ensureLoyaltyCard(customerId);
  }

  /**
   * Create customer
   */
  create(data) {
    if (!data.name || !data.name.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer name is required');
    }

    const resolvedPhone = data._skipDuplicateCheck
      ? {
          phone: data.phone ?? null,
          phone_normalized: data.phone_normalized ?? null,
        }
      : this._resolvePhoneFields(data.phone);

    if (data.email !== undefined && data.email !== null && String(data.email).trim() !== '') {
      const emailGate = assertOptionalEmail(data.email);
      if (!emailGate.ok) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, emailGate.error, { code: emailGate.code });
      }
      data.email = emailGate.email;
    }

    if (data.bonus_points !== undefined && data.bonus_points !== null) {
      const bonusGate = assertInitialBonusPoints(data.bonus_points, {
        maxInitial: this._getNumericSetting(
          'customers.bonus.initial_limit',
          DEFAULT_INITIAL_BONUS_LIMIT
        ),
      });
      if (!bonusGate.ok) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, bonusGate.error, { code: bonusGate.code });
      }
      data.bonus_points = bonusGate.points;
    }

    if (data.credit_limit !== undefined && data.credit_limit !== null) {
      const limitNum = Number(data.credit_limit);
      if (!Number.isFinite(limitNum) || limitNum < 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Kredit limiti 0 yoki undan katta bo‘lishi kerak.');
      }
      if (limitNum > 0) {
        const actorId = getCurrentUserId();
        // No session (smoke/system seeds): allow. Interactive UI always has actor.
        if (actorId) {
          const actorRoles = this._getUserRoleCodes(actorId);
          const isAdmin = (actorRoles || []).some((r) => String(r).toLowerCase() === 'admin');
          if (!isAdmin) {
            throw createError(
              ERROR_CODES.FORBIDDEN,
              'Kredit limitini faqat admin belgilashi mumkin.'
            );
          }
        }
      }
      data.credit_limit = limitNum;
    }

    if (!data._skipDuplicateCheck && resolvedPhone.phone_normalized) {
      const existing = this.findByNormalizedPhone(resolvedPhone.phone_normalized);
      if (existing) {
        this._throwDuplicatePhone(existing);
      }
    }

    const phoneMode = this._getCustomerPhoneMode();
    if (phoneMode === 'required' && !resolvedPhone.phone_normalized) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        "Telefon raqami majburiy (sozlamalar: customers.phone.mode = required).",
      );
    }

    const probableDuplicate =
      !resolvedPhone.phone_normalized && !data._skipDuplicateCheck
        ? this._findProbablePhonelessDuplicate(data.name)
        : null;

    const id = data.id || randomUUID();
    const now = nowSqlInTimeZone();

    // Generate code if not provided
    let code = data.code;
    if (!code) {
      const lastCustomer = this.db.prepare('SELECT code FROM customers WHERE code LIKE ? ORDER BY code DESC LIMIT 1')
        .get('CUST-%');
      if (lastCustomer && lastCustomer.code) {
        const lastNum = parseInt(lastCustomer.code.replace('CUST-', '')) || 0;
        code = `CUST-${String(lastNum + 1).padStart(4, '0')}`;
      } else {
        code = 'CUST-0001';
      }
    }

    try {
      this._insertCustomerRecord(id, code, data, resolvedPhone, now);
      this.ensureLoyaltyCard(id, { customerCode: code });
      const customer = this.getById(id);
      if (probableDuplicate && probableDuplicate.id !== id) {
        customer._probable_duplicate = {
          id: probableDuplicate.id,
          name: probableDuplicate.name,
          code: probableDuplicate.code,
          loyalty_card_code: probableDuplicate.loyalty_card_code || null,
          message:
            "Shu ismli telefonsiz mijoz allaqachon mavjud. Telefon kiriting yoki mavjud kartani ishlating.",
        };
      }
      return customer;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (
          String(error.message || '').includes('phone_normalized') ||
          String(error.message || '').includes('idx_customers_phone_normalized_unique')
        ) {
          const existing = resolvedPhone.phone_normalized
            ? this.findByNormalizedPhone(resolvedPhone.phone_normalized)
            : null;
          if (existing) {
            this._throwDuplicatePhone(existing);
          }
          throw createError(
            ERROR_CODES.DUPLICATE_PHONE,
            "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
          );
        }
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer code must be unique');
      }
      throw error;
    }
  }

  /**
   * Update customer
   */
  update(id, data) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const existing = this.getById(id);

    const updates = [];
    const params = [];

    if (data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer name cannot be empty');
      }
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.phone !== undefined) {
      const resolvedPhone = this._resolvePhoneFields(data.phone);
      this._assertUniquePhoneNormalized(resolvedPhone.phone_normalized, id);
      updates.push('phone = ?');
      params.push(resolvedPhone.phone);
      if (this._hasCol('phone_normalized')) {
        updates.push('phone_normalized = ?');
        params.push(resolvedPhone.phone_normalized);
      }
    }

    if (data.email !== undefined) {
      updates.push('email = ?');
      params.push(data.email?.trim() || null);
    }

    if (data.address !== undefined) {
      updates.push('address = ?');
      params.push(data.address?.trim() || null);
    }

    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }

    if (data.company_name !== undefined) {
      updates.push('company_name = ?');
      params.push(data.company_name?.trim() || null);
    }

    if (data.tax_number !== undefined) {
      updates.push('tax_number = ?');
      params.push(data.tax_number?.trim() || null);
    }

    if (data.credit_limit !== undefined) {
      const actorId = getCurrentUserId();
      if (actorId) {
        const actorRoles = this._getUserRoleCodes(actorId);
        const isAdmin = (actorRoles || []).some((r) => String(r).toLowerCase() === 'admin');
        if (!isAdmin) {
          throw createError(
            ERROR_CODES.FORBIDDEN,
            'Kredit limitini faqat admin belgilashi mumkin.'
          );
        }
      }
      const limitNum = Number(data.credit_limit);
      if (!Number.isFinite(limitNum) || limitNum < 0) {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Kredit limiti 0 yoki undan katta bo‘lishi kerak.');
      }
      updates.push('credit_limit = ?');
      params.push(limitNum);
      if (this._hasCol('credit_limit_currency')) {
        const cur = String(data.credit_limit_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
        updates.push('credit_limit_currency = ?');
        params.push(cur);
      }
      if (this._hasCol('credit_limit_updated_at')) {
        updates.push('credit_limit_updated_at = ?');
        params.push(nowSqlInTimeZone());
      }
      if (this._hasCol('credit_limit_updated_by')) {
        updates.push('credit_limit_updated_by = ?');
        params.push(actorId || null);
      }
    }

    if (data.allow_debt !== undefined) {
      updates.push('allow_debt = ?');
      params.push(data.allow_debt ? 1 : 0);
    }

    if (data.allow_credit !== undefined) {
      updates.push('allow_credit = ?');
      params.push(data.allow_credit ? 1 : 0);
    }

    if (data.balance !== undefined) {
      updates.push('balance = ?');
      params.push(data.balance);
    }

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    if (data.notes !== undefined) {
      updates.push('notes = ?');
      params.push(data.notes?.trim() || null);
    }

    if (data.pricing_tier !== undefined && this._hasCol('pricing_tier')) {
      updates.push('pricing_tier = ?');
      params.push(data.pricing_tier === 'master' ? 'master' : 'retail');
    }

    if (data.bonus_points !== undefined && this._hasCol('bonus_points')) {
      updates.push('bonus_points = ?');
      params.push(Number(data.bonus_points) || 0);
    }

    if (
      data.telegram !== undefined ||
      data.telegram_id !== undefined ||
      data.telegram_username !== undefined
    ) {
      const tgRow = {};
      this._applyTelegramToRow(tgRow, data);
      if (this._hasCol('telegram_id') && Object.prototype.hasOwnProperty.call(tgRow, 'telegram_id')) {
        updates.push('telegram_id = ?');
        params.push(tgRow.telegram_id);
      }
      if (
        this._hasCol('telegram_username') &&
        Object.prototype.hasOwnProperty.call(tgRow, 'telegram_username')
      ) {
        updates.push('telegram_username = ?');
        params.push(tgRow.telegram_username);
      }
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(nowSqlInTimeZone());
    params.push(id);

    try {
      this.db.prepare(`
        UPDATE customers 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      const updated = this.getById(id);
      if (data.credit_limit !== undefined) {
        this._safeAuditLog({
          user_id: getCurrentUserId(),
          action: 'customer_credit_limit_update',
          entity_type: 'customer',
          entity_id: id,
          old_values: { credit_limit: Number(existing.credit_limit) || 0 },
          new_values: {
            credit_limit: Number(updated?.credit_limit) || 0,
            credit_limit_currency: updated?.credit_limit_currency || 'UZS',
          },
        });
      }
      return updated;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        if (
          String(error.message || '').includes('phone_normalized') ||
          String(error.message || '').includes('idx_customers_phone_normalized_unique')
        ) {
          throw createError(
            ERROR_CODES.DUPLICATE_PHONE,
            "Bu telefon raqami allaqachon ro'yxatdan o'tgan",
          );
        }
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer code must be unique');
      }
      throw error;
    }
  }

  /**
   * Delete customer
   */
  delete(id) {
    if (!id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    const existing = this.getById(id);

    // Check if customer has orders
    const orderCount = this.db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(id);
    if (orderCount.count > 0) {
      // Soft delete
      this.db.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?').run(
        'inactive',
        nowSqlInTimeZone(),
        id
      );
      return { success: true, softDeleted: true };
    }

    // Soft-delete when balance or payment/ledger history exists (no orders)
    const balances = readCustomerBalances(this.db, id);
    const hasBalance =
      Math.abs(Number(balances.uzs || 0)) > 0.001 || Math.abs(Number(balances.usd || 0)) > 0.001;

    let hasLedger = false;
    if (this._hasTable('customer_ledger')) {
      hasLedger = !!this.db
        .prepare('SELECT 1 AS ok FROM customer_ledger WHERE customer_id = ? LIMIT 1')
        .get(id);
    }

    let hasPayments = false;
    if (this._hasTable('customer_payments')) {
      hasPayments = !!this.db
        .prepare('SELECT 1 AS ok FROM customer_payments WHERE customer_id = ? LIMIT 1')
        .get(id);
    }

    if (hasBalance || hasLedger || hasPayments) {
      this.db.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ?').run(
        'inactive',
        nowSqlInTimeZone(),
        id
      );
      return { success: true, softDeleted: true, reason: 'has_balance_or_history' };
    }

    // Hard delete
    this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);

    return { success: true, softDeleted: false };
  }

  /**
   * Aggregate outstanding customer debt (negative balances only).
   * @returns {{ debt_uzs: number, debt_usd: number }}
   */
  getTotalDebt() {
    // Stored columns only — do not recompute open-order AR (legacy debts stay put).
    const hasUsd = hasCustomerBalanceUsd(this.db);
    const row = this.db
      .prepare(
        hasUsd
          ? `SELECT
               COALESCE(SUM(COALESCE(debt_uzs, CASE WHEN balance < 0 THEN -balance ELSE 0 END)), 0) AS debt_uzs,
               COALESCE(SUM(COALESCE(debt_usd, CASE WHEN balance_usd < 0 THEN -balance_usd ELSE 0 END)), 0) AS debt_usd
             FROM customers
             WHERE COALESCE(status, 'active') = 'active'`
          : `SELECT
               COALESCE(SUM(COALESCE(debt_uzs, CASE WHEN balance < 0 THEN -balance ELSE 0 END)), 0) AS debt_uzs,
               0 AS debt_usd
             FROM customers
             WHERE COALESCE(status, 'active') = 'active'`,
      )
      .get();
    return {
      debt_uzs: Math.round((Number(row?.debt_uzs) || 0) * 100) / 100,
      debt_usd: Math.round((Number(row?.debt_usd) || 0) * 100) / 100,
    };
  }

  /**
   * Update customer balance (for debt/credit operations)
   * Balance logic: negative = debt, positive = prepaid, zero = settled
   * @param {string} customerId - Customer ID
   * @param {number} amount - Amount to add/subtract
   * @param {string} type - 'debt' (add debt, decrease balance) or 'payment' (reduce debt, increase balance)
   */
  updateBalance(customerId, amount, type, currency = 'UZS') {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    this.getById(customerId);
    const amountValue = Number(amount) || 0;
    const cur = normalizeCustomerCurrency(currency);
    const balances = readCustomerBalances(this.db, customerId);
    const currentBalance = cur === 'USD' ? balances.usd : balances.uzs;
    let newBalance;

    if (type === 'debt' || type === 'credit') {
      newBalance = currentBalance - amountValue;
    } else if (type === 'payment') {
      newBalance = Math.min(0, currentBalance + amountValue);
    } else {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Invalid balance update type. Use "payment", "debt", or "credit"');
    }

    const delta = newBalance - currentBalance;
    const now = nowSqlInTimeZone();
    applyCustomerBalanceDelta(this.db, customerId, delta, cur, now);

    if (delta !== 0) {
      this._notifyBalanceChange({
        customerId,
        delta,
        balanceAfter: newBalance,
        currency: cur,
        reason: type === 'payment' ? 'payment_in' : type,
        refId: `adjust-${customerId}-${Date.now()}`,
      });
    }

    return this.getById(customerId);
  }

  /**
   * Receive payment from customer or give money to customer
   * Balance logic: negative = debt, positive = prepaid/credit, zero = settled
   * 
   * Operation:
   * - 'payment_in': Receive money from customer (increases balance)
   *   - balance = balance + amount
   *   - Example: balance = -9000, payment 3000 => new balance = -6000 (reduces debt)
   *   - Example: balance = +9000, payment 3000 => new balance = +12000 (increases credit)
   * - 'payment_out': Give money to customer (decreases balance)
   *   - balance = balance - amount
   *   - Example: balance = +9000, give 3000 => new balance = +6000 (reduces credit)
   *   - Example: balance = 0, give 3000 => new balance = -3000 (creates debt)
   * 
   * This is the SINGLE SOURCE OF TRUTH for customer payment logic.
   */
  /**
   * Insert a customer_payments row for shift drawer rollup WITHOUT changing
   * balance or ledger. Used when a sale TX already applied prior_debt_payment
   * to customers + customer_ledger; shift expected cash still needs this row
   * (see ShiftsService._getCustomerPaymentsShiftRollup).
   *
   * Must run inside the caller's SQLite transaction.
   *
   * @returns {{ payment_id: string, payment_number: string, shift_id: string|null }}
   */
  recordDrawerPaymentOnly({
    customerId,
    amount,
    paymentMethod = 'cash',
    notes = null,
    receivedBy = null,
    orderId = null,
    shiftId = null,
    oldBalance = null,
    newBalance = null,
    operation = 'payment_in',
    paidAt = null,
  } = {}) {
    const normalizedCustomerId =
      customerId != null && customerId !== '' ? String(customerId).trim() : '';
    if (!normalizedCustomerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }
    const amountParsed = parsePositiveMoneyAmount(amount);
    if (!amountParsed.ok) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, amountParsed.error);
    }
    const requestedAmount = amountParsed.amount;
    if (!paymentMethod) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Payment method is required');
    }
    if (operation !== 'payment_in' && operation !== 'payment_out') {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        `Invalid operation type: ${operation}. Must be 'payment_in' or 'payment_out'`
      );
    }

    const resolvedReceivedBy = this._resolveReceivedByForPayment(receivedBy);
    const normalizedOrderId = this._normalizeOrderIdForPayment(orderId);
    const normalizedShiftId = this._normalizeShiftIdForPayment(shiftId);
    const now = paidAt
      ? String(paidAt).replace('T', ' ').replace('Z', '').substring(0, 19)
      : nowSqlUtc();
    const paymentId = randomUUID();
    const paymentNumber = `PAY-${Date.now()}-${paymentId.substring(0, 8).toUpperCase()}`;

    const tableInfo = this.db.prepare('PRAGMA table_info(customer_payments)').all();
    const hasLedgerFields = tableInfo.some((col) => col.name === 'old_balance');
    const hasShiftIdCol = tableInfo.some((col) => col.name === 'shift_id');
    const hasOperationCol = tableInfo.some((col) => col.name === 'operation');

    const cols = [
      'id',
      'payment_number',
      'customer_id',
      'order_id',
      'amount',
      'payment_method',
      'reference_number',
      'notes',
      'received_by',
      'paid_at',
      'created_at',
    ];
    const vals = [
      paymentId,
      paymentNumber,
      normalizedCustomerId,
      normalizedOrderId,
      requestedAmount,
      paymentMethod,
      null,
      notes || null,
      resolvedReceivedBy,
      now,
      now,
    ];
    if (hasLedgerFields) {
      const oldBal =
        oldBalance != null && Number.isFinite(Number(oldBalance)) ? Number(oldBalance) : null;
      const newBal =
        newBalance != null && Number.isFinite(Number(newBalance))
          ? Number(newBalance)
          : oldBal != null
            ? oldBal + (operation === 'payment_out' ? -requestedAmount : requestedAmount)
            : null;
      cols.push('old_balance', 'applied_amount', 'new_balance');
      vals.push(oldBal, requestedAmount, newBal);
    }
    if (hasShiftIdCol) {
      cols.push('shift_id');
      vals.push(normalizedShiftId);
    }
    if (hasOperationCol) {
      cols.push('operation');
      vals.push(operation);
    }
    const ph = cols.map(() => '?').join(', ');
    this.db
      .prepare(`INSERT INTO customer_payments (${cols.join(', ')}) VALUES (${ph})`)
      .run(...vals);

    return {
      payment_id: paymentId,
      payment_number: paymentNumber,
      shift_id: normalizedShiftId,
    };
  }

  /**
   * @param {string} customerId - Customer ID
   * @param {number} amount - Payment amount (must be > 0, always positive)
   * @param {string} paymentMethod - 'cash', 'card', 'click', 'payme', 'transfer', 'other'
   * @param {string} notes - Optional notes
   * @param {string} receivedBy - User ID who received/gave the payment
   * @param {string} orderId - Optional order ID if payment is for specific order
   * @param {string} source - 'pos' or 'customers' (for logging)
   * @param {string} operation - 'payment_in' (receive) or 'payment_out' (give), required
   * @param {string|null} shiftId - ochiq smena ID (kassa / smena hisobi uchun)
   * @returns {Object} { customer_id, old_balance, requested_amount, applied_amount, new_balance, payment_id, payment_number, created_at }
   */
  receivePayment(
    customerId,
    amount,
    paymentMethod = 'cash',
    notes = null,
    receivedBy = null,
    orderId = null,
    source = null,
    operation = 'payment_in',
    shiftId = null,
    currency = 'UZS',
    fxRate = null,
    paymentUuid = null,
    paymentOutKind = null,
    lendAuthorized = false,
    approverUserId = null,
    manualAllocations = null
  ) {
    if (customerId && typeof customerId === 'object' && !Array.isArray(customerId)) {
      const p = customerId;
      return this.receivePayment(
        p.customer_id,
        p.amount,
        p.payment_method || p.method || 'cash',
        p.notes ?? p.note ?? null,
        p.received_by ?? p.receivedBy ?? null,
        p.order_id ?? p.orderId ?? null,
        p.source ?? null,
        p.operation || 'payment_in',
        p.shift_id ?? p.shiftId ?? null,
        p.currency ?? 'UZS',
        p.fx_rate ?? p.fxRate ?? null,
        p.payment_uuid ?? p.paymentUuid ?? null,
        p.payment_out_kind ?? p.paymentOutKind ?? null,
        p.lend_authorized === true || p.lendAuthorized === true,
        p.approver_user_id ?? p.approverUserId ?? null,
        p.allocations ?? p.order_allocations ?? null
      );
    }

    const normalizedCustomerId =
      customerId != null && customerId !== '' ? String(customerId).trim() : '';
    if (!normalizedCustomerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Validation: amount must be positive number (reject 0 / neg / bad format)
    const amountParsed = parsePositiveMoneyAmount(amount);
    if (!amountParsed.ok) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Summa 0 dan katta bo‘lishi kerak.');
    }
    const requestedAmount = amountParsed.amount;

    // Validation: payment method required
    if (!paymentMethod) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'To‘lov usuli majburiy.');
    }

    // Validate operation type
    if (operation !== 'payment_in' && operation !== 'payment_out') {
      throw createError(ERROR_CODES.VALIDATION_ERROR, `Invalid operation type: ${operation}. Must be 'payment_in' or 'payment_out'`);
    }

    const resolvedReceivedBy = this._resolveReceivedByForPayment(receivedBy);
    const normalizedOrderId = this._normalizeOrderIdForPayment(orderId);
    const normalizedShiftId = this._normalizeShiftIdForPayment(shiftId);
    const payCurrency = normalizeCustomerCurrency(currency);
    const payFx =
      payCurrency === 'USD' ? Number(fxRate ?? 0) : null;
    if (payCurrency === 'USD' && (!Number.isFinite(payFx) || payFx <= 0)) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'fx_rate is required for USD customer payments (UZS per 1 USD)'
      );
    }

    const normalizedPaymentUuid =
      paymentUuid != null && String(paymentUuid).trim() !== ''
        ? String(paymentUuid).trim()
        : null;

    if (Array.isArray(manualAllocations) && manualAllocations.length > 0) {
      const allocRoles = this._getUserRoleCodes(resolvedReceivedBy);
      if (!roleCanManualPaymentAllocation(allocRoles)) {
        throw createError(
          ERROR_CODES.FORBIDDEN,
          'Qo‘lda taqsimlash faqat menejer yoki admin uchun.'
        );
      }
    }

    // Use transaction for atomicity and consistency
    const result = this.db.transaction(() => {
      const paymentId = randomUUID();
      const paymentNumber = `PAY-${Date.now()}-${paymentId.substring(0, 8).toUpperCase()}`;
      // Idempotency: client payment_uuid (retry-safe) or fresh paymentId — never order_id
      // (multiple partial payments against one order must each apply).
      const ledgerRefId = normalizedPaymentUuid ? `pay-${normalizedPaymentUuid}` : paymentId;

      if (hasCustomerLedgerRef(this.db, ledgerRefId)) {
        const ledgerRow = this.db
          .prepare(
            `SELECT amount, balance_after, ref_no, created_at FROM customer_ledger WHERE ref_id = ? LIMIT 1`
          )
          .get(ledgerRefId);
        const customer = this.getById(normalizedCustomerId);
        const finalBalances = readCustomerBalances(this.db, normalizedCustomerId);
        const ledgerAmount = Number(ledgerRow?.amount || 0);
        const ledgerBalanceAfter = Number(ledgerRow?.balance_after || 0);
        return {
          success: true,
          duplicate: true,
          customer_id: normalizedCustomerId,
          currency: payCurrency,
          old_balance: ledgerBalanceAfter - ledgerAmount,
          new_balance: ledgerBalanceAfter,
          old_balance_uzs: finalBalances.uzs - (payCurrency === 'UZS' ? ledgerAmount : 0),
          new_balance_uzs: finalBalances.uzs,
          old_balance_usd: finalBalances.usd - (payCurrency === 'USD' ? ledgerAmount : 0),
          new_balance_usd: finalBalances.usd,
          requested_amount: requestedAmount,
          applied_amount: Math.abs(ledgerAmount),
          signed_amount: ledgerAmount,
          payment_id: paymentId,
          payment_number: ledgerRow?.ref_no || paymentNumber,
          created_at: ledgerRow?.created_at || nowSqlUtc(),
          operation,
        };
      }

      // Read current customer balance
      const customer = this.getById(normalizedCustomerId);
      if (!customer) {
        throw createError(ERROR_CODES.NOT_FOUND, 'Mijoz topilmadi.');
      }
      const customerStatus = String(customer.status || 'active').toLowerCase();
      if (customerStatus && customerStatus !== 'active') {
        throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mijoz faol emas. Operatsiya bloklandi.');
      }
      const balancesBefore = readCustomerBalances(this.db, normalizedCustomerId);
      const oldBalance = readBalanceInCurrency(this.db, normalizedCustomerId, payCurrency);
      const bucketsBefore = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
      const posBefore = computeCustomerPosition(this.db, normalizedCustomerId, payCurrency);

      let paymentOutMeta = null;
      if (operation === 'payment_out') {
        const actorRoles = this._getUserRoleCodes(resolvedReceivedBy);
        const outGate = assertPaymentOutAllowed({
          oldBalance,
          amount: requestedAmount,
          roles: actorRoles,
          kindRequested: paymentOutKind,
          reason: notes,
          creditLimit: customer?.credit_limit,
          lendAuthorized: lendAuthorized === true,
          currentDebt: posBefore.total_debt,
          currentAdvance: posBefore.advance,
        });
        if (!outGate.ok) {
          throw createError(
            outGate.code === 'LEND_FORBIDDEN' || outGate.code === 'PAYOUT_FORBIDDEN'
              ? ERROR_CODES.FORBIDDEN
              : ERROR_CODES.VALIDATION_ERROR,
            outGate.error,
            {
              code: outGate.code,
              advance: outGate.advance,
              amount: outGate.amount,
              debt_created: outGate.debt_created,
              new_debt: outGate.new_debt,
              new_advance: outGate.new_advance,
              current_debt: outGate.current_debt,
              credit_limit: outGate.credit_limit,
              over_by: outGate.over_by,
            }
          );
        }
        paymentOutMeta = outGate;
      }
      
      // Calculate signed amount based on operation type
      // CRITICAL: amount is always positive from UI, backend applies the sign
      let signedAmount = requestedAmount;
      if (operation === 'payment_out') {
        signedAmount = -requestedAmount; // Negative for giving money
      }
      // For 'payment_in', signedAmount remains positive (receiving money increases balance)
      
      // Calculate new balance: balance = balance + signedAmount
      // payment_in: balance = balance + amount (increases)
      // payment_out payout: balance = balance - amount (decreases / nets advance)
      // payment_out lend: net = advance - (debt + amount); advance unchanged
      const isExplicitLend = operation === 'payment_out' && paymentOutMeta?.kind === 'lend';
      const newBalance = isExplicitLend
        ? Number(paymentOutMeta.new_balance)
        : oldBalance + signedAmount;
      const allocation =
        operation === 'payment_in'
          ? (() => {
              // Dual-bucket: close debt first, excess → advance (do not use signed net alone)
              const debtPortion = Math.min(requestedAmount, bucketsBefore.debt);
              const advancePortion = Math.max(0, requestedAmount - debtPortion);
              return {
                debt_portion: Math.round(debtPortion * 100) / 100,
                advance_portion: Math.round(advancePortion * 100) / 100,
                new_balance:
                  Math.round(
                    (bucketsBefore.advance + advancePortion - (bucketsBefore.debt - debtPortion)) *
                      100,
                  ) / 100,
              };
            })()
          : { debt_portion: 0, advance_portion: 0, new_balance: newBalance };

      // UTC-naive (same as sales/returns ledger) so Hisob tarixi sorts with one clock.
      const now = nowSqlUtc();

      // Log payment operation for debugging
      const operationLabel = operation === 'payment_in' ? 'Receiving' : 'Giving';
      console.log(`💰 ${operationLabel} customer payment:`, {
        customer_id: normalizedCustomerId,
        customer_name: customer.name,
        operation: operation,
        old_balance: oldBalance,
        requested_amount: requestedAmount,
        signed_amount: signedAmount,
        new_balance: newBalance,
        debt_portion: allocation.debt_portion,
        advance_portion: allocation.advance_portion,
        payment_out_kind: paymentOutMeta?.kind || null,
        debt_before: bucketsBefore.debt,
        advance_before: bucketsBefore.advance,
        method: paymentMethod,
        source: source || 'unknown',
        balance_type: oldBalance < 0 ? 'debt' : oldBalance > 0 ? 'credit' : 'zero'
      });

      // Assertion: verify calculations are correct
      if (operation === 'payment_in' && signedAmount !== requestedAmount) {
        throw new Error(`CRITICAL: For payment_in, signed_amount (${signedAmount}) must equal requested_amount (${requestedAmount})`);
      }
      if (operation === 'payment_out' && signedAmount !== -requestedAmount) {
        throw new Error(`CRITICAL: For payment_out, signed_amount (${signedAmount}) must equal -requested_amount (${-requestedAmount})`);
      }
      if (isExplicitLend) {
        const expectedNet =
          Math.round((bucketsBefore.advance - (posBefore.total_debt + requestedAmount)) * 100) / 100;
        if (Math.abs(Number(paymentOutMeta.new_balance) - expectedNet) > 1e-6) {
          throw new Error(
            `CRITICAL: lend new_balance (${paymentOutMeta.new_balance}) must equal advance - (exposure + amount) (${expectedNet})`
          );
        }
      }

      // Update customer balance atomically (idempotent per ledger ref_id)
      // Explicit lend: increase debt only — never consume advance.
      // Payment in: FIFO onto open orders, leftover closes loan then advance.
      let inboundAlloc = { allocations: [], remainder: 0, applied_to_orders: 0 };
      let inboundOpType = CUSTOMER_OP.CUSTOMER_PAYMENT;
      let applyResult;
      if (isExplicitLend) {
        applyResult = applyCustomerLendDeltaOnce(
            this.db,
            normalizedCustomerId,
            requestedAmount,
            payCurrency,
            ledgerRefId,
            now
          );
      } else if (operation === 'payment_in') {
        if (posBefore.open_order_debt > 0.009 || (Array.isArray(manualAllocations) && manualAllocations.length)) {
          inboundAlloc = allocateInboundToOpenOrders(this.db, {
            customerId: normalizedCustomerId,
            paymentId,
            amount: requestedAmount,
            currency: payCurrency,
            preferredOrderId: normalizedOrderId,
            paymentMethod,
            fxRate: payFx,
            shiftId: normalizedShiftId,
            createdAt: now,
            createdBy: resolvedReceivedBy,
            cashDocId: paymentNumber,
            manualAllocations,
          });
        }
        applyResult = applyCustomerBalanceDeltaOnce(
          this.db,
          normalizedCustomerId,
          signedAmount,
          payCurrency,
          ledgerRefId,
          now
        );
        inboundOpType = classifyInboundOpType(
          inboundAlloc.applied_to_orders || Math.min(requestedAmount, bucketsBefore.debt),
          Math.max(0, requestedAmount - Math.min(requestedAmount, bucketsBefore.debt)),
          0
        );
      } else {
        applyResult = applyCustomerBalanceDeltaOnce(
            this.db,
            normalizedCustomerId,
            signedAmount,
            payCurrency,
            ledgerRefId,
            now
          );
      }
      if (!applyResult.applied) {
        throw new Error(`CRITICAL: balance replay guard failed for ref_id ${ledgerRefId}`);
      }
      void applyResult.balances;

      const bucketsAfter = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
      const actualNewBalance = readBalanceInCurrency(this.db, normalizedCustomerId, payCurrency);
      const paymentInDebtPortion = roundCustomerMoney(
        Math.min(requestedAmount, bucketsBefore.debt)
      );
      const paymentInAdvancePortion = roundCustomerMoney(
        Math.max(0, requestedAmount - paymentInDebtPortion)
      );

      // Generate payment ID and number (ledgerRefId uses paymentId when no order)
      
      // Insert ledger entry (single source of truth for balance changes)
      // Check if customer_ledger table exists before inserting
      try {
        const tableExists = this.db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='customer_ledger'
        `).get();
        
        if (tableExists) {
          // Check if method column exists
          const tableInfo = this.db.prepare('PRAGMA table_info(customer_ledger)').all();
          const hasMethodColumn = tableInfo.some((col) => col.name === 'method');
          const hasLedgerCur = hasCustomerLedgerCurrency(this.db);
          const hasLedgerBalUsd = tableInfo.some((col) => col.name === 'balance_after_usd');
          const balancesAfter = readCustomerBalances(this.db, normalizedCustomerId);
          
          const ledgerId = randomUUID();
          // Ledger type matches operation type
          const ledgerNote =
            operation === 'payment_in'
              ? notes ||
                `Pul qabul qilindi: ${paymentMethod} (buyurtmalar: ${inboundAlloc.applied_to_orders || 0}; oldindan: ${inboundAlloc.remainder || 0})`
              : paymentOutMeta?.kind === 'lend'
                ? notes ||
                  `Mijozga yangi qarz berildi: ${paymentMethod}; yangi qarz: ${paymentOutMeta.new_debt ?? bucketsAfter.debt}; avans: ${bucketsAfter.advance}`
                : notes || `Mijoz avansi qaytarildi: ${paymentMethod}`;
          const opCode = ledgerOpCodeForPayment(operation, paymentOutMeta?.kind, inboundOpType);
          
          const ledgerCols = [
            'id',
            'customer_id',
            'type',
            'ref_id',
            'ref_no',
            'amount',
            'balance_after',
            'note',
          ];
          const ledgerVals = [
            ledgerId,
            normalizedCustomerId,
            operation,
            ledgerRefId,
            paymentNumber,
            signedAmount,
            actualNewBalance,
            ledgerNote,
          ];
          if (hasLedgerCur) {
            ledgerCols.push('currency');
            ledgerVals.push(payCurrency);
          }
          if (hasLedgerBalUsd) {
            ledgerCols.push('balance_after_usd');
            ledgerVals.push(balancesAfter.usd);
          }
          if (hasMethodColumn) {
            ledgerCols.push('method');
            ledgerVals.push(paymentMethod);
          }
          appendLedgerAuditCols(this.db, ledgerCols, ledgerVals, {
            op_code: opCode,
            debt_before: posBefore.total_debt,
            debt_after: bucketsAfter.debt,
            advance_before: bucketsBefore.advance,
            advance_after: bucketsAfter.advance,
          });
          ledgerCols.push('created_at', 'created_by');
          ledgerVals.push(now, resolvedReceivedBy);
          const ph = ledgerCols.map(() => '?').join(', ');
          this.db
            .prepare(`INSERT INTO customer_ledger (${ledgerCols.join(', ')}) VALUES (${ph})`)
            .run(...ledgerVals);
          console.log('✅ Ledger entry inserted for payment:', { customerId: normalizedCustomerId, operation, signedAmount, newBalance });
        } else {
          throw new Error('customer_ledger jadvali topilmadi. Migratsiyani ishga tushiring.');
        }
      } catch (ledgerError) {
        console.error('❌ Failed to insert ledger entry:', ledgerError.message);
        throw ledgerError;
      }

      // Insert payment record into ledger with all balance tracking fields
      const tableInfo = this.db.prepare('PRAGMA table_info(customer_payments)').all();
      const hasLedgerFields = tableInfo.some((col) => col.name === 'old_balance');
      const hasShiftIdCol = tableInfo.some((col) => col.name === 'shift_id');
      const hasOperationCol = tableInfo.some((col) => col.name === 'operation');

      const cols = [
        'id',
        'payment_number',
        'customer_id',
        'order_id',
        'amount',
        'payment_method',
        'reference_number',
        'notes',
        'received_by',
        'paid_at',
        'created_at',
      ];
      const vals = [
        paymentId,
        paymentNumber,
        normalizedCustomerId,
        normalizedOrderId,
        requestedAmount,
        paymentMethod,
        null,
        notes || null,
        resolvedReceivedBy,
        now,
        now,
      ];
      if (hasLedgerFields) {
        cols.push('old_balance', 'applied_amount', 'new_balance');
        vals.push(oldBalance, requestedAmount, newBalance);
      }
      if (hasShiftIdCol) {
        cols.push('shift_id');
        vals.push(normalizedShiftId);
      }
      if (hasOperationCol) {
        cols.push('operation');
        vals.push(operation);
      }
      const hasOpType = tableInfo.some((col) => col.name === 'op_type');
      const payOpType =
        operation === 'payment_out' && paymentOutMeta?.kind === 'lend'
          ? CUSTOMER_OP.CUSTOMER_LOAN_ISSUED
          : operation === 'payment_out'
            ? CUSTOMER_OP.ADVANCE_REFUND
            : inboundOpType;
      if (hasOpType) {
        cols.push('op_type');
        vals.push(payOpType);
      }
      if (tableInfo.some((col) => col.name === 'remainder_to_advance')) {
        cols.push('remainder_to_advance');
        vals.push(
          operation === 'payment_in'
            ? inboundAlloc.remainder > 0.009
              ? inboundAlloc.remainder
              : paymentInAdvancePortion
            : 0
        );
      }
      if (tableInfo.some((col) => col.name === 'direction')) {
        cols.push('direction');
        vals.push(operation === 'payment_out' ? 'out' : 'in');
      }
      const ph = cols.map(() => '?').join(', ');
      this.db
        .prepare(`INSERT INTO customer_payments (${cols.join(', ')}) VALUES (${ph})`)
        .run(...vals);

      // Track non-order loan repayment so position.loan_debt drops (no second cash movement).
      if (operation === 'payment_in' && hasOpType) {
        const loanNetBefore = roundCustomerMoney(
          Math.max(0, Number(posBefore.loan_issued || 0) - Number(posBefore.loan_repaid || 0))
        );
        const loanRepay = roundCustomerMoney(
          Math.min(
            loanNetBefore,
            Math.max(0, paymentInDebtPortion - (inboundAlloc.applied_to_orders || 0))
          )
        );
        if (loanRepay > 0.009) {
          const repayId = randomUUID();
          const repayNumber = `LR-${Date.now()}-${repayId.substring(0, 8).toUpperCase()}`;
          const rCols = [
            'id',
            'payment_number',
            'customer_id',
            'order_id',
            'amount',
            'payment_method',
            'reference_number',
            'notes',
            'received_by',
            'paid_at',
            'created_at',
          ];
          const rVals = [
            repayId,
            repayNumber,
            normalizedCustomerId,
            null,
            loanRepay,
            paymentMethod,
            paymentId,
            `CUSTOMER_LOAN_REPAID ref ${paymentNumber}`,
            resolvedReceivedBy,
            now,
            now,
          ];
          if (hasLedgerFields) {
            rCols.push('old_balance', 'applied_amount', 'new_balance');
            rVals.push(actualNewBalance, loanRepay, actualNewBalance);
          }
          if (hasShiftIdCol) {
            rCols.push('shift_id');
            rVals.push(normalizedShiftId);
          }
          if (hasOperationCol) {
            rCols.push('operation');
            // Not payment_in: cash-flow reports must not double-count this allocation row.
            rVals.push('loan_repay');
          }
          rCols.push('op_type');
          rVals.push(CUSTOMER_OP.CUSTOMER_LOAN_REPAID);
          if (tableInfo.some((col) => col.name === 'direction')) {
            rCols.push('direction');
            rVals.push('in');
          }
          const rPh = rCols.map(() => '?').join(', ');
          this.db
            .prepare(`INSERT INTO customer_payments (${rCols.join(', ')}) VALUES (${rPh})`)
            .run(...rVals);
        }
      }

      if (isExplicitLend) {
        const posLend = computeCustomerPosition(this.db, normalizedCustomerId, payCurrency);
        const loanNet = roundCustomerMoney(
          Math.max(0, Number(posLend.loan_issued || 0) - Number(posLend.loan_repaid || 0))
        );
        const floor = roundCustomerMoney(posLend.open_order_debt + loanNet);
        const b = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
        if (floor > b.debt + 0.02) {
          writeDebtAdvanceNet(this.db, normalizedCustomerId, payCurrency, floor, b.advance, now);
        }
      }

      if (operation === 'payment_in') {
        try {
          recordPaymentFee(this.db, {
            paymentId,
            orderId: normalizedOrderId,
            paymentMethod,
            paymentAmount: requestedAmount,
            currency: payCurrency,
            fxRate: payFx,
            source: 'customer_payments',
            createdAt: now,
          });
        } catch (feeErr) {
          console.warn('[CustomersService.receivePayment] payment fee skipped:', feeErr?.message || feeErr);
        }
      }

      const bucketsFinal = readCustomerDebtAdvance(this.db, normalizedCustomerId, payCurrency);
      const finalBalances = readCustomerBalances(this.db, normalizedCustomerId);
      const posFinal = computeCustomerPosition(this.db, normalizedCustomerId, payCurrency);

      return {
        success: true,
        customer_id: normalizedCustomerId,
        currency: payCurrency,
        old_balance: oldBalance,
        new_balance: finalBalances[payCurrency === 'USD' ? 'usd' : 'uzs'],
        old_balance_uzs: balancesBefore.uzs,
        new_balance_uzs: finalBalances.uzs,
        old_balance_usd: balancesBefore.usd,
        new_balance_usd: finalBalances.usd,
        old_debt: posBefore.total_debt,
        new_debt: posFinal.total_debt,
        old_advance: bucketsBefore.advance,
        new_advance: bucketsFinal.advance,
        requested_amount: requestedAmount,
        applied_amount: requestedAmount,
        signed_amount: signedAmount,
        debt_portion: operation === 'payment_in' ? paymentInDebtPortion : allocation.debt_portion,
        advance_portion: operation === 'payment_in' ? paymentInAdvancePortion : allocation.advance_portion,
        allocations: inboundAlloc.allocations || [],
        applied_to_orders: inboundAlloc.applied_to_orders || 0,
        remainder_to_advance:
          operation === 'payment_in'
            ? inboundAlloc.remainder > 0.009
              ? inboundAlloc.remainder
              : paymentInAdvancePortion
            : 0,
        position: posFinal,
        op_type: payOpType,
        payment_out_kind: paymentOutMeta?.kind || null,
        debt_created: paymentOutMeta?.debt_created ?? 0,
        payment_id: paymentId,
        payment_number: paymentNumber,
        created_at: now,
        operation,
        approver_user_id: paymentOutMeta?.kind === 'lend' ? approverUserId || resolvedReceivedBy : null,
      };
    })();

    if (result && !result.duplicate && Number(result.signed_amount) !== 0) {
      this._notifyBalanceChange({
        customerId: result.customer_id,
        delta: result.signed_amount,
        balanceAfter: result.new_balance,
        currency: result.currency,
        reason: result.operation || 'payment_in',
        refId: result.payment_id,
        paymentNumber: result.payment_number || null,
        totalAmount: Math.abs(Number(result.applied_amount || result.signed_amount || 0)),
        customerName: null,
      });
    }

    if (result && !result.duplicate) {
      if (result.operation === 'payment_out') {
        this._safeAuditLog({
          user_id: resolvedReceivedBy,
          action: result.payment_out_kind === 'lend' ? 'customer_lend' : 'customer_payout',
          entity_type: 'customer',
          entity_id: result.customer_id,
          old_values: {
            balance: result.old_balance,
            open_debt: result.old_debt ?? Math.max(0, -Number(result.old_balance) || 0),
            advance: result.old_advance ?? Math.max(0, Number(result.old_balance) || 0),
          },
          new_values: {
            balance: result.new_balance,
            open_debt: result.new_debt ?? Math.max(0, -Number(result.new_balance) || 0),
            advance: result.new_advance ?? Math.max(0, Number(result.new_balance) || 0),
            amount: result.applied_amount,
            kind: result.payment_out_kind,
            debt_created: result.debt_created,
            payment_id: result.payment_id,
            payment_method: paymentMethod,
            currency: result.currency,
            credit_limit: Number(this.getById(result.customer_id)?.credit_limit) || 0,
            approver_user_id: result.approver_user_id,
            notes: notes || null,
            operation_name: result.payment_out_kind === 'lend' ? 'Pul berildi' : 'Avans qaytarildi',
            income: 0,
            expense: result.applied_amount,
          },
        });
      } else if (result.operation === 'payment_in') {
        this._safeAuditLog({
          user_id: resolvedReceivedBy,
          action: 'customer_payment_in',
          entity_type: 'customer',
          entity_id: result.customer_id,
          old_values: {
            balance: result.old_balance,
            open_debt: result.old_debt ?? Math.max(0, -Number(result.old_balance) || 0),
            advance: result.old_advance ?? Math.max(0, Number(result.old_balance) || 0),
          },
          new_values: {
            balance: result.new_balance,
            open_debt: result.new_debt ?? Math.max(0, -Number(result.new_balance) || 0),
            advance: result.new_advance ?? Math.max(0, Number(result.new_balance) || 0),
            amount: result.applied_amount,
            debt_portion: result.debt_portion,
            advance_portion: result.advance_portion,
            payment_id: result.payment_id,
            payment_method: paymentMethod,
            currency: result.currency,
            notes: notes || null,
          },
        });
      }
    }

    return result;
  }

  /**
   * Fire-and-forget customer Telegram DM for payments / balance adjusts (not staff channel).
   */
  _notifyBalanceChange(payload) {
    try {
      const { fireCustomerOpsNotify } = require('../../public-api/lib/customerOpsNotify.cjs');
      fireCustomerOpsNotify(this.db, payload);
    } catch (e) {
      console.warn('[customers] customer ops notify unavailable:', e?.message || e);
    }
  }

  _safeAuditLog(data) {
    try {
      const has = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'`)
        .get();
      if (!has) return;
      const id = randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
        INSERT INTO audit_log (
          id, user_id, action, entity_type, entity_id,
          old_values, new_values, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `
        )
        .run(
          id,
          data.user_id || null,
          data.action,
          data.entity_type,
          data.entity_id || null,
          data.old_values ? JSON.stringify(data.old_values) : null,
          data.new_values ? JSON.stringify(data.new_values) : null,
          now
        );
    } catch (e) {
      console.warn('[customers] audit log skipped:', e?.message || e);
    }
  }

  _getNumericSetting(key, fallback) {
    const raw = this._getSettingRaw(key);
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  _attachPaymentAllocations(rows, idField = 'id') {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return list;
    try {
      const exists = this.db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='customer_payment_allocations'`)
        .get();
      if (!exists) return list.map((r) => ({ ...r, allocations: [] }));
      const ids = [...new Set(list.map((r) => r?.[idField]).filter(Boolean))];
      if (!ids.length) return list.map((r) => ({ ...r, allocations: [] }));
      const ph = ids.map(() => '?').join(',');
      const allocs = this.db
        .prepare(
          `SELECT * FROM customer_payment_allocations WHERE payment_id IN (${ph}) ORDER BY created_at ASC`
        )
        .all(...ids);
      const byPay = new Map();
      for (const a of allocs || []) {
        const key = String(a.payment_id);
        if (!byPay.has(key)) byPay.set(key, []);
        byPay.get(key).push({
          ...a,
          allocated_amount: Number(a.allocated_amount ?? a.applied_amount ?? 0),
        });
      }
      return list.map((r) => ({
        ...r,
        allocations: byPay.get(String(r[idField] || '')) || [],
      }));
    } catch {
      return list.map((r) => ({ ...r, allocations: r.allocations || [] }));
    }
  }

  /**
   * List customer payments (customer_payments table)
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Optional: { limit, offset }
   * @returns {Array} Array of payment rows
   */
  getPayments(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    let query = `
      SELECT cp.*
      FROM customer_payments cp
      WHERE cp.customer_id = ?
      ORDER BY cp.created_at DESC
    `;
    const params = [customerId];

    const limit = Number(filters.limit ?? 200);
    const offset = Number(filters.offset ?? 0);
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = this.db.prepare(query).all(params);
    return this._attachPaymentAllocations(rows, 'id');
  }

  /**
   * Get customer ledger (account history)
   * Returns all balance-changing events for a customer
   * 
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Optional filters: { limit, offset, from, to, type }
   * @returns {Array} Array of ledger entries
   */
  getLedger(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Check if customer_ledger table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='customer_ledger'
    `).get();

    if (!tableExists) {
      console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
      return [];
    }

    // Check if method column exists in customer_ledger table
    const tableInfo = this.db.prepare("PRAGMA table_info(customer_ledger)").all();
    const hasMethodColumn = tableInfo.some(col => col.name === 'method');
    const hasOpCode = tableInfo.some((col) => col.name === 'op_code');
    const hasDebtAudit = tableInfo.some((col) => col.name === 'debt_before');
    const hasLedgerCur = hasCustomerLedgerCurrency(this.db);
    
    // Build query based on actual schema
    const methodColumn = hasMethodColumn ? 'customer_ledger.method' : 'NULL as method';
    const opCodeColumn = hasOpCode ? 'customer_ledger.op_code' : 'NULL as op_code';
    const currencyColumn = hasLedgerCur ? 'customer_ledger.currency' : `'UZS' as currency`;
    const debtAuditColumns = hasDebtAudit
      ? 'customer_ledger.debt_before, customer_ledger.debt_after, customer_ledger.advance_before, customer_ledger.advance_after'
      : 'NULL as debt_before, NULL as debt_after, NULL as advance_before, NULL as advance_after';
    const staff = this._staffNameSql('customer_ledger.created_by');
    const hasOrders = this._hasTable('orders');
    const orderPaidSelect = hasOrders
      ? 'o.paid_amount AS order_paid_amount, o.total_amount AS order_total_amount'
      : 'NULL AS order_paid_amount, NULL AS order_total_amount';
    const orderJoin = hasOrders
      ? 'LEFT JOIN orders o ON o.id = customer_ledger.ref_id'
      : '';
    let query = `
      SELECT 
        customer_ledger.id,
        customer_ledger.customer_id,
        customer_ledger.type,
        customer_ledger.ref_id,
        customer_ledger.ref_no,
        customer_ledger.amount,
        customer_ledger.balance_after,
        customer_ledger.note,
        ${methodColumn},
        ${opCodeColumn},
        ${currencyColumn},
        ${debtAuditColumns},
        customer_ledger.created_at,
        customer_ledger.created_by,
        ${staff.select},
        ${orderPaidSelect}
      FROM customer_ledger
      ${staff.join}
      ${orderJoin}
      WHERE customer_ledger.customer_id = ?
    `;
    const params = [customerId];

    // Filter by type if provided
    if (filters.type && filters.type !== 'all') {
      query += ' AND customer_ledger.type = ?';
      params.push(filters.type);
    }

    // Filter by date range if provided
    if (filters.from) {
      query += ` AND ${this._tzDateExpr('customer_ledger.created_at')} >= date(?)`;
      params.push(filters.from);
    }
    if (filters.to) {
      query += ` AND ${this._tzDateExpr('customer_ledger.created_at')} <= date(?)`;
      params.push(filters.to);
    }

    // Order by normalized datetime + id for stable ties.
    // Default DESC for backward compatibility; CustomerDetail passes order: 'asc'.
    // substr(1,19) after T/Z normalize keeps datetime() valid across ISO / offset / fractional forms.
    const orderRaw = String(filters.order || filters.sort || "desc").toLowerCase();
    const orderDir = orderRaw === "asc" || orderRaw === "oldest" ? "ASC" : "DESC";
    const orderTs = sqlNormalizeDatetimeExpr('customer_ledger.created_at');
    query += ` ORDER BY ${orderTs} ${orderDir}, customer_ledger.id ${orderDir}`;

    // Apply limit and offset if provided
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    } else {
      // Default limit if not provided
      query += ' LIMIT 100';
    }

    try {
      const results = this.db.prepare(query).all(params);
      console.log(`✅ Fetched ${results.length} ledger entries for customer ${customerId}`);
      return this._attachPaymentAllocations(results, 'ref_id');
    } catch (error) {
      console.error('❌ Error fetching ledger:', error.message);
      return [];
    }
  }

  /**
   * Get customer ledger count
   * Returns total number of ledger entries for a customer
   * 
   * @param {string} customerId - Customer ID
   * @returns {number} Total count of ledger entries
   */
  getLedgerCount(customerId) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }

    // Check if customer_ledger table exists
    const tableExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='customer_ledger'
    `).get();

    if (!tableExists) {
      console.warn('⚠️ customer_ledger table does not exist. Run migration 020_create_customer_ledger.sql');
      return 0;
    }

    try {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM customer_ledger
        WHERE customer_id = ?
      `).get(customerId);
      
      return result?.count || 0;
    } catch (error) {
      console.error('❌ Error fetching ledger count:', error.message);
      return 0;
    }
  }

  _getUserRoleCodes(userId) {
    if (!userId) return [];
    try {
      const rows = this.db
        .prepare(
          `
        SELECT r.code
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `
        )
        .all(userId);
      return (rows || []).map((r) => String(r.code));
    } catch {
      return [];
    }
  }

  _staffNameSql(createdByExpr) {
    try {
      const hasUsers = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
        .get();
      if (!hasUsers) return { select: 'NULL AS created_by_name', join: '' };
      return {
        select: `COALESCE(NULLIF(TRIM(u_staff.full_name), ''), u_staff.username, ${createdByExpr}) AS created_by_name`,
        join: `LEFT JOIN users u_staff ON u_staff.id = ${createdByExpr}`,
      };
    } catch {
      return { select: 'NULL AS created_by_name', join: '' };
    }
  }

  /**
   * Bonus points ledger (earn / redeem / adjust)
   */
  getBonusLedger(customerId, filters = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Customer ID is required');
    }
    const t = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    if (!t) return [];

    const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100)));
    const offset = Math.max(0, Number(filters.offset ?? 0));

    let query = `
      SELECT id, customer_id, type, points, order_id, note, created_at, created_by
      FROM customer_bonus_ledger
      WHERE customer_id = ?
    `;
    const params = [customerId];
    if (filters.type && filters.type !== 'all') {
      query += ' AND type = ?';
      params.push(filters.type);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    try {
      return this.db.prepare(query).all(params);
    } catch (e) {
      console.error('getBonusLedger:', e?.message || e);
      return [];
    }
  }

  /**
   * Admin/manager adjustment to bonus_points with audit row.
   */
  adjustBonusPoints(actorUserId, customerId, deltaPoints, note, opts = {}) {
    if (!customerId) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Mijoz ID kerak');
    }
    if (!this._hasCol('bonus_points')) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'bonus_points ustuni mavjud emas');
    }

    const t = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='customer_bonus_ledger'`)
      .get();
    if (!t) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'customer_bonus_ledger jadvali topilmadi');
    }

    const cust = this.db.prepare('SELECT bonus_points FROM customers WHERE id = ?').get(customerId);
    if (!cust) {
      throw createError(ERROR_CODES.NOT_FOUND, 'Mijoz topilmadi');
    }
    const before = Number(cust.bonus_points) || 0;
    const roles = this._getUserRoleCodes(actorUserId);
    const perOp = this._getNumericSetting(
      'customers.bonus.correction_per_op',
      DEFAULT_BONUS_CORRECTION_PER_OP
    );
    const perDay = this._getNumericSetting(
      'customers.bonus.correction_per_day',
      DEFAULT_BONUS_CORRECTION_PER_DAY
    );
    const largeAt = this._getNumericSetting(
      'customers.bonus.large_threshold',
      DEFAULT_BONUS_LARGE_CORRECTION
    );

    let dayUsedAbs = 0;
    try {
      const today = formatYmdInTimeZone(new Date());
      const row = this.db
        .prepare(
          `
          SELECT COALESCE(SUM(ABS(points)), 0) AS used
          FROM customer_bonus_ledger
          WHERE customer_id = ?
            AND type = 'adjust'
            AND date(created_at) = date(?)
        `
        )
        .get(customerId, today);
      dayUsedAbs = Number(row?.used || 0) || 0;
    } catch {
      dayUsedAbs = 0;
    }

    const gate = assertBonusCorrection({
      delta: deltaPoints,
      reason: note,
      beforeBalance: before,
      allowNegative: false,
      perOpLimit: perOp,
      perDayLimit: perDay,
      dayUsedAbs,
      largeThreshold: largeAt,
      roles,
      largeApproved: opts.largeApproved === true || opts.large_approved === true,
      authorized: opts.authorized === true,
    });
    if (!gate.ok) {
      throw createError(
        gate.code === 'BONUS_FORBIDDEN' ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR,
        gate.error,
        { code: gate.code, threshold: gate.threshold, limit: gate.limit }
      );
    }

    const after = gate.after;
    const now = nowSqlInTimeZone();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE customers SET bonus_points = ?, updated_at = ? WHERE id = ?')
        .run(after, now, customerId);
      const lid = randomUUID();
      this.db
        .prepare(
          `INSERT INTO customer_bonus_ledger (id, customer_id, type, points, order_id, note, created_at, created_by)
           VALUES (?, ?, 'adjust', ?, NULL, ?, ?, ?)`
        )
        .run(lid, customerId, gate.delta, gate.reason, now, actorUserId || null);
    })();

    this._safeAuditLog({
      user_id: actorUserId,
      action: 'customer_bonus_adjust',
      entity_type: 'customer',
      entity_id: customerId,
      old_values: { bonus_points: before },
      new_values: { bonus_points: after, delta: gate.delta, note: gate.reason },
    });

    return this.getById(customerId);
  }

  /**
   * Export customers to CSV file
   * @param {Object} filters - Filters to apply (same as list method)
   * @param {Object} browserWindow - Electron BrowserWindow instance (optional, for dialog)
   * @returns {Promise<Object>} { cancelled: boolean, path?: string, count?: number }
   */
  async exportCsv(filters = {}, browserWindow = null) {
    try {
      // Authz bound to session only — never trust client actorUserId spoof.
      const actorUserId = getCurrentUserId() || null;
      const roles = this._getUserRoleCodes(actorUserId);
      if (!roleCanExportCustomers(roles)) {
        throw createError(ERROR_CODES.FORBIDDEN, 'Mijozlar eksporti faqat admin uchun');
      }

      // Get customers using existing list method
      const customers = this.list(filters);

      if (customers.length === 0) {
        return { cancelled: false, path: null, count: 0, message: 'No customers to export' };
      }

      // Privacy: mask phones on export unless admin explicitly requests full phones
      const unmask = filters?.unmaskPhones === true || filters?.maskPhones === false;

      // Build CSV content
      const hasBalanceUsd = hasCustomerBalanceUsd(this.db);
      const headers = [
        'id',
        'name',
        'phone',
        'type',
        'status',
        'balance',
        ...(hasBalanceUsd ? ['balance_usd'] : []),
        'total_sales',
        'last_order_date',
        'created_at',
      ];

      // CSV escape function
      const escapeCsv = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        // If contains comma, quote, or newline, wrap in quotes and escape quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Build CSV rows
      const csvRows = [
        headers.join(',') // Header row
      ];

      for (const customer of customers) {
        const phoneOut = unmask ? customer.phone : maskPhoneForExport(customer.phone);
        const row = [
          escapeCsv(customer.id),
          escapeCsv(customer.name),
          escapeCsv(phoneOut),
          escapeCsv(customer.type),
          escapeCsv(customer.status),
          escapeCsv(customer.balance || 0),
          ...(hasBalanceUsd ? [escapeCsv(customer.balance_usd ?? 0)] : []),
          escapeCsv(customer.total_sales || 0),
          escapeCsv(customer.last_order_date || ''),
          escapeCsv(customer.created_at || '')
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');

      const dateStr = formatYmdInTimeZone(new Date()) || 'export'; // YYYY-MM-DD (Asia/Tashkent)
      const defaultFilename = `customers_${dateStr}.csv`;

      let filePath;
      if (isServerMode()) {
        const base = process.env.POS_DATA_DIR
          ? path.resolve(String(process.env.POS_DATA_DIR).trim())
          : path.join(os.homedir(), '.pos-data');
        const exportDir = path.join(base, 'exports');
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        filePath = path.join(exportDir, defaultFilename);
      } else {
        const { dialog } = require('electron');
        const dialogOptions = {
          title: 'Export Customers to CSV',
          defaultPath: defaultFilename,
          filters: [
            { name: 'CSV Files', extensions: ['csv'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        };
        const result = browserWindow
          ? await dialog.showSaveDialog(browserWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (result.canceled || !result.filePath) {
          return { cancelled: true };
        }
        filePath = result.filePath;
      }

      fs.writeFileSync(filePath, csvContent, 'utf8');

      console.log(`✅ Exported ${customers.length} customers to ${filePath}`);

      this._safeAuditLog({
        user_id: actorUserId,
        action: 'customers_export_csv',
        entity_type: 'customer',
        entity_id: null,
        old_values: null,
        new_values: {
          count: customers.length,
          path: filePath,
          phones_masked: !unmask,
          filters: {
            search: filters?.search || filters?.searchTerm || null,
            type: filters?.type || null,
            status: filters?.status || null,
          },
        },
      });

      return {
        cancelled: false,
        path: filePath,
        count: customers.length
      };
    } catch (error) {
      if (error && error.code === ERROR_CODES.FORBIDDEN) throw error;
      console.error('❌ Error exporting customers to CSV:', error);
      throw createError(ERROR_CODES.DB_ERROR, `Failed to export customers: ${error.message}`);
    }
  }

  /**
   * Find likely duplicate customers before create (phone / email / name).
   */
  findDuplicateCandidates({ phone, email, name, excludeId = null } = {}) {
    const out = [];
    const seen = new Set();
    const push = (row, match) => {
      if (!row?.id || seen.has(row.id)) return;
      if (excludeId && String(row.id) === String(excludeId)) return;
      seen.add(row.id);
      out.push({
        id: row.id,
        name: row.name,
        phone: row.phone || null,
        email: row.email || null,
        code: row.code || null,
        match,
      });
    };

    try {
      if (phone) {
        const norm = normalizePhoneUz(phone);
        if (norm) {
          const byPhone = this.findByNormalizedPhone(norm);
          if (byPhone) push(byPhone, 'phone');
        }
      }
      if (email) {
        const em = String(email).trim().toLowerCase();
        if (em) {
          const row = this.db
            .prepare(
              `SELECT id, name, phone, email, code FROM customers WHERE LOWER(TRIM(email)) = ? LIMIT 1`
            )
            .get(em);
          if (row) push(row, 'email');
        }
      }
      if (name) {
        const n = String(name).trim().toLowerCase();
        if (n.length >= 2) {
          const rows = this.db
            .prepare(
              `
              SELECT id, name, phone, email, code FROM customers
              WHERE LOWER(TRIM(name)) = ?
              LIMIT 5
            `
            )
            .all(n);
          for (const row of rows || []) push(row, 'name');
        }
      }
    } catch (e) {
      console.warn('[customers] findDuplicateCandidates:', e?.message || e);
    }
    return out;
  }
}

module.exports = CustomersService;




