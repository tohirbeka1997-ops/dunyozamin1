// POSTerminal uchun sof (state'ga bog'liq bo'lmagan) yordamchi funksiyalar va
// konstantalar. POSTerminal.tsx hajmini kamaytirish uchun ajratib olindi.
// Bu yerdagi hech narsa React state/hook'larga bog'liq emas — faqat argumentlar
// orqali ishlaydi, shuning uchun mustaqil test qilish mumkin.

import type { Product } from '@/types/database';
import {
  clampQuantityForUnit,
  getMaxQuantityForUnit,
  getQuantityMin,
} from '@/utils/quantity';

export const POS_QUICK_PRODUCT_IDS_KEY = 'pos:quickProductIds';
export const MAX_POS_QUICK_PRODUCTS = 8;
/** Buyurtma tahriri: checkout paytida asl buyurtmani bekor qilish (replaces_order_id) */
export const POS_REPLACES_ORDER_ID_KEY = 'pos_replaces_order_id';
/** POS scan debounce — batch promo IPC during rapid barcode bursts */
export const POS_PROMO_APPLY_DEBOUNCE_MS = 180;

export function readPosReplacesOrderId(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const v = sessionStorage.getItem(POS_REPLACES_ORDER_ID_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function persistPosReplacesOrderId(orderId: string | null | undefined): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (orderId) sessionStorage.setItem(POS_REPLACES_ORDER_ID_KEY, orderId);
    else sessionStorage.removeItem(POS_REPLACES_ORDER_ID_KEY);
  } catch {
    /* ignore */
  }
}

/** Navigatsiya orqali POS dan chiqganda savatni vaqtincha saqlash */
export const POS_NAV_CART_DRAFT_KEY = 'pos:nav_cart_draft';

export type PosNavCartDraftLine = {
  productId: string;
  quantity: number;
  qty_sale?: number;
  sale_unit?: string;
  ratio_to_base?: number;
  unit_price: number;
  price_tier?: 'retail' | 'master' | 'wholesale' | 'marketplace';
  price_source?: string;
  is_price_overridden?: boolean;
  discount_amount: number;
  subtotal: number;
  total: number;
};

export type PosNavCartDraft = {
  lines: PosNavCartDraftLine[];
  customerId?: string | null;
  discount?: { type: 'amount' | 'percent' | 'promo'; value: string };
  promoCode?: string;
  saleCurrency?: string;
  tierCode?: string;
};

export function readPosNavCartDraft(): PosNavCartDraft | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(POS_NAV_CART_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosNavCartDraft;
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistPosNavCartDraft(draft: PosNavCartDraft | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (!draft || !draft.lines.length) {
      sessionStorage.removeItem(POS_NAV_CART_DRAFT_KEY);
      return;
    }
    sessionStorage.setItem(POS_NAV_CART_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearPosNavCartDraft(): void {
  persistPosNavCartDraft(null);
}

export function registerProductScanIndexes(
  product: Product,
  barcodeIndex: Map<string, Product>,
  skuIndex: Map<string, Product>,
) {
  const sku = String(product.sku || '').trim();
  if (sku) {
    skuIndex.set(sku, product);
    const normalized = sku.toLowerCase().replace(/[\s\-_]/g, '');
    if (normalized) skuIndex.set(normalized, product);
    const trimmedLeadingZeros = sku.replace(/^0+/, '') || '0';
    if (trimmedLeadingZeros !== sku) skuIndex.set(trimmedLeadingZeros, product);
  }
  const barcode = String((product as any).barcode || '').trim();
  if (barcode) {
    barcodeIndex.set(barcode, product);
    const digitsOnly = barcode.replace(/[^\d]/g, '');
    if (digitsOnly && digitsOnly !== barcode) barcodeIndex.set(digitsOnly, product);
  }
}

// ----- Qidiruv matnini normallashtirish -----

export const normalizeSearchTerm = (value: string) => String(value || '').trim();

export const normalizeSku = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]/g, '');

export const normalizeText = (value: string) => String(value || '').trim().toLowerCase();

export const classifyQuery = (value: string) => {
  const raw = normalizeSearchTerm(value);
  const trimmed = raw.trim();
  const lower = normalizeText(trimmed);
  const numericOnly = /^[0-9]+$/.test(trimmed);
  const normalizedSku = normalizeSku(trimmed);
  const isBarcodeLike = numericOnly && [8, 12, 13, 14].includes(trimmed.length);
  const isSkuLike =
    !isBarcodeLike &&
    normalizedSku.length > 0 &&
    normalizedSku.length <= 12 &&
    /^[a-z0-9]+$/i.test(normalizedSku);
  return {
    raw: trimmed,
    lower,
    normalizedSku,
    numericOnly,
    isBarcodeLike,
    isSkuLike,
  };
};

// ----- Sotuv birligi (unit) hisob-kitoblari -----

export const getProductUnits = (product: Product) => {
  const baseUnit = (product as any)?.base_unit || product.unit || 'pcs';
  const units = Array.isArray((product as any)?.product_units)
    ? (product as any).product_units
    : [
        {
          unit: baseUnit,
          ratio_to_base: 1,
          sale_price: Number((product as any)?.sale_price ?? 0) || 0,
          is_default: true,
        },
      ];
  return { baseUnit, units };
};

export const getSaleUnitConfig = (product: Product, saleUnit?: string) => {
  const { baseUnit, units } = getProductUnits(product);
  const normalizeUnit = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const targetUnit = normalizeUnit(saleUnit);
  const picked =
    units.find((u: any) => normalizeUnit(u.unit) === targetUnit) ||
    units.find((u: any) => u.is_default) ||
    units[0];
  if (targetUnit && picked && normalizeUnit(picked.unit) !== targetUnit) {
    const productUnitTokens = [
      (product as any)?.unit,
      (product as any)?.unit_code,
      (product as any)?.unit_symbol,
      (product as any)?.unit_name,
    ]
      .map((v) => normalizeUnit(v))
      .filter(Boolean);
    if (productUnitTokens.includes(targetUnit)) {
      const fallbackPrice = Number((product as any)?.sale_price ?? 0) || 0;
      return { baseUnit, saleUnit: saleUnit as string, ratio_to_base: 1, sale_price: fallbackPrice };
    }
  }
  const ratio = Number(picked?.ratio_to_base ?? 1) || 1;
  const price = Number(picked?.sale_price ?? (product as any)?.sale_price ?? 0) || 0;
  return { baseUnit, saleUnit: picked?.unit || baseUnit, ratio_to_base: ratio, sale_price: price };
};

export const toBaseQty = (qtySale: number, ratioToBase: number) => {
  const qty = Number(qtySale || 0) || 0;
  const ratio = Number(ratioToBase || 0) || 1;
  return Number((qty * ratio).toFixed(6));
};

export const getMaxSaleQty = (product: Product, ratioToBase: number, saleUnit?: string) => {
  const baseAvailable = Number(product.current_stock || 0) || 0;
  if (!Number.isFinite(ratioToBase) || ratioToBase <= 0) return 0;
  const rawMax = baseAvailable / ratioToBase;
  return getMaxQuantityForUnit(rawMax, saleUnit);
};

/** Master minimal bazaviy miqdor uchun to'g'ri birlik narxi olish (proba miqdor). */
export const getProbeSaleQtyForUnitPrice = (product: Product, saleUnit: string, ratioToBase: number) => {
  const minSale = getQuantityMin(saleUnit);
  const masterMinBase = Number((product as any)?.master_min_qty);
  let probe = minSale;
  if (Number.isFinite(masterMinBase) && masterMinBase > 0) {
    const ratio = Number(ratioToBase || 1) || 1;
    const needSale = masterMinBase / ratio;
    probe = Math.max(probe, needSale);
  }
  return clampQuantityForUnit(probe, saleUnit);
};

/** Cart line qty in sale units (negative = return / exchange return line). */
export type CartLineLike = {
  qty_sale?: number | null;
  quantity?: number | null;
  subtotal?: number | null;
  discount_amount?: number | null;
};

export function cartLineQtySale(line: CartLineLike): number {
  return Number(line.qty_sale ?? line.quantity ?? 0) || 0;
}

/** Order-level discount applies only to positive (sale) lines — not returns. */
export function cartOrderDiscountBase(items: CartLineLike[]) {
  let saleSubtotal = 0;
  let saleLineDiscounts = 0;
  let hasSaleLine = false;
  for (const item of items) {
    if (cartLineQtySale(item) <= 0) continue;
    hasSaleLine = true;
    saleSubtotal += Number(item.subtotal || 0);
    saleLineDiscounts += Number(item.discount_amount || 0);
  }
  return {
    hasSaleLine,
    saleSubtotal,
    saleLineDiscounts,
    maxOrderDiscount: Math.max(0, saleSubtotal - saleLineDiscounts),
  };
}
