import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HeldOrder } from '@/types/database';
import { Clock, User, FileText, RotateCcw, Trash2, Edit2, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { uz } from 'date-fns/locale';
import { formatMoneyUZS } from '@/lib/format';

interface WaitingOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldOrders: HeldOrder[];
  onRestore: (order: HeldOrder) => void;
  onCancel: (orderId: string) => void;
  onRename?: (orderId: string, newName: string) => void;
}

export default function WaitingOrdersDialog({
  open,
  onOpenChange,
  heldOrders,
  onRestore,
  onCancel,
  onRename,
}: WaitingOrdersDialogProps) {
  const { t } = useTranslation();
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [renameOrderId, setRenameOrderId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  const calculateTotal = (order: HeldOrder) => {
    const itemsTotal = order.items.reduce((sum, item) => sum + item.total, 0);
    
    if (!order.discount) return itemsTotal;
    
    if (order.discount.type === 'amount') {
      return itemsTotal - order.discount.value;
    }
    
    return itemsTotal - (itemsTotal * order.discount.value) / 100;
  };

  const getOrderPriority = (order: HeldOrder) => {
    const minutesAgo = differenceInMinutes(new Date(), new Date(order.created_at));
    if (minutesAgo >= 30) return 'critical';
    if (minutesAgo >= 15) return 'warning';
    return 'normal';
  };

  const getPriorityStyles = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'border-red-500 bg-red-50 dark:bg-red-950/20';
      case 'warning':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20';
      default:
        return '';
    }
  };

  const handleCancelConfirm = () => {
    if (cancelOrderId) {
      onCancel(cancelOrderId);
      setCancelOrderId(null);
    }
  };

  const handleRenameConfirm = () => {
    if (renameOrderId && renameName.trim() && onRename) {
      onRename(renameOrderId, renameName.trim());
      setRenameOrderId(null);
      setRenameName('');
    }
  };

  const openRenameDialog = (order: HeldOrder) => {
    setRenameOrderId(order.id);
    setRenameName(order.customer_name || '');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t('pos.waitingOrders.title')}</DialogTitle>
            <DialogDescription>
              {heldOrders.length === 0
                ? t('pos.waitingOrders.empty')
                : t('pos.waitingOrders.counter', { count: heldOrders.length })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] pr-4">
            {heldOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('pos.waitingOrders.empty')}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('pos.waitingOrders.emptyDescription')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {heldOrders.map((order) => {
                  const priority = getOrderPriority(order);
                  const priorityStyles = getPriorityStyles(priority);
                  
                  return (
                    <div
                      key={order.id}
                      className={`border-2 rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors ${priorityStyles}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{order.held_number}</Badge>
                            {priority !== 'normal' && (
                              <Badge variant={priority === 'critical' ? 'destructive' : 'default'} className="gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {priority === 'critical' ? '30+ min' : '15+ min'}
                              </Badge>
                            )}
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
                                locale: uz,
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold">
                            {formatMoneyUZS(calculateTotal(order))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('pos.waitingOrders.items', { count: order.items.length })}
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
                          title={t('pos.waitingOrders.restore')}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          {t('pos.waitingOrders.restore')}
                        </Button>
                        {onRename && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRenameDialog(order)}
                            title={t('pos.waitingOrders.edit')}
                            aria-label={t('pos.waitingOrders.edit')}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCancelOrderId(order.id)}
                          title={t('pos.waitingOrders.delete')}
                          aria-label={t('pos.waitingOrders.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelOrderId} onOpenChange={(open) => !open && setCancelOrderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pos.waitingOrders.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('pos.waitingOrders.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('pos.waitingOrders.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelConfirm}>
              {t('pos.waitingOrders.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!renameOrderId} onOpenChange={(open) => !open && setRenameOrderId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pos.waitingOrders.renameTitle')}</DialogTitle>
            <DialogDescription>
              {t('pos.waitingOrders.renameDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-input">{t('pos.waitingOrders.customerName')}</Label>
              <Input
                id="rename-input"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder={t('pos.waitingOrders.customerNamePlaceholder')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRenameConfirm();
                  }
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameOrderId(null)}>
              {t('pos.waitingOrders.cancel')}
            </Button>
            <Button onClick={handleRenameConfirm} disabled={!renameName.trim()}>
              {t('pos.waitingOrders.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
