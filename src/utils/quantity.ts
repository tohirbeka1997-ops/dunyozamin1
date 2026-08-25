const FRACTIONAL_UNITS = [
  'kg',
  'кг',
  'g',
  'гр',
  'г',
  'mg',
  'm',
  'м',
  'meter',
  'metre',
  'metr',
  'm2',
  'm3',
  'm²',
  'm³',
  'l',
  'л',
  'lt',
  'liter',
  'litre',
  'litr',
  'ml',
  'мл',
] as const;
const FRACTIONAL_UNIT_SET = new Set<string>(FRACTIONAL_UNITS);
const FRACTIONAL_DECIMALS = 3;
const FRACTIONAL_MIN = 0.001;

const UNIT_ALIASES: Record<string, string> = {
  l: 'l',
  ml: 'ml',
  m: 'm',
  kg: 'kg',
  g: 'g',
  pcs: 'pcs',
  pack: 'pack',
  box: 'box',
  dozen: 'dozen',
};

const normalizeUnit = (unit?: string): string => {
  const trimmed = String(unit || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (UNIT_ALIASES[lower]) return UNIT_ALIASES[lower];
  return lower;
};

const roundTo = (value: number, decimals: number): number => {
  if (!isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const isFractionalUnit = (unit?: string): boolean => {
  return FRACTIONAL_UNIT_SET.has(normalizeUnit(unit));
};

export const getQuantityMin = (unit?: string): number => {
  return isFractionalUnit(unit) ? FRACTIONAL_MIN : 1;
};

export const getQuantityStep = (unit?: string): number => {
  return isFractionalUnit(unit) ? FRACTIONAL_MIN : 1;
};

export const getMaxQuantityForUnit = (maxStock: number, unit?: string): number => {
  if (!isFinite(maxStock) || maxStock <= 0) return maxStock;
  if (isFractionalUnit(unit)) {
    return roundTo(maxStock, FRACTIONAL_DECIMALS);
  }
  return Math.floor(maxStock);
};

export const clampQuantityForUnit = (value: number, unit?: string): number => {
  if (!isFinite(value)) return getQuantityMin(unit);
  if (isFractionalUnit(unit)) {
    const rounded = roundTo(value, FRACTIONAL_DECIMALS);
    return rounded < FRACTIONAL_MIN ? FRACTIONAL_MIN : rounded;
  }
  const rounded = Math.round(value);
  return rounded < 1 ? 1 : rounded;
};

/** Positive → same as clampQuantityForUnit; negative → symmetric (return / exchange lines). */
export const clampSignedQuantityForUnit = (value: number, unit?: string): number => {
  if (!isFinite(value)) return getQuantityMin(unit);
  if (value === 0) return 0;
  if (value > 0) return clampQuantityForUnit(value, unit);
  const absClamped = clampQuantityForUnit(Math.abs(value), unit);
  return -absClamped;
};

export const formatQuantity = (value: number, unit?: string): string => {
  if (!isFinite(value)) return '0';
  if (isFractionalUnit(unit)) {
    return roundTo(value, FRACTIONAL_DECIMALS).toFixed(FRACTIONAL_DECIMALS);
  }
  return String(Math.round(value));
};

export const normalizeQuantityInput = (value: string): string => {
  return value.replace(',', '.');
};

export const isValidDecimalInput = (value: string, decimalPlaces: number = FRACTIONAL_DECIMALS): boolean => {
  if (value === '') return true;
  const normalized = normalizeQuantityInput(value);
  const match = normalized.match(/^\d*(?:\.(\d*))?$/);
  if (!match) return false;
  const decimals = match[1]?.length ?? 0;
  return decimals <= decimalPlaces;
};

export const parseDecimalInput = (value: string): number | null => {
  const normalized = normalizeQuantityInput(String(value || '').trim());
  if (normalized === '' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isValidQuantityInput = (value: string, unit?: string): boolean => {
  if (value === '') return true;
  const normalized = normalizeQuantityInput(value);
  if (isFractionalUnit(unit)) {
    return isValidDecimalInput(normalized, FRACTIONAL_DECIMALS);
  }
  return /^\d*$/.test(normalized);
};
