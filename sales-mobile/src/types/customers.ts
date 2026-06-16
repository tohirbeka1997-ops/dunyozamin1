/**
 * Customer, supplier, and purchase-order types — mirror staff REST routes.
 */

export interface CustomerSummary {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  balance?: number | null;
  balance_uzs?: number | null;
  balance_usd?: number | null;
  total_sales?: number | null;
  total_orders?: number | null;
  credit_limit?: number | null;
  notes?: string | null;
}

export interface CreateCustomerPayload {
  name: string;
  phone?: string | null;
  notes?: string | null;
}

export interface UpdateCustomerPayload {
  name?: string;
  phone?: string | null;
  notes?: string | null;
}

export interface CustomerLedgerEntry {
  id: string;
  customer_id: string;
  type: string;
  ref_id?: string | null;
  ref_no?: string | null;
  amount: number;
  balance_after?: number | null;
  note?: string | null;
  method?: string | null;
  created_at?: string | null;
  created_by?: string | null;
}

export interface ReceivePaymentResult {
  customer_id: string;
  old_balance: number;
  requested_amount: number;
  applied_amount: number;
  new_balance: number;
  payment_id: string;
  payment_number?: string | null;
  created_at?: string | null;
}

export interface SupplierSummary {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  contact_person?: string | null;
  status?: string | null;
  balance?: number | null;
  total_debt?: number | null;
  total_paid?: number | null;
  settlement_currency?: string | null;
}

export interface SupplierPaymentResult {
  payment: {
    id: string;
    payment_number?: string | null;
    amount?: number | null;
    payment_method?: string | null;
    paid_at?: string | null;
  };
  supplier: SupplierSummary;
}

export interface SupplierLedgerEntry {
  id: string;
  date: string;
  type: 'PURCHASE' | 'PAYMENT' | string;
  reference?: string | null;
  debit: number;
  credit: number;
  balance: number;
  purchase_order_id?: string | null;
  payment_id?: string | null;
  created_at?: string | null;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  is_active?: number | boolean | null;
}

export interface Expense {
  id: string;
  expense_number: string;
  category_id: string;
  category_name?: string | null;
  amount: number;
  payment_method?: string | null;
  expense_date: string;
  description: string;
  notes?: string | null;
  status?: string | null;
  shift_id?: string | null;
  created_at?: string | null;
}

export interface CreateExpensePayload {
  category_id: string;
  amount: number;
  description: string;
  notes?: string;
  payment_method?: 'cash' | 'card' | 'transfer';
  expense_date?: string;
}

export interface PurchaseOrderItem {
  id: string;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  ordered_qty: number;
  received_qty?: number | null;
  unit_cost?: number | null;
  line_total?: number | null;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  status: string;
  total_amount: number;
  order_date?: string | null;
  notes?: string | null;
  items?: PurchaseOrderItem[];
  currency?: string | null;
}

export interface CreatePurchaseOrderPayload {
  supplier_id: string;
  items: {
    product_id: string;
    ordered_qty: number;
    unit_cost: number;
    unit_cost_usd?: number;
  }[];
  notes?: string;
  currency?: 'UZS' | 'USD';
  fx_rate?: number;
}

export interface ReceivePurchaseOrderPayload {
  items: { item_id: string; received_qty: number; product_id?: string }[];
}
