/**
 * POS selling types — mirror public-api/routes/staff/{products,shifts,sales}.cjs.
 */

export type PaymentMethod = 'cash' | 'card' | 'credit';

export interface PosProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sale_price: number;
  current_stock?: number | null;
  unit?: string | null;
  image_url?: string | null;
  /** Tan narx (purchase/cost price). Null when the role may not see cost. */
  cost_price?: number | null;
  purchase_price?: number | null;
}

/** Cost summary derived from a product's batches. */
export interface CostSummary {
  avg_cost: number | null;
  latest_cost: number | null;
  min_cost: number | null;
  max_cost: number | null;
  batch_count: number;
}

/** Product detail returned by GET /v1/staff/products/:id. */
export interface ProductDetail extends PosProduct {
  category_name?: string | null;
  cost_summary?: CostSummary | null;
}

/** One inbound batch (partiya) from GET /v1/staff/products/:id/batches. */
export interface ProductBatch {
  batch_id: string;
  quantity: number;
  remaining_quantity: number;
  unit_cost: number;
  received_at?: string | null;
  supplier_name?: string | null;
  supplier_id?: string | null;
  purchase_order_id?: string | null;
  doc_no?: string | null;
  source_type?: string | null;
  status?: string | null;
}

export interface ProductBatchesResponse {
  data: ProductBatch[];
  summary: CostSummary;
}

export interface CartLine {
  product: PosProduct;
  quantity: number;
  /** Line discount in UZS (absolute), capped at unit_price * quantity on checkout. */
  discount_amount?: number;
}

export interface SaleItemInput {
  product_id: string;
  quantity: number;
  discount_amount?: number;
}

export interface CompleteSalePayload {
  items: SaleItemInput[];
  payment_method: PaymentMethod;
  customer_id?: string;
  amount_tendered?: number;
  notes?: string;
  order_uuid?: string;
  /** YYYY-MM-DD — credit repayment due date (optional). */
  due_date?: string;
}

export interface HoldSalePayload {
  items: SaleItemInput[];
  customer_id?: string;
  notes?: string;
  order_uuid?: string;
  shift_id?: string;
  device_id?: string;
}

export interface HoldSaleResponse {
  data: SaleOrder;
}

export interface SaleOrderItem {
  id: string;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/** Summary row from GET /v1/staff/sales (orders table). */
export interface PosSaleSummary {
  id: string;
  order_number: string;
  status: string;
  payment_status?: string | null;
  total_amount: number;
  created_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  payment_methods?: string | null;
  sales_channel?: string | null;
  cashier_name?: string | null;
  order_source?: string;
}

export interface SaleOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  subtotal?: number | null;
  total_amount: number;
  paid_amount?: number | null;
  change_amount?: number | null;
  credit_amount?: number | null;
  created_at?: string | null;
  sales_channel?: string | null;
  customer_name?: string | null;
  items?: SaleOrderItem[];
  payments?: { payment_method: string; amount: number }[];
}

export interface ReceiptLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export interface Receipt {
  lines: ReceiptLine[];
  text: string;
}

export interface CompleteSaleResponse {
  data: SaleOrder;
  receipt: Receipt;
}

export interface Shift {
  id: string;
  shift_number: string;
  status: string;
  opening_cash: number;
  opened_at?: string | null;
  closed_at?: string | null;
}

export interface ShiftSummary {
  shiftId: string;
  totalSales: number;
  cashSales: number;
  orders: number;
  expectedCash: number;
  openingCash: number;
}

export interface CurrentShiftResponse {
  shift: Shift;
  summary: ShiftSummary | null;
  /** False when viewing another cashier's store-wide open shift. */
  is_own_shift?: boolean;
}

export interface DailyReport {
  date: string;
  order_count: number;
  total_sales: number;
  cash_total: number;
  card_total: number;
  credit_total: number;
  open_shift?: {
    id: string;
    shift_number: string;
    opened_at?: string | null;
    summary: ShiftSummary | null;
  } | null;
}

export interface CloseShiftResult {
  success: boolean;
  shiftId: string;
  closingCash: number;
  expectedCash: number;
  cashDifference: number;
  totalPayments: number;
  cashPayments: number;
}

export type RefundMethod = 'cash' | 'card' | 'credit';

export interface ReturnableItem {
  order_item_id: string;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  sold_quantity: number;
  returned_quantity: number;
  returnable_quantity: number;
  unit_price: number;
  line_total?: number;
}

export interface ReturnableOrder {
  order: {
    id: string;
    order_number?: string;
    status?: string;
  };
  customer?: { id: string; name?: string } | null;
  items: ReturnableItem[];
  has_returnable: boolean;
}

export interface CreateReturnPayload {
  order_id: string;
  items: { order_item_id: string; quantity: number }[];
  reason?: string;
  refund_method?: RefundMethod;
}

export interface SalesReturnResult {
  id: string;
  return_number: string;
  order_id: string;
  status: string;
  total_amount: number;
  refund_amount: number;
  refund_method: string;
}
