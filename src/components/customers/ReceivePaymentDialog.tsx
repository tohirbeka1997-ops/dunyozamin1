import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { receiveCustomerPayment } from '@/db/api';
import type { Customer } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';

type CustomerPaymentMethod = 'cash' | 'card' | 'qr';

interface ReceivePaymentDialogProps {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function ReceivePaymentDialog({
  customer,
  open,
  onOpenChange,
  onSuccess,
}: ReceivePaymentDialogProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

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

    if (amount > (customer.balance || 0)) {
      toast({
        title: 'Amount Exceeds Balance',
        description: `Payment amount cannot exceed customer balance of ${formatMoneyUZS(customer.balance || 0)}.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount: amount,
        payment_method: paymentMethod,
        notes: note.trim() || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to receive payment');
      }

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);

      toast({
        title: '✅ Payment Received',
        description: `Payment of ${formatMoneyUZS(amount)} received. New balance: ${formatMoneyUZS(result.new_balance || 0)}`,
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
        description: error instanceof Error ? error.message : 'Failed to receive payment',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Receive Payment</DialogTitle>
          <DialogDescription>
            Record a payment from {customer.name} to reduce their outstanding balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Customer:</span>
              <span className="font-semibold">{customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Current Balance:</span>
              <span className="font-bold text-destructive">
                {formatMoneyUZS(customer.balance || 0)}
              </span>
            </div>
          </div>

          <MoneyInput
            id="amount"
            label="Payment Amount"
            value={amount ?? null}
            onValueChange={(val) => setAmount(val ?? undefined)}
            placeholder="0"
            required
            min={1}
            max={customer.balance || undefined}
          />

          <div className="space-y-2">
            <Label htmlFor="method">Payment Method *</Label>
            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as CustomerPaymentMethod)}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="qr">QR Pay</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note (Optional)</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this payment..."
              rows={3}
            />
          </div>

          {amount && amount > 0 && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">New Balance:</span>
                <span className="text-lg font-bold text-primary">
                  {formatMoneyUZS((customer.balance || 0) - amount)}
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amount || amount <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />
            {loading ? 'Processing...' : 'Receive Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
