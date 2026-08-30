import { useEffect, useMemo, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import MoneyInput from '@/components/common/MoneyInput';
import { applySupplierAdvanceToPurchaseOrder, listSupplierAdvances } from '@/db/suppliers.api';
import { formatMoney } from '@/lib/currency';
import { getPoRemainingAmount } from '@/lib/currency';
import type { PurchaseOrder, SupplierWithBalance } from '@/types/database';
import { hasMinPurchaseRole } from '@/lib/purchase/purchaseHardening';

type AdvanceRow = {
  id: string;
  advance_number?: string;
  amount_remaining: number;
  currency?: string;
  created_at?: string;
};

interface ApplySupplierAdvanceDialogProps {
  supplier: SupplierWithBalance;
  purchaseOrder: PurchaseOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function ApplySupplierAdvanceDialog({
  supplier,
  purchaseOrder,
  open,
  onOpenChange,
  onSuccess,
}: ApplySupplierAdvanceDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [advanceId, setAdvanceId] = useState<string>('');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);

  const canApply = hasMinPurchaseRole(profile?.role, 'accountant');
  const poRemaining = getPoRemainingAmount(purchaseOrder as any);
  const selected = useMemo(
    () => advances.find((a) => a.id === advanceId) || null,
    [advances, advanceId],
  );
  const maxApply = selected
    ? Math.min(Number(selected.amount_remaining || 0), Number(poRemaining || 0))
    : 0;
  const currency = String(selected?.currency || (purchaseOrder as any)?.currency || 'UZS').toUpperCase();

  useEffect(() => {
    if (!open) {
      setAdvanceId('');
      setAmount(undefined);
      setConfirmed(false);
      setAdvances([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setLoadingList(true);
        const rows = await listSupplierAdvances(supplier.id);
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setAdvances(list as AdvanceRow[]);
        if (list.length === 1) {
          setAdvanceId(list[0].id);
          const max = Math.min(Number(list[0].amount_remaining || 0), Number(poRemaining || 0));
          setAmount(max > 0 ? max : undefined);
        }
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: t('common.error', 'Error'),
            description: e?.message || t('purchase_orders.advance_load_failed', 'Could not load advances'),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, supplier.id]);

  useEffect(() => {
    if (!selected) return;
    const max = Math.min(Number(selected.amount_remaining || 0), Number(poRemaining || 0));
    setAmount(max > 0 ? max : undefined);
  }, [advanceId]);

  const handleSubmit = async () => {
    if (!canApply) {
      toast({
        title: t('common.error', 'Error'),
        description: t(
          'purchase_orders.advance_role_required',
          'Applying supplier advance requires accountant/manager/admin',
        ),
        variant: 'destructive',
      });
      return;
    }
    if (!advanceId || !(Number(amount) > 0)) {
      toast({
        title: t('common.error', 'Error'),
        description: t('purchase_orders.advance_amount_required', 'Select an advance and amount'),
        variant: 'destructive',
      });
      return;
    }
    if (Number(amount) > maxApply + 0.02) {
      toast({
        title: t('common.error', 'Error'),
        description: t('purchase_orders.advance_amount_exceeds', 'Amount exceeds advance or PO remaining'),
        variant: 'destructive',
      });
      return;
    }
    if (!confirmed) {
      toast({
        title: t('common.error', 'Error'),
        description: t('purchase_orders.advance_confirm_required', 'Confirm applying this advance'),
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      await applySupplierAdvanceToPurchaseOrder({
        advance_id: advanceId,
        purchase_order_id: purchaseOrder.id,
        amount: Number(amount),
        confirm: true,
        created_by: profile?.id || null,
      });
      toast({
        title: t('common.success', 'Success'),
        description: t('purchase_orders.advance_applied', 'Supplier advance applied to PO'),
      });
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({
        title: t('common.error', 'Error'),
        description: e?.message || t('purchase_orders.advance_apply_failed', 'Failed to apply advance'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('purchase_orders.apply_advance_title', 'Apply supplier advance')}</DialogTitle>
          <DialogDescription>
            {t(
              'purchase_orders.apply_advance_desc',
              'Select an existing advance for {{supplier}} and apply it to PO {{po}}.',
              { supplier: supplier.name, po: purchaseOrder.po_number },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('purchase_orders.po_remaining', 'PO remaining')}</span>
              <span className="font-medium">{formatMoney(poRemaining, currency as any)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('purchase_orders.available_advances', 'Available advances')}</Label>
            <Select
              value={advanceId}
              onValueChange={setAdvanceId}
              disabled={loadingList || advances.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingList
                      ? t('common.loading', 'Loading...')
                      : advances.length === 0
                        ? t('purchase_orders.no_advances', 'No remaining advances')
                        : t('purchase_orders.select_advance', 'Select advance')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {advances.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {(a.advance_number || a.id).slice(0, 24)} —{' '}
                    {formatMoney(Number(a.amount_remaining || 0), String(a.currency || 'UZS') as any)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <MoneyInput
            id="apply-advance-amount"
            label={t('purchase_orders.apply_amount', 'Amount to apply')}
            value={amount ?? null}
            onValueChange={(val) => setAmount(val ?? undefined)}
            placeholder="0"
            required
          />
          {selected ? (
            <p className="text-xs text-muted-foreground">
              {t('purchase_orders.max_apply', 'Max')}: {formatMoney(maxApply, currency as any)}
            </p>
          ) : null}

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="confirm-apply-advance"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
            />
            <Label htmlFor="confirm-apply-advance" className="text-sm font-normal leading-snug">
              {t(
                'purchase_orders.confirm_apply_advance',
                'I confirm applying this advance to the purchase order',
              )}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={loading || loadingList || advances.length === 0 || !canApply}
          >
            {loading
              ? t('common.saving', 'Saving...')
              : t('purchase_orders.apply_advance_btn', 'Apply advance')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
