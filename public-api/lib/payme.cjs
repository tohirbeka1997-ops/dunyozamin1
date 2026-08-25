'use strict';

const crypto = require('crypto');
const { sumsToTiyin } = require('./paymentLinks.cjs');
const { decrementStockForPaidWebOrder, handleWebOrderCancelled } = require('./stockDecrement.cjs');

/** Constant-time string comparison to avoid auth timing side-channels. */
function timingSafeStrEqual(a, b) {
  const aa = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (aa.length !== bb.length || aa.length === 0) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * Paycom Merchant API — Basic Auth: base64(merchant_id:api_key)
 */
function verifyPaycomBasicAuth(req, merchantId, apiKey) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  let decoded;
  try {
    decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const id = decoded.slice(0, idx);
  const key = decoded.slice(idx + 1);
  // Constant-time compare on both fields (non-short-circuit) to avoid leaking
  // which of merchant_id / api_key matched via response timing.
  const idOk = timingSafeStrEqual(id, String(merchantId));
  const keyOk = timingSafeStrEqual(key, String(apiKey));
  return idOk && keyOk;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message: String(message), ...(data ? { data } : {}) },
  };
}

const E_ORDER_NOT_FOUND = -31001;
const E_INVALID_AMOUNT = -31003;
const E_UNABLE_TO_PERFORM = -31008;

const PROVIDER = 'payme';

function isPayableByPayme(row) {
  if (!row) return false;
  if (row.status === 'cancelled') return false;
  if (row.payment_method && String(row.payment_method) !== PROVIDER) return false;
  if (row.payment_status === 'paid') {
    return row.payment_provider == null || String(row.payment_provider) === PROVIDER;
  }
  if (row.payment_status === 'failed' || row.payment_status === 'refunded') return false;
  return true;
}

/**
 * @returns {{ body: object, notifyOrderId?: number }}
 */
function handlePaycomRpc(db, req, body, { merchantId, apiKey }) {
  const rpc = body && typeof body === 'object' ? body : {};
  const id = rpc.id;
  const method = rpc.method;
  const params = rpc.params || {};

  if (!verifyPaycomBasicAuth(req, merchantId, apiKey)) {
    return { body: jsonRpcError(id, -32504, 'Unauthorized') };
  }

  const account = params.account || {};
  const orderIdRaw = account.order_id;
  const orderId = orderIdRaw != null ? Number.parseInt(String(orderIdRaw), 10) : NaN;

  if (method === 'CheckPerformTransaction') {
    const amountTiyin = Number(params.amount);
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db
      .prepare(
        'SELECT id, total_amount, status, payment_status, payment_method, payment_provider FROM web_orders WHERE id = ?'
      )
      .get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const expected = sumsToTiyin(row.total_amount);
    if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
      return { body: jsonRpcError(id, E_INVALID_AMOUNT, 'Invalid amount') };
    }
    if (row.status === 'cancelled') {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Cancelled') };
    }
    if (!isPayableByPayme(row)) {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Order is not payable via Payme') };
    }
    return { body: jsonRpcResult(id, { allow: true }) };
  }

  if (method === 'CreateTransaction') {
    const amountTiyin = Number(params.amount);
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db
      .prepare(
        'SELECT id, total_amount, status, payment_status, payment_method, payment_provider FROM web_orders WHERE id = ?'
      )
      .get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const expected = sumsToTiyin(row.total_amount);
    if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
      return { body: jsonRpcError(id, E_INVALID_AMOUNT, 'Invalid amount') };
    }
    if (!isPayableByPayme(row)) {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Order is not payable via Payme') };
    }
    const createTime = Date.now();
    return {
      body: jsonRpcResult(id, {
        create_time: createTime,
        transaction: String(orderId),
        state: 1,
      }),
    };
  }

  if (method === 'PerformTransaction') {
    const amountTiyin = Number(params.amount);
    const transId = params.id != null ? String(params.id) : '';
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db
      .prepare(
        `
      SELECT wo.id, wo.total_amount, wo.status, wo.payment_status, wo.payment_method, wo.payment_provider
      FROM web_orders wo
      WHERE wo.id = ?
    `
      )
      .get(orderId);

    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const expected = sumsToTiyin(row.total_amount);
    if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
      return { body: jsonRpcError(id, E_INVALID_AMOUNT, 'Invalid amount') };
    }

    if (
      (row.status === 'paid' || row.status === 'processing') &&
      row.payment_status === 'paid'
    ) {
      if (row.payment_provider && String(row.payment_provider) !== PROVIDER) {
        return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Order already paid via another provider') };
      }
      return {
        body: jsonRpcResult(id, {
          transaction: transId,
          perform_time: Date.now(),
          state: 2,
        }),
      };
    }

    if (row.status === 'cancelled') {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Cancelled') };
    }

    if (!isPayableByPayme(row)) {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Order is not payable via Payme') };
    }

    const now = new Date().toISOString();
    // Idempotent at the DB layer. The UPDATE only flips a still-unpaid order
    // to paid; `changes` tells us whether THIS callback performed the
    // transition. Provider retries / concurrent callbacks observe
    // `changes === 0` and skip the stock decrement (and the customer
    // notification), so stock is decremented at most once. IMMEDIATE takes the
    // write lock at BEGIN so the conditional-update + decrement check-then-act
    // is atomic against a racing callback.
    const performed = db
      .transaction(() => {
        const res = db
          .prepare(
            `
        UPDATE web_orders SET
          status = 'processing',
          payment_status = 'paid',
          payment_id = ?,
          payment_provider = 'payme',
          updated_at = ?
        WHERE id = ? AND payment_status != 'paid'
      `
          )
          .run(transId, now, orderId);
        if (res.changes === 0) return false;
        decrementStockForPaidWebOrder(db, orderId);
        return true;
      })
      .immediate();

    return {
      body: jsonRpcResult(id, {
        transaction: transId,
        perform_time: Date.now(),
        state: 2,
      }),
      ...(performed ? { notifyOrderId: orderId } : {}),
    };
  }

  if (method === 'CancelTransaction') {
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db.prepare('SELECT id, status, payment_status FROM web_orders WHERE id = ?').get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const now = new Date().toISOString();
    const status = String(row.status || '').toLowerCase();
    const payStatus = String(row.payment_status || '').toLowerCase();
    if (status !== 'cancelled') {
      const nextPay = payStatus === 'paid' ? 'refunded' : 'failed';
      db.transaction(() => {
        db.prepare(
          `
        UPDATE web_orders SET status = 'cancelled', payment_status = ?, updated_at = ? WHERE id = ?
      `,
        ).run(nextPay, now, orderId);
        handleWebOrderCancelled(db, orderId);
      })();
    }
    return {
      body: jsonRpcResult(id, {
        transaction: String(params.id ?? ''),
        cancel_time: Date.now(),
        state: -1,
      }),
    };
  }

  if (method === 'CheckTransaction') {
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db.prepare('SELECT payment_id, payment_status, status FROM web_orders WHERE id = ?').get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    return {
      body: jsonRpcResult(id, {
        transaction: row.payment_id || String(orderId),
        perform_time: Date.now(),
        state: row.payment_status === 'paid' ? 2 : 1,
      }),
    };
  }

  return { body: jsonRpcError(id, -32601, 'Method not found') };
}

module.exports = {
  verifyPaycomBasicAuth,
  handlePaycomRpc,
  jsonRpcError,
  jsonRpcResult,
  E_ORDER_NOT_FOUND,
  E_INVALID_AMOUNT,
};
