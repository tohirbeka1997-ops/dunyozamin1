import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Crown } from 'lucide-react';
import { formatCustomerBalance } from '@/lib/format';
import { getCustomerBalances } from '@/lib/currency';
import type { Customer } from '@/types/database';

interface CustomerInfoBadgeProps {
  customer: Customer;
}

export default function CustomerInfoBadge({ customer }: CustomerInfoBadgeProps) {
  const isVIP = customer.total_sales > 10000000;
  const balances = getCustomerBalances(customer);
  const uzsInfo = formatCustomerBalance(balances.uzs, 'UZS');
  const usdInfo = formatCustomerBalance(balances.usd, 'USD');

  const getBadgeInfo = () => {
    if (isVIP) {
      return {
        label: 'VIP',
        variant: 'default' as const,
        icon: <Crown className="h-3 w-3" />,
      };
    }
    return null;
  };

  const badgeInfo = getBadgeInfo();
  const tierCode = (customer as any)?.pricing_tier;

  return (
    <div className="flex items-center gap-2">
      {tierCode && (
        <Badge variant="secondary" className="gap-1">
          Tier: {String(tierCode)}
        </Badge>
      )}
      {String(tierCode) === 'master' && (
        <Badge variant="outline" className="gap-1">
          Bonus: {Number(customer.bonus_points ?? 0)} ball
        </Badge>
      )}
      {uzsInfo.type !== 'zero' && (
        <Badge
          variant={uzsInfo.variant}
          className={`gap-1 ${uzsInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}`}
        >
          {uzsInfo.label}
        </Badge>
      )}
      {Math.abs(balances.usd) > 0.0001 && (
        <Badge
          variant={usdInfo.variant}
          className={`gap-1 ${usdInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}`}
        >
          {usdInfo.label}
        </Badge>
      )}
      {badgeInfo && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={badgeInfo.variant} className="gap-1 cursor-help">
                {badgeInfo.icon}
                {badgeInfo.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{customer.name}</p>
                {customer.phone && (
                  <p className="text-muted-foreground">Phone: {customer.phone}</p>
                )}
                {customer.email && (
                  <p className="text-muted-foreground">Email: {customer.email}</p>
                )}
                <div className="pt-2 space-y-1 border-t">
                  <p>Total Orders: {customer.total_orders}</p>
                  <p>Total Sales: {customer.total_sales.toFixed(2)} UZS</p>
                  {String(tierCode) === 'master' && (
                    <p>Bonus ball: {Number(customer.bonus_points ?? 0)}</p>
                  )}
                </div>
                {customer.notes && (
                  <p className="pt-2 text-xs text-muted-foreground border-t">
                    {customer.notes}
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
