import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { receiveCustomerPayment } from '@/db/api';
import type { Customer } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatCustomerBalance, formatMoneyUZS } from '@/lib/format';
import {
  formatMoney,
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
import {
  allocatePaymentInToDebtAndAdvance,
  assertPaymentOutAllowed,
  classifyPaymentOut,
  roleCanLendCreateDebt,
  roleCanPayoutWithinAdvance,
} from '@/lib/posHardening';

type PaymentMethod = 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other';
type OutMode = 'payout' | 'lend';

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
  const { user, profile } = useAuth();
  const { currentShift } = useShiftStore();
  const role = String(profile?.role || '').toLowerCase();
  const roles = role ? [role] : [];
  const canPayout = roleCanPayoutWithinAdvance(roles);
  const canLend = roleCanLendCreateDebt(roles);

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [outMode, setOutMode] = useState<OutMode>('payout');
  const [amount, setAmount] = useState<number | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<AppCurrency>(defaultCurrency);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmOutOpen, setConfirmOutOpen] = useState(false);
  const [confirmLendOpen, setConfirmLendOpen] = useState(false);
  const paymentUuidRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const balances = customer ? getCustomerBalances(customer) : { uzs: 0, usd: 0 };
  const activeBalance = paymentCurrency === 'USD' ? balances.usd : balances.uzs;
  const advance = activeBalance > 0 ? activeBalance : 0;
  const openDebt = activeBalance < 0 ? Math.abs(activeBalance) : 0;

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
      setOutMode('payout');
      setPaymentMethod('cash');
      setNote('');
      paymentUuidRef.current = null;
    } else if (!open) {
      setDirection('in');
      setOutMode('payout');
      setAmount(null);
      setPaymentCurrency(defaultCurrency);
      setPaymentMethod('cash');
      setNote('');
      setConfirmOutOpen(false);
      setConfirmLendOpen(false);
      paymentUuidRef.current = null;
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

  useEffect(() => {
    if (!canPayout && !canLend && direction === 'out') {
      setDirection('in');
    }
  }, [canPayout, canLend, direction]);

  const outClassification = useMemo(() => {
    if (!amount || amount <= 0) return null;
    return classifyPaymentOut(activeBalance, amount);
  }, [activeBalance, amount]);

  const paymentInAllocation = useMemo(() => {
    if (!amount || amount <= 0 || direction !== 'in') return null;
    return allocatePaymentInToDebtAndAdvance(activeBalance, amount);
  }, [activeBalance, amount, direction]);

  const payoutBlocked =
    direction === 'out' &&
    outMode === 'payout' &&
    !!outClassification?.ok &&
    outClassification.kind === 'lend';

  const canSubmitAmount = !!amount && amount > 0 && !payoutBlocked;

  const submitPayment = async (kind: OutMode | null) => {
    if (!customer) return;

    if (!paymentUuidRef.current) {
      paymentUuidRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const paymentUuid = paymentUuidRef.current;

    try {
      setLoading(true);
      const operation = direction === 'in' ? 'payment_in' : 'payment_out';

      const result = await receiveCustomerPayment({
        customer_id: customer.id,
        amount: amount!,
        currency: paymentCurrency,
        fx_rate: paymentCurrency === 'USD' ? fxRate : null,
        operation,
        payment_method: paymentMethod,
        notes: note.trim() || null,
        received_by: user?.id || null,
        source,
        shift_id: currentShift?.id ?? null,
        payment_uuid: paymentUuid,
        ...(operation === 'payment_out'
          ? {
              payment_out_kind: kind || outMode,
              lend_authorized: kind === 'lend' || outMode === 'lend',
              approver_user_id: user?.id || null,
            }
          : {}),
      });

      if (!result.success) {
        throw new Error(result.error || "To'lov qabul qilinmadi");
      }

      invalidateDashboardQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });

      const appliedAmount = result.applied_amount ?? amount!;
      const newBal =
        paymentCurrency === 'USD'
          ? Number(result.new_balance_usd ?? result.new_balance ?? 0)
          : Number(result.new_balance_uzs ?? result.new_balance ?? 0);

      const operationLabel =
        direction === 'in'
          ? "To'lov qabul qilindi"
          : kind === 'lend' || outMode === 'lend'
            ? 'Qarz berildi'
            : 'Pul berildi';
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
      setOutMode('payout');
      setAmount(null);
      setPaymentMethod('cash');
      setNote('');
      paymentUuidRef.current = null;
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

    if (direction === 'out') {
      const gate = assertPaymentOutAllowed({
        oldBalance: activeBalance,
        amount,
        roles,
        kindRequested: outMode,
        reason: note,
        creditLimit: Number((customer as any).credit_limit) || 0,
        lendAuthorized: outMode === 'lend' && canLend,
      });
      if (!gate.ok) {
        toast({
          title: 'Xatolik',
          description: gate.error,
          variant: 'destructive',
        });
        return;
      }
      if (outMode === 'lend') {
        if (!note.trim()) {
          toast({
            title: 'Sabab kerak',
            description: 'Qarz berish (lend) uchun sabab majburiy',
            variant: 'destructive',
          });
          return;
        }
        setConfirmLendOpen(true);
        return;
      }
      setConfirmOutOpen(true);
      return;
    }

    await submitPayment(null);
  };

  if (!customer) return null;

  const previewAmount = amount && amount > 0 ? amount : 0;
  const delta = direction === 'in' ? previewAmount : -previewAmount;
  const newBalance = activeBalance + delta;
  const uzsInfo = formatCustomerBalance(balances.uzs, 'UZS');
  const usdInfo = formatCustomerBalance(balances.usd, 'USD');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[calc(100vw-1rem)] sm:max-w-[400px] max-h-[82vh] overflow-y-auto p-3"
          aria-describedby="receive-payment-desc"
        >
          <DialogHeader>
            <DialogTitle className="text-base">
              {direction === 'in'
                ? 'Pul qabul qilish'
                : outMode === 'lend'
                  ? 'Qarz berish (lend)'
                  : 'Pul berish (payout)'}
            </DialogTitle>
            <DialogDescription id="receive-payment-desc" className="text-xs">
              {direction === 'in'
                ? `${customer.name} — to‘lov valyutasini tanlang (UZS/USD alohida)`
                : outMode === 'lend'
                  ? `${customer.name} — oldindan to‘lovdan ortiq berish = yangi qarz (menejer/admin)`
                  : `${customer.name} — faqat mavjud oldindan to‘lov doirasida`}
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
                  {canPayout && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="out" id="out" />
                      <Label htmlFor="out" className="font-normal cursor-pointer">
                        - Berish
                      </Label>
                    </div>
                  )}
                </div>
              </RadioGroup>
            </div>

            {direction === 'out' && canLend && (
              <div className="space-y-2">
                <Label>Berish turi *</Label>
                <RadioGroup value={outMode} onValueChange={(v) => setOutMode(v as OutMode)}>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="payout" id="out-payout" />
                      <Label htmlFor="out-payout" className="font-normal cursor-pointer">
                        Oldindan to‘lovdan berish
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="lend" id="out-lend" />
                      <Label htmlFor="out-lend" className="font-normal cursor-pointer">
                        Qarz berish (lend)
                      </Label>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="p-2 bg-muted rounded-lg space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Mijoz:</span>
                <span className="text-xs font-semibold">{customer.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Oldindan ({paymentCurrency}):</span>
                <span className="text-xs font-semibold text-green-600">
                  {formatMoney(advance, paymentCurrency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Ochiq qarz ({paymentCurrency}):</span>
                <span className="text-xs font-semibold text-destructive">
                  {formatMoney(openDebt, paymentCurrency)}
                </span>
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
                onValueChange={(v) => {
                  setPaymentCurrency(v as AppCurrency);
                  setAmount(null);
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS (so‘m)</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
              {paymentCurrency === 'USD' && (
                <p
                  className={`text-xs ${fxRate && fxRate > 0 ? 'text-muted-foreground' : 'text-destructive'}`}
                >
                  {fxRate && fxRate > 0
                    ? `Kurs: 1 USD = ${formatMoneyUZS(fxRate)}`
                    : 'USD kursi topilmadi — sozlamalardan kursni kiriting.'}
                </p>
              )}
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
                max={direction === 'out' && outMode === 'payout' && advance > 0 ? advance : undefined}
                className="h-9 text-sm"
              />
              {direction === 'in' && openDebt > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(openDebt)}
                    className="h-8 px-2 text-xs"
                  >
                    100% qarz
                  </Button>
                </div>
              )}
              {direction === 'out' && outMode === 'payout' && (
                <p className="text-xs text-muted-foreground">
                  Maksimal: {formatMoney(advance, paymentCurrency)} (oldindan to‘lov)
                </p>
              )}
              {payoutBlocked && (
                <p className="text-xs text-destructive">
                  Summa oldindan to‘lovdan oshib ketdi. Oddiy berish bloklangan — qarz berish (lend)
                  alohida amal.
                </p>
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
              <Label htmlFor="note">
                {direction === 'out' && outMode === 'lend' ? 'Sabab *' : 'Izoh (ixtiyoriy)'}
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  direction === 'out' && outMode === 'lend'
                    ? 'Qarz berish sababi (majburiy)...'
                    : "To'lov haqida qo'shimcha ma'lumot..."
                }
                rows={2}
                required={direction === 'out' && outMode === 'lend'}
              />
            </div>

            {amount && amount > 0 && (
              <div className="p-2 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
                {direction === 'in' && paymentInAllocation && (
                  <div className="text-xs space-y-1 pb-1 border-b mb-1">
                    <div className="flex justify-between">
                      <span>Qarz yopiladi:</span>
                      <span className="font-semibold">
                        {formatMoney(paymentInAllocation.debt_portion, paymentCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Oldindan qo‘shiladi:</span>
                      <span className="font-semibold text-green-600">
                        {formatMoney(paymentInAllocation.advance_portion, paymentCurrency)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ortig‘i avtomatik oldindan to‘lovga o‘tadi; qarz o‘zi yopilmaydi.
                    </p>
                  </div>
                )}
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
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={
                loading ||
                !canSubmitAmount ||
                (direction === 'out' && outMode === 'lend' && !note.trim())
              }
            >
              <DollarSign className="h-3.5 w-3.5 mr-2" />
              {loading
                ? 'Jarayonda...'
                : direction === 'in'
                  ? 'Qabul qilish'
                  : outMode === 'lend'
                    ? 'Qarz berish'
                    : 'Berish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOutOpen} onOpenChange={setConfirmOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pul berishni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription>
              „{customer.name}” mijozga {formatMoney(amount || 0, paymentCurrency)} berilsinmi?
              (faqat oldindan to‘lov doirasida)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                setConfirmOutOpen(false);
                void submitPayment('payout');
              }}
            >
              Tasdiqlash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLendOpen} onOpenChange={setConfirmLendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Qarz berishni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription>
              Bu amal mijozga yangi qarz yaratadi. Summa: {formatMoney(amount || 0, paymentCurrency)}.
              Sabab: {note.trim() || '—'}. Ikkinchi marta tasdiqlang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                setConfirmLendOpen(false);
                void submitPayment('lend');
              }}
            >
              Qarz berishni tasdiqlash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
