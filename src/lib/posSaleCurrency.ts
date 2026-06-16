import type { AppCurrency } from '@/lib/currency';
import { normalizeCurrency } from '@/lib/currency';

export type PosSaleCurrency = AppCurrency;

export function orderCurrencyFields(
  currency: PosSaleCurrency,
  fxRate: number | null | undefined
): { currency: PosSaleCurrency; fx_rate: number | null } {
  const cur = normalizeCurrency(currency, 'UZS');
  const fx = Number(fxRate ?? 0);
  return {
    currency: cur,
    fx_rate: cur === 'USD' && Number.isFinite(fx) && fx > 0 ? fx : null,
  };
}

/** Shift / reports that expect UZS totals */
export function toShiftUzsAmount(amount: number, currency: PosSaleCurrency, fxRate: number | null): number {
  const value = Number(amount || 0) || 0;
  if (currency !== 'USD') return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  return value * fx;
}
