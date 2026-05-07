/**
 * Uzbekistan currency (UZS) formatting and parsing utilities.
 *
 * Format: 1.000.000 so'm (dot thousand separators, no decimals, Uzbek suffix)
 *
 * MONEY MODEL (read this before adding new monetary code):
 * - UZS has NO sub-unit. Every monetary value in this app must end up as
 *   a whole-UZS integer at the storage and display boundary.
 * - Older schemas (orders, products, sales_returns, ...) use SQLite
 *   `REAL` for amount columns, while newer marketplace tables
 *   (`web_orders`, `web_order_items`) use `INTEGER`. Both conventions are
 *   acceptable as long as writers route through `roundUZS()` /
 *   `applyPercentUZS()` first; never insert a fractional UZS into either
 *   column type.
 * - Incoming JSON from the marketplace API (INTEGER columns) and from the
 *   POS IPC layer (REAL columns) is reconciled by callers using the
 *   helpers below — don't open-code `(amount * pct) / 100` anywhere.
 */

/**
 * Formats a number as UZS currency with dot separators and " so'm" suffix
 * No decimals - UZS is always whole numbers
 * 
 * @param amount - The value to format (number, null, or undefined)
 * @returns Formatted string with " so'm" suffix
 * 
 * Examples:
 * 0 -> "0 so'm"
 * 1000 -> "1.000 so'm"
 * 1000000 -> "1.000.000 so'm"
 * null/undefined/NaN -> "0 so'm"
 */
export function formatMoneyUZS(
  amount: number | null | undefined
): string {
  // Handle null, undefined, or invalid values
  if (amount === null || amount === undefined) {
    return '0 so\'m';
  }

  // Handle NaN
  if (isNaN(amount) || !isFinite(amount)) {
    return '0 so\'m';
  }

  // Round to nearest integer (UZS has no decimals)
  const roundedAmount = Math.round(amount);

  // Format integer part with dot separators
  const integerStr = Math.abs(roundedAmount).toString();
  const formattedInteger = integerStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Add sign for negative numbers
  const sign = roundedAmount < 0 ? '-' : '';
  const formatted = sign + formattedInteger;

  // Always append " so'm"
  return `${formatted} so'm`;
}

/**
 * Alias for formatMoneyUZS - formats with " so'm" suffix
 */
export function formatUZS(amount: number | null | undefined): string {
  return formatMoneyUZS(amount);
}

/**
 * Formats a number with dot separators (no currency suffix)
 * Used for display in tight spaces or when suffix is shown separately
 * 
 * @param amount - The value to format (number, null, or undefined)
 * @returns Formatted string with dots only (e.g. "1.000.000")
 * 
 * Examples:
 * 0 -> "0"
 * 1000 -> "1.000"
 * 1000000 -> "1.000.000"
 * null/undefined/NaN -> "0"
 */
export function formatNumberDots(
  amount: number | null | undefined
): string {
  // Handle null, undefined, or invalid values
  if (amount === null || amount === undefined) {
    return '0';
  }

  // Handle NaN
  if (isNaN(amount) || !isFinite(amount)) {
    return '0';
  }

  // Round to nearest integer
  const roundedAmount = Math.round(amount);

  // Format integer part with dot separators
  const integerStr = Math.abs(roundedAmount).toString();
  const formattedInteger = integerStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Add sign for negative numbers
  const sign = roundedAmount < 0 ? '-' : '';
  return sign + formattedInteger;
}

/**
 * Formats a number with dot thousand separators and optional decimal part.
 *
 * - Thousands separator: dot (.)
 * - Decimal separator: comma (,)
 * - Trims trailing zeros in fractional part
 *
 * Examples:
 *  1000 -> "1.000"
 *  1000.5 -> "1.000,5"
 *  1000.25 -> "1.000,25"
 */
export function formatNumberDotsWithDecimals(
  amount: number | null | undefined,
  fractionDigits: number = 2
): string {
  if (amount === null || amount === undefined) return '0';
  if (isNaN(amount) || !isFinite(amount)) return '0';

  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const intPart = Math.floor(abs);
  const intFormatted = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Keep a bounded fractional representation, then trim trailing zeros
  const fixed = abs.toFixed(Math.max(0, Math.min(6, fractionDigits)));
  const frac = fixed.split('.')[1] || '';
  const fracTrimmed = frac.replace(/0+$/, '');

  if (!fracTrimmed) return sign + intFormatted;
  return `${sign}${intFormatted},${fracTrimmed}`;
}

/**
 * Parses user input to a number.
 *
 * Supports:
 * - thousands separators '.' (optional)
 * - decimal separator ',' or '.'
 * - ignores spaces and "so'm"
 *
 * Notes:
 * - If both ',' and '.' appear, the last one is treated as decimal separator.
 * - If only '.' appears, it's treated as decimal separator only when the digits after it are <= fractionDigits.
 */
export function parseMoneyFlexible(input: string, fractionDigits: number = 2): number {
  if (!input || typeof input !== 'string') return 0;

  let s = input.trim();
  if (!s) return 0;

  // normalize
  s = s.replace(/\s/g, '').replace(/so'm/gi, '');

  const isNeg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!s) return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);
  const sepChar = sepIndex >= 0 ? s[sepIndex] : null;

  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;

  const treatAsDecimal = (() => {
    if (sepIndex < 0 || !sepChar) return false;
    if (hasComma && hasDot) return true; // last separator wins, treat as decimal
    if (sepChar === ',') return true;
    // Only dot present: treat as decimal only if it "looks like" a decimal part
    const digitsAfter = s.slice(sepIndex + 1).replace(/[^\d]/g, '').length;
    return digitsAfter > 0 && digitsAfter <= Math.max(0, fractionDigits);
  })();

  let num = 0;

  if (treatAsDecimal && sepIndex >= 0) {
    const left = s.slice(0, sepIndex);
    const right = s.slice(sepIndex + 1);
    const intPart = left.replace(/[^\d]/g, '');
    const fracPart = right.replace(/[^\d]/g, '').slice(0, Math.max(0, fractionDigits));
    const composed = `${intPart || '0'}.${fracPart || '0'}`;
    num = parseFloat(composed);
  } else {
    // Integer mode: remove all non-digits (including dots/commas)
    const digits = s.replace(/[^\d]/g, '');
    num = digits ? parseInt(digits, 10) : 0;
  }

  if (isNaN(num) || !isFinite(num)) return 0;
  return isNeg ? -num : num;
}

/**
 * Parses a formatted UZS string back to a number
 * Removes dots, spaces, "so'm" suffix, and any non-digit characters
 * 
 * @param input - The formatted string (e.g. "1.000.000 so'm")
 * @returns Parsed number (e.g. 1000000)
 * 
 * Examples:
 * "1.000.000 so'm" -> 1000000
 * "1.000" -> 1000
 * "500 so'm" -> 500
 * "" -> 0
 */
export function parseMoneyUZS(input: string): number {
  if (!input || typeof input !== 'string') {
    return 0;
  }

  // Remove all non-digit characters except minus sign
  const cleaned = input
    .replace(/\./g, '') // Remove dots
    .replace(/\s/g, '') // Remove spaces
    .replace(/so'm/gi, '') // Remove "so'm" suffix (case insensitive)
    .replace(/[^\d-]/g, ''); // Remove everything except digits and minus

  // Handle empty string
  if (!cleaned || cleaned === '-') {
    return 0;
  }

  // Parse to number
  const parsed = parseInt(cleaned, 10);

  // Return 0 if parsing failed
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Alias for parseMoneyUZS - parses UZS formatted string to number
 */
export function parseUZS(input: string): number {
  return parseMoneyUZS(input);
}

/**
 * Round to nearest whole UZS — UZS has no sub-unit. Use this for any
 * computed monetary value before persisting, displaying, or comparing
 * against another monetary value, so floating-point arithmetic
 * (`(subtotal * pct) / 100`, line-prorate, batch-cost) doesn't leak
 * fractional sums into receipts or order totals.
 *
 * Returns 0 for null/undefined/NaN/Infinity to keep call sites safe.
 */
export function roundUZS(amount: number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

/**
 * Apply a percent discount/markup to a UZS amount and round to whole UZS.
 *
 * `applyPercent(1234, 7.5)` -> 92  (1234 * 0.075 = 92.55 -> rounded)
 *
 * Negative or non-finite inputs return 0. Percent is clamped to [0, 100]
 * because POS callers always want a valid discount fraction; if you need
 * markups > 100 % use `roundUZS(amount * pct / 100)` directly.
 */
export function applyPercentUZS(
  amount: number | null | undefined,
  percent: number | null | undefined,
): number {
  const a = Number(amount);
  const p = Number(percent);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return 0;
  if (a <= 0) return 0;
  const pct = Math.max(0, Math.min(100, p));
  return Math.round((a * pct) / 100);
}

/**
 * Sum an array of UZS amounts with rounding at each step. Useful for
 * receipt totals where every line was already rounded — summing rounded
 * lines is exact, but summing then rounding can drift by 1-2 UZS.
 */
export function sumUZS(values: ReadonlyArray<number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += roundUZS(v);
  return total;
}
