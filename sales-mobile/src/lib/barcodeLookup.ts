import { searchProducts } from '@/api/client';
import type { PosProduct } from '@/types/sales';

export function normalizeScannedCode(raw: string): string {
  return String(raw || '').trim();
}

export function isExactCodeMatch(product: PosProduct, code: string): boolean {
  const c = normalizeScannedCode(code);
  if (!c) return false;
  const sku = String(product.sku || '').trim();
  const barcode = String(product.barcode || '').trim();
  return sku === c || barcode === c;
}

/** Resolve a scanned barcode or SKU to a product (exact match preferred). */
export async function lookupProductByCode(code: string): Promise<PosProduct | null> {
  const trimmed = normalizeScannedCode(code);
  if (!trimmed) return null;
  const results = await searchProducts(trimmed, 10);
  const exact = results.find((p) => isExactCodeMatch(p, trimmed));
  return exact ?? results[0] ?? null;
}
