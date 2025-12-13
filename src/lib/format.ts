/**
 * Global UZS format: 1.234.567 so'm (dot separators)
 * 
 * Standardized number/currency formatting for the entire POS system.
 * 
 * Format rules:
 * - Thousands separator: dot (.)
 * - Currency suffix: " so'm"
 * - No decimals (UZS is always whole numbers)
 * 
 * Examples:
 * 60000 -> 60.000 so'm
 * 1000000 -> 1.000.000 so'm
 * 
 * For quantities (counts, stock): use formatNumberUZ (no currency suffix)
 * 10000 -> 10.000
 */

import { formatMoneyUZS as formatMoneyUZSFromMoney } from './money';

/**
 * Formats a number as UZS currency with dot separators and " so'm" suffix
 * UZS has no decimals - always rounds to whole numbers
 * 
 * @param amount - The value to format (number, string, null, or undefined)
 * @returns Formatted string with " so'm" suffix
 * 
 * Rules:
 * - null/undefined/NaN => "0 so'm"
 * - negative values => "-1.000 so'm"
 * - accepts string input like "70000.00" and outputs correctly
 * - always rounds to whole number (no decimals for UZS)
 * 
 * Examples:
 * 0 -> "0 so'm"
 * 1000 -> "1.000 so'm"
 * 1000000 -> "1.000.000 so'm"
 */
export function formatMoneyUZS(
  amount: number | string | null | undefined
): string {
  // Convert string to number if needed
  const numValue = typeof amount === 'string' ? parseFloat(amount) : amount;
  return formatMoneyUZSFromMoney(numValue);
}

/**
 * Formats a number with dot separators (no currency suffix)
 * Used for quantities, counts, stock levels, etc.
 * 
 * @param value - The value to format (number, string, null, or undefined)
 * @returns Formatted string without currency suffix
 * 
 * Examples:
 * 10000 -> "10.000"
 * 1234567 -> "1.234.567"
 * null/undefined/NaN -> "0"
 */
export function formatNumberUZ(
  value: number | string | null | undefined
): string {
  // Handle null, undefined, or invalid values
  if (value === null || value === undefined) {
    return '0';
  }

  // Convert string to number if needed
  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  // Handle NaN
  if (isNaN(numValue) || !isFinite(numValue)) {
    return '0';
  }

  // Round to nearest integer
  const roundedValue = Math.round(numValue);

  // Format integer part with dot separators
  const integerStr = Math.abs(roundedValue).toString();
  const formattedInteger = integerStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Add sign for negative numbers
  const sign = roundedValue < 0 ? '-' : '';
  return sign + formattedInteger;
}
