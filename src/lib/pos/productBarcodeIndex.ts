/**
 * In-memory O(1) barcode/SKU index for supermarket-speed POS scanning.
 * Built once when the catalog loads; lookups stay synchronous (no IPC).
 */
import type { Product } from '@/types/database';

export type ProductScanIndexEntry = Product & {
  cost_price?: number;
};

export type ProductScanIndex = {
  barcode: Map<string, ProductScanIndexEntry>;
  sku: Map<string, ProductScanIndexEntry>;
};

export function createEmptyProductScanIndex(): ProductScanIndex {
  return { barcode: new Map(), sku: new Map() };
}

/** All lookup keys we try for a raw scanner payload (order matters). */
export function collectScanLookupKeys(rawInput: string): string[] {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return [];
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  const keys = new Set<string>([trimmed]);
  if (digitsOnly && digitsOnly !== trimmed) keys.add(digitsOnly);
  const upper = trimmed.toUpperCase();
  if (upper !== trimmed) keys.add(upper);
  const lower = trimmed.toLowerCase();
  if (lower !== trimmed) keys.add(lower);
  return Array.from(keys);
}

function registerBarcodeKey(index: Map<string, ProductScanIndexEntry>, key: string, product: ProductScanIndexEntry) {
  const k = String(key || '').trim();
  if (!k) return;
  index.set(k, product);
  const upper = k.toUpperCase();
  if (upper !== k) index.set(upper, product);
  const lower = k.toLowerCase();
  if (lower !== k) index.set(lower, product);
  const digitsOnly = k.replace(/[^\d]/g, '');
  if (digitsOnly && digitsOnly !== k) index.set(digitsOnly, product);
}

function registerSkuKey(index: Map<string, ProductScanIndexEntry>, key: string, product: ProductScanIndexEntry) {
  const k = String(key || '').trim();
  if (!k) return;
  index.set(k, product);
  const normalized = k.toLowerCase().replace(/[\s\-_]/g, '');
  if (normalized) index.set(normalized, product);
  const trimmedLeadingZeros = k.replace(/^0+/, '') || '0';
  if (trimmedLeadingZeros !== k) index.set(trimmedLeadingZeros, product);
  const padded5 = trimmedLeadingZeros.padStart(5, '0');
  if (padded5 !== k && padded5 !== trimmedLeadingZeros) index.set(padded5, product);
}

/** Register one product on shared barcode + SKU indexes (all common key variants). */
export function registerProductScanIndexes(
  product: ProductScanIndexEntry,
  barcodeIndex: Map<string, ProductScanIndexEntry>,
  skuIndex: Map<string, ProductScanIndexEntry>,
) {
  const sku = String(product.sku || '').trim();
  if (sku) registerSkuKey(skuIndex, sku, product);

  const barcode = String((product as { barcode?: string | null }).barcode || '').trim();
  if (barcode) registerBarcodeKey(barcodeIndex, barcode, product);

  const altBarcodes = (product as { alt_barcodes?: string[] | null }).alt_barcodes;
  if (Array.isArray(altBarcodes)) {
    for (const alt of altBarcodes) {
      registerBarcodeKey(barcodeIndex, String(alt || ''), product);
    }
  }
}

/** Build a fresh index from a product list (catalog load / refresh). */
export function buildProductScanIndex(products: ProductScanIndexEntry[]): ProductScanIndex {
  const index = createEmptyProductScanIndex();
  for (const p of products) {
    registerProductScanIndexes(p, index.barcode, index.sku);
  }
  return index;
}

export type ScanLookupHit = {
  product: ProductScanIndexEntry;
  matchKind: 'barcode' | 'sku';
  matchedKey: string;
};

/**
 * Synchronous local lookup — supermarket pattern: RAM hash map, no network.
 */
export function lookupProductByScanCode(
  rawInput: string,
  index: ProductScanIndex,
): ScanLookupHit | null {
  const keys = collectScanLookupKeys(rawInput);
  for (const key of keys) {
    const byBarcode = index.barcode.get(key);
    if (byBarcode) return { product: byBarcode, matchKind: 'barcode', matchedKey: key };
  }
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[\s\-_]/g, '');
    const bySku = index.sku.get(key) || (normalized ? index.sku.get(normalized) : undefined);
    if (bySku) return { product: bySku, matchKind: 'sku', matchedKey: key };
  }
  return null;
}
