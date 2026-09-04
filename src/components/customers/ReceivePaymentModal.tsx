import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { receiveCustomerPayment, listOpenCreditOrders, type OpenCreditOrderRow } from '@/db/api';
import type { Customer } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight, DollarSign } from 'lucide-react';
import { formatCustomerBalance, formatMoneyUZS } from '@/lib/format';
import {
  formatMoney,
  getCustomerBalances,
  getCustomerDebtAdvance,
  type AppCurrency,
} from '@/lib/currency';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
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
  assertPaymentOutAllowed,
  classifyExplicitLend,
  classifyPaymentOut,
  roleCanLendCreateDebt,
  roleCanPayoutWithinAdvance,
} from '@/lib/posHardening';
import { cn } from '@/lib/utils';

type PaymentMethod = 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other';
/** Cashier-facing direction: money in vs money out. */
type CashDirection = 'in' | 'out';
/** Legacy prop values — mapped onto CashDirection. */
type LegacyOpKind = 'payment_in' | 'advance_in' | 'advance_out' | 'lend';

interface ReceivePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  source?: 'pos' | 'customers';
  /** POS: savat valyutasiga mos bucket */
  defaultCurrency?: AppCurrency;
  /** Prefill direction when opening (e.g. payment_in from debt-section CTA). */
  initialOpKind?: LegacyOpKind | CashDirection;
  onSuccess?: () => void;
}

function mapInitialDirection(initial?: LegacyOpKind | CashDirection): CashDirection {
  if (initial === 'out' || initial === 'advance_out' || initial === 'lend') return 'out';
  return 'in';
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
    return 'Ortiqcha to‘lovni qaytarib bo‘lmaydi: qoldiq yetarli emas.';
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
  initialOpKind,
  onSuccess,
}: ReceivePaymentModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const { currentShift } = useShiftStore();
  const role = String(profile?.role || '').toLowerCase();
  const roles = role ? [role] : [];
  const canPayout = roleCanPayoutWithinAdvance(roles);
  const canLend = roleCanLendCreateDebt(roles);
  const canManualAlloc = role === 'admin' || role === 'manager';
  const canOut = canPayout || canLend;

  const [direction, setDirection] = useState<CashDirection>('in');
  const [amount, setAmount] = useState<number | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<AppCurrency>(defaultCurrency);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmOutOpen, setConfirmOutOpen] = useState(false);
  const [openOrders, setOpenOrders] = useState<OpenCreditOrderRow[]>([]);
  const [manualAlloc, setManualAlloc] = useState(false);
  const [allocByOrder, setAllocByOrder] = useState<Record<string, number | null>>({});
  const paymentUuidRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const balances = customer ? getCustomerBalances(customer) : { uzs: 0, usd: 0 };
  const activeBalance = paymentCurrency === 'USD' ? balances.usd : balances.uzs;
  const debtAdvance = customer
    ? getCustomerDebtAdvance(customer, paymentCurrency)
    : { debt: 0, advance: 0, net: 0 };
  const advance = debtAdvance.advance;
  const openDebt = debtAdvance.debt;
  const creditLimitRaw = Number((customer as { credit_limit?: number } | null)?.credit_limit);
  const creditLimit = Number.isFinite(creditLimitRaw) ? creditLimitRaw : 0;
  const hasCreditLimit = creditLimit > 0;
  const lendAvailable = canLend && hasCreditLimit;

  /**
   * Auto-map Berildi → backend kind (cashier never picks 4 labels):
   * - amount ≤ excess (signed −) → payment_out payout
   * - else → payment_out lend (creates / increases debt)
   */
  const resolvedOutKind = useMemo((): 'payout' | 'lend' | null => {
    if (direction !== 'out' || !amount || amount <= 0) return null;
    if (advance > 0.009 && amount <= advance + 1e-9) return 'payout';
    return 'lend';
  }, [advance, amount, direction]);

  const reasonRequired = direction === 'out';

  useEffect(() => {
    if (open && customer) {
      setPaymentCurrency(defaultCurrency);
      const bucket = defaultCurrency === 'USD' ? balances.usd : balances.uzs;
      let nextDir = mapInitialDirection(initialOpKind);
      if (nextDir === 'out' && !canOut) nextDir = 'in';
      setDirection(nextDir);
      // Olindi: qarz bo‘lsa taklif; Berildi hech qachon avto-to‘ldirilmasin
      if (nextDir === 'in') {
        setAmount(bucket < 0 ? Math.abs(bucket) : null);
      } else {
        setAmount(null);
      }
      setPaymentMethod('cash');
      setNote('');
      paymentUuidRef.current = null;
      setManualAlloc(false);
      setAllocByOrder({});
    } else if (!open) {
      setDirection('in');
      setAmount(null);
      setPaymentCurrency(defaultCurrency);
      setPaymentMethod('cash');
      setNote('');
      setConfirmOutOpen(false);
      paymentUuidRef.current = null;
      setOpenOrders([]);
      setManualAlloc(false);
      setAllocByOrder({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on open/customer
  }, [open, customer, defaultCurrency, initialOpKind]);

  useEffect(() => {
    if (!open || !customer?.id) return;
    let cancelled = false;
    void listOpenCreditOrders({ customerId: customer.id, limit: 50 })
      .then((rows) => {
        if (!cancelled) setOpenOrders(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setOpenOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer?.id]);

  useEffect(() => {
    if (!open) return;
    if (paymentCurrency !== 'USD') {
      setFxRate(null);
      return;
    }
    void fetchUzsPerUsdRate().then((r) => setFxRate(r));
  }, [open, paymentCurrency]);

  useEffect(() => {
    if (direction === 'out' && !canOut) {
      setDirection('in');
    }
  }, [canOut, direction]);

  const handleDirectionChange = (next: CashDirection) => {
    if (next === 'out' && !canOut) return;
    setDirection(next);
    paymentUuidRef.current = null;
    if (next === 'in' && openDebt > 0) {
      setAmount(openDebt);
    } else {
      setAmount(null);
    }
  };

  const paymentInAllocation = useMemo(() => {
    if (!amount || amount <= 0 || direction !== 'in') return null;
    const debt_portion = Math.min(amount, openDebt);
    const advance_portion = Math.max(0, amount - debt_portion);
    return {
      debt_portion,
      advance_portion,
      new_balance: advance + advance_portion - (openDebt - debt_portion),
    };
  }, [amount, advance, direction, openDebt]);

  const outNeedsLend = resolvedOutKind === 'lend';
  const outBlockedNoLend = direction === 'out' && outNeedsLend && !lendAvailable;
  const outBlockedNoPayout =
    direction === 'out' && resolvedOutKind === 'payout' && !canPayout;

  const lendPreview =
    direction === 'out' && outNeedsLend && amount && amount > 0
      ? classifyExplicitLend(activeBalance, amount, {
          currentDebt: openDebt,
          currentAdvance: advance,
        })
      : null;

  const payoutPreview =
    direction === 'out' && resolvedOutKind === 'payout' && amount && amount > 0
      ? classifyPaymentOut(activeBalance, amount)
      : null;

  const previewLegacyNet =
    amount && amount > 0
      ? direction === 'in' && paymentInAllocation
        ? paymentInAllocation.new_balance
        : outNeedsLend && lendPreview?.ok
          ? lendPreview.new_balance
          : payoutPreview?.ok
            ? payoutPreview.new_balance
            : activeBalance
      : activeBalance;

  const canSubmitAmount =
    !!amount && amount > 0 && !outBlockedNoLend && !outBlockedNoPayout;

  const cashFlowLabel =
    direction === 'in'
      ? `Kassa kirimi: ${formatMoney(amount || 0, paymentCurrency)}`
      : `Kassa chiqimi: ${formatMoney(amount || 0, paymentCurrency)}`;

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
      const outKind = kind || resolvedOutKind;

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
              payment_out_kind: outKind || 'payout',
              lend_authorized: outKind === 'lend',
              approver_user_id: user?.id || null,
            }
          : {}),
        ...(operation === 'payment_in' && manualAlloc
          ? {
              allocations: Object.entries(allocByOrder)
                .filter(([, v]) => Number(v) > 0.009)
                .map(([order_id, v]) => ({ order_id, amount: Number(v) })),
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
        direction === 'in'
          ? t('customers.payment_modal.toast_received')
          : outKind === 'lend'
            ? t('customers.payment_modal.toast_lent')
            : t('customers.payment_modal.toast_given');
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
              {t('customers.payment_modal.new_balance')} ({paymentCurrency}):{' '}
              {formatCustomerBalance(newBal, paymentCurrency).label}
            </div>
          </div>
        ),
        className: 'bg-green-50 border-green-200',
      });

      setDirection('in');
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
      if (!canOut) {
        toast({
          title: 'Xatolik',
          description: 'Bu operatsiya uchun menejer ruxsati kerak.',
          variant: 'destructive',
        });
        return;
      }

      const outKind = resolvedOutKind;
      if (!outKind) {
        toast({
          title: 'Xatolik',
          description: 'Summa 0 dan katta bo‘lishi kerak.',
          variant: 'destructive',
        });
        return;
      }

      if (outKind === 'lend' && !hasCreditLimit) {
        toast({
          title: 'Xatolik',
          description: 'Qarz berib bo‘lmaydi: mijoz kredit limiti belgilanmagan.',
          variant: 'destructive',
        });
        return;
      }

      if (!note.trim()) {
        toast({
          title: 'Sabab kerak',
          description: t('customers.payment_modal.reason_required_out'),
          variant: 'destructive',
        });
        return;
      }

      const gate = assertPaymentOutAllowed({
        oldBalance: activeBalance,
        amount,
        roles,
        kindRequested: outKind,
        reason: note,
        creditLimit: hasCreditLimit ? creditLimit : 0,
        lendAuthorized: outKind === 'lend' && canLend,
        currentDebt: openDebt,
        currentAdvance: advance,
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
      setConfirmOutOpen(true);
      return;
    }

    await submitPayment(null);
  };

  if (!customer) return null;

  const title =
    direction === 'in'
      ? t('customers.payment_modal.title_in')
      : t('customers.payment_modal.title_out');
  const desc =
    direction === 'in'
      ? t('customers.payment_modal.desc_in', { name: customer.name })
      : t('customers.payment_modal.desc_out', { name: customer.name });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[calc(100vw-1rem)] sm:max-w-[440px] max-h-[82vh] overflow-y-auto p-3"
          aria-describedby="receive-payment-desc"
        >
          <DialogHeader>
            <DialogTitle className="text-base">{title}</DialogTitle>
            <DialogDescription id="receive-payment-desc" className="text-xs">
              {desc}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <div className="space-y-2">
              <Label>{t('customers.payment_modal.direction_label')} *</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={direction === 'in' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'h-11 flex-col gap-0.5 py-1.5',
                    direction === 'in' && 'ring-2 ring-primary/30',
                  )}
                  onClick={() => handleDirectionChange('in')}
                >
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <ArrowDownLeft className="h-3.5 w-3.5" />
                    {t('customers.payment_modal.direction_in')}
                  </span>
                  <span className="text-[10px] font-normal opacity-80">
                    {t('customers.payment_modal.direction_in_hint')}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={direction === 'out' ? 'default' : 'outline'}
                  size="sm"
                  disabled={!canOut}
                  className={cn(
                    'h-11 flex-col gap-0.5 py-1.5',
                    direction === 'out' && 'ring-2 ring-primary/30',
                    !canOut && 'opacity-60',
                  )}
                  onClick={() => handleDirectionChange('out')}
                >
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {t('customers.payment_modal.direction_out')}
                  </span>
                  <span className="text-[10px] font-normal opacity-80">
                    {canOut
                      ? t('customers.payment_modal.direction_out_hint')
                      : t('customers.payment_modal.direction_out_forbidden')}
                  </span>
                </Button>
              </div>
            </div>

            <div className="p-2 bg-muted rounded-lg space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Mijoz:</span>
                <span className="text-xs font-semibold">{customer.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  Mijoz balansi ({paymentCurrency}):
                </span>
                <span
                  className={`text-xs font-semibold ${
                    activeBalance < -0.001
                      ? 'text-destructive'
                      : activeBalance > 0.001
                        ? 'text-green-600'
                        : 'text-muted-foreground'
                  }`}
                >
                  {formatCustomerBalance(activeBalance, paymentCurrency).label}
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
                max={
                  direction === 'out' && advance > 0 && !lendAvailable
                    ? advance
                    : undefined
                }
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
                    {t('customers.payment_modal.close_full_debt')}
                  </Button>
                </div>
              )}
              {direction === 'in' && openOrders.length > 0 && (
                <div className="mt-2 space-y-2 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t('customers.payment_modal.alloc_fifo_hint')}
                    </p>
                    {canManualAlloc && (
                      <Button
                        type="button"
                        variant={manualAlloc ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setManualAlloc((v) => !v)}
                      >
                        {manualAlloc
                          ? t('customers.payment_modal.alloc_auto')
                          : t('customers.payment_modal.alloc_manual')}
                      </Button>
                    )}
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {openOrders.map((row) => {
                      const rem = Number(row.credit_amount || 0);
                      return (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate">
                            {row.order_number} · {formatMoney(rem, paymentCurrency)}
                            {row.due_date ? ` · ${String(row.due_date).slice(0, 10)}` : ''}
                          </span>
                          {manualAlloc && canManualAlloc ? (
                            <MoneyInput
                              value={allocByOrder[row.id] ?? null}
                              onValueChange={(v) =>
                                setAllocByOrder((prev) => ({ ...prev, [row.id]: v }))
                              }
                              min={0}
                              max={rem}
                              allowZero
                              className="h-7 w-28 text-xs"
                              containerClassName="space-y-0"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {direction === 'out' && advance > 0.009 && (
                <p className="text-xs text-muted-foreground">
                  {t('customers.payment_modal.out_excess_hint', {
                    amount: formatMoney(advance, paymentCurrency),
                  })}
                </p>
              )}
              {direction === 'out' && outNeedsLend && (
                <p className="text-xs text-amber-700">
                  {t('customers.payment_modal.out_lend_hint')}
                </p>
              )}
              {outBlockedNoLend && (
                <p className="text-xs text-destructive">
                  {!hasCreditLimit
                    ? t('customers.payment_modal.out_no_credit_limit')
                    : t('customers.payment_modal.out_lend_forbidden')}
                </p>
              )}
              {outBlockedNoPayout && (
                <p className="text-xs text-destructive">
                  {t('customers.payment_modal.direction_out_forbidden')}
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
              <Label htmlFor="note">
                {reasonRequired
                  ? t('customers.payment_modal.reason_required')
                  : t('customers.payment_modal.note_optional')}
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  direction === 'out'
                    ? t('customers.payment_modal.reason_placeholder_out')
                    : t('customers.payment_modal.note_placeholder')
                }
                rows={2}
                required={reasonRequired}
              />
            </div>

            {amount && amount > 0 && (
              <div className="p-2 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground pb-1">
                  {t('customers.payment_modal.preview_title')}
                </p>
                {direction === 'in' && paymentInAllocation && (
                  <div className="text-xs space-y-1 pb-1 border-b mb-1">
                    <div className="flex justify-between">
                      <span>{t('customers.payment_modal.preview_debt_closed')}:</span>
                      <span className="font-semibold">
                        {formatMoney(paymentInAllocation.debt_portion, paymentCurrency)}
                      </span>
                    </div>
                    {paymentInAllocation.advance_portion > 0.009 && (
                      <div className="flex justify-between">
                        <span>{t('customers.payment_modal.preview_excess')}:</span>
                        <span className="font-semibold text-green-600">
                          {formatMoney(paymentInAllocation.advance_portion, paymentCurrency)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-between items-center text-xs">
                  <span>{t('customers.payment_modal.preview_current')}:</span>
                  <span className="font-semibold">
                    {formatCustomerBalance(activeBalance, paymentCurrency).label}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>{t('customers.payment_modal.preview_amount')}:</span>
                  <span className="font-semibold">{formatMoney(amount, paymentCurrency)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-1 border-t">
                  <span>{t('customers.payment_modal.preview_new')}:</span>
                  <span
                    className={`font-semibold ${
                      previewLegacyNet < -0.001
                        ? 'text-destructive'
                        : previewLegacyNet > 0.001
                          ? 'text-green-600'
                          : ''
                    }`}
                  >
                    {formatCustomerBalance(previewLegacyNet, paymentCurrency).label}
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
                (direction === 'out' && outNeedsLend && !hasCreditLimit)
              }
            >
              <DollarSign className="h-3.5 w-3.5 mr-2" />
              {loading
                ? 'Jarayonda...'
                : direction === 'out'
                  ? t('customers.payment_modal.submit_out')
                  : t('customers.payment_modal.submit_in')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOutOpen} onOpenChange={setConfirmOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {outNeedsLend
                ? t('customers.payment_modal.confirm_lend_title')
                : t('customers.payment_modal.confirm_out_title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {outNeedsLend && (
                <span className="block text-amber-800">
                  {t('customers.payment_modal.confirm_lend_warn')}
                </span>
              )}
              <span className="block text-sm space-y-1">
                <span className="flex justify-between gap-4">
                  <span>{t('customers.payment_modal.preview_current')}:</span>
                  <span>{formatCustomerBalance(activeBalance, paymentCurrency).label}</span>
                </span>
                <span className="flex justify-between gap-4">
                  <span>{t('customers.payment_modal.preview_amount')}:</span>
                  <span>{formatMoney(amount || 0, paymentCurrency)}</span>
                </span>
                <span className="flex justify-between gap-4 font-medium">
                  <span>{t('customers.payment_modal.preview_new')}:</span>
                  <span>
                    {formatCustomerBalance(previewLegacyNet, paymentCurrency).label}
                  </span>
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {t('customers.payment_modal.reason_label')}: {note.trim() || '—'}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                setConfirmOutOpen(false);
                void submitPayment(resolvedOutKind);
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
