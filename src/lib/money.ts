/**
 * Uzbekistan currency (UZS) formatting and parsing utilities
 * 
 * Format: 1.000.000 so'm (dot thousand separators, no decimals, Uzbek suffix)
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
