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
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const paymentAmount = Number(amount);

    // Validation
    if (!paymentAmount || paymentAmount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid payment amount greater than zero.',
        variant: 'destructive',
      });
      return;
    }

    if (paymentAmount > (customer.balance || 0)) {
      toast({
        title: 'Amount Exceeds Balance',
        description: `Payment amount cannot exceed customer balance of ${(customer.balance || 0).toFixed(2)} UZS.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount: paymentAmount,
        payment_method: paymentMethod,
        notes: note.trim() || null,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to receive payment');
      }

      toast({
        title: '✅ Payment Received',
        description: `Payment of ${paymentAmount.toFixed(2)} UZS received. New balance: ${result.new_balance?.toFixed(2)} UZS`,
        className: 'bg-green-50 border-green-200',
      });

      // Reset form
      setAmount('');
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
                {(customer.balance || 0).toFixed(2)} UZS
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              max={customer.balance || 0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Maximum: {(customer.balance || 0).toFixed(2)} UZS
            </p>
          </div>

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

          {amount && Number(amount) > 0 && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">New Balance:</span>
                <span className="text-lg font-bold text-primary">
                  {((customer.balance || 0) - Number(amount)).toFixed(2)} UZS
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amount || Number(amount) <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />
            {loading ? 'Processing...' : 'Receive Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
