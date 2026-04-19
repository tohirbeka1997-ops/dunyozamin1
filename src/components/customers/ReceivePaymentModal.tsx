import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { receiveCustomerPayment } from '@/db/api';
import type { Customer } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatMoneyUZS, formatCustomerBalance } from '@/lib/format';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';

type PaymentMethod = 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other';

interface ReceivePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  source?: 'pos' | 'customers';
  onSuccess?: () => void;
}

export default function ReceivePaymentModal({
  open,
  onOpenChange,
  customer,
  source = 'customers',
  onSuccess,
}: ReceivePaymentModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [direction, setDirection] = useState<'in' | 'out'>('in'); // 'in' = receive, 'out' = give
  const [amount, setAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  // Reset form when customer changes or dialog opens/closes
  useEffect(() => {
    if (open && customer) {
      // Set default direction and amount based on balance type
      const balance = customer.balance || 0;
      if (balance < 0) {
        // For debt, default to receiving payment
        setDirection('in');
        setAmount(Math.abs(balance));
      } else {
        // For credit or zero, default to receiving payment
        setDirection('in');
        setAmount(null);
      }
      setPaymentMethod('cash');
      setNote('');
    } else if (!open) {
      setDirection('in');
      setAmount(null);
      setPaymentMethod('cash');
      setNote('');
    }
  }, [open, customer]);

  const handleSubmit = async () => {
    if (!customer) return;

    // Validation
    if (!amount || amount <= 0) {
      toast({
        title: 'Xatolik',
        description: 'To\'lov summasi 0 dan katta bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    const currentBalance = customer.balance || 0;

    const finalAmount = amount;

    try {
      setLoading(true);
      // Map direction to operation type: 'in' -> 'payment_in', 'out' -> 'payment_out'
      const operation = direction === 'in' ? 'payment_in' : 'payment_out';
      
      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount: finalAmount, // Always positive
        operation: operation, // 'payment_in' | 'payment_out'
        payment_method: paymentMethod,
        notes: note.trim() || null,
        received_by: user?.id || null,
        source: source,
      });

      if (!result.success) {
        throw new Error(result.error || 'To\'lov qabul qilinmadi');
      }

      // Invalidate queries to refresh UI
      invalidateDashboardQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });

      // Extract response fields (all should be defined from backend)
      const oldBalance = result.old_balance ?? 0;
      const appliedAmount = result.applied_amount ?? finalAmount;
      const newBalance = result.new_balance ?? 0;
      const requestedAmount = result.requested_amount ?? finalAmount;

      // Show success toast with payment details
      const operationLabel = direction === 'in' ? 'To\'lov qabul qilindi' : 'Pul berildi';
      const deltaLabel = direction === 'in' 
        ? `+${formatMoneyUZS(appliedAmount)} so'm`
        : `-${formatMoneyUZS(appliedAmount)} so'm`;
      
      // Format new balance with Haq/Qarz label (based on sign, not operation)
      const newBalanceInfo = formatCustomerBalance(newBalance);
      
      toast({
        title: `✅ ${operationLabel}`,
        description: (
          <div className="space-y-1">
            <div>{deltaLabel}</div>
            <div>Yangi balans: {newBalanceInfo.label}</div>
          </div>
        ),
        className: 'bg-green-50 border-green-200',
      });

      // Reset form
      setDirection('in');
      setAmount(null);
      setPaymentMethod('cash');
      setNote('');
      onOpenChange(false);
      
      // Call success callback
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Payment error:', error);
      toast({
        title: '❌ Xatolik',
        description: error instanceof Error ? error.message : 'To\'lov qabul qilinmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!customer) return null;

  // Calculate balance info for display
  const currentBalance = customer.balance || 0;
  const isDebt = currentBalance < 0;
  const isCredit = currentBalance > 0;
  const isZero = currentBalance === 0;
  
  // Preview new balance after operation
  const previewAmount = amount && amount > 0 ? amount : 0;
  const delta = direction === 'in' ? previewAmount : -previewAmount;
  const newBalance = currentBalance + delta;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-[360px] max-h-[82vh] overflow-y-auto p-3">
        <DialogHeader>
          <DialogTitle className="text-base">
            {direction === 'in' ? 'Pul qabul qilish' : 'Pul berish'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {direction === 'in'
              ? `${customer.name} mijozdan pul qabul qiling`
              : `${customer.name} mijozga pul bering`
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          {/* Operation Type */}
          <div className="space-y-2">
            <Label>Operatsiya turi *</Label>
            <RadioGroup value={direction} onValueChange={(value) => setDirection(value as 'in' | 'out')}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="in" id="in" />
                  <Label htmlFor="in" className="font-normal cursor-pointer">+ Qabul</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="out" id="out" />
                  <Label htmlFor="out" className="font-normal cursor-pointer">- Berish</Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Customer Info */}
          <div className="p-2 bg-muted rounded-lg space-y-1">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Mijoz:</span>
              <span className="text-xs font-semibold">{customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">
                {isDebt ? 'Qarz:' : isCredit ? 'Haq:' : 'Balans:'}
              </span>
              <span className={`text-xs font-bold ${isDebt ? 'text-destructive' : isCredit ? 'text-green-600' : 'text-muted-foreground'}`}>
                {formatMoneyUZS(currentBalance)} so'm
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Summa *</Label>
            <MoneyInput
              id="amount"
              value={amount}
              onValueChange={(val) => setAmount(val)}
              placeholder="0"
              required
              min={1}
              className="h-9 text-sm"
            />
            
            {/* Quick amount buttons - only show for receiving when customer has debt */}
            {direction === 'in' && isDebt && (
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(10000)}
                  disabled={Math.abs(currentBalance) < 10000}
                  className="h-8 px-2 text-xs"
                >
                  10 000
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(20000)}
                  disabled={Math.abs(currentBalance) < 20000}
                  className="h-8 px-2 text-xs"
                >
                  20 000
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(Math.floor(Math.abs(currentBalance) * 0.5))}
                  disabled={currentBalance >= 0}
                  className="h-8 px-2 text-xs"
                >
                  50%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(Math.abs(currentBalance))}
                  disabled={currentBalance >= 0}
                  className="h-8 px-2 text-xs"
                >
                  100%
                </Button>
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label>To'lov usuli *</Label>
            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="To'lov usuli tanlang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Karta</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="other">Boshqa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="note">Izoh (ixtiyoriy)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="To'lov haqida qo'shimcha ma'lumot..."
              rows={2}
            />
          </div>

          {/* Preview */}
          {amount && amount > 0 && (
            <div className="p-2 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium">Joriy:</span>
                  <span className={`text-xs font-semibold ${isDebt ? 'text-destructive' : isCredit ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {formatMoneyUZS(currentBalance)} so'm
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium">O'zgarish:</span>
                  <span className={`text-xs font-semibold ${delta >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {delta >= 0 ? '+' : ''}{formatMoneyUZS(delta)} so'm
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t">
                  <span className="text-xs font-medium">Yangi:</span>
                  <span className={`text-base font-bold ${newBalance < 0 ? 'text-destructive' : newBalance > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {formatMoneyUZS(newBalance)} so'm
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor qilish
          </Button>
          <Button 
            size="sm"
            onClick={handleSubmit} 
            disabled={loading || !amount || amount <= 0}
          >
            <DollarSign className="h-3.5 w-3.5 mr-2" />
            {loading 
              ? 'Jarayonda...' 
              : direction === 'in' 
                ? 'Qabul qilish' 
                : 'Berish'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

