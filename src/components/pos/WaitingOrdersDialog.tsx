import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { HeldOrder } from '@/types/database';
import { Clock, User, FileText, RotateCcw, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface WaitingOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldOrders: HeldOrder[];
  onRestore: (order: HeldOrder) => void;
  onCancel: (orderId: string) => void;
}

export default function WaitingOrdersDialog({
  open,
  onOpenChange,
  heldOrders,
  onRestore,
  onCancel,
}: WaitingOrdersDialogProps) {
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  const calculateTotal = (order: HeldOrder) => {
    const itemsTotal = order.items.reduce((sum, item) => sum + item.total, 0);
    
    if (!order.discount) return itemsTotal;
    
    if (order.discount.type === 'amount') {
      return itemsTotal - order.discount.value;
    }
    
    return itemsTotal - (itemsTotal * order.discount.value) / 100;
  };

  const handleCancelConfirm = () => {
    if (cancelOrderId) {
      onCancel(cancelOrderId);
      setCancelOrderId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Waiting Orders</DialogTitle>
            <DialogDescription>
              {heldOrders.length === 0
                ? 'No orders on hold'
                : `${heldOrders.length} order${heldOrders.length > 1 ? 's' : ''} waiting`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] pr-4">
            {heldOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No orders on hold</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Held orders will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {heldOrders.map((order) => (
                  <div
                    key={order.id}
                    className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{order.held_number}</Badge>
                          {order.customer_name && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <User className="h-3 w-3" />
                              <span>{order.customer_name}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>
                            {formatDistanceToNow(new Date(order.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">
                          {calculateTotal(order).toFixed(2)} UZS
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.items.length} item{order.items.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {order.note && (
                      <div className="flex items-start gap-2 text-sm bg-muted/50 p-2 rounded">
                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <p className="text-muted-foreground">{order.note}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={() => onRestore(order)}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCancelOrderId(order.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelOrderId} onOpenChange={(open) => !open && setCancelOrderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Waiting Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this waiting order. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
