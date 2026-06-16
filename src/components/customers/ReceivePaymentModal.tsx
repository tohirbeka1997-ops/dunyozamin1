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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { receiveCustomerPayment } from '@/db/api';
import type { Customer } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatCustomerBalance, formatMoney } from '@/lib/format';
import {
  getCustomerBalances,
  type AppCurrency,
} from '@/lib/currency';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';
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
import { useShiftStore } from '@/store/shiftStore';

type PaymentMethod = 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other';

interface ReceivePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  source?: 'pos' | 'customers';
  /** POS: savat valyutasiga mos bucket */
  defaultCurrency?: AppCurrency;
  onSuccess?: () => void;
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

export default function ReceivePaymentModal({
  open,
  onOpenChange,
  customer,
  source = 'customers',
  defaultCurrency = 'UZS',
  onSuccess,
}: ReceivePaymentModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentShift } = useShiftStore();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState<number | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<AppCurrency>(defaultCurrency);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const balances = customer ? getCustomerBalances(customer) : { uzs: 0, usd: 0 };
  const activeBalance = paymentCurrency === 'USD' ? balances.usd : balances.uzs;

  useEffect(() => {
    if (open && customer) {
      setPaymentCurrency(defaultCurrency);
      const bucket = defaultCurrency === 'USD' ? balances.usd : balances.uzs;
      if (bucket < 0) {
        setDirection('in');
        setAmount(Math.abs(bucket));
      } else {
        setDirection('in');
        setAmount(null);
      }
      setPaymentMethod('cash');
      setNote('');
    } else if (!open) {
      setDirection('in');
      setAmount(null);
      setPaymentCurrency(defaultCurrency);
      setPaymentMethod('cash');
      setNote('');
    }
  }, [open, customer, defaultCurrency]);

  useEffect(() => {
    if (!open) return;
    if (paymentCurrency !== 'USD') {
      setFxRate(null);
      return;
    }
    void fetchUzsPerUsdRate().then((r) => setFxRate(r));
  }, [open, paymentCurrency]);

  const handleSubmit = async () => {
    if (!customer) return;

    if (!amount || amount <= 0) {
      toast({
        title: 'Xatolik',
        description: "To'lov summasi 0 dan katta bo'lishi kerak",
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

    try {
      setLoading(true);
      const operation = direction === 'in' ? 'payment_in' : 'payment_out';

      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount,
        currency: paymentCurrency,
        fx_rate: paymentCurrency === 'USD' ? fxRate : null,
        operation,
        payment_method: paymentMethod,
        notes: note.trim() || null,
        received_by: user?.id || null,
        source,
        shift_id: currentShift?.id ?? null,
      });

      if (!result.success) {
        throw new Error(result.error || "To'lov qabul qilinmadi");
      }

      invalidateDashboardQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });

      const appliedAmount = result.applied_amount ?? amount;
      const newBal =
        paymentCurrency === 'USD'
          ? Number(result.new_balance_usd ?? result.new_balance ?? 0)
          : Number(result.new_balance_uzs ?? result.new_balance ?? 0);

      const operationLabel = direction === 'in' ? "To'lov qabul qilindi" : 'Pul berildi';
      const deltaLabel =
        direction === 'in'
          ? `+${formatMoney(appliedAmount, paymentCurrency)}`
          : `-${formatMoney(appliedAmount, paymentCurrency)}`;

      toast({
        title: `✅ ${operationLabel}`,
        description: (
          <div className="space-y-1">
            <div>{deltaLabel}</div>
            <div>
              Yangi balans ({paymentCurrency}): {formatCustomerBalance(newBal, paymentCurrency).label}
            </div>
          </div>
        ),
        className: 'bg-green-50 border-green-200',
      });

      setDirection('in');
      setAmount(null);
      setPaymentMethod('cash');
      setNote('');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Payment error:', error);
      toast({
        title: '❌ Xatolik',
        description: error instanceof Error ? error.message : "To'lov qabul qilinmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!customer) return null;

  const isDebt = activeBalance < 0;
  const isCredit = activeBalance > 0;
  const previewAmount = amount && amount > 0 ? amount : 0;
  const delta = direction === 'in' ? previewAmount : -previewAmount;
  const newBalance = activeBalance + delta;
  const uzsInfo = formatCustomerBalance(balances.uzs, 'UZS');
  const usdInfo = formatCustomerBalance(balances.usd, 'USD');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-[400px] max-h-[82vh] overflow-y-auto p-3">
        <DialogHeader>
          <DialogTitle className="text-base">
            {direction === 'in' ? 'Pul qabul qilish' : 'Pul berish'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {direction === 'in'
              ? `${customer.name} — to‘lov valyutasini tanlang (UZS/USD alohida)`
              : `${customer.name} mijozga pul bering`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <div className="space-y-2">
            <Label>Operatsiya turi *</Label>
            <RadioGroup value={direction} onValueChange={(value) => setDirection(value as 'in' | 'out')}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="in" id="in" />
                  <Label htmlFor="in" className="font-normal cursor-pointer">
                    + Qabul
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="out" id="out" />
                  <Label htmlFor="out" className="font-normal cursor-pointer">
                    - Berish
                  </Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="p-2 bg-muted rounded-lg space-y-1">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Mijoz:</span>
              <span className="text-xs font-semibold">{customer.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Balans (UZS):</span>
              <BalanceLine variant={uzsInfo.variant} label={uzsInfo.label} />
            </div>
            {(Math.abs(balances.usd) > 0.0001 || paymentCurrency === 'USD') && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Balans (USD):</span>
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
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UZS">UZS (so‘m)</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Summa ({paymentCurrency}) *</Label>
            <MoneyInput
              id="amount"
              value={amount}
              onValueChange={(val) => setAmount(val)}
              placeholder="0"
              required
              min={1}
              className="h-9 text-sm"
            />
            {direction === 'in' && isDebt && (
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(Math.abs(activeBalance))}
                  className="h-8 px-2 text-xs"
                >
                  100% qarz
                </Button>
              </div>
            )}
          </div>

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

          {amount && amount > 0 && (
            <div className="p-2 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium">Joriy ({paymentCurrency}):</span>
                <BalanceLine
                  variant={formatCustomerBalance(activeBalance, paymentCurrency).variant}
                  label={formatCustomerBalance(activeBalance, paymentCurrency).label}
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium">O'zgarish:</span>
                <span
                  className={`text-xs font-semibold ${delta >= 0 ? 'text-green-600' : 'text-destructive'}`}
                >
                  {delta >= 0 ? '+' : ''}
                  {formatMoney(delta, paymentCurrency)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t">
                <span className="text-xs font-medium">Yangi:</span>
                <BalanceLine
                  variant={formatCustomerBalance(newBalance, paymentCurrency).variant}
                  label={formatCustomerBalance(newBalance, paymentCurrency).label}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor qilish
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading || !amount || amount <= 0}>
            <DollarSign className="h-3.5 w-3.5 mr-2" />
            {loading ? 'Jarayonda...' : direction === 'in' ? 'Qabul qilish' : 'Berish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
