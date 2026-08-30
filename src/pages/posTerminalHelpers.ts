// POSTerminal uchun sof (state'ga bog'liq bo'lmagan) yordamchi funksiyalar va
// konstantalar. POSTerminal.tsx hajmini kamaytirish uchun ajratib olindi.
// Bu yerdagi hech narsa React state/hook'larga bog'liq emas — faqat argumentlar
// orqali ishlaydi, shuning uchun mustaqil test qilish mumkin.

import type { Product } from '@/types/database';
import { applyPercentUZS, roundUZS } from '@/lib/money';
import {
  clampQuantityForUnit,
  clampSignedQuantityForUnit,
  getMaxQuantityForUnit,
  getQuantityMin,
  isFractionalUnit,
} from '@/utils/quantity';
import {
  filterProductsBySearchTerm,
  productMatchesSearchTerm,
} from '@/lib/productSearchMatch';

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

/**
 * Checkout: send replaces_order_id only for completed-order amend (not hold/draft void).
 * Prefer in-memory edit id; fall back to sessionStorage when state was lost on nav/refresh
 * but the cart was restored from pos_replaces_order_id / nav draft.
 */
export function resolveReplacesOrderIdForCheckout(
  importedOrderIdForEdit: string | null,
  importedHoldOrderId?: string | null,
): string | null {
  if (importedHoldOrderId) return null;
  if (importedOrderIdForEdit) return importedOrderIdForEdit;
  return readPosReplacesOrderId();
}

export function isPosAmendCheckoutError(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('only completed orders can be amended') ||
    m.includes('cannot be amended') ||
    m.includes('no remaining items to amend')
  );
}

/** Unpaid portion of a completed order still on the customer ledger (UZS bucket). */
export function computeOrderOutstandingForAmend(order: {
  total_amount?: number | null;
  paid_amount?: number | null;
}): number {
  const total = Number(order.total_amount ?? 0) || 0;
  const paid = Number(order.paid_amount ?? 0) || 0;
  return Math.max(0, total - paid);
}

/**
 * When amending a completed order, subtract its outstanding debt from "Oldingi qarz"
 * so checkout does not add both the full cart (re-sale) and the same order's credit again.
 */
export function netPriorDebtForAmendCheckout(
  priorDebt: number,
  importedOrderOutstanding: number,
  isAmendCheckout: boolean,
): number {
  const raw = Math.max(0, Number(priorDebt) || 0);
  const overlap = Math.max(0, Number(importedOrderOutstanding) || 0);
  if (!isAmendCheckout || overlap <= 0) return raw;
  return Math.max(0, raw - overlap);
}

/**
 * Amount due at POS checkout (To'lash). Prior customer debt is only added when
 * explicitly opted in — default checkout is the current sale/cart total only.
 */
export function computeCheckoutGrandTotal(
  saleTotal: number,
  priorDebt: number,
  includePriorDebt: boolean,
): number {
  const total = Number(saleTotal) || 0;
  if (total <= 0) return total;
  const extra =
    includePriorDebt && (Number(priorDebt) || 0) > 0 ? Math.max(0, Number(priorDebt) || 0) : 0;
  return total + extra;
}

/** Navigatsiya orqali POS dan chiqganda savatni vaqtincha saqlash */
export const POS_NAV_CART_DRAFT_KEY = 'pos:nav_cart_draft';

export type PosNavCartDraftLine = {
  productId: string;
  quantity: number;
  qty_sale?: number;
  sale_unit?: string;
  ratio_to_base?: number;
  /** Original sold qty when amending a completed order — used for stock cap bonus. */
  amend_original_qty_sale?: number;
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
  /** Completed order being amended — restored on POS return so checkout reverses stock/ledger. */
  replacesOrderId?: string | null;
  /** Unpaid portion of replacesOrderId — nets "Oldingi qarz" at amend checkout. */
  importedOrderOutstanding?: number;
  /** Usta/referrer for bonus routing only */
  bonusReferrerCustomerId?: string | null;
  /** Display label for amend banner (e.g. ORD-123). */
  replacesOrderNumber?: string | null;
  /** Hold/draft order imported — void on checkout, not amend. */
  importedHoldOrderId?: string | null;
  /** Display label for hold-import banner. */
  importedHoldOrderNumber?: string | null;
  /** Loyalty points to redeem — restored on amend import. */
  loyaltyRedeemPoints?: number;
};

/** Restore loyalty redeem when importing a completed order for amend (not hold). */
export function resolveLoyaltyRedeemOnOrderImport(
  order: { loyalty_redeem_points?: number | null },
  isAmendImport: boolean,
): number {
  if (!isAmendImport) return 0;
  return Math.max(0, Math.floor(Number(order.loyalty_redeem_points) || 0));
}

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

export {
  registerProductScanIndexes,
  buildProductScanIndex,
  lookupProductByScanCode,
  collectScanLookupKeys,
  createEmptyProductScanIndex,
} from '@/lib/pos/productBarcodeIndex';
export type { ProductScanIndex, ScanLookupHit } from '@/lib/pos/productBarcodeIndex';

// ----- Qidiruv matnini normallashtirish -----

export const normalizeSearchTerm = (value: string) => String(value || '').trim();

export const normalizeSku = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]/g, '');

export const normalizeArticle = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]/g, '');

export const normalizeText = (value: string) => String(value || '').trim().toLowerCase();

/** POS mahsulot qidiruvi: exact SKU/barcode first, then fuzzy name/partial. */
export function productMatchesPosTextFilter(product: Product, term: string): boolean {
  return productMatchesSearchTerm(product, term);
}

/** Filter POS product lists with exact-code precedence (suppress unrelated contains hits). */
export function filterPosProductsBySearchTerm<T extends Product>(
  products: T[],
  term: string,
): T[] {
  return filterProductsBySearchTerm(products, term);
}

/** Compact secondary codes for POS lists/cart: SKU · Artikul · Brend (non-empty only). */
export function posProductCodeParts(product: {
  sku?: string | null;
  article?: string | null;
  brand?: string | null;
}): string[] {
  const parts: string[] = [];
  const sku = String(product.sku ?? '').trim();
  const article = String(product.article ?? '').trim();
  const brand = String(product.brand ?? '').trim();
  if (sku) parts.push(sku);
  if (article) parts.push(article);
  if (brand) parts.push(brand);
  return parts;
}

export function formatPosProductCodeMeta(product: {
  sku?: string | null;
  article?: string | null;
  brand?: string | null;
}): string {
  return posProductCodeParts(product).join(' · ');
}

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

export const normalizeUnitCode = (value?: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/** Map display/legacy aliases onto product_units codes (m ↔ metr, L ↔ litr, …). */
const UNIT_CODE_ALIASES: Record<string, string> = {
  m: 'm',
  м: 'm',
  meter: 'm',
  metre: 'm',
  metr: 'm',
  kg: 'kg',
  кг: 'kg',
  g: 'g',
  гр: 'g',
  г: 'g',
  l: 'l',
  л: 'l',
  lt: 'l',
  liter: 'l',
  litre: 'l',
  litr: 'l',
  ml: 'ml',
  мл: 'ml',
  pcs: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  dona: 'pcs',
  don: 'pcs',
  шт: 'pcs',
  штук: 'pcs',
  pack: 'pack',
  paket: 'pack',
  upak: 'pack',
  упак: 'pack',
  pachka: 'pack',
  box: 'box',
  quti: 'box',
};

export const canonicalUnitCode = (value?: unknown) => {
  const raw = normalizeUnitCode(value);
  if (!raw) return '';
  return UNIT_CODE_ALIASES[raw] || raw;
};

/** Resolve the stock base unit (ratio_to_base === 1). */
export const getBaseUnit = (product: Product) => {
  const { baseUnit, units } = getProductUnits(product);
  const fromRatio =
    units.find((u: any) => Number(u.ratio_to_base || 0) === 1)?.unit || null;
  return canonicalUnitCode(fromRatio || baseUnit || 'pcs') || 'pcs';
};

/**
 * POS grid "+" quick-add quantity in the product's default sale unit.
 * Countable units always add 1; base fractional units (kg, m) add 1 as well.
 */
export const getQuickAddSaleQty = (product: Product): number => {
  const { saleUnit } = getSaleUnitConfig(product);
  return 1;
};

/**
 * When default sale unit is a fractional alternate unit (e.g. kg while stock is in pcs),
 * open the quantity numpad instead of silently adding 1 kg.
 */
export const canQuickAddWithoutNumpad = (product: Product): boolean => {
  const { baseUnit, saleUnit } = getSaleUnitConfig(product);
  const normBase = canonicalUnitCode(baseUnit);
  const normSale = canonicalUnitCode(saleUnit);
  if (normSale === normBase) return true;
  if (!isFractionalUnit(saleUnit)) return true;
  return false;
};

/** Human-readable ratio hint for product form / POS: "1 kg = 0.046 dona". */
export const formatUnitRatioHint = (
  unit: string,
  ratioToBase: number,
  baseUnit: string,
): string => {
  const ratio = Number(ratioToBase || 0) || 0;
  const u = String(unit || '').trim() || '?';
  const base = String(baseUnit || '').trim() || 'asosiy';
  if (ratio <= 0) return '';
  if (Math.abs(ratio - 1) < 1e-9) return `1 ${u} = 1 ${base}`;
  const formatted = ratio >= 1 ? String(ratio) : ratio.toFixed(6).replace(/\.?0+$/, '');
  return `1 ${u} = ${formatted} ${base}`;
};

export const getSaleUnitConfig = (product: Product, saleUnit?: string) => {
  const { baseUnit, units } = getProductUnits(product);
  const targetUnit = canonicalUnitCode(saleUnit);
  const picked =
    (targetUnit
      ? units.find((u: any) => canonicalUnitCode(u.unit) === targetUnit)
      : undefined) ||
    units.find((u: any) => u.is_default) ||
    units[0];
  // Do NOT invent ratio_to_base=1 when the label mismatches (e.g. UI "Metr" vs unit "m").
  // That desyncs qty_base and under/over-prices lines after unit switches.
  const ratio = Number(picked?.ratio_to_base ?? 1) || 1;
  const price = Number(picked?.sale_price ?? (product as any)?.sale_price ?? 0) || 0;
  return { baseUnit, saleUnit: picked?.unit || baseUnit, ratio_to_base: ratio, sale_price: price };
};

/**
 * After a cart sale-unit switch: keep stock (qty_base) stable, refresh sale qty / price / totals.
 * Always returns `quantity === qty_sale` so promo IPC (which historically preferred `quantity`)
 * cannot overwrite the line with a stale qty.
 */
export function recalcCartLineForSaleUnitChange(input: {
  prevQtySale: number;
  prevQtyBase?: number | null;
  prevRatioToBase: number;
  nextSaleUnit: string;
  nextRatioToBase: number;
  nextUnitPrice: number;
  discountAmount?: number;
}): {
  sale_unit: string;
  ratio_to_base: number;
  quantity: number;
  qty_sale: number;
  qty_base: number;
  unit_price: number;
  subtotal: number;
  discount_amount: number;
  total: number;
} {
  const prevQtySale = Number(input.prevQtySale || 0) || 0;
  const prevRatio = Number(input.prevRatioToBase || 0) || 1;
  const prevQtyBaseRaw = Number(input.prevQtyBase);
  const prevQtyBase =
    Number.isFinite(prevQtyBaseRaw) && prevQtyBaseRaw !== 0
      ? prevQtyBaseRaw
      : toBaseQty(prevQtySale, prevRatio);
  const nextRatio = Number(input.nextRatioToBase || 0) || 1;
  let qtySale = nextRatio > 0 ? prevQtyBase / nextRatio : prevQtySale;
  qtySale = clampSignedQuantityForUnit(qtySale, input.nextSaleUnit);
  const qtyBase = toBaseQty(qtySale, nextRatio);
  const unitPrice = Number(input.nextUnitPrice || 0) || 0;
  const subtotal = unitPrice * qtySale;
  const lineDiscount =
    qtySale < 0 ? 0 : Math.min(Number(input.discountAmount || 0) || 0, Math.max(0, subtotal));
  return {
    sale_unit: input.nextSaleUnit,
    ratio_to_base: nextRatio,
    quantity: qtySale,
    qty_sale: qtySale,
    qty_base: qtyBase,
    unit_price: unitPrice,
    subtotal,
    discount_amount: lineDiscount,
    total: subtotal - lineDiscount,
  };
}

/** Cart qty used for pricing / promos — prefer sale units over legacy `quantity`. */
export function cartLinePricingQty(line: {
  qty_sale?: number | null;
  quantity?: number | null;
}): number {
  return Number(line.qty_sale ?? line.quantity ?? 0) || 0;
}

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

/**
 * Max sale qty for a cart line. During completed-order amend, checkout reverses the
 * original sale first — UI may allow current warehouse stock plus the line's original
 * sold qty (not clamped to warehouse balance alone).
 */
export const getMaxSaleQtyForCartLine = (
  product: Product,
  ratioToBase: number,
  saleUnit?: string,
  amendOriginalQtySale?: number | null,
) => {
  const stockMax = getMaxSaleQty(product, ratioToBase, saleUnit);
  const bonus = Math.max(0, Number(amendOriginalQtySale) || 0);
  if (bonus <= 0) return stockMax;
  if (stockMax <= 0) return bonus;
  return stockMax + bonus;
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

/** POS scan toast: name · barcode · cost · unit */
export function formatScanInfoDescription(product: Product): string {
  const barcode = String((product as { barcode?: string | null }).barcode || '').trim() || '—';
  const cost =
    Number(
      (product as { cost_price?: number }).cost_price ??
        (product as { purchase_price?: number }).purchase_price ??
        0,
    ) || 0;
  const { saleUnit } = getSaleUnitConfig(product);
  const costLabel = cost > 0 ? cost.toLocaleString('uz-UZ') : '—';
  return `${product.name} · ${barcode} · tannarx ${costLabel} · ${saleUnit}`;
}

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

// ----- Checkout idempotency (duplicate-order / double-stock-deduction guard) -----

/**
 * Generate a one-time idempotency key for a POS checkout session.
 *
 * The key is sent to the backend as `order_uuid`. The SAME key must be reused
 * across retries of the SAME basket (slow response / HTTP 429 re-submit) so the
 * server dedups (one order, stock decremented once). A fresh basket must get a
 * fresh key — see {@link buildCheckoutIdempotencySignature}.
 */
export function newCheckoutIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore — fall through to manual UUID */
  }
  // RFC4122-ish fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Sale (+1) vs exchange return (-1) when adding a cart line from POS. */
export function getCartLineQuantitySign(exchangeReturnMode: boolean): 1 | -1 {
  return exchangeReturnMode ? -1 : 1;
}

export type CheckoutSignatureLine = {
  productId: string;
  qtyBase: number;
  unitPrice: number;
  discountAmount: number;
};

/**
 * Stable signature of the current checkout so the idempotency key can be bound
 * to THIS exact basket. Any change (lines, customer, discount, currency, loyalty
 * redemption) yields a different signature, which the UI uses to start a new
 * checkout session (new key). Identical re-submits keep the same signature →
 * same key → backend dedup.
 */
export function buildCheckoutIdempotencySignature(input: {
  lines: CheckoutSignatureLine[];
  customerId?: string | null;
  bonusReferrerCustomerId?: string | null;
  discountType?: string | null;
  discountValue?: string | number | null;
  saleCurrency?: string | null;
  loyaltyRedeemPoints?: number | null;
}): string {
  const lines = (input.lines || [])
    .map(
      (l) =>
        `${l.productId}:${Number(l.qtyBase) || 0}:${Number(l.unitPrice) || 0}:${Number(l.discountAmount) || 0}`,
    )
    .join('|');
  const meta = [
    `c=${input.customerId ?? ''}`,
    `br=${input.bonusReferrerCustomerId ?? ''}`,
    `dt=${input.discountType ?? ''}`,
    `dv=${input.discountValue ?? ''}`,
    `cur=${input.saleCurrency ?? ''}`,
    `lp=${Number(input.loyaltyRedeemPoints) || 0}`,
  ].join(';');
  return `${lines}#${meta}`;
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

export type HeldOrderDiscount = { type: 'amount' | 'percent'; value: number } | null;

/**
 * Merchandise total for a parked/hold order — matches POSTerminal `totals.total`
 * (line + order discounts, UZS rounding). Excludes prior customer debt and loyalty.
 * When `storedTotal` is set (DB/mobile hold or snapshot at save time), use it as-is.
 */
export function computeHeldOrderTotal(
  items: CartLineLike[],
  orderDiscount?: HeldOrderDiscount,
  storedTotal?: number | null,
): number {
  if (storedTotal != null && Number.isFinite(Number(storedTotal))) {
    return roundUZS(Number(storedTotal));
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const lineDiscountsTotal = items.reduce(
    (sum, item) => sum + Number(item.discount_amount || 0),
    0,
  );
  const discountBase = cartOrderDiscountBase(items);

  let globalDiscountAmount = 0;
  if (orderDiscount && discountBase.hasSaleLine && Number(orderDiscount.value) > 0) {
    if (orderDiscount.type === 'amount') {
      globalDiscountAmount = roundUZS(orderDiscount.value);
    } else {
      globalDiscountAmount = applyPercentUZS(
        discountBase.maxOrderDiscount,
        orderDiscount.value,
      );
    }
  }

  return roundUZS(subtotal - lineDiscountsTotal - globalDiscountAmount);
}
