import { getLatestExchangeRate } from '@/db/api';

/** Canonical FX pair stored in settings: 1 USD = rate UZS */
export const UZS_PER_USD_PAIR = {
  base_currency: 'USD',
  quote_currency: 'UZS',
} as const;

/**
 * Returns UZS per 1 USD for the given date (or today).
 * Matches migration/docs: exchange_rates.rate = quote per 1 base.
 */
export async function fetchUzsPerUsdRate(onDate?: string): Promise<number | null> {
  const row = await getLatestExchangeRate({
    ...UZS_PER_USD_PAIR,
    on_date: onDate || new Date().toISOString().slice(0, 10),
  });
  const rate = Number((row as { rate?: number } | null)?.rate ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
