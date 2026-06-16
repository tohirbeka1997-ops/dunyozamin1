import { formatMoney, type AppCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';

type DualCurrencyAmountProps = {
  uzs?: number | null;
  usd?: number | null;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
};

/** Shows UZS and/or USD lines when both buckets have non-zero totals. */
export function DualCurrencyAmount({
  uzs = 0,
  usd = 0,
  className,
  primaryClassName,
  secondaryClassName,
}: DualCurrencyAmountProps) {
  const uzsVal = Number(uzs || 0) || 0;
  const usdVal = Number(usd || 0) || 0;
  const hasUzs = Math.abs(uzsVal) > 0.0001;
  const hasUsd = Math.abs(usdVal) > 0.0001;

  if (hasUzs && hasUsd) {
    return (
      <div className={cn('flex flex-col items-end gap-0.5', className)}>
        <span className={primaryClassName}>{formatMoney(uzsVal, 'UZS')}</span>
        <span className={cn('text-xs text-muted-foreground', secondaryClassName)}>
          {formatMoney(usdVal, 'USD')}
        </span>
      </div>
    );
  }

  const single = hasUsd ? usdVal : uzsVal;
  const cur: AppCurrency = hasUsd ? 'USD' : 'UZS';
  return <span className={className}>{formatMoney(single, cur)}</span>;
}
