import {
  buildProductScanIndex,
  collectScanLookupKeys,
  lookupProductByScanCode,
  registerProductScanIndexes,
  type ProductScanIndex,
  type ProductScanIndexEntry,
} from '@/lib/pos/productBarcodeIndex';
import { productMatchesPosTextFilter } from '@/pages/posTerminalHelpers';

export type { ProductScanIndex, ProductScanIndexEntry };

export function createPurchaseScanIndex(products: ProductScanIndexEntry[]): ProductScanIndex {
  return buildProductScanIndex(products);
}

export function registerPurchaseScanProduct(
  product: ProductScanIndexEntry,
  index: ProductScanIndex,
): void {
  registerProductScanIndexes(product, index.barcode, index.sku);
}

export function lookupPurchaseScan(
  rawInput: string,
  index: ProductScanIndex,
): ProductScanIndexEntry | null {
  const hit = lookupProductByScanCode(rawInput, index);
  return hit?.product ?? null;
}

/** Max rows shown in PO product search dropdown (scrollable). */
export const PO_PRODUCT_SEARCH_LIMIT = 150;

/** Name/SKU/barcode/article/brand text search over the in-memory scan catalog (no IPC). */
export function filterPurchaseCatalog(
  products: ProductScanIndexEntry[],
  term: string,
  limit = PO_PRODUCT_SEARCH_LIMIT,
  index?: ProductScanIndex,
): ProductScanIndexEntry[] {
  const q = String(term || '').trim();
  if (!q) return [];
  const lookupIndex = index ?? buildProductScanIndex(products);
  const keys = collectScanLookupKeys(q);
  const seen = new Set<string>();
  const exact: ProductScanIndexEntry[] = [];
  for (const key of keys) {
    const hit = lookupProductByScanCode(key, lookupIndex);
    if (hit && !seen.has(hit.product.id)) {
      seen.add(hit.product.id);
      exact.push(hit.product);
    }
  }
  if (exact.length >= limit) return exact.slice(0, limit);
  const fuzzy = products.filter((p) => !seen.has(p.id) && productMatchesPosTextFilter(p, q));
  return [...exact, ...fuzzy].slice(0, limit);
}

/** Same as filterPurchaseCatalog, plus total match count before the display cap. */
export function filterPurchaseCatalogWithTotal(
  products: ProductScanIndexEntry[],
  term: string,
  limit = PO_PRODUCT_SEARCH_LIMIT,
  index?: ProductScanIndex,
): { items: ProductScanIndexEntry[]; total: number } {
  const all = filterPurchaseCatalog(products, term, Number.MAX_SAFE_INTEGER, index);
  return { items: all.slice(0, limit), total: all.length };
}

export function getScanLookupKeys(rawInput: string): string[] {
  return collectScanLookupKeys(rawInput);
}
