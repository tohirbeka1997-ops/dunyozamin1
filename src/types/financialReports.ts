export type CashFlowGranularity = 'day' | 'week';

export type CashFlowRow = {
  period_start: string; // YYYY-MM-DD (day) or week start (Monday)
  period_key: string; // YYYY-MM-DD or YYYY-W##
  method: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type SupplierProductSalesRow = {
  supplier_id: string | null;
  supplier_name: string | null;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  product_barcode: string | null;
  sold_qty: number;
  sales_amount_uzs: number;
  discount_uzs: number;
  net_sales_uzs: number;
  cogs_uzs: number;
  gross_profit_uzs: number;
};

export type CashDiscrepancyRow = {
  user_id: string;
  cashier_name: string;
  shift_count: number;
  sum_diff: number;
  over_amount: number;
  short_amount: number;
  avg_diff: number;
  last_closed_at: string | null;
};

export type AgingBuckets = {
  _0_7: number;
  _8_30: number;
  _31_60: number;
  _60_plus: number;
  total: number;
};

export type CustomerAgingRow = {
  customer_id: string;
  customer_name: string;
} & AgingBuckets;

export type SupplierAgingRow = {
  supplier_id: string;
  supplier_name: string;
} & AgingBuckets;

export type AgingReportResponse = {
  as_of_date: string; // YYYY-MM-DD
  customers: CustomerAgingRow[];
  suppliers: SupplierAgingRow[];
};

