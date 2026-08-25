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
