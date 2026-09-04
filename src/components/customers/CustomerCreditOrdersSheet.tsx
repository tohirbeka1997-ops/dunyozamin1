import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate, todayYMD } from '@/lib/datetime';
import {
  listOpenCreditOrders,
  updateOrderDueDate,
  sendCreditReminder,
  applyCustomerAdvanceToOrder,
  type OpenCreditOrderRow,
} from '@/db/customerCredit.api';
import { assertDueDateNotBeforeToday } from '@/lib/posHardening';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, Loader2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName?: string;
  advanceAvailable?: number;
  onUpdated?: () => void;
};

function daysOverdue(dueDate?: string | null) {
  if (!dueDate) return 0;
  const due = String(dueDate).slice(0, 10);
  if (due.length !== 10) return 0;
  const today = todayYMD();
  if (due >= today) return 0;
  const a = new Date(`${due}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function isCreditOrderOverdue(dueDate?: string | null) {
  if (!dueDate) return false;
  const due = String(dueDate).slice(0, 10);
  return due.length === 10 && due < todayYMD();
}

export default function CustomerCreditOrdersSheet({
  open,
  onOpenChange,
  customerId,
  customerName,
  advanceAvailable = 0,
  onUpdated,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const canEditDue = profile?.role === 'admin' || profile?.role === 'manager';
  const [rows, setRows] = useState<OpenCreditOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingDueDateId, setSavingDueDateId] = useState<string | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [draftDue, setDraftDue] = useState<Record<string, string>>({});
  const [dueReason, setDueReason] = useState<Record<string, string>>({});
  const [confirmReminderOpen, setConfirmReminderOpen] = useState(false);
  const [applyingAdvanceId, setApplyingAdvanceId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listOpenCreditOrders({ customerId, limit: 100 });
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      const drafts: Record<string, string> = {};
      for (const row of list) {
        drafts[row.id] = row.due_date ? String(row.due_date).slice(0, 10) : '';
      }
      setDraftDue(drafts);
    } catch (error) {
      console.error('Failed to load open credit orders:', error);
      setRows([]);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('customers.credit_orders_loading'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [customerId, t, toast]);

  useEffect(() => {
    if (open) void loadRows();
  }, [open, loadRows]);

  const handleSaveDueDate = async (row: OpenCreditOrderRow) => {
    const dueDate = (draftDue[row.id] || '').trim();
    const reason = (dueReason[row.id] || '').trim();
    if (!dueDate) {
      toast({
        title: t('common.error'),
        description: t('customers.credit_due_date'),
        variant: 'destructive',
      });
      return;
    }
    const gate = assertDueDateNotBeforeToday(dueDate, todayYMD());
    if (!gate.ok) {
      toast({
        title: t('common.error'),
        description: gate.error,
        variant: 'destructive',
      });
      return;
    }
    if (!reason) {
      toast({
        title: t('common.error'),
        description: t('customers.credit_due_reason_required'),
        variant: 'destructive',
      });
      return;
    }
    setSavingDueDateId(row.id);
    try {
      const out = await updateOrderDueDate({
        orderId: row.id,
        dueDate: gate.due_date,
        reason,
        actorUserId: profile?.id || null,
      });
      if (!out.ok) {
        throw new Error(out.error || t('customers.credit_due_save_failed'));
      }
      toast({
        title: t('customers.credit_due_saved'),
        description: row.order_number,
      });
      setDueReason((prev) => ({ ...prev, [row.id]: '' }));
      await loadRows();
      onUpdated?.();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('customers.credit_due_save_failed'),
        variant: 'destructive',
      });
    } finally {
      setSavingDueDateId(null);
    }
  };

  const handleApplyAdvance = async (row: OpenCreditOrderRow) => {
    const remaining = Number(row.credit_amount || 0) || 0;
    const amt = Math.min(remaining, Number(advanceAvailable) || 0);
    if (!(amt > 0)) {
      toast({
        title: t('common.error'),
        description: 'Qo‘llash uchun avans yoki ochiq qarz yo‘q',
        variant: 'destructive',
      });
      return;
    }
    setApplyingAdvanceId(row.id);
    try {
      const out = await applyCustomerAdvanceToOrder({
        customerId,
        orderId: row.id,
        amount: amt,
        receivedBy: profile?.id || null,
        notes: `Avans ${row.order_number} ga qo‘llandi`,
      });
      if (!out.success) throw new Error(out.error || 'Avansni qo‘llab bo‘lmadi');
      toast({ title: 'Avans qo‘llandi', description: formatMoneyUZS(out.applied_amount || amt) });
      await loadRows();
      onUpdated?.();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : 'Avansni qo‘llab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setApplyingAdvanceId(null);
    }
  };

  const handleSendCreditReminder = async () => {
    setSendingReminder(true);
    try {
      const out = await sendCreditReminder({ customerId });
      if (out.ok) {
        toast({
          title: t('customers.credit_reminder_sent'),
          description: out.channel || '',
        });
      } else {
        toast({
          title: t('customers.credit_reminder_failed'),
          description: out.error || t('customers.credit_reminder_failed_hint'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: t('customers.credit_reminder_error'),
        description: error instanceof Error ? error.message : t('customers.credit_reminder_failed'),
        variant: 'destructive',
      });
    } finally {
      setSendingReminder(false);
      setConfirmReminderOpen(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-[min(100vw,34rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[34rem]">
          <SheetHeader className="shrink-0 border-b px-5 pb-4 pr-12 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <SheetTitle>{t('customers.credit_orders_title')}</SheetTitle>
                <SheetDescription>
                  {customerName
                    ? t('customers.credit_orders_sheet_for', { name: customerName })
                    : t('customers.credit_orders_sheet_desc')}
                </SheetDescription>
              </div>
              {rows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={sendingReminder}
                  onClick={() => setConfirmReminderOpen(true)}
                >
                  {sendingReminder ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Bell className="mr-2 h-4 w-4" />
                  )}
                  {t('customers.credit_send_reminder')}
                </Button>
              )}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('customers.credit_orders_loading')}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('customers.credit_orders_empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => {
                  const overdue = isCreditOrderOverdue(row.due_date);
                  const savedDue = row.due_date ? String(row.due_date).slice(0, 10) : '';
                  const draft = draftDue[row.id] ?? savedDue;
                  const dirty = draft !== savedDue;
                  const overdueDays = daysOverdue(row.due_date);
                  const paid = Number(row.paid_amount || 0) || 0;
                  const total = Number(row.total_amount || 0) || 0;
                  const remaining = Number(row.credit_amount || 0) || 0;
                  return (
                    <div
                      key={row.id}
                      className={`rounded-lg border p-3 space-y-2 ${overdue ? 'border-destructive/50 bg-destructive/5' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{row.order_number}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(row.created_at)}</p>
                        </div>
                        <div className="text-right space-y-0.5">
                          <p className="text-xs text-muted-foreground">
                            Jami {formatMoneyUZS(total)} · To‘langan {formatMoneyUZS(paid)}
                          </p>
                          <p className="text-sm text-muted-foreground">{t('customers.credit_remaining')}</p>
                          <p className="font-semibold tabular-nums text-destructive">
                            {formatMoneyUZS(remaining)}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Muddat:{' '}
                        {savedDue ? savedDue : 'Muddat belgilanmagan'}
                        {overdueDays > 0 ? ` · ${overdueDays} kun kechikkan` : ''}
                      </p>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex-1 min-w-[10rem] space-y-1">
                            <Label htmlFor={`credit-due-${row.id}`} className="text-xs">
                              {t('customers.credit_due_date')}
                            </Label>
                            <Input
                              id={`credit-due-${row.id}`}
                              type="date"
                              value={draft}
                              disabled={!canEditDue || savingDueDateId === row.id}
                              min={todayYMD()}
                              onChange={(e) =>
                                setDraftDue((prev) => ({ ...prev, [row.id]: e.target.value }))
                              }
                            />
                          </div>
                          {overdue && (
                            <Badge variant="destructive">{t('customers.credit_due_overdue')}</Badge>
                          )}
                        </div>
                        {canEditDue && dirty && (
                          <>
                            <div className="space-y-1">
                              <Label htmlFor={`credit-due-reason-${row.id}`} className="text-xs">
                                {t('customers.credit_due_reason')} *
                              </Label>
                              <Textarea
                                id={`credit-due-reason-${row.id}`}
                                rows={2}
                                value={dueReason[row.id] || ''}
                                onChange={(e) =>
                                  setDueReason((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                placeholder={t('customers.credit_due_reason')}
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={savingDueDateId === row.id || !(dueReason[row.id] || '').trim()}
                              onClick={() => void handleSaveDueDate(row)}
                            >
                              {savingDueDateId === row.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              {t('customers.credit_due_save')}
                            </Button>
                          </>
                        )}
                      </div>
                      {row.credit_reminder_note ? (
                        <p className="text-xs text-muted-foreground">{row.credit_reminder_note}</p>
                      ) : null}
                      {advanceAvailable > 0.009 && remaining > 0.009 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={applyingAdvanceId === row.id}
                          onClick={() => void handleApplyAdvance(row)}
                        >
                          {applyingAdvanceId === row.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Avansni shu buyurtmaga qo‘llash
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmReminderOpen} onOpenChange={setConfirmReminderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('customers.credit_reminder_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('customers.credit_reminder_confirm_body', {
                name: customerName || customerId,
                count: rows.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendingReminder}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sendingReminder}
              onClick={(e) => {
                e.preventDefault();
                void handleSendCreditReminder();
              }}
            >
              {t('customers.credit_send_reminder')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
