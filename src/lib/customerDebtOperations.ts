import type { TFunction } from 'i18next';

export type DebtOpKind = 'debt_payment' | 'credit_sale' | 'loan_issued' | 'advance';

export type CustomerDebtOperationRow = {
  id: string;
  occurred_at: string;
  customer_id: string;
  customer_name: string;
  kind: DebtOpKind | string;
  op_code?: string | null;
  ledger_type?: string | null;
  amount: number;
  amount_uzs: number;
  currency?: string;
  payment_method?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  ref_id?: string | null;
  ref_no?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  note?: string | null;
};

export type CustomerDebtOperationsSummary = {
  debt_collected: number;
  debt_collected_count: number;
  credit_issued: number;
  credit_issued_count: number;
  advance_received: number;
  advance_received_count: number;
  net: number;
};

export type CustomerDebtOperationsReport = {
  filters?: {
    date_from?: string | null;
    date_to?: string | null;
    warehouse_id?: string | null;
    cashier_id?: string | null;
    op_type?: string | null;
  };
  rows: CustomerDebtOperationRow[];
  summary: CustomerDebtOperationsSummary;
};

const KIND_KEYS: Record<string, string> = {
  debt_payment: 'reports.debt_operations_page.kinds.debt_payment',
  credit_sale: 'reports.debt_operations_page.kinds.credit_sale',
  loan_issued: 'reports.debt_operations_page.kinds.loan_issued',
  advance: 'reports.debt_operations_page.kinds.advance',
};

const KIND_FALLBACK_UZ: Record<string, string> = {
  debt_payment: 'Qarz to‘lovi',
  credit_sale: 'Nasiya savdo',
  loan_issued: 'Qarz berildi',
  advance: 'Avans',
};

export function isCreditPaymentMethod(method: unknown): boolean {
  return /(credit|debt|nasiya|qarz|loan|on_credit|balance)/i.test(String(method || ''));
}

export function getDebtOpKindLabel(kind: unknown, t?: TFunction): string {
  const code = String(kind || '').toLowerCase();
  const key = KIND_KEYS[code];
  const fallback = KIND_FALLBACK_UZ[code] || code || '—';
  if (t && key) return t(key, fallback);
  return fallback;
}
