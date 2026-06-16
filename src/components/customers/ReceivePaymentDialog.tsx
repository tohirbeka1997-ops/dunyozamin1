import { useEffect, useState } from 'react';
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
import {
  formatCustomerBalance,
  formatMoney,
  formatMoneyUZS,
} from '@/lib/format';
import {
  getCustomerBalances,
  type AppCurrency,
} from '@/lib/currency';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { useShiftStore } from '@/store/shiftStore';
import { useAuth } from '@/contexts/AuthContext';

type CustomerPaymentMethod = 'cash' | 'card' | 'qr';

interface ReceivePaymentDialogProps {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function BalanceLine({
  variant,
  label,
}: {
  variant: 'destructive' | 'default' | 'outline';
  label: string;
}) {
  const cls =
    variant === 'destructive'
      ? 'text-destructive font-semibold'
      : variant === 'default'
        ? 'text-green-600 font-semibold'
        : 'text-muted-foreground';
  return <span className={cls}>{label}</span>;
}

export default function ReceivePaymentDialog({
  customer,
  open,
  onOpenChange,
  onSuccess,
}: ReceivePaymentDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentShift } = useShiftStore();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentCurrency, setPaymentCurrency] = useState<AppCurrency>('UZS');
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const balances = getCustomerBalances(customer);
  const activeBalance = paymentCurrency === 'USD' ? balances.usd : balances.uzs;

  useEffect(() => {
    if (!open) return;
    if (paymentCurrency !== 'USD') {
      setFxRate(null);
      return;
    }
    void fetchUzsPerUsdRate().then((r) => setFxRate(r));
  }, [open, paymentCurrency]);

  const handleSubmit = async () => {
    if (amount === undefined || amount === null || amount <= 0) {
      toast({
        title: 'Noto‘g‘ri summa',
        description: 'Musbat to‘lov summasini kiriting.',
        variant: 'destructive',
      });
      return;
    }

    if (paymentCurrency === 'USD' && (!fxRate || fxRate <= 0)) {
      toast({
        title: 'Kurs kerak',
        description: 'USD to‘lov uchun 1 USD = ? UZS kursini sozlamalardan oling.',
        variant: 'destructive',
      });
      return;
    }

    if (activeBalance < 0 && amount > Math.abs(activeBalance)) {
      toast({
        title: 'Summa qarzdan oshdi',
        description: `Qarz: ${formatMoney(Math.abs(activeBalance), paymentCurrency)}`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount,
        currency: paymentCurrency,
        fx_rate: paymentCurrency === 'USD' ? fxRate : null,
        payment_method: paymentMethod,
        notes: note.trim() || null,
        operation: 'payment_in',
        received_by: user?.id ?? null,
        shift_id: currentShift?.id ?? null,
      });

      if (!result.success) {
        throw new Error(result.error || 'To‘lovni qayd etib bo‘lmadi');
      }

      invalidateDashboardQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['customers'] });

      const newBal =
        paymentCurrency === 'USD'
          ? Number(result.new_balance_usd ?? result.new_balance ?? 0)
          : Number(result.new_balance_uzs ?? result.new_balance ?? 0);

      toast({
        title: 'To‘lov qabul qilindi',
        description: `${formatMoney(amount, paymentCurrency)}. Yangi balans: ${formatMoney(newBal, paymentCurrency)}`,
        className: 'bg-green-50 border-green-200',
      });

      setAmount(undefined);
      setPaymentMethod('cash');
      setPaymentCurrency('UZS');
      setNote('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Payment error:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'To‘lovni qayd etib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const previewBalance = activeBalance + (amount && amount > 0 ? amount : 0);
  const uzsInfo = formatCustomerBalance(balances.uzs, 'UZS');
  const usdInfo = formatCustomerBalance(balances.usd, 'USD');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Mijozdan to‘lov</DialogTitle>
          <DialogDescription>
            {customer.name} — balansni UZS yoki USD da yangilang (valyutalar aralashmaydi).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Mijoz:</span>
              <span className="font-semibold">{customer.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Balans (UZS):</span>
              <BalanceLine variant={uzsInfo.variant} label={uzsInfo.label} />
            </div>
            {(Math.abs(balances.usd) > 0.0001 || paymentCurrency === 'USD') && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Balans (USD):</span>
                <BalanceLine variant={usdInfo.variant} label={usdInfo.label} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>To‘lov valyutasi</Label>
            <Select
              value={paymentCurrency}
              onValueChange={(v) => setPaymentCurrency(v as AppCurrency)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UZS">UZS (so‘m)</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
            {paymentCurrency === 'USD' && (
              <p className="text-xs text-muted-foreground">
                Kurs: {fxRate ? `1 USD = ${formatMoneyUZS(fxRate)}` : 'yuklanmoqda…'}
              </p>
            )}
          </div>

          <MoneyInput
            id="amount"
            label={`To‘lov summasi (${paymentCurrency})`}
            value={amount ?? null}
            onValueChange={(val) => setAmount(val ?? undefined)}
            placeholder="0"
            required
            min={1}
            max={activeBalance < 0 ? Math.abs(activeBalance) : undefined}
          />

          <div className="space-y-2">
            <Label htmlFor="method">To‘lov usuli</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as CustomerPaymentMethod)}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Karta</SelectItem>
                <SelectItem value="qr">QR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Izoh</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ixtiyoriy izoh…"
              rows={3}
            />
          </div>

          {amount && amount > 0 && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Yangi balans ({paymentCurrency}):</span>
                <span className="text-lg font-bold tabular-nums">
                  {formatMoney(previewBalance, paymentCurrency)}
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amount || amount <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />
            {loading ? 'Saqlanmoqda…' : 'Qabul qilish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
