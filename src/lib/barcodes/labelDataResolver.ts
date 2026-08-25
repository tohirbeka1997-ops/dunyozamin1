import { formatMoneyUZS } from '@/lib/format';
import { formatNumberDots } from '@/lib/money';
import type { LabelElement, LabelPreviewData, PriceFormat } from './labelModel';

export function resolveElementText(el: LabelElement, data: LabelPreviewData): string {
  if (el.kind === 'line') return '';
  if (el.data === 'static_text') return el.text ?? '';
  if (!el.data) return el.text ?? '';

  switch (el.data) {
    case 'product_name':
      return data.product_name;
    case 'sku':
      return formatSkuField(data.sku, el.showSkuPrefix);
    case 'price':
      return formatPriceField(data.price, el.priceFormat, el.showCurrency);
    case 'old_price':
      return data.old_price != null
        ? formatPriceField(data.old_price, el.priceFormat, el.showCurrency)
        : '';
    case 'discount_pct':
      return data.discount_pct != null ? `−${data.discount_pct}%` : '';
    case 'barcode_value':
      return data.barcode_value;
    case 'unit':
      return data.unit;
    case 'date':
      return data.date;
    case 'store_name':
      return data.store_name;
    default:
      return el.text ?? '';
  }
}

export function formatSkuField(sku: string, showPrefix?: boolean): string {
  if (!sku) return '';
  if (showPrefix === false) return sku;
  return `SKU: ${sku}`;
}

export function formatPriceField(
  amount: number,
  format: PriceFormat | undefined,
  showCurrency?: boolean
): string {
  const fmt = format ?? 'dot_som';
  if (fmt === 'plain') {
    return String(Math.round(amount));
  }
  const withCurrency = fmt === 'dot_som' && showCurrency !== false;
  if (withCurrency) {
    return formatMoneyUZS(amount);
  }
  return formatNumberDots(amount);
}

export function resolveBarcodeValue(el: LabelElement, data: LabelPreviewData): string {
  if (el.kind === 'qr' && el.text) return el.text;
  return data.barcode_value || '0000000000000';
}

export function elementBarcodeType(el: LabelElement, fallback: 'EAN13' | 'CODE128' | 'QR' = 'EAN13') {
  if (el.kind === 'qr') return 'QR' as const;
  return el.barcodeType ?? fallback;
}

export function isBarcodeKind(el: LabelElement): boolean {
  return el.kind === 'barcode' || el.kind === 'qr';
}

export function previewDataFromProduct(p: {
  name?: string | null;
  sale_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  unit?: string | null;
}, storeName = 'DUNYOZAMIN'): LabelPreviewData {
  const price = Number(p.sale_price) || 0;
  return {
    product_name: p.name || 'Mahsulot',
    price,
    old_price: price > 0 ? Math.round(price * 1.18) : undefined,
    discount_pct: price > 0 ? 15 : undefined,
    sku: p.sku ? String(p.sku) : '',
    barcode_value: p.barcode ? String(p.barcode) : '4780001234567',
    unit: p.unit ? String(p.unit) : 'dona',
    date: new Date().toLocaleDateString('uz-UZ'),
    store_name: storeName,
  };
}
