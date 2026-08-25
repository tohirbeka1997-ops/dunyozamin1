import { v4 as uuidv4 } from 'uuid';

export type ElementKind = 'text' | 'barcode' | 'qr' | 'image' | 'line';
export type DataField =
  | 'product_name'
  | 'price'
  | 'old_price'
  | 'discount_pct'
  | 'sku'
  | 'barcode_value'
  | 'unit'
  | 'date'
  | 'store_name'
  | 'static_text';

export type BarcodeFormat = 'EAN13' | 'CODE128' | 'QR';
export type PriceFormat = 'dot_som' | 'dot' | 'plain';
export type LabelAlign = 'left' | 'center' | 'right';
export type LabelRotation = 0 | 90 | 180 | 270;

export type LabelElement = {
  id: string;
  kind: ElementKind;
  data?: DataField;
  text?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  align?: LabelAlign;
  color?: string;
  rotation?: LabelRotation;
  visible?: boolean;
  locked?: boolean;
  z?: number;
  barcodeType?: BarcodeFormat;
  showValue?: boolean;
  moduleWidth?: number;
  priceFormat?: PriceFormat;
  /** When false, price omits "so'm" suffix (dot_som format only). Default: true. */
  showCurrency?: boolean;
  /** When false, SKU omits "SKU: " prefix. Default: true. */
  showSkuPrefix?: boolean;
  /** Legacy compat */
  letterSpacingPt?: number;
  uppercase?: boolean;
};

export type LabelTemplate = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
  background?: string;
  builtin?: boolean;
  updatedAt?: string;
};

export type LabelSheetLayout = {
  paper: 'A4' | 'A5' | 'Roll';
  cols: number;
  rows: number;
  gapMm: number;
  marginMm: number;
};

/** @deprecated legacy rigid element id */
export type ProductLabelElementId = 'header' | 'name' | 'sku' | 'price' | 'barcode';

/** @deprecated legacy layout element (xMm fields) */
export type LegacyProductLabelElement = {
  id: ProductLabelElementId;
  kind: 'text' | 'barcode';
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSizePt?: number;
  fontWeight?: number;
  align?: LabelAlign;
  fontFamily?: string;
  letterSpacingPt?: number;
  uppercase?: boolean;
};

const LEGACY_DATA_MAP: Record<ProductLabelElementId, DataField | undefined> = {
  header: 'store_name',
  name: 'product_name',
  sku: 'sku',
  price: 'price',
  barcode: undefined,
};

export function newElementId(): string {
  return uuidv4();
}

export function createPaletteElement(
  kind: ElementKind,
  data?: DataField,
  defaults?: Partial<LabelElement>
): LabelElement {
  const base: LabelElement = {
    id: newElementId(),
    kind,
    data,
    x: 2,
    y: 2,
    w: 20,
    h: 4,
    visible: true,
    locked: false,
    fontFamily: 'Inter, Arial, sans-serif',
    fontSizePt: 10,
    fontWeight: 600,
    align: 'left',
    color: '#16201b',
    rotation: 0,
    ...defaults,
  };
  if (kind === 'barcode') {
    return {
      ...base,
      w: 30,
      h: 10,
      barcodeType: 'EAN13',
      showValue: true,
      moduleWidth: 2,
    };
  }
  if (kind === 'qr') {
    return { ...base, kind: 'qr', w: 12, h: 12, barcodeType: 'QR' };
  }
  if (kind === 'line') {
    return { ...base, h: 0.4, w: 30, color: '#16201b' };
  }
  if (kind === 'image') {
    return { ...base, w: 10, h: 10 };
  }
  if (data === 'price') {
    return { ...base, fontSizePt: 18, fontWeight: 900, color: '#0a5b32', priceFormat: 'dot_som' };
  }
  if (data === 'old_price') {
    return { ...base, fontSizePt: 12, fontWeight: 700, color: '#bcc6bf' };
  }
  if (data === 'discount_pct') {
    return {
      ...base,
      w: 12,
      h: 5,
      fontSizePt: 11,
      fontWeight: 800,
      align: 'center',
      color: '#ffffff',
      data: 'discount_pct',
    };
  }
  if (data === 'product_name') {
    return { ...base, fontSizePt: 11, fontWeight: 800 };
  }
  return base;
}

export function migrateLegacyElement(el: LegacyProductLabelElement, z = 0): LabelElement {
  const data = LEGACY_DATA_MAP[el.id];
  return {
    id: el.id,
    kind: el.id === 'barcode' ? 'barcode' : 'text',
    data,
    x: el.xMm,
    y: el.yMm,
    w: el.wMm,
    h: el.hMm,
    fontSizePt: el.fontSizePt,
    fontWeight: el.fontWeight,
    align: el.align,
    fontFamily: el.fontFamily,
    letterSpacingPt: el.letterSpacingPt,
    uppercase: el.uppercase,
    visible: true,
    locked: false,
    z,
    barcodeType: el.id === 'barcode' ? 'EAN13' : undefined,
    showValue: el.id === 'barcode' ? false : undefined,
    priceFormat: el.id === 'price' ? 'dot_som' : undefined,
  };
}

export function migrateLegacyLayout(layout: LegacyProductLabelElement[]): LabelElement[] {
  return layout.map((el, i) => migrateLegacyElement(el, i));
}

export function isLegacyElement(el: unknown): el is LegacyProductLabelElement {
  return (
    !!el &&
    typeof el === 'object' &&
    'xMm' in (el as object) &&
    'id' in (el as object) &&
    typeof (el as LegacyProductLabelElement).id === 'string'
  );
}

export function normalizeElements(raw: unknown[]): LabelElement[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((el, i) => {
    if (isLegacyElement(el)) return migrateLegacyElement(el, i);
    const e = el as LabelElement;
    return {
      ...e,
      id: e.id || newElementId(),
      x: Number(e.x ?? (e as unknown as { xMm?: number }).xMm ?? 0),
      y: Number(e.y ?? (e as unknown as { yMm?: number }).yMm ?? 0),
      w: Number(e.w ?? (e as unknown as { wMm?: number }).wMm ?? 10),
      h: Number(e.h ?? (e as unknown as { hMm?: number }).hMm ?? 4),
      visible: e.visible !== false,
      locked: Boolean(e.locked),
      z: e.z ?? i,
    };
  });
}

export function sortByZ(elements: LabelElement[]): LabelElement[] {
  return [...elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

export function clampElementToLabel(el: LabelElement, widthMm: number, heightMm: number): LabelElement {
  const w = Math.max(0.5, Math.min(el.w, widthMm));
  const h = Math.max(0.5, Math.min(el.h, heightMm));
  const x = Math.max(0, Math.min(el.x, widthMm - w));
  const y = Math.max(0, Math.min(el.y, heightMm - h));
  return { ...el, x, y, w, h };
}

export function roundMm(n: number, step = 0.5): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / step) * step;
}

export function defaultProductLabelLayout(widthMm: number, heightMm: number): LabelElement[] {
  const w = Math.max(10, Number(widthMm) || 39);
  const h = Math.max(10, Number(heightMm) || 20);
  const isSmall = w <= 45 && h <= 25;
  const pad = isSmall ? 0.6 : 1.0;
  const headerH = isSmall ? 3.8 : 5.2;
  const nameH = isSmall ? 3.0 : 4.2;
  const priceH = isSmall ? 3.2 : 4.6;
  const barcodeH = Math.max(6, h - (pad * 2 + headerH + nameH + priceH));

  return normalizeElements([
    {
      id: 'header',
      kind: 'text',
      data: 'store_name',
      x: pad,
      y: pad,
      w: Math.max(10, w * 0.65 - pad),
      h: headerH,
      fontSizePt: isSmall ? 10 : 12,
      fontWeight: 800,
      align: 'left',
    },
    {
      id: 'sku',
      kind: 'text',
      data: 'sku',
      x: w * 0.65,
      y: pad,
      w: Math.max(8, w * 0.35 - pad),
      h: headerH,
      fontSizePt: isSmall ? 7 : 8,
      fontWeight: 600,
      align: 'right',
    },
    {
      id: 'name',
      kind: 'text',
      data: 'product_name',
      x: pad,
      y: pad + headerH,
      w: w - pad * 2,
      h: nameH,
      fontSizePt: isSmall ? 8 : 9,
      fontWeight: 500,
      align: 'left',
    },
    {
      id: 'barcode',
      kind: 'barcode',
      x: pad,
      y: pad + headerH + nameH,
      w: w - pad * 2,
      h: barcodeH,
      barcodeType: 'EAN13',
      showValue: false,
    },
    {
      id: 'price',
      kind: 'text',
      data: 'price',
      x: pad,
      y: pad + headerH + nameH + barcodeH,
      w: w - pad * 2,
      h: priceH,
      fontSizePt: isSmall ? 10 : 12,
      fontWeight: 800,
      align: 'center',
      priceFormat: 'dot_som',
    },
  ]);
}

export const LABEL_SIZE_PRESETS = [
  { key: '30x20', w: 30, h: 20, label: '30 × 20 mm' },
  { key: '40x30', w: 40, h: 30, label: '40 × 30 mm' },
  { key: '50x30', w: 50, h: 30, label: '50 × 30 mm' },
  { key: '58x40', w: 58, h: 40, label: '58 × 40 mm' },
  { key: '100x30', w: 100, h: 30, label: '100 × 30 mm' },
] as const;

export type LabelPreviewData = {
  product_name: string;
  price: number;
  old_price?: number;
  discount_pct?: number;
  sku: string;
  barcode_value: string;
  unit: string;
  date: string;
  store_name: string;
};

export const DEMO_PREVIEW_DATA: LabelPreviewData = {
  product_name: 'Hi-Tech Plafon',
  price: 195000,
  old_price: 230000,
  discount_pct: 15,
  sku: 'DH1-006',
  barcode_value: '3008475700156',
  unit: 'dona',
  date: new Date().toLocaleDateString('uz-UZ'),
  store_name: 'DUNYOZAMIN',
};

export function labelsPerSheet(
  labelW: number,
  labelH: number,
  sheet: LabelSheetLayout
): number {
  if (sheet.paper === 'Roll') return sheet.cols * sheet.rows;
  const pageW = sheet.paper === 'A5' ? 148 : 210;
  const pageH = sheet.paper === 'A5' ? 210 : 297;
  const m = sheet.marginMm;
  const g = sheet.gapMm;
  const usableW = pageW - 2 * m;
  const usableH = pageH - 2 * m;
  const maxCols = Math.max(1, Math.floor((usableW + g) / (labelW + g)));
  const maxRows = Math.max(1, Math.floor((usableH + g) / (labelH + g)));
  return Math.min(sheet.cols * sheet.rows, maxCols * maxRows);
}
