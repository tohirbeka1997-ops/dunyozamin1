import { getPriceTiers, getProductTierPrice, setProductTierPrice } from '@/db/api';
import { mapWithConcurrency } from '@/lib/tierPriceCache';

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
