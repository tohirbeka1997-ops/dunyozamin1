import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInventoryStore } from '@/store/inventoryStore';
import type { Product } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import { formatUnit } from '@/utils/formatters';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';

interface StockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess?: () => void;
}

export default function StockAdjustmentDialog({
  open,
  onOpenChange,
  product,
  onSuccess,
}: StockAdjustmentDialogProps) {
  const { toast } = useToast();
  const { addMovement, getCurrentStockByProductId } = useInventoryStore();
  const queryClient = useQueryClient();
  
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  const currentStock = getCurrentStockByProductId(product.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const qty = Number(quantity);
    if (!quantity || isNaN(qty) || qty <= 0) {
      toast({
        title: 'Xatolik',
        description: 'Miqdor musbat son bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    if (adjustmentType === 'decrease') {
      const newStock = currentStock - qty;
      if (newStock < 0) {
        toast({
          title: 'Xatolik',
          description: `Qoldiqni 0 dan pastga tushirib bo'lmaydi. Joriy qoldiq: ${currentStock}`,
          variant: 'destructive',
        });
        return;
      }
    }

    const movementQuantity = adjustmentType === 'increase' ? qty : -qty;
    const movementType = adjustmentType === 'increase' ? 'manual_in' : 'manual_out';

    addMovement({
      product_id: product.id,
      quantity: movementQuantity,
      type: movementType,
      reason: reason || `Manual ${adjustmentType === 'increase' ? 'increase' : 'decrease'}`,
    });

    // Invalidate dashboard queries (affects low stock count)
    invalidateDashboardQueries(queryClient);

    toast({
      title: 'Muvaffaqiyatli',
      description: `Qoldiq ${adjustmentType === 'increase' ? 'oshirildi' : 'kamaytirildi'} ${qty} ${formatUnit(product.unit)} ga`,
    });

    // Reset form
    setQuantity('');
    setReason('');
    setAdjustmentType('increase');
    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Qoldiqni to'g'rilash - {product.name}</DialogTitle>
          <DialogDescription>
            Joriy qoldiq: <strong>{currentStock} {formatUnit(product.unit)}</strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="adjustment-type">
                To'g'rilash turi <span className="text-destructive">*</span>
              </Label>
              <Select
                value={adjustmentType}
                onValueChange={(value: 'increase' | 'decrease') => setAdjustmentType(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="increase">Qoldiqni oshirish</SelectItem>
                  <SelectItem value="decrease">Qoldiqni kamaytirish</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">
                Miqdor ({formatUnit(product.unit)}) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quantity"
                type="number"
                step="0.01"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Miqdorni kiriting"
                autoFocus
              />
              {adjustmentType === 'decrease' && quantity && Number(quantity) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Yangi qoldiq: {currentStock - Number(quantity)} {formatUnit(product.unit)}
                </p>
              )}
              {adjustmentType === 'increase' && quantity && Number(quantity) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Yangi qoldiq: {currentStock + Number(quantity)} {formatUnit(product.unit)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Sabab (Ixtiyoriy)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="To'g'rilash sababini kiriting..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Bekor qilish
            </Button>
            <Button type="submit">Saqlash</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}



