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
/** Operator-facing operation (Uzbek TZ names). */
type OpKind = 'payment_in' | 'advance_in' | 'advance_out' | 'lend';

interface ReceivePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  source?: 'pos' | 'customers';
  /** POS: savat valyutasiga mos bucket */
  defaultCurrency?: AppCurrency;
  onSuccess?: () => void;
}

function mapPaymentError(raw: string): string {
  const s = String(raw || '');
  if (/Exceeds customer credit limit/i.test(s)) {
    return 'Qarz berib bo‘lmaydi: yangi qarz mijoz kredit limitidan oshadi.';
  }
  if (/Lending \(creating debt\)|LEND_FORBIDDEN|manager or admin/i.test(s)) {
    return 'Bu operatsiya uchun menejer ruxsati kerak.';
  }
  if (/Payout amount exceeds|PAYOUT_EXCEEDS/i.test(s)) {
    return 'Avans qaytarib bo‘lmaydi: mijoz avansi yetarli emas.';
  }
  if (/amount must be|greater than 0/i.test(s)) {
    return 'Summa 0 dan katta bo‘lishi kerak.';
  }
  if (/network|Failed to fetch|ECONNREFUSED|offline/i.test(s)) {
    return 'Tarmoq uzildi. Operatsiya holati tekshirilmoqda.';
  }
  return s || 'Operatsiya saqlanmadi. Qayta urinib ko‘ring.';
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

  const [opKind, setOpKind] = useState<OpKind>('payment_in');
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
  const creditLimitRaw = Number((customer as { credit_limit?: number } | null)?.credit_limit);
  const creditLimit = Number.isFinite(creditLimitRaw) ? creditLimitRaw : 0;
  const hasCreditLimit = creditLimit > 0;
  const lendAvailable = canLend && hasCreditLimit;

  const direction: 'in' | 'out' =
    opKind === 'payment_in' || opKind === 'advance_in' ? 'in' : 'out';
  const outMode: 'payout' | 'lend' = opKind === 'lend' ? 'lend' : 'payout';
  const reasonRequired = opKind === 'lend' || opKind === 'advance_out';

  useEffect(() => {
    if (open && customer) {
      setPaymentCurrency(defaultCurrency);
      const bucket = defaultCurrency === 'USD' ? balances.usd : balances.uzs;
      setOpKind('payment_in');
      // To‘lov qabul: qarz bo‘lsa taklif; yangi qarz berish hech qachon avto-to‘ldirilmasin
      setAmount(bucket < 0 ? Math.abs(bucket) : null);
      setPaymentMethod('cash');
      setNote('');
      paymentUuidRef.current = null;
    } else if (!open) {
      setOpKind('payment_in');
      setAmount(null);
      setPaymentCurrency(defaultCurrency);
      setPaymentMethod('cash');
      setNote('');
      setConfirmOutOpen(false);
      setConfirmLendOpen(false);
      paymentUuidRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on open/customer
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
    if (!canPayout && (opKind === 'advance_out' || opKind === 'lend')) {
      setOpKind('payment_in');
    } else if (!lendAvailable && opKind === 'lend') {
      setOpKind(canPayout ? 'advance_out' : 'payment_in');
    }
  }, [canPayout, lendAvailable, opKind]);

  const handleOpKindChange = (next: OpKind) => {
    setOpKind(next);
    paymentUuidRef.current = null;
    // TZ: yangi qarz berishda summa bo‘sh / 0 — mavjud qarz avtomatik qo‘yilmasin;
    // amallar o‘rtasida summa ko‘chib o‘tmasin.
    if (next === 'lend' || next === 'advance_in' || next === 'advance_out') {
      setAmount(null);
    } else if (next === 'payment_in' && openDebt > 0) {
      setAmount(openDebt);
    } else {
      setAmount(null);
    }
  };

  const outClassification = useMemo(() => {
    if (!amount || amount <= 0 || direction !== 'out') return null;
    return classifyPaymentOut(activeBalance, amount);
  }, [activeBalance, amount, direction]);

  const paymentInAllocation = useMemo(() => {
    if (!amount || amount <= 0 || direction !== 'in') return null;
    return allocatePaymentInToDebtAndAdvance(activeBalance, amount);
  }, [activeBalance, amount, direction]);

  const payoutBlocked =
    opKind === 'advance_out' &&
    !!outClassification?.ok &&
    outClassification.kind === 'lend';

  const canSubmitAmount = !!amount && amount > 0 && !payoutBlocked;

  const previewAfterDebt =
    amount && amount > 0
      ? direction === 'in'
        ? Math.max(0, -(activeBalance + amount))
        : Math.max(
            0,
            -((outClassification?.ok ? outClassification.new_balance : activeBalance - amount) || 0),
          )
      : openDebt;
  const previewAfterAdvance =
    amount && amount > 0
      ? direction === 'in'
        ? Math.max(0, activeBalance + amount)
        : Math.max(
            0,
            (outClassification?.ok ? outClassification.new_balance : activeBalance - amount) || 0,
          )
      : advance;

  const cashFlowLabel =
    direction === 'in'
      ? `Kassa kirimi: ${formatMoney(amount || 0, paymentCurrency)}`
      : `Kassa chiqimi: ${formatMoney(amount || 0, paymentCurrency)}`;

  const lendNewDebt =
    outClassification?.ok
      ? Math.max(0, -outClassification.new_balance)
      : openDebt + (amount || 0);

  const submitPayment = async (kind: 'payout' | 'lend' | null) => {
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
        throw new Error(result.error || 'Operatsiya saqlanmadi. Qayta urinib ko‘ring.');
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
        opKind === 'payment_in'
          ? 'To‘lov qabul qilindi'
          : opKind === 'advance_in'
            ? 'Avans qabul qilindi'
            : opKind === 'lend' || kind === 'lend'
              ? 'Yangi qarz berildi'
              : 'Avans qaytarildi';
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
              Yangi holat ({paymentCurrency}):{' '}
              {formatCustomerBalance(newBal, paymentCurrency).label}
            </div>
          </div>
        ),
        className: 'bg-green-50 border-green-200',
      });

      setOpKind('payment_in');
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
        description: mapPaymentError(
          error instanceof Error ? error.message : 'Operatsiya saqlanmadi. Qayta urinib ko‘ring.',
        ),
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
        description: 'Summa 0 dan katta bo‘lishi kerak.',
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
      if (opKind === 'lend' && !hasCreditLimit) {
        toast({
          title: 'Xatolik',
          description: 'Qarz berib bo‘lmaydi: mijoz kredit limiti belgilanmagan.',
          variant: 'destructive',
        });
        return;
      }
      const gate = assertPaymentOutAllowed({
        oldBalance: activeBalance,
        amount,
        roles,
        kindRequested: outMode,
        reason: note,
        creditLimit: hasCreditLimit ? creditLimit : 0,
        lendAuthorized: outMode === 'lend' && canLend,
      });
      if (!gate.ok) {
        let detail = gate.error;
        if (gate.code === 'CREDIT_LIMIT_EXCEEDED') {
          const g = gate as {
            current_debt?: number;
            amount?: number;
            credit_limit?: number;
            new_debt?: number;
            over_by?: number;
          };
          detail = [
            gate.error,
            `Joriy qarz: ${formatMoney(g.current_debt ?? openDebt, paymentCurrency)}`,
            `Berilayotgan: ${formatMoney(g.amount ?? amount, paymentCurrency)}`,
            `Kredit limiti: ${formatMoney(g.credit_limit ?? creditLimit, paymentCurrency)}`,
            `Yangi qarz: ${formatMoney(g.new_debt ?? 0, paymentCurrency)}`,
            `Limitdan oshadi: ${formatMoney(g.over_by ?? 0, paymentCurrency)}`,
          ].join('\n');
        }
        toast({
          title: 'Xatolik',
          description: detail,
          variant: 'destructive',
        });
        return;
      }
      if (opKind === 'lend') {
        if (!note.trim()) {
          toast({
            title: 'Sabab kerak',
            description: 'Qarz berish sababi majburiy.',
            variant: 'destructive',
          });
          return;
        }
        setConfirmLendOpen(true);
        return;
      }
      if (!note.trim()) {
        toast({
          title: 'Sabab kerak',
          description: 'Avans qaytarish sababi majburiy.',
          variant: 'destructive',
        });
        return;
      }
      setConfirmOutOpen(true);
      return;
    }

    await submitPayment(null);
  };

  if (!customer) return null;

  const titleByOp: Record<OpKind, string> = {
    payment_in: 'Mijozdan to‘lov qabul qilish',
    advance_in: 'Mijoz avansini qabul qilish',
    advance_out: 'Mijoz avansini qaytarish',
    lend: 'Mijozga yangi qarz berish',
  };

  const descByOp: Record<OpKind, string> = {
    payment_in: `${customer.name} — avval ochiq qarz yopiladi, ortiqchasi avansga o‘tadi`,
    advance_in: `${customer.name} — oldindan to‘lov (avans) qabul qilish`,
    advance_out: `${customer.name} — faqat mavjud avans doirasida qaytarish`,
    lend: `${customer.name} — kassadan chiqim + mijoz qarzi oshadi (menejer/admin)`,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[calc(100vw-1rem)] sm:max-w-[440px] max-h-[82vh] overflow-y-auto p-3"
          aria-describedby="receive-payment-desc"
        >
          <DialogHeader>
            <DialogTitle className="text-base">{titleByOp[opKind]}</DialogTitle>
            <DialogDescription id="receive-payment-desc" className="text-xs">
              {descByOp[opKind]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <div className="space-y-2">
              <Label>Operatsiya turi *</Label>
              <RadioGroup
                value={opKind}
                onValueChange={(value) => handleOpKindChange(value as OpKind)}
              >
                <div className="grid gap-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="payment_in" id="op-payment-in" />
                    <Label htmlFor="op-payment-in" className="font-normal cursor-pointer text-sm">
                      Mijozdan to‘lov qabul qilish
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="advance_in" id="op-advance-in" />
                    <Label htmlFor="op-advance-in" className="font-normal cursor-pointer text-sm">
                      Mijoz avansini qabul qilish
                    </Label>
                  </div>
                  {canPayout && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="advance_out" id="op-advance-out" />
                      <Label htmlFor="op-advance-out" className="font-normal cursor-pointer text-sm">
                        Mijoz avansini qaytarish
                      </Label>
                    </div>
                  )}
                  {canLend && (
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem
                        value="lend"
                        id="op-lend"
                        disabled={!hasCreditLimit}
                      />
                      <Label
                        htmlFor="op-lend"
                        className={`font-normal text-sm ${
                          hasCreditLimit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                        }`}
                      >
                        Mijozga yangi qarz berish
                        {!hasCreditLimit ? ' (limit yo‘q)' : ''}
                      </Label>
                    </div>
                  )}
                </div>
              </RadioGroup>
              {canLend && !hasCreditLimit && (
                <p className="text-xs text-destructive">
                  Qarz berib bo‘lmaydi: mijoz kredit limiti belgilanmagan.
                </p>
              )}
            </div>

            <div className="p-2 bg-muted rounded-lg space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Mijoz:</span>
                <span className="text-xs font-semibold">{customer.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Ochiq qarz ({paymentCurrency}):</span>
                <span className="text-xs font-semibold text-destructive">
                  {formatMoney(openDebt, paymentCurrency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Mijoz avansi ({paymentCurrency}):</span>
                <span className="text-xs font-semibold text-green-600">
                  {formatMoney(advance, paymentCurrency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Kredit limiti:</span>
                <span className="text-xs font-semibold">
                  {hasCreditLimit
                    ? formatMoney(creditLimit, paymentCurrency)
                    : 'Belgilanmagan'}
                </span>
              </div>
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
                max={opKind === 'advance_out' && advance > 0 ? advance : undefined}
                className="h-9 text-sm"
              />
              {opKind === 'payment_in' && openDebt > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(openDebt)}
                    className="h-8 px-2 text-xs"
                  >
                    Butun qarzni yopish
                  </Button>
                </div>
              )}
              {opKind === 'advance_out' && (
                <p className="text-xs text-muted-foreground">
                  Maksimal: {formatMoney(advance, paymentCurrency)} (mijoz avansi)
                </p>
              )}
              {opKind === 'lend' && (
                <p className="text-xs text-amber-700">
                  Diqqat: bu amal kassadan pul chiqimini yaratadi va mijoz qarzini oshiradi.
                </p>
              )}
              {payoutBlocked && (
                <p className="text-xs text-destructive">
                  Avans qaytarib bo‘lmaydi: mijoz avansi yetarli emas.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>To‘lov usuli *</Label>
              <Select
                value={paymentMethod}
                onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="To‘lov usuli tanlang" />
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
              <Label htmlFor="note">{reasonRequired ? 'Sabab *' : 'Izoh (ixtiyoriy)'}</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  opKind === 'lend'
                    ? 'Qarz berish sababi (majburiy)...'
                    : opKind === 'advance_out'
                      ? 'Avans qaytarish sababi (majburiy)...'
                      : 'Qo‘shimcha ma’lumot...'
                }
                rows={2}
                required={reasonRequired}
              />
            </div>

            {amount && amount > 0 && (
              <div className="p-2 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground pb-1">
                  Operatsiyadan oldin ko‘rish
                </p>
                {direction === 'in' && paymentInAllocation && (
                  <div className="text-xs space-y-1 pb-1 border-b mb-1">
                    <div className="flex justify-between">
                      <span>Qarz yopiladi:</span>
                      <span className="font-semibold">
                        {formatMoney(paymentInAllocation.debt_portion, paymentCurrency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avansga o‘tadi:</span>
                      <span className="font-semibold text-green-600">
                        {formatMoney(paymentInAllocation.advance_portion, paymentCurrency)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs">
                  <span>Joriy qarz:</span>
                  <span className="font-semibold">{formatMoney(openDebt, paymentCurrency)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Joriy avans:</span>
                  <span className="font-semibold">{formatMoney(advance, paymentCurrency)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Operatsiya summasi:</span>
                  <span className="font-semibold">{formatMoney(amount, paymentCurrency)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Kredit limiti:</span>
                  <span className="font-semibold">
                    {hasCreditLimit ? formatMoney(creditLimit, paymentCurrency) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1 border-t">
                  <span>Keyingi qarz:</span>
                  <span className="font-semibold text-destructive">
                    {formatMoney(previewAfterDebt, paymentCurrency)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Keyingi avans:</span>
                  <span className="font-semibold text-green-600">
                    {formatMoney(previewAfterAdvance, paymentCurrency)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>{cashFlowLabel}</span>
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
                (reasonRequired && !note.trim()) ||
                (opKind === 'lend' && !hasCreditLimit)
              }
            >
              <DollarSign className="h-3.5 w-3.5 mr-2" />
              {loading
                ? 'Jarayonda...'
                : opKind === 'lend'
                  ? 'Davom etish'
                  : opKind === 'advance_out'
                    ? 'Qaytarish'
                    : 'Qabul qilish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOutOpen} onOpenChange={setConfirmOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Avans qaytarishni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription>
              „{customer.name}” mijozga {formatMoney(amount || 0, paymentCurrency)} avansdan
              qaytarilsinmi? Keyingi avans:{' '}
              {formatMoney(Math.max(0, advance - (amount || 0)), paymentCurrency)}.
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
            <AlertDialogTitle>Yangi qarz berishni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block text-amber-800">
                Diqqat: bu amal kassadan pul chiqimini yaratadi va mijoz qarzini oshiradi.
              </span>
              <span className="block">
                Mijozga {formatMoney(amount || 0, paymentCurrency)} beriladi. Mijozning yangi qarzi{' '}
                {formatMoney(lendNewDebt, paymentCurrency)} bo‘ladi. Davom etilsinmi?
              </span>
              <span className="block text-xs text-muted-foreground">
                Sabab: {note.trim() || '—'}
              </span>
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
              Tasdiqlash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
