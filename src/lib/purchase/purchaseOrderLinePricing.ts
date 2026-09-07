/**
 * PO line pricing helpers — keep draft save permissive; receive can require cost.
 */

export function salePriceForPoLineSave(salePrice: number | null | undefined): number | null {
  const n = Number(salePrice ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type CostRow = {
  product_name?: string | null;
  base_unit_cost?: number | null;
  base_unit_cost_usd?: number | null;
  unit_cost?: number | null;
  unit_cost_usd?: number | null;
};

/** Line unit cost used for receive gating (PO currency). */
export function getPoLineUnitCost(item: CostRow, currency: 'UZS' | 'USD'): number {
  if (currency === 'USD') {
    return Number(item.base_unit_cost_usd ?? item.unit_cost_usd ?? 0) || 0;
  }
  return Number(item.base_unit_cost ?? item.unit_cost ?? 0) || 0;
}

/** Names of lines with missing/zero tannarx — blocked on receive, allowed on draft save. */
export function findZeroCostPoLineNames(
  items: CostRow[],
  currency: 'UZS' | 'USD',
): string[] {
  const names: string[] = [];
  for (const item of items) {
    const cost = getPoLineUnitCost(item, currency);
    if (!(cost > 0)) {
      names.push(String(item.product_name || 'Nomsiz mahsulot'));
    }
  }
  return names;
}
