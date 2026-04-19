import type { CartTotals } from '@/types/cart';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';

/**
 * Calculate VAT amount from subtotal
 */
export const calculateVAT = (subtotal: number, vatRate: number): number => {
  return (subtotal * vatRate) / 100;
};

/**
 * Format currency for display (UZS)
 * 
 * @deprecated Use formatMoneyUZS from '@/lib/format' instead
 * This function is kept for backward compatibility but will be removed in future versions.
 */
export const formatCurrency = (
  amount: number,
  _currency: string = 'UZS'
): string => {
  return formatMoneyUZS(amount);
};

/**
 * Format currency without symbol (for calculations)
 */
export const formatNumber = (amount: number): string => {
  // Project standard: dot thousand separators, no decimals
  return formatNumberUZ(amount);
};

/**
 * Parse currency string to number
 */
export const parseCurrency = (value: string): number => {
  // Accept both "1,000" and "1.000" thousand separators
  // UZS is whole-number currency, so we treat separators as thousands and drop decimals if any.
  const cleaned = value
    .replace(/\s/g, '')
    .replace(/so'm/gi, '')
    .replace(/,/g, '')
    .replace(/\./g, '') // treat dot as thousands separator
    .replace(/[^\d-]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Validate payment amounts match total
 */
export const validatePaymentAmounts = (
  payments: Array<{ amount: number }>,
  creditAmount: number,
  totalDue: number,
  tolerance: number = 0.01
): { valid: boolean; error?: string } => {
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0) + creditAmount;
  const difference = Math.abs(totalPaid - totalDue);

  if (difference > tolerance) {
    return {
      valid: false,
      error: `Payment mismatch: Paid ${formatMoneyUZS(totalPaid)}, Required ${formatMoneyUZS(totalDue)}`,
    };
  }

  return { valid: true };
};







