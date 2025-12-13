import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { createSupplierPayment } from '@/db/api';
import type { SupplierWithBalance, PurchaseOrder } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';

type SupplierPaymentMethod = 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';

interface PaySupplierDialogProps {
  supplier: SupplierWithBalance;
  purchaseOrder?: PurchaseOrder | null; // Optional: can pay without linking to PO
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function PaySupplierDialog({
  supplier,
  purchaseOrder,
  open,
  onOpenChange,
  onSuccess,
}: PaySupplierDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<SupplierPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  // Initialize amount when dialog opens
  useEffect(() => {
    if (open) {
      // Calculate default amount (remaining if PO provided, or empty)
      const defaultAmount = purchaseOrder 
        ? (purchaseOrder.remaining_amount ?? purchaseOrder.total_amount - (purchaseOrder.paid_amount ?? 0))
        : 0;
      
      if (amount === undefined && defaultAmount > 0) {
        setAmount(defaultAmount);
      }
    } else {
      // Reset form when dialog closes
      setAmount(undefined);
      setNote('');
      setPaymentMethod('cash');
    }
  }, [open, purchaseOrder]);

  const handleSubmit = async () => {
    // Validation
    if (amount === undefined || amount === null || amount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid payment amount greater than zero.',
        variant: 'destructive',
      });
      return;
    }

    // If PO provided, validate amount doesn't exceed remaining
    if (purchaseOrder) {
      const remaining = purchaseOrder.remaining_amount ?? 
        (purchaseOrder.total_amount - (purchaseOrder.paid_amount ?? 0));
      if (amount > remaining) {
        toast({
          title: 'Amount Exceeds Remaining',
          description: `Payment amount cannot exceed remaining amount of ${formatMoneyUZS(remaining)}.`,
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setLoading(true);
      const result = await createSupplierPayment({
        supplier_id: supplier.id,
        purchase_order_id: purchaseOrder?.id || null,
        amount: amount,
        payment_method: paymentMethod,
        note: note.trim() || null,
        created_by: profile?.id || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create payment');
      }

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);

      toast({
        title: '✅ Payment Recorded',
        description: `Payment of ${formatMoneyUZS(amount)} recorded. New balance: ${formatMoneyUZS(result.new_balance ?? 0)}`,
        className: 'bg-green-50 border-green-200',
      });

      // Reset form
      setAmount(undefined);
      setPaymentMethod('cash');
      setNote('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Payment error:', error);
      toast({
        title: '❌ Payment Failed',
        description: error instanceof Error ? error.message : 'Failed to record payment',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const remainingAmount = purchaseOrder 
    ? (purchaseOrder.remaining_amount ?? purchaseOrder.total_amount - (purchaseOrder.paid_amount ?? 0))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>To'lov qilish</DialogTitle>
          <DialogDescription>
            {purchaseOrder 
              ? `Record payment for ${supplier.name} - PO ${purchaseOrder.po_number}`
              : `Record payment to ${supplier.name}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Yetkazib beruvchi:</span>
              <span className="font-semibold">{supplier.name}</span>
            </div>
            {purchaseOrder && (
              <>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Buyurtma raqami:</span>
                  <span className="font-medium">{purchaseOrder.po_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Jami summa:</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">To'langan:</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.paid_amount ?? 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-sm font-medium">Qoldiq:</span>
                  <span className="font-bold text-primary">{formatMoneyUZS(remainingAmount ?? 0)}</span>
                </div>
              </>
            )}
            {!purchaseOrder && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Joriy balans:</span>
                <span className={`font-bold ${supplier.balance > 0 ? 'text-destructive' : supplier.balance < 0 ? 'text-success' : ''}`}>
                  {formatMoneyUZS(supplier.balance)}
                </span>
              </div>
            )}
          </div>

          <MoneyInput
            id="amount"
            label="To'lov summasi"
            value={amount ?? null}
            onValueChange={(val) => setAmount(val ?? undefined)}
            placeholder="0"
            required
            min={1}
            max={remainingAmount ?? undefined}
          />

          <div className="space-y-2">
            <Label htmlFor="method">To'lov usuli *</Label>
            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as SupplierPaymentMethod)}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Karta</SelectItem>
                <SelectItem value="transfer">Bank o'tkazmasi</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="uzum">Uzum</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Izoh (ixtiyoriy)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="To'lov haqida qo'shimcha ma'lumot..."
              rows={3}
            />
          </div>

          {amount && amount > 0 && !purchaseOrder && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Yangi balans:</span>
                <span className="text-lg font-bold text-primary">
                  {formatMoneyUZS(supplier.balance - amount)}
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor qilish
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amount || amount <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />
            {loading ? 'Saqlanmoqda...' : 'To\'lov qilish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


