import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Crown, AlertCircle, Sparkles } from 'lucide-react';
import type { Customer } from '@/types/database';

interface CustomerInfoBadgeProps {
  customer: Customer;
}

export default function CustomerInfoBadge({ customer }: CustomerInfoBadgeProps) {
  const isVIP = customer.total_sales > 10000000;
  const hasDebt = customer.balance < 0;
  const isNew = customer.total_orders <= 3;

  const getBadgeInfo = () => {
    if (hasDebt) {
      return {
        label: 'Debt',
        variant: 'destructive' as const,
        icon: <AlertCircle className="h-3 w-3" />,
      };
    }
    if (isVIP) {
      return {
        label: 'VIP',
        variant: 'default' as const,
        icon: <Crown className="h-3 w-3" />,
      };
    }
    if (isNew) {
      return {
        label: 'New',
        variant: 'secondary' as const,
        icon: <Sparkles className="h-3 w-3" />,
      };
    }
    return null;
  };

  const badgeInfo = getBadgeInfo();
  if (!badgeInfo) return null;

  return (
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
              {hasDebt && (
                <p className="text-destructive font-semibold">
                  Debt: {Math.abs(customer.balance).toFixed(2)} UZS
                </p>
              )}
              {customer.bonus_points > 0 && (
                <p>Bonus Points: {customer.bonus_points}</p>
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
  );
}
