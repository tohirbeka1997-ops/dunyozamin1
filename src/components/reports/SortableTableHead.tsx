import type { ReactNode } from 'react';
import { TableHead } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortValueKind } from '@/hooks/useTableSort';

type Props<K extends string> = {
  columnKey: K;
  sortKey: K;
  sortOrder: 'asc' | 'desc';
  onSort: (key: K, kind: SortValueKind) => void;
  kind: SortValueKind;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
};

export function SortableTableHead<K extends string>({
  columnKey,
  sortKey,
  sortOrder,
  onSort,
  kind,
  children,
  align = 'left',
  className,
}: Props<K>) {
  const active = sortKey === columnKey;
  return (
    <TableHead
      className={cn(
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'h-8 gap-1 px-2',
          align === 'right' && 'flex w-full flex-row-reverse justify-end',
          align === 'center' && 'mx-auto flex',
          align === 'left' && '-ml-2 inline-flex'
        )}
        onClick={() => onSort(columnKey, kind)}
      >
        <span className="whitespace-normal text-left font-medium leading-tight">{children}</span>
        {active ? (
          sortOrder === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-35" aria-hidden />
        )}
      </Button>
    </TableHead>
  );
}
