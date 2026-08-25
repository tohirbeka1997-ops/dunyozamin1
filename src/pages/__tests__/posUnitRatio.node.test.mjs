/**
 * POS multi-unit ratio semantics (kg / pcs cable scenario).
 * Run: npm run test:pos-unit-ratio
 */
import assert from 'node:assert/strict';

const FRACTIONAL_UNITS = [
  'kg', 'кг', 'g', 'гр', 'г', 'mg', 'm', 'м', 'meter', 'metre', 'metr',
  'm2', 'm3', 'm²', 'm³', 'l', 'л', 'lt', 'liter', 'litre', 'litr', 'ml', 'мл',
];
const FRACTIONAL_UNIT_SET = new Set(FRACTIONAL_UNITS);
const FRACTIONAL_DECIMALS = 3;
const FRACTIONAL_MIN = 0.001;

const UNIT_CODE_ALIASES = {
  m: 'm',
  м: 'm',
  meter: 'm',
  metre: 'm',
  metr: 'm',
  kg: 'kg',
  кг: 'kg',
  pcs: 'pcs',
  dona: 'pcs',
};

function normalizeUnitCode(value) {
  return String(value ?? '').trim().toLowerCase();
}

function canonicalUnitCode(value) {
  const raw = normalizeUnitCode(value);
  if (!raw) return '';
  return UNIT_CODE_ALIASES[raw] || raw;
}

function isFractionalUnit(unit) {
  return FRACTIONAL_UNIT_SET.has(normalizeUnitCode(unit));
}

function roundTo(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clampQuantityForUnit(value, unit) {
  if (!Number.isFinite(value)) return isFractionalUnit(unit) ? FRACTIONAL_MIN : 1;
  if (isFractionalUnit(unit)) {
    const rounded = roundTo(value, FRACTIONAL_DECIMALS);
    return rounded < FRACTIONAL_MIN ? FRACTIONAL_MIN : rounded;
  }
  const rounded = Math.round(value);
  return rounded < 1 ? 1 : rounded;
}

function clampSignedQuantityForUnit(value, unit) {
  if (!Number.isFinite(value)) return isFractionalUnit(unit) ? FRACTIONAL_MIN : 1;
  if (value === 0) return 0;
  if (value > 0) return clampQuantityForUnit(value, unit);
  return -clampQuantityForUnit(Math.abs(value), unit);
}

function getProductUnits(product) {
  const baseUnit = product?.base_unit || product?.unit || 'pcs';
  const units = Array.isArray(product?.product_units)
    ? product.product_units
    : [{ unit: baseUnit, ratio_to_base: 1, sale_price: Number(product?.sale_price ?? 0) || 0, is_default: true }];
  return { baseUnit, units };
}

function getBaseUnit(product) {
  const { baseUnit, units } = getProductUnits(product);
  const fromRatio = units.find((u) => Number(u.ratio_to_base || 0) === 1)?.unit || null;
  return canonicalUnitCode(fromRatio || baseUnit || 'pcs') || 'pcs';
}

function getSaleUnitConfig(product, saleUnit) {
  const { baseUnit, units } = getProductUnits(product);
  const targetUnit = canonicalUnitCode(saleUnit);
  const picked =
    (targetUnit ? units.find((u) => canonicalUnitCode(u.unit) === targetUnit) : undefined) ||
    units.find((u) => u.is_default) ||
    units[0];
  const ratio = Number(picked?.ratio_to_base ?? 1) || 1;
  const price = Number(picked?.sale_price ?? product?.sale_price ?? 0) || 0;
  return { baseUnit, saleUnit: picked?.unit || baseUnit, ratio_to_base: ratio, sale_price: price };
}

function toBaseQty(qtySale, ratioToBase) {
  const qty = Number(qtySale || 0) || 0;
  const ratio = Number(ratioToBase || 0) || 1;
  return Number((qty * ratio).toFixed(6));
}

function canQuickAddWithoutNumpad(product) {
  const { baseUnit, saleUnit } = getSaleUnitConfig(product);
  const normBase = canonicalUnitCode(baseUnit);
  const normSale = canonicalUnitCode(saleUnit);
  if (normSale === normBase) return true;
  if (!isFractionalUnit(saleUnit)) return true;
  return false;
}

function formatUnitRatioHint(unit, ratioToBase, baseUnit) {
  const ratio = Number(ratioToBase || 0) || 0;
  const u = String(unit || '').trim() || '?';
  const base = String(baseUnit || '').trim() || 'asosiy';
  if (ratio <= 0) return '';
  if (Math.abs(ratio - 1) < 1e-9) return `1 ${u} = 1 ${base}`;
  const formatted = ratio >= 1 ? String(ratio) : ratio.toFixed(6).replace(/\.?0+$/, '');
  return `1 ${u} = ${formatted} ${base}`;
}

function recalcCartLineForSaleUnitChange(input) {
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

/** Promo path must prefer qty_sale (regression for stale `quantity` after unit switch). */
function promoLineSubtotal(line) {
  const qty = Number(line.qty_sale ?? line.quantity ?? line.qty_base ?? 1);
  const up = Number(line.unit_price ?? 0);
  return qty * up;
}

/** Cable: stock in kg, sell by meter (pcs), 1 m ≈ 0.046 kg, 2400 UZS/m */
const cableCorrect = {
  id: 'cable-1',
  base_unit: 'kg',
  unit: 'kg',
  current_stock: 100,
  sale_price: 52200,
  product_units: [
    { unit: 'kg', ratio_to_base: 1, sale_price: 52200, is_default: false },
    { unit: 'pcs', ratio_to_base: 0.046, sale_price: 2400, is_default: true },
    { unit: 'pack', ratio_to_base: 1, sale_price: 24000, is_default: false },
  ],
};

const cfg = getSaleUnitConfig(cableCorrect);
assert.equal(cfg.saleUnit, 'pcs');
assert.equal(cfg.ratio_to_base, 0.046);
assert.equal(cfg.sale_price, 2400);

const qtyBaseOneMeter = toBaseQty(1, cfg.ratio_to_base);
assert.equal(qtyBaseOneMeter, 0.046);

const lineTotal = cfg.sale_price * 1;
assert.equal(lineTotal, 2400);

assert.equal(canQuickAddWithoutNumpad(cableCorrect), true);

/** User screenshot setup: kg default with ratio 0.046 while base auto-resolves to pcs */
const cableMisconfigured = {
  id: 'cable-2',
  base_unit: 'pcs',
  unit: 'pcs',
  current_stock: 100,
  product_units: [
    { unit: 'pcs', ratio_to_base: 1, sale_price: 2400, is_default: false },
    { unit: 'kg', ratio_to_base: 0.046, sale_price: 2400, is_default: true },
  ],
};

const misCfg = getSaleUnitConfig(cableMisconfigured);
assert.equal(misCfg.saleUnit, 'kg');
assert.equal(misCfg.ratio_to_base, 0.046);

const misQtyBase = toBaseQty(1, misCfg.ratio_to_base);
assert.equal(misQtyBase, 0.046);

const misLineTotal = misCfg.sale_price * 1;
assert.equal(misLineTotal, 2400);

assert.equal(canQuickAddWithoutNumpad(cableMisconfigured), false);

assert.equal(formatUnitRatioHint('pcs', 0.046, 'kg'), '1 pcs = 0.046 kg');
assert.equal(formatUnitRatioHint('kg', 0.046, 'pcs'), '1 kg = 0.046 pcs');

/** Unit switch preserves stock qty: 1 m (0.046 kg) → kg line shows ~0.046 kg */
const prevQtyBase = toBaseQty(1, 0.046);
const qtyAfterSwitchToKg = prevQtyBase / 1;
assert.equal(qtyAfterSwitchToKg, 0.046);

/** APUNP screenshot: 1.231 m @ 2100 must stay ~2585 after unit controls / promo */
const apunp = {
  id: 'apunp',
  base_unit: 'kg',
  unit: 'm',
  sale_price: 2100,
  product_units: [
    { unit: 'kg', ratio_to_base: 1, sale_price: 32812, is_default: false },
    { unit: 'm', ratio_to_base: 0.064, sale_price: 2100, is_default: true },
  ],
};

const metrAlias = getSaleUnitConfig(apunp, 'Metr');
assert.equal(metrAlias.saleUnit, 'm');
assert.equal(metrAlias.ratio_to_base, 0.064);
assert.equal(metrAlias.sale_price, 2100);
assert.equal(getBaseUnit(apunp), 'kg');

const qtySale = 1.231;
const ratioM = metrAlias.ratio_to_base;
const qtyBaseM = toBaseQty(qtySale, ratioM);
assert.equal(qtyBaseM, Number((1.231 * 0.064).toFixed(6)));

const retailTotal = metrAlias.sale_price * qtySale;
assert.ok(Math.abs(retailTotal - 2585.1) < 0.01, `expected ~2585, got ${retailTotal}`);

/** Unit switch m → kg → m keeps money + syncs quantity with qty_sale */
const toKg = recalcCartLineForSaleUnitChange({
  prevQtySale: qtySale,
  prevQtyBase: qtyBaseM,
  prevRatioToBase: ratioM,
  nextSaleUnit: 'kg',
  nextRatioToBase: 1,
  nextUnitPrice: 32812,
});
assert.equal(toKg.quantity, toKg.qty_sale);
// kg is fractional to 3dp — clamped from ~0.0788 → 0.079
assert.ok(Math.abs(toKg.qty_sale - 0.079) < 1e-9, `got kg qty ${toKg.qty_sale}`);
assert.ok(Math.abs(toKg.subtotal - 32812 * 0.079) < 1);

const backToM = recalcCartLineForSaleUnitChange({
  prevQtySale: toKg.qty_sale,
  prevQtyBase: toKg.qty_base,
  prevRatioToBase: toKg.ratio_to_base,
  nextSaleUnit: 'm',
  nextRatioToBase: 0.064,
  nextUnitPrice: 2100,
});
assert.equal(backToM.quantity, backToM.qty_sale);
assert.ok(Math.abs(backToM.unit_price * backToM.qty_sale - backToM.subtotal) < 1e-6);
assert.ok(backToM.subtotal > 2500 && backToM.subtotal < 2700);

/**
 * Regression: stale `quantity` after unit switch used to make promo recompute
 * unit_price * oldQty → wrong total (~134 when price was ratio-scaled).
 */
const staleAfterSwitch = {
  quantity: 1.231, // stale sale-meters
  qty_sale: toKg.qty_sale, // real kg qty ~0.079
  qty_base: toKg.qty_base,
  unit_price: 32812,
};
const wrongOldPromo = Number(staleAfterSwitch.quantity) * staleAfterSwitch.unit_price;
const fixedPromo = promoLineSubtotal(staleAfterSwitch);
assert.ok(wrongOldPromo > 30000, 'stale quantity would overcharge');
assert.ok(Math.abs(fixedPromo - toKg.subtotal) < 1, `promo must use qty_sale, got ${fixedPromo}`);

/** Master tier: master_price is per base; sale unit price = master * ratio */
const masterPerBase = 32812.5;
const masterPerMeter = masterPerBase * 0.064;
assert.ok(Math.abs(masterPerMeter - 2100) < 0.1);
assert.ok(Math.abs(masterPerMeter * qtySale - retailTotal) < 1);

console.log('posUnitRatio.node.test.mjs: ok');
