export type PoQtyViolation = {
  productId: string;
  receivedQty: number;
  orderedQty: number;
};

type QtyRow = {
  product_id?: string | null;
  ordered_qty?: number | null;
  received_qty?: number | null;
};

function sumByProductId(
  rows: QtyRow[],
  qtyField: 'ordered_qty' | 'received_qty',
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const pid = String(row.product_id || '');
    if (!pid) continue;
    const qty = Number(row[qtyField] ?? 0);
    if (!Number.isFinite(qty)) continue;
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return map;
}

/** Ordered qty per product must not fall below already received qty (aggregated by product). */
export function findPoOrderQtyViolations(
  formItems: QtyRow[],
  existingItems: QtyRow[] | null | undefined,
): PoQtyViolation[] {
  if (!existingItems?.some((it) => Number(it.received_qty || 0) > 0)) {
    return [];
  }

  const receivedByPid = sumByProductId(existingItems, 'received_qty');
  const orderedByPid = sumByProductId(formItems, 'ordered_qty');
  const violations: PoQtyViolation[] = [];

  for (const [productId, receivedQty] of receivedByPid) {
    if (receivedQty <= 0) continue;
    const orderedQty = orderedByPid.get(productId) || 0;
    if (orderedQty < receivedQty - 1e-9) {
      violations.push({ productId, receivedQty, orderedQty });
    }
  }

  return violations;
}

export function violationsToMap(
  violations: PoQtyViolation[],
): Map<string, { receivedQty: number; orderedQty: number }> {
  return new Map(
    violations.map((v) => [
      v.productId,
      { receivedQty: v.receivedQty, orderedQty: v.orderedQty },
    ]),
  );
}
