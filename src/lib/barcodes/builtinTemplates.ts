import type { LabelElement, LabelTemplate } from './labelModel';
import { newElementId } from './labelModel';

function el(p: Omit<LabelElement, 'id'> & { id?: string }): LabelElement {
  return {
    visible: true,
    locked: false,
    fontFamily: 'Inter, Arial, sans-serif',
    color: '#16201b',
    rotation: 0,
    ...p,
    id: p.id ?? newElementId(),
  };
}

function tpl(
  id: string,
  name: string,
  widthMm: number,
  heightMm: number,
  elements: LabelElement[],
  extra?: Partial<LabelTemplate>
): LabelTemplate {
  return {
    id,
    name,
    widthMm,
    heightMm,
    elements: elements.map((e, i) => ({ ...e, z: e.z ?? i })),
    builtin: true,
    ...extra,
  };
}

// ─── 40 × 30 (priority) ───────────────────────────────────────────

const T40_KLASSIK = tpl('40x30-klassik', 'Klassik', 40, 30, [
  el({ kind: 'text', data: 'product_name', x: 2, y: 2, w: 36, h: 5, fontSizePt: 11, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'sku', x: 2, y: 7, w: 36, h: 3, fontSizePt: 7, fontWeight: 600, align: 'center', color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 2, y: 10, w: 36, h: 7, fontSizePt: 20, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 3, y: 19, w: 34, h: 7, barcodeType: 'EAN13', showValue: true, moduleWidth: 2 }),
]);

const T40_SPLIT = tpl('40x30-split', 'Split', 40, 30, [
  el({ kind: 'text', data: 'product_name', x: 2, y: 2, w: 22, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 2, y: 7, w: 22, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 24, y: 2, w: 14, h: 8, fontSizePt: 16, fontWeight: 900, align: 'right', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 2, y: 18, w: 36, h: 9, barcodeType: 'EAN13', showValue: true, moduleWidth: 2 }),
]);

const T40_QR_NARX = tpl('40x30-qr-narx', 'QR + narx', 40, 30, [
  el({ kind: 'qr', x: 2, y: 3, w: 14, h: 14, barcodeType: 'QR' }),
  el({ kind: 'text', data: 'product_name', x: 18, y: 3, w: 20, h: 5, fontSizePt: 9, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 18, y: 8, w: 20, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 18, y: 12, w: 20, h: 7, fontSizePt: 14, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
]);

const T40_NARX_FOKUS = tpl('40x30-narx-fokus', 'Narx-fokus', 40, 30, [
  el({ kind: 'text', data: 'price', x: 2, y: 4, w: 36, h: 12, fontSizePt: 26, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'static_text', text: "so'm", x: 2, y: 16, w: 36, h: 3, fontSizePt: 8, fontWeight: 600, align: 'center', color: '#5a655e' }),
  el({ kind: 'barcode', x: 8, y: 21, w: 24, h: 7, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T40_BRENDLI = tpl('40x30-brendli', 'Brendli', 40, 30, [
  el({ kind: 'text', data: 'store_name', x: 0, y: 0, w: 40, h: 5, fontSizePt: 8, fontWeight: 800, align: 'center', color: '#ffffff', uppercase: true }),
  el({ kind: 'text', data: 'product_name', x: 2, y: 7, w: 36, h: 5, fontSizePt: 10, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'price', x: 2, y: 13, w: 36, h: 8, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 6, y: 22, w: 28, h: 6, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
], { background: '#0a5b32' });

// ─── 58 × 40 (priority) ───────────────────────────────────────────

const T58_TOKCHA = tpl('58x40-tokcha', 'Tokcha — katta narx', 58, 40, [
  el({ kind: 'text', data: 'product_name', x: 3, y: 3, w: 52, h: 6, fontSizePt: 12, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'price', x: 3, y: 10, w: 52, h: 14, fontSizePt: 32, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'sku', x: 3, y: 24, w: 52, h: 4, fontSizePt: 8, fontWeight: 600, align: 'center', color: '#5a655e' }),
  el({ kind: 'barcode', x: 6, y: 30, w: 46, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T58_BRENDLI = tpl('58x40-brendli', 'Brendli tokcha', 58, 40, [
  el({ kind: 'text', data: 'store_name', x: 0, y: 0, w: 58, h: 6, fontSizePt: 9, fontWeight: 800, align: 'center', color: '#ffffff', uppercase: true }),
  el({ kind: 'text', data: 'product_name', x: 3, y: 9, w: 52, h: 5, fontSizePt: 10, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'price', x: 3, y: 15, w: 52, h: 12, fontSizePt: 28, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 8, y: 30, w: 42, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
], { background: '#0a5b32' });

const T58_CHEGIRMA = tpl('58x40-chegirma', 'Chegirma (aksiya)', 58, 40, [
  el({ kind: 'text', data: 'product_name', x: 3, y: 2, w: 52, h: 5, fontSizePt: 11, fontWeight: 800 }),
  el({ kind: 'text', data: 'old_price', x: 3, y: 8, w: 30, h: 5, fontSizePt: 12, fontWeight: 700, color: '#bcc6bf' }),
  el({ kind: 'text', data: 'price', x: 3, y: 14, w: 30, h: 12, fontSizePt: 28, fontWeight: 900, color: '#d92d20', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'discount_pct', x: 36, y: 16, w: 18, h: 6, fontSizePt: 10, fontWeight: 800, align: 'center', color: '#ffffff' }),
  el({ kind: 'barcode', x: 3, y: 30, w: 52, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T58_QR = tpl('58x40-qr', 'Katta QR', 58, 40, [
  el({ kind: 'qr', x: 3, y: 5, w: 22, h: 22, barcodeType: 'QR' }),
  el({ kind: 'text', data: 'product_name', x: 28, y: 6, w: 27, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 28, y: 12, w: 27, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 28, y: 16, w: 27, h: 8, fontSizePt: 16, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'static_text', text: "so'm", x: 28, y: 25, w: 27, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
]);

const T58_PRO = tpl('58x40-pro', 'Pro to\'liq', 58, 40, [
  el({ kind: 'text', data: 'product_name', x: 3, y: 2, w: 38, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'date', x: 42, y: 2, w: 13, h: 4, fontSizePt: 7, fontWeight: 600, align: 'right', color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 3, y: 8, w: 28, h: 12, fontSizePt: 26, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'unit', x: 32, y: 14, w: 23, h: 4, fontSizePt: 8, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'barcode', x: 3, y: 24, w: 52, h: 9, barcodeType: 'EAN13', showValue: true, moduleWidth: 2 }),
  el({ kind: 'text', data: 'sku', x: 3, y: 34, w: 52, h: 4, fontSizePt: 7, fontWeight: 600, align: 'center', color: '#5a655e' }),
]);

// ─── 30 × 20 ──────────────────────────────────────────────────────

const T30_KLASSIK = tpl('30x20-klassik', 'Klassik', 30, 20, [
  el({ kind: 'text', data: 'product_name', x: 1.5, y: 1.5, w: 27, h: 4, fontSizePt: 8, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'price', x: 1.5, y: 5.5, w: 27, h: 5, fontSizePt: 14, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 2, y: 12, w: 26, h: 5, barcodeType: 'EAN13', showValue: true, moduleWidth: 2 }),
]);

const T30_MINIMAL = tpl('30x20-minimal', 'Minimal', 30, 20, [
  el({ kind: 'text', data: 'price', x: 1.5, y: 2, w: 27, h: 7, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 2, y: 11, w: 26, h: 7, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T30_SPLIT = tpl('30x20-split', 'Split', 30, 20, [
  el({ kind: 'text', data: 'product_name', x: 1.5, y: 1.5, w: 16, h: 4, fontSizePt: 7, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 1.5, y: 5.5, w: 16, h: 3, fontSizePt: 6, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 17, y: 1.5, w: 11.5, h: 7, fontSizePt: 11, fontWeight: 900, align: 'right', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 1.5, y: 12, w: 27, h: 6, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T30_QR = tpl('30x20-qr', 'QR', 30, 20, [
  el({ kind: 'qr', x: 1.5, y: 2, w: 10, h: 10, barcodeType: 'QR' }),
  el({ kind: 'text', data: 'product_name', x: 13, y: 2, w: 15.5, h: 4, fontSizePt: 7, fontWeight: 800 }),
  el({ kind: 'text', data: 'price', x: 13, y: 7, w: 15.5, h: 5, fontSizePt: 11, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
]);

const T30_AKSIYA = tpl('30x20-aksiya', 'Aksiya (rangli)', 30, 20, [
  el({ kind: 'text', data: 'store_name', x: 1, y: 1, w: 28, h: 3, fontSizePt: 6, fontWeight: 800, align: 'center', color: '#ffffff', uppercase: true }),
  el({ kind: 'text', data: 'price', x: 1, y: 5, w: 28, h: 8, fontSizePt: 16, fontWeight: 900, align: 'center', color: '#ffffff', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'sku', x: 1, y: 14, w: 28, h: 3, fontSizePt: 6, fontWeight: 600, align: 'center', color: 'rgba(255,255,255,0.8)' }),
], { background: '#0a5b32' });

// ─── 50 × 30 ──────────────────────────────────────────────────────

const T50_KLASSIK = tpl('50x30-klassik', 'Klassik keng', 50, 30, [
  el({ kind: 'text', data: 'product_name', x: 2, y: 2, w: 46, h: 5, fontSizePt: 11, fontWeight: 800, align: 'center' }),
  el({ kind: 'text', data: 'sku', x: 2, y: 7, w: 46, h: 3, fontSizePt: 7, fontWeight: 600, align: 'center', color: '#5a655e' }),
  el({ kind: 'text', data: 'unit', x: 2, y: 7, w: 46, h: 3, fontSizePt: 7, fontWeight: 600, align: 'center', color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 2, y: 11, w: 46, h: 7, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 4, y: 20, w: 42, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T50_IKKI_USTUN = tpl('50x30-ikki-ustun', 'Ikki ustun', 50, 30, [
  el({ kind: 'text', data: 'product_name', x: 2, y: 2, w: 28, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 2, y: 7, w: 28, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'barcode', x: 2, y: 18, w: 26, h: 9, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
  el({ kind: 'line', x: 31, y: 2, w: 0.2, h: 26, color: '#d8ded8' }),
  el({ kind: 'text', data: 'price', x: 33, y: 8, w: 15, h: 10, fontSizePt: 20, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'static_text', text: "so'm", x: 33, y: 18, w: 15, h: 3, fontSizePt: 7, fontWeight: 600, align: 'center', color: '#5a655e' }),
]);

const T50_QR_RAQAM = tpl('50x30-qr-raqam', 'QR + raqam', 50, 30, [
  el({ kind: 'qr', x: 2, y: 3, w: 16, h: 16, barcodeType: 'QR' }),
  el({ kind: 'text', data: 'product_name', x: 20, y: 3, w: 28, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'price', x: 20, y: 9, w: 28, h: 7, fontSizePt: 16, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'barcode_value', x: 20, y: 17, w: 28, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
]);

const T50_NARX_FOKUS = tpl('50x30-narx-fokus', 'Narx-fokus', 50, 30, [
  el({ kind: 'text', data: 'price', x: 2, y: 3, w: 46, h: 12, fontSizePt: 30, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 6, y: 18, w: 22, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
  el({ kind: 'text', data: 'sku', x: 30, y: 20, w: 18, h: 4, fontSizePt: 8, fontWeight: 600, align: 'center', color: '#5a655e' }),
]);

const T50_BRENDLI_SANA = tpl('50x30-brendli-sana', 'Brendli + sana', 50, 30, [
  el({ kind: 'text', data: 'store_name', x: 0, y: 0, w: 32, h: 5, fontSizePt: 7, fontWeight: 800, color: '#ffffff', uppercase: true }),
  el({ kind: 'text', data: 'date', x: 32, y: 0, w: 18, h: 5, fontSizePt: 6, fontWeight: 600, align: 'right', color: 'rgba(255,255,255,0.8)' }),
  el({ kind: 'text', data: 'product_name', x: 2, y: 7, w: 28, h: 5, fontSizePt: 9, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 2, y: 12, w: 28, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 32, y: 8, w: 16, h: 10, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 2, y: 20, w: 46, h: 8, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
], { background: '#0a5b32' });

// Fix brendli+sana header text colors on green bg - product name should be on white area
T50_BRENDLI_SANA.elements = T50_BRENDLI_SANA.elements.map((e) => {
  if (e.y >= 6) return e;
  if (e.data === 'store_name' || e.data === 'date') return e;
  return e;
});

// ─── 100 × 30 ─────────────────────────────────────────────────────

const T100_GORizontal = tpl('100x30-gorizontal', 'Gorizontal to\'liq', 100, 30, [
  el({ kind: 'text', data: 'product_name', x: 3, y: 3, w: 38, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 3, y: 8, w: 38, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'unit', x: 3, y: 8, w: 38, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 44, y: 5, w: 22, h: 10, fontSizePt: 16, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 70, y: 4, w: 26, h: 14, barcodeType: 'EAN13', showValue: true, moduleWidth: 2 }),
]);

const T100_NARX_BARKOD = tpl('100x30-narx-barkod', 'Narx + uzun barkod', 100, 30, [
  el({ kind: 'text', data: 'price', x: 4, y: 4, w: 36, h: 14, fontSizePt: 22, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'text', data: 'static_text', text: "so'm/m", x: 4, y: 18, w: 36, h: 4, fontSizePt: 8, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'barcode', x: 44, y: 3, w: 54, h: 24, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
]);

const T100_BRENDLI_YON = tpl('100x30-brendli-yon', 'Brendli yon panel', 100, 30, [
  el({ kind: 'text', data: 'store_name', x: 0, y: 0, w: 22, h: 30, fontSizePt: 7, fontWeight: 800, align: 'center', color: '#ffffff', rotation: 0 }),
  el({ kind: 'text', data: 'product_name', x: 25, y: 4, w: 42, h: 5, fontSizePt: 9, fontWeight: 800 }),
  el({ kind: 'barcode', x: 25, y: 12, w: 30, h: 14, barcodeType: 'EAN13', showValue: false, moduleWidth: 2 }),
  el({ kind: 'text', data: 'price', x: 70, y: 6, w: 28, h: 12, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
], { background: '#ffffff' });

// Green side panel element overlay
T100_BRENDLI_YON.elements[0] = {
  ...T100_BRENDLI_YON.elements[0],
  x: 0,
  y: 0,
  w: 20,
  h: 30,
  color: '#ffffff',
};

const T100_QR_UZUN = tpl('100x30-qr-uzun', 'QR uzun', 100, 30, [
  el({ kind: 'qr', x: 3, y: 3, w: 18, h: 18, barcodeType: 'QR' }),
  el({ kind: 'text', data: 'product_name', x: 24, y: 4, w: 48, h: 5, fontSizePt: 10, fontWeight: 800 }),
  el({ kind: 'text', data: 'unit', x: 24, y: 10, w: 48, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 76, y: 5, w: 22, h: 12, fontSizePt: 16, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
]);

const T100_KOMPAKT = tpl('100x30-kompakt', 'Kompakt lenta', 100, 30, [
  el({ kind: 'text', data: 'product_name', x: 3, y: 8, w: 50, h: 5, fontSizePt: 9, fontWeight: 800 }),
  el({ kind: 'text', data: 'sku', x: 3, y: 14, w: 30, h: 3, fontSizePt: 7, fontWeight: 600, color: '#5a655e' }),
  el({ kind: 'text', data: 'price', x: 56, y: 5, w: 24, h: 12, fontSizePt: 18, fontWeight: 900, align: 'center', color: '#0a5b32', priceFormat: 'dot_som' }),
  el({ kind: 'barcode', x: 82, y: 4, w: 15, h: 22, barcodeType: 'CODE128', showValue: false, moduleWidth: 2, rotation: 90 }),
]);

export const BUILTIN_LABEL_TEMPLATES: LabelTemplate[] = [
  // 30×20
  T30_KLASSIK,
  T30_MINIMAL,
  T30_SPLIT,
  T30_QR,
  T30_AKSIYA,
  // 40×30
  T40_KLASSIK,
  T40_SPLIT,
  T40_QR_NARX,
  T40_NARX_FOKUS,
  T40_BRENDLI,
  // 50×30
  T50_KLASSIK,
  T50_IKKI_USTUN,
  T50_QR_RAQAM,
  T50_NARX_FOKUS,
  T50_BRENDLI_SANA,
  // 58×40
  T58_TOKCHA,
  T58_BRENDLI,
  T58_CHEGIRMA,
  T58_QR,
  T58_PRO,
  // 100×30
  T100_GORizontal,
  T100_NARX_BARKOD,
  T100_BRENDLI_YON,
  T100_QR_UZUN,
  T100_KOMPAKT,
];

export function getBuiltinTemplate(id: string): LabelTemplate | undefined {
  return BUILTIN_LABEL_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesBySize(widthMm: number, heightMm: number): LabelTemplate[] {
  return BUILTIN_LABEL_TEMPLATES.filter((t) => t.widthMm === widthMm && t.heightMm === heightMm);
}

export function cloneTemplate(template: LabelTemplate, newName?: string): LabelTemplate {
  return {
    ...template,
    id: newElementId(),
    name: newName ?? `${template.name} (nusxa)`,
    builtin: false,
    updatedAt: new Date().toISOString(),
    elements: template.elements.map((e) => ({ ...e, id: newElementId() })),
  };
}
