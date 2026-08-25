import { getPriceTiers, getProductTierPrice, setProductTierPrice } from '@/db/api';
import { convertAtRate } from '@/lib/currency';
import { mapWithConcurrency } from '@/lib/tierPriceCache';

/**
 * Stored USD retail must be distinct from the UZS catalog amount.
 * Corrupted rows (reconcile bug) often equal the UZS sale_price.
 */
export function isPlausibleUsdRetail(
  usd: number | null | undefined,
  uzs: number | null | undefined
): boolean {
  const u = usd != null ? Number(usd) : NaN;
  if (!Number.isFinite(u) || u <= 0) return false;
  const z = uzs != null ? Number(uzs) : NaN;
  if (!Number.isFinite(z) || z <= 0) return true;
  if (Math.abs(u - z) <= 0.01) return false;
  if (u >= z) return false;
  return true;
}

/**
 * USD retail for display / cart: real tier USD, else UZS ÷ fx. Never label raw UZS as USD.
 */
export function resolveUsdRetailDisplay(
  uzsPrice: number | null | undefined,
  storedUsd: number | null | undefined,
  fxRate: number | null | undefined
): number | null {
  const uzs = Number(uzsPrice ?? 0) || 0;
  if (isPlausibleUsdRetail(storedUsd, uzs)) return Number(storedUsd);
  const fx = Number(fxRate || 0);
  if (fx > 0 && uzs > 0) return convertAtRate(uzs, 'UZS', 'USD', fx);
  return null;
}

export async function loadRetailUsdPrice(
  productId: string,
  unit: string
): Promise<number | null> {
  const price = await getProductTierPrice({
    product_id: productId,
    tier_code: 'retail',
    currency: 'USD',
    unit,
  });
  const n = price != null ? Number(price) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function saveRetailUsdPrice(
  productId: string,
  unit: string,
  usd: number | null | undefined
): Promise<void> {
  const tiers = await getPriceTiers();
  const retail = (tiers || []).find((t: { code?: string }) => String(t?.code || '') === 'retail');
  if (!retail?.id) return;
  const p = Number(usd ?? 0);
  if (!Number.isFinite(p) || p <= 0) return;
  await setProductTierPrice({
    product_id: productId,
    tier_id: Number(retail.id),
    currency: 'USD',
    unit,
    price: p,
  });
}

export async function loadRetailUsdPricesForProducts(
  products: Array<{ id: string; unit?: string | null; base_unit?: string | null }>
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const slice = products.slice(0, 120);
  await mapWithConcurrency(slice, 8, async (p) => {
    const unit = String(p.unit || (p as any).base_unit || 'pcs');
    try {
      const price = await loadRetailUsdPrice(p.id, unit);
      if (price != null) out[p.id] = price;
    } catch {
      // ignore per-product failures (incl. rate limit soft-fail)
    }
  });
  return out;
}
