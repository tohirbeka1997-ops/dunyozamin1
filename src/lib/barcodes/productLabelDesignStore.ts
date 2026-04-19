import { isElectron, requireElectron, handleIpcResponse } from '@/utils/electron';
import type { ProductLabelElement } from '@/components/barcodes/ProductLabelLayoutEditor';

export type SavedProductLabelDesignV1 = {
  v: 1;
  widthMm: number;
  heightMm: number;
  showBarcodeDigits: boolean;
  layout: ProductLabelElement[];
  savedAt: string;
};

function round1(n: number) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function productLabelDesignKey(widthMm: number, heightMm: number) {
  const w = round1(widthMm);
  const h = round1(heightMm);
  return `barcode_center.product_design.${w}x${h}`;
}

export async function saveProductLabelDesign(
  input: Omit<SavedProductLabelDesignV1, 'v' | 'savedAt'>,
  updatedBy: string | null
) {
  if (!isElectron()) {
    throw new Error('Dizaynni saqlash faqat desktop ilovada ishlaydi');
  }
  const api = requireElectron();
  const payload: SavedProductLabelDesignV1 = {
    v: 1,
    ...input,
    savedAt: new Date().toISOString(),
  };
  const key = productLabelDesignKey(input.widthMm, input.heightMm);
  return handleIpcResponse(api.settings.set(key, payload, 'json', updatedBy));
}

export async function loadProductLabelDesign(widthMm: number, heightMm: number): Promise<SavedProductLabelDesignV1 | null> {
  if (!isElectron()) return null;
  const api = requireElectron();
  const key = productLabelDesignKey(widthMm, heightMm);
  const val = await handleIpcResponse<any>(api.settings.get(key)).catch(() => null);
  if (!val || typeof val !== 'object') return null;
  if (val.v !== 1) return null;
  return val as SavedProductLabelDesignV1;
}

