'use strict';

const { sumsToTiyin } = require('./paymentLinks.cjs');
const { decrementStockForPaidWebOrder } = require('./stockDecrement.cjs');

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
  return id === String(merchantId) && key === String(apiKey);
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
    const row = db.prepare('SELECT id, total_amount, status, payment_status FROM web_orders WHERE id = ?').get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const expected = sumsToTiyin(row.total_amount);
    if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
      return { body: jsonRpcError(id, E_INVALID_AMOUNT, 'Invalid amount') };
    }
    if (row.status === 'cancelled') {
      return { body: jsonRpcError(id, E_UNABLE_TO_PERFORM, 'Cancelled') };
    }
    return { body: jsonRpcResult(id, { allow: true }) };
  }

  if (method === 'CreateTransaction') {
    const amountTiyin = Number(params.amount);
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db.prepare('SELECT id, total_amount, status FROM web_orders WHERE id = ?').get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const expected = sumsToTiyin(row.total_amount);
    if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
      return { body: jsonRpcError(id, E_INVALID_AMOUNT, 'Invalid amount') };
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
      SELECT wo.id, wo.total_amount, wo.status, wo.payment_status, wo.payment_method
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

    if (row.status === 'paid' && row.payment_status === 'paid') {
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

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `
        UPDATE web_orders SET
          status = 'paid',
          payment_status = 'paid',
          payment_id = ?,
          payment_provider = 'payme',
          updated_at = ?
        WHERE id = ?
      `
      ).run(transId, now, orderId);

      decrementStockForPaidWebOrder(db, orderId);
    })();

    return {
      body: jsonRpcResult(id, {
        transaction: transId,
        perform_time: Date.now(),
        state: 2,
      }),
      notifyOrderId: orderId,
    };
  }

  if (method === 'CancelTransaction') {
    if (!Number.isFinite(orderId)) {
      return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    }
    const row = db.prepare('SELECT id, status, payment_status FROM web_orders WHERE id = ?').get(orderId);
    if (!row) return { body: jsonRpcError(id, E_ORDER_NOT_FOUND, 'Order not found') };
    const now = new Date().toISOString();
    if (row.status === 'new' && row.payment_status === 'pending') {
      db.prepare(
        `
        UPDATE web_orders SET status = 'cancelled', payment_status = 'failed', updated_at = ? WHERE id = ?
      `
      ).run(now, orderId);
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
