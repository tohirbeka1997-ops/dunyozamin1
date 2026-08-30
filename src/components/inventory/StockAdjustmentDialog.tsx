import { useEffect, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { createStockAdjustment, getSettingsByCategory } from '@/db/api';
import type { Product } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import { formatUnit } from '@/utils/formatters';
import {
  clampQuantityForUnit,
  formatQuantity,
  getQuantityMin,
  getQuantityStep,
  isFractionalUnit,
  normalizeQuantityInput,
} from '@/utils/quantity';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import {
  assertStockAdjustmentQty,
  DEFAULT_MAX_STOCK_ADJUSTMENT,
} from '@/lib/posHardening';
import { useAuth } from '@/contexts/AuthContext';

interface StockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess?: () => void;
}

const ADJUSTMENT_CATEGORIES = [
  { value: 'surplus', direction: 'increase' as const },
  { value: 'shortage', direction: 'decrease' as const },
  { value: 'damage', direction: 'decrease' as const },
  { value: 'expiry', direction: 'decrease' as const },
  { value: 'recount', direction: 'increase' as const },
  { value: 'system_error', direction: 'increase' as const },
  { value: 'other', direction: 'increase' as const },
];

export default function StockAdjustmentDialog({
  open,
  onOpenChange,
  product,
  onSuccess,
}: StockAdjustmentDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { profile, user } = useAuth();

  const [category, setCategory] = useState('recount');
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [maxAdjustmentQty, setMaxAdjustmentQty] = useState(DEFAULT_MAX_STOCK_ADJUSTMENT);
  const [approvalRequired, setApprovalRequired] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const inv = await getSettingsByCategory('inventory');
        if (cancelled || !inv) return;
        const max = Number((inv as any).max_adjustment_qty);
        if (Number.isFinite(max) && max > 0) setMaxAdjustmentQty(max);
        setApprovalRequired(!!(inv as any).adjustment_approval_required);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Get current stock from product data (single source of truth from IPC)
  const currentStock =
    product.current_stock ??
    (product as any).stock_available ??
    (product as any).available_stock ??
    product.stock_quantity ??
    0;
  const unit = product.unit;
  const quantityMin = getQuantityMin(unit);
  const quantityStep = getQuantityStep(unit);
  const qtyPreview = Number(normalizeQuantityInput(quantity));
  const hasQtyPreview = quantity !== '' && Number.isFinite(qtyPreview) && qtyPreview > 0;
  const deltaPreview = hasQtyPreview
    ? adjustmentType === 'increase'
      ? qtyPreview
      : -qtyPreview
    : null;
  const newStockPreview = deltaPreview != null ? currentStock + deltaPreview : null;

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    const meta = ADJUSTMENT_CATEGORIES.find((c) => c.value === value);
    if (meta) setAdjustmentType(meta.direction);
  };

  const canSave =
    !isSubmitting &&
    reason.trim().length > 0 &&
    hasQtyPreview &&
    !(adjustmentType === 'decrease' && newStockPreview != null && newStockPreview < 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalized = normalizeQuantityInput(quantity);
    const qtyRaw = Number(normalized);
    if (!quantity || isNaN(qtyRaw) || qtyRaw <= 0) {
      toast({
        title: 'Xatolik',
        description: "Miqdor musbat son bo'lishi kerak",
        variant: 'destructive',
      });
      return;
    }

    if (!reason.trim()) {
      toast({
        title: 'Xatolik',
        description: 'Sabab majburiy',
        variant: 'destructive',
      });
      return;
    }

    const qty = clampQuantityForUnit(qtyRaw, unit);
    if (qty !== qtyRaw) {
      toast({
        title: 'Miqdor tuzatildi',
        description: `Miqdor ${formatQuantity(qty, unit)} ga o'rnatildi`,
      });
    }

    const limitCheck = assertStockAdjustmentQty(qty, {
      maxQty: maxAdjustmentQty,
      approvalRequired,
      userRole: user?.role || profile?.role || null,
    });
    if (!limitCheck.ok) {
      toast({
        title: 'Xatolik',
        description: limitCheck.error,
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

    try {
      setIsSubmitting(true);

      await createStockAdjustment({
        product_id: product.id,
        quantity: movementQuantity,
        reason: reason.trim(),
        adjustment_type: category,
        user_role: user?.role || profile?.role || null,
      });

      invalidateDashboardQueries(queryClient);

      toast({
        title: 'Muvaffaqiyatli',
        description: `Qoldiq ${adjustmentType === 'increase' ? 'oshirildi' : 'kamaytirildi'} ${qty} ${formatUnit(product.unit)} ga`,
      });

      setQuantity('');
      setReason('');
      setCategory('recount');
      setAdjustmentType('increase');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Stock adjustment error:', error);
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Xatolik',
        description: `Qoldiqni to'g'rilab bo'lmadi. ${msg ? `(${msg})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Qoldiqni to'g'rilash - {product.name}</DialogTitle>
          <DialogDescription>
            Joriy qoldiq:{' '}
            <strong>
              {currentStock} {formatUnit(product.unit)}
            </strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="adjustment-category">
                {t('inventory.adjustment_category', { defaultValue: "To'g'rilash turi" })}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger id="adjustment-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {t(`inventory.adjustment_type_${c.value}`, { defaultValue: c.value })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjustment-type">
                {t('inventory.adjustment_direction', { defaultValue: "Yo'nalish" })}{' '}
                <span className="text-destructive">*</span>
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
                step={quantityStep.toString()}
                min={quantityMin.toString()}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Miqdorni kiriting"
                autoFocus
                inputMode={isFractionalUnit(unit) ? 'decimal' : 'numeric'}
              />
              {hasQtyPreview && newStockPreview != null && (
                <p className="text-sm text-muted-foreground">
                  Eski: {currentStock} → o‘zgarish: {deltaPreview! > 0 ? '+' : ''}
                  {deltaPreview} → yangi: {newStockPreview} {formatUnit(product.unit)}
                </p>
              )}
              {adjustmentType === 'decrease' &&
                hasQtyPreview &&
                newStockPreview != null &&
                newStockPreview < 0 && (
                  <p className="text-sm text-destructive">
                    Natija manfiy bo‘ladi — saqlash bloklangan
                  </p>
                )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">
                Sabab <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="To'g'rilash sababini kiriting..."
                rows={3}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Bekor qilish
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSubmitting ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
