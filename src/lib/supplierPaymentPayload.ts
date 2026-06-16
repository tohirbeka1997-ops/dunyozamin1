export type LedgerCurrency = 'UZS' | 'USD';

export type SupplierPaymentPayload = {
  amount: number;
  amount_usd: number | null;
  currency: LedgerCurrency;
};

/**
 * Maps a payment entered in PO/display currency into supplier settlement ledger fields.
 * Matches PaySupplierDialog + supplierService.createPayment expectations.
 */
export function buildSupplierPaymentPayload(input: {
  paid: number;
  entryCurrency: LedgerCurrency;
  settlementCurrency: LedgerCurrency;
  fxRate: number | null;
}): SupplierPaymentPayload {
  const paid = Number(input.paid || 0);
  if (!paid || paid <= 0) {
    throw new Error("To'lov summasi 0 dan katta bo'lishi kerak");
  }

  const entry = input.entryCurrency;
  const settlement = input.settlementCurrency;
  const fx = Number(input.fxRate || 0);
  const fxOk = Number.isFinite(fx) && fx > 0;

  if (entry === settlement) {
    if (settlement === 'USD') {
      return { currency: 'USD', amount: 0, amount_usd: paid };
    }
    return { currency: 'UZS', amount: paid, amount_usd: null };
  }

  if (!fxOk) {
    throw new Error(
      entry === 'UZS' && settlement === 'USD'
        ? "USD hisobli yetkazib beruvchiga UZS to'lov uchun kurs majburiy"
        : "UZS hisobli yetkazib beruvchiga USD to'lov uchun kurs majburiy"
    );
  }

  if (entry === 'UZS' && settlement === 'USD') {
    return { currency: 'USD', amount: 0, amount_usd: paid / fx };
  }

  return { currency: 'UZS', amount: paid * fx, amount_usd: null };
}

export function convertToSettlementCurrency(
  value: number,
  from: LedgerCurrency,
  settlement: LedgerCurrency,
  fxRate: number | null
): number {
  const amount = Number(value || 0);
  if (!amount) return 0;
  if (from === settlement) return amount;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return amount;
  if (from === 'UZS' && settlement === 'USD') return amount / fx;
  if (from === 'USD' && settlement === 'UZS') return amount * fx;
  return amount;
}

export function convertFromSettlementCurrency(
  value: number,
  settlement: LedgerCurrency,
  to: LedgerCurrency,
  fxRate: number | null
): number {
  const amount = Number(value || 0);
  if (!amount) return 0;
  if (settlement === to) return amount;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return amount;
  if (to === 'UZS' && settlement === 'USD') return amount * fx;
  if (to === 'USD' && settlement === 'UZS') return amount / fx;
  return amount;
}
