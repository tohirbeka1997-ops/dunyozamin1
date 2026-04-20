'use strict';

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';

function boolCol(v) {
  return v === 1 || v === true;
}

/**
 * Onlayn buyurtma 'paid' bo'lganda asosiy omborda qoldiqni kamaytirish (TZ F-25).
 * @param {import('better-sqlite3').Database} db
 * @param {number} orderId
 */
function decrementStockForPaidWebOrder(db, orderId) {
  const items = db
    .prepare(
      `
    SELECT product_id, quantity FROM web_order_items WHERE order_id = ?
  `
    )
    .all(orderId);

  for (const it of items) {
    const p = db.prepare('SELECT track_stock FROM products WHERE id = ?').get(it.product_id);
    if (!p || !boolCol(p.track_stock)) continue;

    const wh = db
      .prepare(
        `
      SELECT id, quantity, reserved_quantity FROM stock_balances
      WHERE product_id = ? AND warehouse_id = ?
    `
      )
      .get(it.product_id, MAIN_WAREHOUSE_ID);

    if (!wh) continue;

    const q = Number(wh.quantity) || 0;
    const rq = Number(wh.reserved_quantity) || 0;
    const dec = Number(it.quantity) || 0;
    const newQty = Math.max(0, q - dec);
    const newRes = Math.max(0, rq);
    db.prepare(
      `
      UPDATE stock_balances SET quantity = ?, reserved_quantity = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(newQty, newRes, wh.id);
  }
}

module.exports = { decrementStockForPaidWebOrder, MAIN_WAREHOUSE_ID };
