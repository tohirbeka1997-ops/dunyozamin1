/**
 * Product search with offline catalog fallback.
 */

import { searchProducts } from '@/api/client';
import {
  lookupCachedProductByCode,
  searchCachedProducts,
  upsertCatalogProducts,
} from '@/lib/catalogCache';
import { isNetworkError } from '@/lib/offlineQueue';
import { isExactCodeMatch, normalizeScannedCode } from '@/lib/barcodeLookup';
import type { PosProduct } from '@/types/sales';

/** Online search; on network failure fall back to local catalog cache. */
export async function searchProductsWithCache(q: string, limit = 20): Promise<PosProduct[]> {
  try {
    const rows = await searchProducts(q, limit);
    void upsertCatalogProducts(rows);
    return rows;
  } catch (e) {
    if (isNetworkError(e)) {
      return searchCachedProducts(q, limit);
    }
    throw e;
  }
}

/** Resolve barcode/SKU — network first, then exact cache match. */
export async function lookupProductByCodeWithCache(code: string): Promise<PosProduct | null> {
  const trimmed = normalizeScannedCode(code);
  if (!trimmed) return null;

  try {
    const results = await searchProducts(trimmed, 10);
    void upsertCatalogProducts(results);
    const exact = results.find((p) => isExactCodeMatch(p, trimmed));
    // Never fall back to fuzzy first hit — wrong product after scan is worse than "not found".
    return exact ?? null;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return lookupCachedProductByCode(trimmed);
  }
}
