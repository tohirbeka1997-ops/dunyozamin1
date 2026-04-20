'use strict';

const crypto = require('crypto');
const { sumsToTiyin } = require('./paymentLinks.cjs');
const { decrementStockForPaidWebOrder } = require('./stockDecrement.cjs');

/**
 * Click merchant callback — MD5 imzo (docs.click.uz).
 */
function verifyClickSign(params, secretKey) {
  const sign = params.sign_string;
  if (!sign || !secretKey) return false;
  const clickTransId = String(params.click_trans_id ?? '');
  const serviceId = String(params.service_id ?? '');
  const merchantTransId = String(params.merchant_trans_id ?? '');
  const amount = String(params.amount ?? '');
  const action = String(params.action ?? '');
  const signTime = String(params.sign_time ?? '');
  const str = `${clickTransId}${serviceId}${secretKey}${merchantTransId}${amount}${action}${signTime}`;
  const digest = crypto.createHash('md5').update(str).digest('hex');
  return digest === String(sign);
}

/**
 * @returns {{ error: number, error_note: string, click_trans_id?: string, merchant_trans_id?: string, merchant_confirm_id?: number }}
 */
function handleClickCallback(db, params, { serviceId, secretKey }, onPaid) {
  if (String(params.service_id ?? '') !== String(serviceId)) {
    return { error: -5, error_note: 'Invalid service' };
  }
  if (!verifyClickSign(params, secretKey)) {
    return { error: -1, error_note: 'Invalid sign' };
  }

  const orderId = Number.parseInt(String(params.merchant_trans_id ?? ''), 10);
  if (!Number.isFinite(orderId)) {
    return { error: -5, error_note: 'Invalid order' };
  }

  const action = Number.parseInt(String(params.action ?? '-1'), 10);
  const amountTiyin = Number(params.amount);

  const row = db.prepare('SELECT id, total_amount, status, payment_status FROM web_orders WHERE id = ?').get(orderId);
  if (!row) {
    return { error: -5, error_note: 'Order not found' };
  }

  const expected = sumsToTiyin(row.total_amount);
  if (!Number.isFinite(amountTiyin) || amountTiyin !== expected) {
    return { error: -4, error_note: 'Invalid amount' };
  }

  if (action === 0) {
    if (row.status === 'cancelled') {
      return { error: -4, error_note: 'Cancelled' };
    }
    return {
      error: 0,
      error_note: 'Success',
      click_trans_id: String(params.click_trans_id ?? ''),
      merchant_trans_id: String(orderId),
      merchant_confirm_id: orderId,
    };
  }

  if (action === 1) {
    if (row.status === 'paid' && row.payment_status === 'paid') {
      return {
        error: 0,
        error_note: 'Success',
        click_trans_id: String(params.click_trans_id ?? ''),
        merchant_trans_id: String(orderId),
        merchant_confirm_id: orderId,
      };
    }
    if (row.status === 'cancelled') {
      return { error: -4, error_note: 'Cancelled' };
    }

    const transId = String(params.click_trans_id ?? '');
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `
        UPDATE web_orders SET
          status = 'paid',
          payment_status = 'paid',
          payment_id = ?,
          payment_provider = 'click',
          updated_at = ?
        WHERE id = ?
      `
      ).run(transId, now, orderId);

      decrementStockForPaidWebOrder(db, orderId);
    })();

    if (typeof onPaid === 'function') void onPaid(orderId);

    return {
      error: 0,
      error_note: 'Success',
      click_trans_id: transId,
      merchant_trans_id: String(orderId),
      merchant_confirm_id: orderId,
    };
  }

  return { error: -3, error_note: 'Unknown action' };
}

module.exports = { verifyClickSign, handleClickCallback };
