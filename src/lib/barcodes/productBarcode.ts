import { makeEan13 } from '@/lib/barcode';
import { getProductByBarcode } from '@/db/api';

export type ProductBarcodeType = 'EAN13' | 'CODE128' | 'QR';

export function validateProductBarcode(input: { type: ProductBarcodeType; value: string }): {
  ok: boolean;
  normalizedValue?: string;
  error?: string;
} {
  const type = input.type;
  const raw = String(input.value || '').trim();
  if (!raw) return { ok: false, error: "Barcode qiymati bo'sh" };

  if (type === 'EAN13') {
    const digits = raw.replace(/\s+/g, '');
    if (!/^\d+$/.test(digits)) return { ok: false, error: "EAN-13 faqat raqam bo'lishi kerak" };
    if (digits.length === 12) {
      try {
        return { ok: true, normalizedValue: makeEan13(digits) };
      } catch (e: any) {
        return { ok: false, error: e?.message || "EAN-13 hisoblab bo'lmadi" };
      }
    }
    if (digits.length === 13) {
      try {
        const expected = makeEan13(digits.slice(0, 12));
        if (expected !== digits) {
          return { ok: false, error: "EAN-13 checksum noto'g'ri" };
        }
        return { ok: true, normalizedValue: digits };
      } catch (e: any) {
        return { ok: false, error: e?.message || "EAN-13 tekshirib bo'lmadi" };
      }
    }
    return { ok: false, error: "EAN-13 12 yoki 13 raqam bo'lishi kerak" };
  }

  if (type === 'QR') {
    if (raw.length > 2000) return { ok: false, error: 'QR matn juda uzun (2000 belgidan oshmasin)' };
    return { ok: true, normalizedValue: raw };
  }

  // CODE128 (basic sanity)
  if (raw.length > 64) return { ok: false, error: "CODE128 juda uzun (64 belgidan oshmasin)" };
  return { ok: true, normalizedValue: raw };
}

export async function checkDuplicateBarcode(
  value: string,
  opts?: { currentProductId?: string | number | null }
): Promise<{ duplicate: boolean; duplicates: Array<{ id: any; name: string; sku: string; barcode?: string | null }> }> {
  const term = String(value || '').trim();
  if (!term) return { duplicate: false, duplicates: [] };

  const currentId = opts?.currentProductId == null ? null : String(opts.currentProductId);
  const found = await getProductByBarcode(term);
  const matches = found
    ? [{ id: (found as any).id, name: (found as any).name, sku: (found as any).sku, barcode: (found as any).barcode }]
    : [];
  const filtered = currentId ? matches.filter((p) => String(p.id) !== currentId) : matches;

  return { duplicate: filtered.length > 0, duplicates: filtered };
}
