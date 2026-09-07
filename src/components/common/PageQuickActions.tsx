import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type PageQuickAction = {
  id: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  disabled?: boolean;
  badge?: number | string;
  title?: string;
};

type PageQuickActionsProps = {
  actions: PageQuickAction[];
  'aria-label'?: string;
  className?: string;
  /** Compact inline toolbar (h-8, no bordered strip) for page headers. */
  compact?: boolean;
};

/**
 * Shared quick-action strip under page titles (not the POS right rail).
 */
export default function PageQuickActions({
  actions,
  'aria-label': ariaLabel = 'Tezkor amallar',
  className,
  compact = false,
}: PageQuickActionsProps) {
  if (!actions.length) return null;

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        !compact && 'rounded-md border bg-muted/30 p-2 gap-2',
        className,
      )}
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant={action.variant ?? 'outline'}
          size="sm"
          disabled={action.disabled}
          title={action.title ?? action.label}
          aria-label={action.label}
          onClick={action.onClick}
          className={cn(
            'relative gap-1.5 text-xs',
            compact ? 'h-8 px-2.5' : 'h-11 gap-2 px-3 sm:text-sm',
          )}
        >
          <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{action.icon}</span>
          <span className="max-w-[9rem] truncate sm:max-w-none">{action.label}</span>
          {action.badge != null && action.badge !== '' && (
            <Badge
              variant="secondary"
              className="ml-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full p-0 px-1 text-[10px]"
            >
              {action.badge}
            </Badge>
          )}
        </Button>
      ))}
    </div>
  );
}
