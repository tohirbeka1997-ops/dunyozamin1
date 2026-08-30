/**
 * Central payment / refund method code → localized label mapping for reports & UI.
 */

import type { TFunction } from 'i18next';

const METHOD_KEYS: Record<string, string> = {
  cash: 'reports.payment_method_labels.cash',
  card: 'reports.payment_method_labels.card',
  transfer: 'reports.payment_method_labels.transfer',
  bank_transfer: 'reports.payment_method_labels.transfer',
  click: 'reports.payment_method_labels.click',
  payme: 'reports.payment_method_labels.payme',
  uzum: 'reports.payment_method_labels.uzum',
  humo: 'reports.payment_method_labels.humo',
  uzcard: 'reports.payment_method_labels.uzcard',
  credit: 'reports.payment_method_labels.credit',
  on_credit: 'reports.payment_method_labels.credit',
  debt: 'reports.payment_method_labels.debt',
  customer_account: 'reports.payment_method_labels.customer_account',
  refund_cash: 'reports.payment_method_labels.refund_cash',
  credit_note: 'reports.payment_method_labels.credit_note',
  unknown: 'reports.payment_method_labels.unknown',
};

const FALLBACK_UZ: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: "O'tkazma",
  bank_transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  humo: 'Humo',
  uzcard: 'Uzcard',
  credit: 'Nasiya',
  on_credit: 'Nasiya',
  debt: 'Qarz',
  customer_account: 'Mijoz hisobi',
  refund_cash: 'Naqd qaytarish',
  credit_note: 'Kredit nota',
  unknown: "Noma'lum",
};

export function normalizePaymentMethodCode(method: unknown): string {
  const code = String(method || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return code || 'unknown';
}

export function getPaymentMethodLabel(method: unknown, t?: TFunction): string {
  const code = normalizePaymentMethodCode(method);
  const key = METHOD_KEYS[code];
  if (t && key) {
    const translated = t(key, FALLBACK_UZ[code] || code);
    if (translated && translated !== key) return translated;
  }
  return FALLBACK_UZ[code] || code;
}

export function getRefundMethodLabel(method: unknown, t?: TFunction): string {
  return getPaymentMethodLabel(method, t);
}

/** Cash-flow source bucket labels */
export function getCashFlowSourceLabel(source: unknown, t?: TFunction): string {
  const code = normalizePaymentMethodCode(source);
  const map: Record<string, string> = {
    order_payments: 'reports.cash_flow.sources.order_payments',
    customer_payments: 'reports.cash_flow.sources.customer_payments',
    expenses: 'reports.cash_flow.sources.expenses',
    supplier_payments: 'reports.cash_flow.sources.supplier_payments',
    refunds: 'reports.cash_flow.sources.refunds',
  };
  const key = map[code];
  const fallbacks: Record<string, string> = {
    order_payments: 'Sotuv to‘lovlari',
    customer_payments: 'Mijoz to‘lovlari',
    expenses: 'Tasdiqlangan xarajatlar',
    supplier_payments: 'Yetkazib beruvchi to‘lovlari',
    refunds: 'Qaytarishlar',
  };
  if (t && key) return t(key, fallbacks[code] || code);
  return fallbacks[code] || String(source || '—');
}
