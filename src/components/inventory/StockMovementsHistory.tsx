import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useInventoryStore } from '@/store/inventoryStore';
import { formatUnit } from '@/utils/formatters';
import { formatDateTime } from '@/lib/datetime';

interface StockMovementsHistoryProps {
  productId: string;
}

export default function StockMovementsHistory({ productId }: StockMovementsHistoryProps) {
  const { getMovementsByProductId } = useInventoryStore();
  const [movements, setMovements] = useState(getMovementsByProductId(productId));

  useEffect(() => {
    // Refresh movements when store updates
    setMovements(getMovementsByProductId(productId));
  }, [productId, getMovementsByProductId]);

  if (movements.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock Movements History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No stock movements found for this product
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Movements History</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Before</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">After</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell>
                  {movement.created_at
                    ? formatDateTime(movement.created_at)
                    : '-'}
                </TableCell>
                <TableCell>
                  <span className="capitalize">{movement.movement_type || '-'}</span>
                </TableCell>
                <TableCell className="text-right">
                  {movement.before_quantity != null ? movement.before_quantity : '-'}
                </TableCell>
                <TableCell className={`text-right ${(movement.quantity || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(movement.quantity || 0) >= 0 ? '+' : ''}{movement.quantity || 0}
                </TableCell>
                <TableCell className="text-right">
                  {movement.after_quantity != null ? movement.after_quantity : '-'}
                </TableCell>
                <TableCell>{movement.reason || movement.notes || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}





























