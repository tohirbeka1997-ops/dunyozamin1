/**
 * Shared order-profit helpers for daily sales / export paths.
 * Critical: never use `sum + Number(x) || 0` — JS parses that as
 * `(sum + Number(x)) || 0`, so a single NaN collapses the whole total to 0.
 */

export type ReportProfitItem = {
  quantity?: unknown;
  line_profit?: unknown;
  final_total?: unknown;
  line_total?: unknown;
  unit_price?: unknown;
  discount_amount?: unknown;
  cost_price?: unknown;
  qty_base?: unknown;
  product_id?: unknown;
  product?: { purchase_price?: unknown };
  [key: string]: unknown;
};

export type ReportProfitOrder = {
  profit?: unknown;
  total_amount?: unknown;
  items?: ReportProfitItem[] | null;
};

function finiteOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Safely add line_profit to a running sum (NaN must not wipe prior total). */
export function addLineProfit(sum: number, lineProfit: unknown): number {
  return sum + finiteOrZero(Number(lineProfit));
}

export function calculateOrderProfit(
  order: ReportProfitOrder,
  opts?: {
    /** Honor order.profit when present (default true). */
    useExplicitProfit?: boolean;
    resolveUnitCost?: (item: ReportProfitItem) => number;
  }
): number {
  if (opts?.useExplicitProfit !== false) {
    const explicit = order.profit;
    if (explicit != null) return finiteOrZero(Number(explicit));
  }

  const items = order.items || [];
  const resolveUnitCost =
    opts?.resolveUnitCost ??
    ((item: ReportProfitItem) => Number(item.cost_price ?? 0) || 0);

  if (items.length > 0) {
    return items.reduce((sum, item) => {
      const qty = Number(item.quantity || 0);
      const qtyBase = Number(item.qty_base ?? qty) || qty;
      const soldLine =
        Number(item.final_total ?? 0) ||
        Number(item.line_total ?? 0) ||
        Number(item.unit_price || 0) * qty - Number(item.discount_amount || 0);
      const unitCost = resolveUnitCost(item);
      const signedProfit = soldLine - unitCost * qtyBase;
      // Negative-qty lines may store line_profit with Math.abs COGS (legacy bug) — recompute.
      if (item.line_profit != null && qty >= 0 && qtyBase >= 0) {
        return addLineProfit(sum, item.line_profit);
      }
      return sum + signedProfit;
    }, 0);
  }

  const totalCost = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const unitCost = resolveUnitCost(item);
    const qtyBase = Number(item.qty_base ?? qty) || qty;
    return sum + unitCost * qtyBase;
  }, 0);
  return Number(order.total_amount) - totalCost;
}
