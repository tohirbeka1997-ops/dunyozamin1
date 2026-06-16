import { formatMoney, type AppCurrency } from '@/lib/currency';
import type { ReactNode } from 'react';

/**
 * Reusable Money component for displaying UZS currency
 * 
 * Uses the unified formatMoneyUZS formatter for consistent display
 * across the entire application.
 * 
 * @example
 * <Money value={1000} />
 * // Renders: "1.000 so'm"
 * 
 * @example
 * <Money value={1234.56} />
 * // Renders: "1.234,56 so'm"
 */
interface MoneyProps {
  /** The monetary value to display */
  value: number | string | null | undefined;
  /** Display currency (default UZS) */
  currency?: AppCurrency;
  /** Optional className for styling */
  className?: string;
  /** Optional children to render instead of the formatted value */
  children?: ReactNode;
}

export function Money({ value, className, children, currency = 'UZS' }: MoneyProps) {
  if (children !== undefined) {
    return <span className={className}>{children}</span>;
  }

  return <span className={className}>{formatMoney(value, currency)}</span>;
}


