'use strict';

/**
 * Distribute remaining order-level discount onto line final_total / discount_amount
 * so line_profit and soldLineRevenueSql stay aligned with header total_amount.
 * Skips extra allocation when lines already net of that discount.
 *
 * Mutates items in place (POS + marketplace checkout).
 *
 * @param {Array<object>} itemsData
 * @param {number} orderDiscountAmount
 * @returns {Array<object>}
 */
function allocateOrderDiscountOntoItems(itemsData, orderDiscountAmount) {
  if (!Array.isArray(itemsData) || itemsData.length === 0) return itemsData;
  const orderDisc = Number(orderDiscountAmount || 0) || 0;
  const prepared = itemsData.map((it) => {
    const qty = Number(it.qty_sale ?? it.quantity ?? 0) || 0;
    const rawUnit = Number(it.unit_price ?? it.price_at_order ?? 0) || 0;
    const lineDisc = Number(it.discount_amount || 0) || 0;
    const grossFromRaw = rawUnit * qty;
    const hasExplicitFinal =
      (it.final_total != null && Number.isFinite(Number(it.final_total))) ||
      (it.line_total != null && Number.isFinite(Number(it.line_total)));
    const existingFinal =
      it.final_total != null && Number.isFinite(Number(it.final_total))
        ? Number(it.final_total)
        : it.line_total != null && Number.isFinite(Number(it.line_total))
          ? Number(it.line_total)
          : grossFromRaw - lineDisc;
    const inferredUnitFromFinal =
      qty !== 0 && Number.isFinite(existingFinal) ? Math.abs(existingFinal / qty) : 0;
    const unit = rawUnit > 0 ? rawUnit : inferredUnitFromFinal;
    const gross = unit * qty;
    return { it, qty, unit, gross, existingFinal, hasExplicitFinal };
  });
  const sumGross = prepared.reduce((s, r) => s + r.gross, 0);
  const sumFinal = prepared.reduce((s, r) => s + r.existingFinal, 0);
  const alreadyTaken = sumGross - sumFinal;
  const extra = orderDisc - alreadyTaken;
  if (!(extra > 0.02)) {
    for (const row of prepared) {
      const canSafelyHydrateFinal = row.hasExplicitFinal || row.gross > 0 || Number(row.it.discount_amount || 0) > 0;
      if (
        canSafelyHydrateFinal &&
        (row.it.final_total == null || !Number.isFinite(Number(row.it.final_total)))
      ) {
        row.it.final_total = row.existingFinal;
      }
    }
    return itemsData;
  }
  const positiveNet = prepared.reduce((s, r) => s + Math.max(0, r.existingFinal), 0);
  if (!(positiveNet > 0)) return itemsData;
  let allocated = 0;
  const lastIdx = prepared.length - 1;
  for (let i = 0; i < prepared.length; i += 1) {
    const row = prepared[i];
    const share =
      i === lastIdx
        ? extra - allocated
        : row.existingFinal > 0
          ? (row.existingFinal / positiveNet) * extra
          : 0;
    allocated += share;
    const finalLine = row.existingFinal - share;
    const totalDisc = Math.max(0, row.gross - finalLine);
    row.it.final_total = finalLine;
    row.it.line_total = finalLine;
    row.it.discount_amount = totalDisc;
    if (row.qty !== 0) {
      row.it.final_unit_price = finalLine / row.qty;
    }
  }
  return itemsData;
}

module.exports = { allocateOrderDiscountOntoItems };
