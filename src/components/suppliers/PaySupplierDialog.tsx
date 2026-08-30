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
import { createSupplierPayment, getLatestExchangeRate } from '@/db/api';
import type { SupplierWithBalance, PurchaseOrder } from '@/types/database';
import { DollarSign } from 'lucide-react';
import { formatMoney, formatLedgerMoney, getPoLedgerCurrency, getPoRemainingAmount } from '@/lib/currency';
import { formatMoneyUZS } from '@/lib/format';
import {
  buildSupplierPaymentPayload,
  convertFromSettlementCurrency,
  type LedgerCurrency,
} from '@/lib/supplierPaymentPayload';
import { canAcceptSupplierOverpayAsAdvance, splitPaymentAgainstRemainder } from '@/lib/purchase/purchaseHardening';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import MoneyInput from '@/components/common/MoneyInput';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';

type SupplierPaymentMethod = 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';
type SupplierPaymentDirection = 'pay' | 'receive';
type PaymentCurrency = 'UZS' | 'USD';

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
  const [direction, setDirection] = useState<SupplierPaymentDirection>('pay');
  const [adjustPercent, setAdjustPercent] = useState(0);
  const [acceptAsAdvance, setAcceptAsAdvance] = useState(false);
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrency>('UZS');
  const [fxRate, setFxRate] = useState<number | null>(null);

  const poCurrencyRaw = String(purchaseOrder?.currency || 'UZS').toUpperCase() as PaymentCurrency;
  const poFxRateRaw = typeof (purchaseOrder as any)?.fx_rate === 'number' ? Number((purchaseOrder as any).fx_rate) : 0;
  const hasUsdData =
    Number(purchaseOrder?.total_usd ?? 0) > 0 ||
    Number((purchaseOrder as any)?.paid_amount_usd ?? 0) > 0 ||
    Number((purchaseOrder as any)?.remaining_amount_usd ?? 0) > 0 ||
    poFxRateRaw > 0;
  const poCurrency = poCurrencyRaw === 'USD' && !hasUsdData ? 'UZS' : poCurrencyRaw;
  const supplierCurrency = String((supplier as any)?.settlement_currency || 'UZS').toUpperCase() as PaymentCurrency;

  // Initialize amount when dialog opens
  useEffect(() => {
    if (open) {
      // Default direction based on balance if NOT linked to a PO
      if (!purchaseOrder) {
        setDirection(supplier.balance < 0 ? 'receive' : 'pay');
      } else {
        setDirection('pay');
      }

      // Calculate default amount (remaining if PO provided, or empty)
      const defaultAmount = purchaseOrder ? getPoRemainingAmount(purchaseOrder as any) : 0;
      
      if (amount === undefined && defaultAmount > 0) {
        setAmount(defaultAmount);
      }

      const nextCurrency = purchaseOrder ? poCurrency : supplierCurrency === 'USD' ? 'USD' : 'UZS';
      setPaymentCurrency(nextCurrency);
      if (poCurrency === 'USD' && poFxRateRaw > 0) {
        setFxRate(poFxRateRaw);
      }
    } else {
      // Reset form when dialog closes
      setAmount(undefined);
      setNote('');
      setPaymentMethod('cash');
      setDirection('pay');
      setAdjustPercent(0);
      setPaymentCurrency('UZS');
      setFxRate(null);
      setAcceptAsAdvance(false);
    }
  }, [open, purchaseOrder, supplier.balance]);

  useEffect(() => {
    if (!open) return;
    if (poCurrency !== 'USD') {
      setFxRate(null);
      return;
    }
    if (Number.isFinite(Number(fxRate)) && Number(fxRate) > 0) return;
    const run = async () => {
      try {
        const row = await getLatestExchangeRate({
          base_currency: 'USD',
          quote_currency: 'UZS',
          on_date: new Date().toISOString().slice(0, 10),
        });
        const r = row?.rate != null ? Number(row.rate) : NaN;
        if (Number.isFinite(r) && r > 0) setFxRate(r);
      } catch {
        // ignore
      }
    };
    void run();
  }, [open, poCurrency, fxRate]);

  const clampPercent = (value: number) => Math.max(-100, Math.min(100, value));
  const baseAmount = Number(amount || 0);
  const safeAdjustPercent = clampPercent(Number(adjustPercent || 0));
  const adjustedAmount = Math.max(0, baseAmount * (1 + safeAdjustPercent / 100));

  const fxRateSafe = Number.isFinite(Number(fxRate)) && Number(fxRate) > 0 ? Number(fxRate) : null;
  const settlementLedger: LedgerCurrency =
    String((supplier as any)?.settlement_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
  const poLedgerCur: LedgerCurrency = purchaseOrder
    ? (getPoLedgerCurrency(purchaseOrder as any) as LedgerCurrency)
    : 'UZS';
  const remainingAmount = purchaseOrder ? getPoRemainingAmount(purchaseOrder as any) : 0;
  const remainingInPaymentCurrency = purchaseOrder
    ? convertFromSettlementCurrency(remainingAmount, poLedgerCur, paymentCurrency, fxRateSafe)
    : 0;
  const formatCurrency = (value: number, currency: PaymentCurrency) => formatMoney(value, currency);
  const overpaySplit = purchaseOrder
    ? splitPaymentAgainstRemainder(adjustedAmount, remainingInPaymentCurrency, paymentCurrency)
    : { settleAmount: 0, advanceAmount: 0, requiresAdvanceAck: false };
  const canOverpayAdvance = canAcceptSupplierOverpayAsAdvance(profile?.role);

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
    if (adjustedAmount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Adjusted amount must be greater than zero.',
        variant: 'destructive',
      });
      return;
    }

    // If PO provided, only payment (to supplier) is allowed
    if (purchaseOrder && direction !== 'pay') {
      toast({
        title: 'Xatolik',
        description: 'Buyurtmaga bog‘langan holatda faqat to‘lov qilish mumkin',
        variant: 'destructive',
      });
      return;
    }

    // If PO provided, overpay requires explicit accept-as-advance + authority
    if (purchaseOrder && overpaySplit.requiresAdvanceAck) {
      if (!acceptAsAdvance) {
        toast({
          title: 'Amount Exceeds Remaining',
          description: `Qoldiq: ${formatCurrency(remainingInPaymentCurrency, paymentCurrency)}. Ortiqchani avans sifatida qabul qilishni belgilang.`,
          variant: 'destructive',
        });
        return;
      }
      if (!canOverpayAdvance) {
        toast({
          title: 'Ruxsat yo‘q',
          description: 'Ortiqcha to‘lovni avans qilish uchun buxgalter/menejer kerak',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setLoading(true);
      const sign = direction === 'receive' ? -1 : 1;
      const adjustmentNote =
        safeAdjustPercent !== 0 ? ` (${safeAdjustPercent > 0 ? '+' : ''}${safeAdjustPercent.toFixed(2)}%)` : '';
      const fullNote = note.trim() ? `${note.trim()}${adjustmentNote}` : adjustmentNote.trim() || null;
      let ledgerPayload;
      try {
        ledgerPayload = buildSupplierPaymentPayload({
          paid: adjustedAmount,
          entryCurrency: paymentCurrency,
          settlementCurrency: settlementLedger,
          fxRate: fxRateSafe,
        });
      } catch (err: any) {
        toast({
          title: 'Xatolik',
          description: err?.message || 'To‘lov valyutasi noto‘g‘ri',
          variant: 'destructive',
        });
        return;
      }

      const ledgerAmountUzs =
        ledgerPayload.currency === 'UZS' ? sign * (Number(ledgerPayload.amount || 0) || adjustedAmount) : 0;
      const ledgerAmountUsd =
        ledgerPayload.amount_usd != null
          ? sign * Number(ledgerPayload.amount_usd)
          : ledgerPayload.currency === 'USD'
            ? sign * adjustedAmount
            : null;
      const poUsdPaid =
        purchaseOrder && poLedgerCur === 'USD'
          ? paymentCurrency === 'USD'
            ? sign * adjustedAmount
            : fxRateSafe
              ? sign * (adjustedAmount / fxRateSafe)
              : null
          : null;

      const result = await createSupplierPayment({
        supplier_id: supplier.id,
        purchase_order_id: purchaseOrder?.id || null,
        amount: ledgerAmountUzs,
        amount_usd: poUsdPaid ?? ledgerAmountUsd,
        currency: ledgerPayload.currency,
        fx_rate: fxRateSafe,
        payment_method: paymentMethod,
        note: fullNote,
        created_by: profile?.id || null,
        accept_as_advance: acceptAsAdvance && overpaySplit.requiresAdvanceAck,
        idempotency_key: `spay-${supplier.id}-${purchaseOrder?.id || 'none'}-${Date.now()}`,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create payment');
      }

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);

      toast({
        title: direction === 'pay' ? '✅ To‘lov saqlandi' : '✅ Pul qabul qilindi',
        description: `${formatCurrency(adjustedAmount, paymentCurrency)}. Yangi balans: ${formatLedgerMoney(
          Number(result.new_balance ?? 0),
          supplierCurrency
        )}`,
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

  const signedAmountPreview = direction === 'receive' ? -adjustedAmount : adjustedAmount;
  const previewBalance = adjustedAmount > 0 ? supplier.balance - signedAmountPreview : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{direction === 'pay' ? "To'lov qilish" : 'Pul qabul qilish'}</DialogTitle>
          <DialogDescription>
            {purchaseOrder 
              ? `Record payment for ${supplier.name} - PO ${purchaseOrder.po_number}`
              : (direction === 'pay'
                ? `${supplier.name} ga to‘lovni qayd etish`
                : `${supplier.name} dan pul qabul qilishni qayd etish`)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{supplier.name}</span>
              {purchaseOrder ? (
                <span className="text-muted-foreground">PO {purchaseOrder.po_number}</span>
              ) : null}
              {purchaseOrder ? (
                <span className="font-semibold text-primary">
                  Qoldiq: {formatCurrency(
                    convertFromSettlementCurrency(
                      Number(remainingAmount || 0),
                      poLedgerCur,
                      poCurrency,
                      fxRateSafe
                    ),
                    poCurrency
                  )}
                </span>
              ) : (
                <>
                  <span className={`font-semibold ${supplier.balance > 0 ? 'text-destructive' : supplier.balance < 0 ? 'text-success' : ''}`}>
                    Balans: {formatCurrency(Number(supplier.balance || 0), supplierCurrency)}
                  </span>
                  {previewBalance !== null && (
                    <span className="font-semibold text-primary">
                      Yangi: {formatCurrency(Number(previewBalance || 0), supplierCurrency)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Direction selector (only when not linked to PO) */}
          {!purchaseOrder && (
            <div className="space-y-2">
              <Label>Tranzaksiya turi</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as SupplierPaymentDirection)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pay">To‘lov qilish (qarzni yopish)</SelectItem>
                  <SelectItem value="receive">Pul qabul qilish (avansni qaytarish)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <MoneyInput
            id="amount"
            label={direction === 'pay' ? "To'lov summasi" : "Qabul qilinadigan summa"}
            value={amount ?? null}
            onValueChange={(val) => setAmount(val ?? undefined)}
            placeholder="0"
            required
            allowDecimals={paymentCurrency === 'USD'}
            min={paymentCurrency === 'USD' ? 0 : 1}
            max={purchaseOrder && !canOverpayAdvance ? remainingInPaymentCurrency : undefined}
          />

          {purchaseOrder && canOverpayAdvance && overpaySplit.requiresAdvanceAck && (
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <Checkbox
                checked={acceptAsAdvance}
                onCheckedChange={(v) => setAcceptAsAdvance(!!v)}
                className="mt-0.5"
              />
              <span>
                Ortiqcha {formatCurrency(overpaySplit.advanceAmount, paymentCurrency)} ni yetkazib
                beruvchi <strong>avansi</strong> sifatida qabul qilish (qarz manfiy bo‘lmaydi)
              </span>
            </label>
          )}

          {poCurrency === 'USD' && (
            <div className="space-y-2">
              <Label htmlFor="payment-currency">To‘lov valyutasi</Label>
              <Select value={paymentCurrency} onValueChange={(v) => setPaymentCurrency(v as PaymentCurrency)}>
                <SelectTrigger id="payment-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="UZS">UZS</SelectItem>
                </SelectContent>
              </Select>
              {paymentCurrency === 'UZS' && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Kurs: {fxRateSafe ? formatMoneyUZS(fxRateSafe) : '—'}
                  </p>
                  <MoneyInput
                    id="fx-rate"
                    label="Kurs (1 USD = UZS)"
                    value={typeof fxRate === 'number' ? fxRate : null}
                    onValueChange={(val) => setFxRate(Number(val ?? 0))}
                    placeholder="0"
                    allowDecimals
                    allowZero={false}
                    min={0}
                    containerClassName="space-y-0"
                    className="text-right"
                  />
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="adjust-percent">Foiz (+/-)</Label>
            <MoneyInput
              id="adjust-percent"
              value={safeAdjustPercent !== 0 ? safeAdjustPercent : null}
              onValueChange={(v) => setAdjustPercent(Number(v ?? 0))}
              allowDecimals
              allowZero
              min={-100}
              max={100}
              containerClassName="space-y-0"
              className="text-right"
            />
          </div>

          <div className="rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">
                Kiritilgan: <span className="font-medium">{formatCurrency(baseAmount, paymentCurrency)}</span>
              </span>
              <span className="text-muted-foreground">
                Foiz: <span className="font-medium">{safeAdjustPercent.toFixed(2)}%</span>
              </span>
              <span className="text-muted-foreground">
                Yakuniy: <span className="font-semibold">{formatCurrency(adjustedAmount, paymentCurrency)}</span>
              </span>
              {purchaseOrder && (
                <span className="text-muted-foreground">
                  Qoladi:{' '}
                  <span className="font-medium">
                    {formatCurrency(
                      Math.max(0, remainingInPaymentCurrency - adjustedAmount),
                      paymentCurrency
                    )}
                  </span>
                </span>
              )}
              {paymentCurrency === 'UZS' && settlementLedger === 'USD' && fxRateSafe && (
                <span className="text-muted-foreground">
                  USD ekv:{' '}
                  <span className="font-medium">
                    {formatMoney(adjustedAmount / fxRateSafe, 'USD')}
                  </span>
                </span>
              )}
            </div>
          </div>

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

          {/* previewBalance shown in compact summary row */}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor qilish
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !amount || amount <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />
            {loading ? 'Saqlanmoqda...' : (direction === 'pay' ? "To'lov qilish" : 'Qabul qilish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


