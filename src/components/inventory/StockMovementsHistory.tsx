import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useInventoryStore } from '@/store/inventoryStore';
import type { InventoryMovement } from '@/types/inventory';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StockMovementsHistoryProps {
  productId: string;
}

export default function StockMovementsHistory({ productId }: StockMovementsHistoryProps) {
  const { getMovementsByProductId } = useInventoryStore();
  const movements = getMovementsByProductId(productId);

  const getMovementTypeLabel = (type: InventoryMovement['type']) => {
    const labels: Record<InventoryMovement['type'], string> = {
      initial: 'Initial Stock',
      sale: 'Sale',
      sale_return: 'Sale Return',
      manual_in: 'Manual Increase',
      manual_out: 'Manual Decrease',
    };
    return labels[type] || type;
  };

  const getMovementTypeBadge = (type: InventoryMovement['type']) => {
    const badges: Record<InventoryMovement['type'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
      initial: { variant: 'default', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
      sale: { variant: 'destructive', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
      sale_return: { variant: 'default', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
      manual_in: { variant: 'default', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
      manual_out: { variant: 'destructive', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
    };
    return badges[type] || { variant: 'outline', className: '' };
  };

  if (movements.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No stock movements recorded for this product
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date/Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((movement) => {
            const isPositive = movement.quantity > 0;
            const badge = getMovementTypeBadge(movement.type);

            return (
              <TableRow key={movement.id}>
                <TableCell>
                  {format(new Date(movement.created_at), 'MMM dd, yyyy HH:mm')}
                </TableCell>
                <TableCell>
                  <Badge className={badge.className}>
                    {getMovementTypeLabel(movement.type)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {isPositive ? (
                      <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    <span
                      className={
                        isPositive
                          ? 'font-semibold text-green-600 dark:text-green-400'
                          : 'font-semibold text-red-600 dark:text-red-400'
                      }
                    >
                      {isPositive ? '+' : ''}
                      {movement.quantity}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {movement.reason || '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}









