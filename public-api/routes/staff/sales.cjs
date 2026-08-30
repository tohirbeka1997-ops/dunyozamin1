'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const {
  buildReceiptInputFromOrder,
  buildReceiptLines,
} = require('../../../electron/lib/receiptTextBuilder.cjs');
const { openTenantDatabase } = require('../../lib/staffDb.cjs');
const { getPosBundle } = require('../../lib/staffPos.cjs');
const { mapStaffServiceError } = require('../../lib/staffErrorMap.cjs');
const { validate } = require('../../middleware/validate.cjs');
const { staffSaleCreateBodySchema, staffSaleHoldBodySchema } = require('../../schemas/staff.schema.cjs');

// Cash/card for full or partial payment; credit requires a real customer (not walk-in).
const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'card', 'credit']);

function mapServiceError(e, res) {
  mapStaffServiceError(e, res, { logTag: '[staff/sales]' });
}

function resolveCustomerTier(db, customerId) {
  if (!customerId) return 'retail';
  try {
    const row = db.prepare('SELECT pricing_tier FROM customers WHERE id = ?').get(customerId);
    return row?.pricing_tier ? String(row.pricing_tier) : 'retail';
  } catch {
    return 'retail';
  }
}

/**
 * Resolve unit price using the SAME rules as SalesService.completePOSOrder
 * (customer pricing tier + product_prices), so payment totals match order_items.
 */
function resolveUnitPrice(bundle, product, tierCode = 'retail') {
  if (bundle.sales && typeof bundle.sales._resolveCatalogUnitPrice === 'function') {
    return bundle.sales._resolveCatalogUnitPrice(product, { tierCode });
  }
  const unit = product.unit ?? product.base_unit ?? 'pcs';
  const tier = tierCode === 'master' ? 'master' : 'retail';
  let price = null;
  try {
    if (typeof bundle.pricing?.getPriceForProduct === 'function') {
      price = bundle.pricing.getPriceForProduct({
        product_id: product.id,
        tier_code: tier,
        currency: 'UZS',
        unit,
      });
    }
  } catch {
    /* fall back to catalog price */
  }
  if (price != null && Number(price) > 0) return Number(price);
  if (tier === 'master') return Number(product.master_price ?? product.sale_price ?? 0) || 0;
  return Number(product.sale_price || 0) || 0;
}

function readPrepaidBalance(db, customerId) {
  if (!customerId) return 0;
  try {
    const row = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId);
    return Math.max(0, Number(row?.balance) || 0);
  } catch {
    return 0;
  }
}

function loadCompany(db) {
  const get = (key) => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value ? String(row.value) : '';
    } catch {
      return '';
    }
  };
  return {
    name: get('company_name') || get('store_name') || get('shop_name') || "Do'kon",
    phone: get('company_phone') || get('store_phone') || '',
    address: get('company_address') || get('store_address') || '',
    tax_id: get('company_tax_id') || get('tax_id') || '',
  };
}

function loadReceiptSettings(db) {
  const get = (key) => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row?.value != null ? String(row.value) : '';
    } catch {
      return '';
    }
  };
  return {
    header_text: get('receipt_header') || '',
    footer_text: get('receipt_footer') || '',
    show_cashier: true,
    show_customer: true,
    show_sku: true,
  };
}

function buildReceipt(db, order) {
  const company = loadCompany(db);
  const settings = loadReceiptSettings(db);
  const input = buildReceiptInputFromOrder(order, company, settings);
  const lines = buildReceiptLines(input, { charsPerLine: 32 });
  return {
    input,
    lines,
    text: lines.map((l) => l.text).join('\n'),
  };
}

/**
 * Staff sales routes — REAL point-of-sale selling from the mobile app.
 * Reuses SalesService.completePOSOrder for all stock/totals/payment math.
 */
function mountStaffSalesRoutes() {
  const router = express.Router();

  function ctxForReq(req) {
    const db = openTenantDatabase(req.staffUser.tenant);
    return { db, bundle: getPosBundle(db) };
  }

  // GET /v1/staff/sales — list completed POS register sales (orders table)
  router.get('/', (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
      const offset = (page - 1) * limit;

      const filters = {
        limit,
        offset,
        sort_by: 'created_at',
        sort_order: 'DESC',
      };

      const q = req.query.q != null ? String(req.query.q).trim() : '';
      if (q.length >= 2) filters.search = q;

      if (req.query.date_from != null && String(req.query.date_from).trim()) {
        filters.date_from = String(req.query.date_from).trim();
      }
      if (req.query.date_to != null && String(req.query.date_to).trim()) {
        filters.date_to = String(req.query.date_to).trim();
      }
      if (req.query.sales_channel != null && String(req.query.sales_channel).trim()) {
        filters.sales_channel = String(req.query.sales_channel).trim();
      }
      if (req.query.status != null && String(req.query.status).trim()) {
        filters.status = String(req.query.status).trim();
      }
      if (req.query.payment_method != null && String(req.query.payment_method).trim()) {
        filters.payment_method = String(req.query.payment_method).trim();
      }

      const { bundle } = ctxForReq(req);
      const data = bundle.sales.list(filters);
      res.json({
        data,
        meta: {
          page,
          limit,
          count: data.length,
          has_more: data.length === limit,
        },
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/sales — complete a sale
  router.post('/', validate({ body: staffSaleCreateBodySchema }), (req, res) => {
    try {
      const body = req.body || {};
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'items required' });
        return;
      }

      const paymentMethod = String(body.payment_method || '').trim().toLowerCase();
      if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
        res.status(400).json({
          error: 'validation_error',
          message: "payment_method must be 'cash', 'card', or 'credit'",
        });
        return;
      }

      const { db, bundle } = ctxForReq(req);

      const customerId = body.customer_id != null && String(body.customer_id).trim()
        ? String(body.customer_id).trim()
        : null;

      if (customerId) {
        const customerExists = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
        if (!customerExists) {
          res.status(404).json({ error: 'not_found', message: 'Mijoz topilmadi' });
          return;
        }
      }

      const tierCode = resolveCustomerTier(db, customerId);

      // Build items + compute authoritative total (server-side pricing, customer tier).
      const itemsData = [];
      let total = 0;
      for (const raw of rawItems) {
        const productId = raw?.product_id != null ? String(raw.product_id) : '';
        const quantity = Number(raw?.quantity);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
          res
            .status(400)
            .json({ error: 'validation_error', message: 'each item needs product_id and quantity > 0' });
          return;
        }
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        if (!product) {
          res.status(404).json({ error: 'not_found', message: `Product ${productId} not found` });
          return;
        }
        const discountAmount = Number(raw?.discount_amount || 0) || 0;
        const unitPrice = resolveUnitPrice(bundle, product, tierCode);
        const lineTotal = unitPrice * quantity - discountAmount;
        total += lineTotal;
        itemsData.push({
          product_id: productId,
          quantity,
          discount_amount: discountAmount > 0 ? discountAmount : 0,
        });
      }

      total = Math.round(total * 100) / 100;
      if (total <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'Sale total must be greater than zero' });
        return;
      }

      const prepaidAvailable = readPrepaidBalance(db, customerId);
      const applyPrepaid =
        body.apply_prepaid !== false &&
        body.apply_prepaid !== 0 &&
        String(body.apply_prepaid || '').toLowerCase() !== 'false';
      const prepaidToApply = applyPrepaid && customerId ? Math.min(prepaidAvailable, total) : 0;
      const cashDue = Math.max(0, total - prepaidToApply);

      if (paymentMethod === 'credit' && !customerId) {
        res.status(400).json({
          error: 'validation_error',
          message: 'customer_id is required for credit sales',
        });
        return;
      }

      const amountTenderedRaw = body.amount_tendered;
      const hasTendered = amountTenderedRaw != null && amountTenderedRaw !== '';
      const amountTendered = hasTendered ? Number(amountTenderedRaw) : null;
      if (hasTendered && (!Number.isFinite(amountTendered) || amountTendered < 0)) {
        res.status(400).json({ error: 'validation_error', message: 'amount_tendered must be >= 0' });
        return;
      }

      const applyOverpayAsPrepaid =
        body.apply_overpay_as_prepaid === true ||
        body.apply_overpay_as_prepaid === 1 ||
        String(body.apply_overpay_as_prepaid || '').toLowerCase() === 'true' ||
        (hasTendered &&
          customerId &&
          amountTendered != null &&
          amountTendered > cashDue + 0.009);

      const orderData = {
        user_id: req.staffUser.id,
        cashier_id: req.staffUser.id,
        customer_id: customerId,
        price_tier_code: tierCode,
        subtotal: total,
        total_amount: total,
        notes: body.notes != null ? String(body.notes).slice(0, 500) : null,
        order_uuid: body.order_uuid != null && String(body.order_uuid).trim()
          ? String(body.order_uuid).trim()
          : randomUUID(),
        sales_channel: 'staff_mobile',
        channel: 'staff_mobile',
        ...(body.due_date != null && String(body.due_date).trim()
          ? { due_date: String(body.due_date).trim().slice(0, 10) }
          : {}),
        ...(prepaidToApply > 0 ? { prepaid_applied: prepaidToApply } : {}),
        ...(applyOverpayAsPrepaid ? { apply_overpay_as_prepaid: true } : {}),
      };

      let paymentsData = [];
      if (paymentMethod === 'credit') {
        paymentsData = [];
      } else if (hasTendered) {
        if (amountTendered > cashDue + 0.009 && !customerId) {
          res.status(400).json({
            error: 'validation_error',
            message: 'amount_tendered cannot exceed sale total without a customer (overpay→advance)',
          });
          return;
        }
        if (amountTendered < cashDue - 0.009 && !customerId) {
          res.status(400).json({
            error: 'validation_error',
            message: 'customer_id is required for partial payment (credit portion)',
          });
          return;
        }
        if (amountTendered > 0) {
          paymentsData = [{ payment_method: paymentMethod, amount: amountTendered }];
        }
      } else if (cashDue > 0) {
        paymentsData = [{ payment_method: paymentMethod, amount: cashDue }];
      }

      // completePOSOrder returns { order_id, order_number }. Load the full detail.
      const result = bundle.sales.completePOSOrder(orderData, itemsData, paymentsData);
      const orderId = result?.order_id ?? result?.id;
      if (!orderId) {
        throw new Error('Sotuv yaratildi, lekin buyurtma ID qaytmadi');
      }
      const order = bundle.sales._getOrderWithDetails(orderId);
      if (!order) {
        throw new Error('Sotuv yaratildi, lekin buyurtma tafsilotlari topilmadi');
      }
      const receipt = buildReceipt(db, order);
      res.status(201).json({
        data: order,
        receipt,
        ...(prepaidToApply > 0 ? { meta: { prepaid_applied: prepaidToApply, cash_due: cashDue } } : {}),
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // POST /v1/staff/sales/hold — park cart for desktop cashier (no payment, no stock move)
  router.post('/hold', validate({ body: staffSaleHoldBodySchema }), (req, res) => {
    try {
      const body = req.body || {};
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'validation_error', message: 'items required' });
        return;
      }

      const { db, bundle } = ctxForReq(req);

      const customerId = body.customer_id != null && String(body.customer_id).trim()
        ? String(body.customer_id).trim()
        : null;

      if (customerId) {
        const customerExists = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
        if (!customerExists) {
          res.status(404).json({ error: 'not_found', message: 'Mijoz topilmadi' });
          return;
        }
      }

      const shiftId = body.shift_id != null && String(body.shift_id).trim()
        ? String(body.shift_id).trim()
        : null;

      const sellerLabel =
        String(req.staffUser.full_name || req.staffUser.username || req.staffUser.id || '').trim();
      const deviceId = body.device_id != null ? String(body.device_id).trim() : '';
      const noteParts = [
        body.notes != null ? String(body.notes).trim() : '',
        sellerLabel ? `Mobil sotuvchi: ${sellerLabel}` : '',
        deviceId ? `Qurilma: ${deviceId}` : '',
      ].filter(Boolean);
      const notes = noteParts.join(' | ').slice(0, 500) || null;

      const draft = bundle.sales.createDraftOrder({
        user_id: req.staffUser.id,
        cashier_id: req.staffUser.id,
        customer_id: customerId,
        shift_id: shiftId,
        notes,
        order_uuid: body.order_uuid != null && String(body.order_uuid).trim()
          ? String(body.order_uuid).trim()
          : randomUUID(),
        sales_channel: 'staff_mobile',
        channel: 'staff_mobile',
        device_id: deviceId || undefined,
      });

      let order = draft;
      for (const raw of rawItems) {
        const productId = raw?.product_id != null ? String(raw.product_id) : '';
        const quantity = Number(raw?.quantity);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
          res
            .status(400)
            .json({ error: 'validation_error', message: 'each item needs product_id and quantity > 0' });
          return;
        }
        const discountAmount = Number(raw?.discount_amount || 0) || 0;
        order = bundle.sales.addItem(order.id, {
          product_id: productId,
          quantity,
          discount_amount: discountAmount > 0 ? discountAmount : 0,
        });
      }

      res.status(201).json({ data: order });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/sales/credit-open — open nasiya orders (for due-date management)
  router.get('/credit-open', (req, res) => {
    try {
      const { db } = ctxForReq(req);
      const { listOpenCreditOrders } = require('../../lib/creditReminder.cjs');
      const limit = req.query.limit != null ? Number(req.query.limit) : 100;
      const customerId =
        req.query.customer_id != null ? String(req.query.customer_id).trim() : undefined;
      const data = listOpenCreditOrders(db, {
        limit,
        customerId: customerId || undefined,
        missingDueDateOnly:
          req.query.missing_due_date === '1' || req.query.missing_due_date === 'true',
      });
      res.json({ data });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // PATCH /v1/staff/sales/:id/due-date — set qarz qaytarish sanasi
  router.patch('/:id/due-date', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const { db } = ctxForReq(req);
      const { updateOrderDueDate } = require('../../lib/creditReminder.cjs');
      const dueDate = req.body?.due_date != null ? String(req.body.due_date).trim() : '';
      if (!dueDate) {
        res.status(400).json({ error: 'validation_error', message: 'due_date required' });
        return;
      }
      const out = updateOrderDueDate(db, req.params.id, dueDate);
      if (!out.ok) {
        const status = out.error === 'order_not_found' ? 404 : 400;
        res.status(status).json({ error: out.error, message: out.error });
        return;
      }
      res.json({ data: out });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/sales/:id/returnable — order lines with remaining returnable qty
  router.get('/:id/returnable', (req, res) => {
    try {
      const { db, bundle } = ctxForReq(req);
      const orderId = String(req.params.id || '').trim();
      const order = db.prepare('SELECT id, status, order_number FROM orders WHERE id = ?').get(orderId);
      if (!order) {
        res.status(404).json({ error: 'not_found', message: 'Sale not found' });
        return;
      }

      const orderStatus = String(order.status || '').toLowerCase();
      if (orderStatus !== 'completed') {
        res.json({
          data: {
            order: { id: order.id, order_number: order.order_number, status: order.status },
            items: [],
            has_returnable: false,
          },
        });
        return;
      }

      const details = bundle.returns.getOrderDetails(orderId);
      // Prefer getOrderDetails remaining (already clamps sold−held; remaining=0 stays 0).
      const items = (details.items || [])
        .map((it) => {
          const orderItemIdVal = it.orderItemId || it.id;
          const soldQty = Number(it.sold_quantity ?? it.qty_sale ?? it.qty ?? it.quantity ?? 0);
          const returnedQty = Number(it.returned_quantity ?? 0);
          const returnableQty = Math.max(
            0,
            it.remaining_quantity != null
              ? Number(it.remaining_quantity)
              : soldQty - returnedQty,
          );
          return {
            order_item_id: orderItemIdVal,
            product_id: it.productId || it.product_id,
            product_name: it.name || it.product_name,
            product_sku: it.product_sku || null,
            sold_quantity: soldQty,
            returned_quantity: returnedQty,
            returnable_quantity: returnableQty,
            unit_price: Number(it.unit_price ?? it.price ?? 0),
            line_total: Number(it.line_total ?? it.lineTotal ?? 0),
          };
        })
        .filter((it) => it.returnable_quantity > 0);

      res.json({
        data: {
          order: details.order,
          customer: details.customer,
          items,
          has_returnable: items.length > 0,
        },
      });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/sales/:id — sale detail
  router.get('/:id', (req, res) => {
    try {
      const { bundle } = ctxForReq(req);
      const order = bundle.sales._getOrderWithDetails(req.params.id);
      if (!order) {
        res.status(404).json({ error: 'not_found', message: 'Sale not found' });
        return;
      }
      res.json({ data: order });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  // GET /v1/staff/sales/:id/receipt — digital receipt (structured + rendered text)
  router.get('/:id/receipt', (req, res) => {
    try {
      const { db, bundle } = ctxForReq(req);
      const order = bundle.sales._getOrderWithDetails(req.params.id);
      if (!order) {
        res.status(404).json({ error: 'not_found', message: 'Sale not found' });
        return;
      }
      const receipt = buildReceipt(db, order);
      res.json({ data: { order, receipt } });
    } catch (e) {
      mapServiceError(e, res);
    }
  });

  return router;
}

module.exports = { mountStaffSalesRoutes };
