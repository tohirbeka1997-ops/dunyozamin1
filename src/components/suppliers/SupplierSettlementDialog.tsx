import { useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import MoneyInput from '@/components/common/MoneyInput';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, normalizeCurrency, type AppCurrency } from '@/lib/currency';
import { canAcceptSupplierOverpayAsAdvance } from '@/lib/purchase/purchaseHardening';
import {
  getSupplierSettlement,
  previewSupplierSettlement,
  settleSupplier,
  type SupplierSettlement,
} from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';

export type SettlementIntent = 'pay' | 'advance_out' | 'receive';

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';

const TITLES: Record<SettlementIntent, string> = {
  pay: 'To‘lov qilish',
  advance_out: 'Avans berish',
  receive: 'Yetkazib beruvchidan pul qabul qilish',
};

interface SupplierSettlementDialogProps {
  supplier: SupplierWithBalance;
  intent: SettlementIntent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function bucket(row: SupplierSettlement | null, currency: AppCurrency, field: 'debt' | 'advance' | 'pending_refund') {
  if (!row) return 0;
  const key = `${field}_${currency.toLowerCase()}` as keyof SupplierSettlement;
  return Number(row[key] || 0) || 0;
}

export default function SupplierSettlementDialog({
  supplier,
  intent,
  open,
  onOpenChange,
  onSuccess,
}: SupplierSettlementDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const defaultCurrency = normalizeCurrency((supplier as { settlement_currency?: string }).settlement_currency, 'UZS');

  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<AppCurrency>(defaultCurrency);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [acceptAsAdvance, setAcceptAsAdvance] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settlement, setSettlement] = useState<SupplierSettlement | null>(null);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    if (!open) {
      setAmount(null);
      setReason('');
      setAcceptAsAdvance(false);
      setPaymentMethod('cash');
      setCurrency(defaultCurrency);
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await getSupplierSettlement(supplier.id);
        if (!cancelled) setSettlement(row);
      } catch {
        if (!cancelled) setSettlement(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supplier.id, defaultCurrency]);

  useEffect(() => {
    if (!open || !amount || amount <= 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await previewSupplierSettlement({
          supplier_id: supplier.id,
          op_kind: intent,
          amount,
          currency,
          accept_as_advance: acceptAsAdvance,
        });
        if (!cancelled) setPreview(res?.preview || res);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supplier.id, intent, amount, currency, acceptAsAdvance]);

  const canOverpay = canAcceptSupplierOverpayAsAdvance(profile?.role);
  const p = preview?.preview || preview;
  const blocked = String(p?.blocked || '');
  const overpayNeedsAck = intent === 'pay' && blocked.includes('avans');

  const handleSubmit = async () => {
    if (!amount || amount <= 0) {
      toast({ title: 'Xatolik', description: 'Summa 0 dan katta bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    if (overpayNeedsAck && !acceptAsAdvance) {
      toast({
        title: 'Tasdiq kerak',
        description: 'Ortiqcha to‘lovni avans sifatida qabul qilishni belgilang',
        variant: 'destructive',
      });
      return;
    }
    if (overpayNeedsAck && !canOverpay) {
      toast({
        title: 'Ruxsat yo‘q',
        description: 'Ortiqcha to‘lovni avans qilish uchun buxgalter/menejer kerak',
        variant: 'destructive',
      });
      return;
    }
    if (blocked && !overpayNeedsAck) {
      toast({ title: 'Bloklandi', description: blocked, variant: 'destructive' });
      return;
    }
    try {
      setLoading(true);
      await settleSupplier({
        supplier_id: supplier.id,
        op_kind: intent,
        amount,
        currency,
        payment_method: paymentMethod,
        reason: reason.trim() || null,
        accept_as_advance: acceptAsAdvance,
        created_by: profile?.id || null,
        idempotency_key: `sset-${intent}-${supplier.id}-${Date.now()}`,
      });
      toast({
        title: 'Saqlandi',
        description: `${TITLES[intent]}: ${formatMoney(amount, currency)}`,
        className: 'bg-green-50 border-green-200',
      });
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Operatsiya bajarilmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const debtNow = bucket(settlement, currency, 'debt');
  const advanceNow = bucket(settlement, currency, 'advance');
  const pendingNow = bucket(settlement, currency, 'pending_refund');

  const methodLabel = useMemo(
    () => (paymentMethod === 'cash' ? 'Naqd (kassa)' : 'Bank/karta'),
    [paymentMethod],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{TITLES[intent]}</DialogTitle>
          <DialogDescription>
            {supplier.name}. Joriy qarz va avans, operatsiyadan keyingi qoldiq ko‘rsatiladi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2 text-sm rounded-lg border bg-muted/40 px-3 py-2">
            <div>
              <p className="text-xs text-muted-foreground">Joriy qarz ({currency})</p>
              <p className="font-semibold text-destructive">{formatMoney(debtNow, currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Joriy avans ({currency})</p>
              <p className="font-semibold text-emerald-700">{formatMoney(advanceNow + pendingNow, currency)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Valyuta</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as AppCurrency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To‘lov usuli</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Naqd</SelectItem>
                  <SelectItem value="card">Karta</SelectItem>
                  <SelectItem value="transfer">O‘tkazma</SelectItem>
                  <SelectItem value="click">Click</SelectItem>
                  <SelectItem value="payme">Payme</SelectItem>
                  <SelectItem value="uzum">Uzum</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <MoneyInput
            id="settlement-amount"
            label="Operatsiya summasi"
            value={amount}
            onValueChange={(v) => setAmount(v)}
            placeholder="0"
            required
            allowDecimals={currency === 'USD'}
            min={currency === 'USD' ? 0 : 1}
          />

          <div className="space-y-2">
            <Label>Sabab / izoh</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>

          {p && !p.blocked && amount ? (
            <div className="rounded-md border px-3 py-2 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Operatsiyadan keyingi qarz</span>
                <span className="font-semibold">{formatMoney(Number(p.debt_after || 0), currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Operatsiyadan keyingi avans</span>
                <span className="font-semibold">{formatMoney(Number(p.advance_after || 0), currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">Manba: {methodLabel}</p>
            </div>
          ) : null}

          {overpayNeedsAck ? (
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <Checkbox
                checked={acceptAsAdvance}
                onCheckedChange={(v) => setAcceptAsAdvance(!!v)}
                className="mt-0.5"
              />
              <span>Ortiqcha summani yetkazib beruvchi avansi sifatida qabul qilish</span>
            </label>
          ) : null}

          {blocked && !overpayNeedsAck ? (
            <p className="text-sm text-destructive">{blocked}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Bekor qilish
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Saqlanmoqda...' : 'Tasdiqlash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
