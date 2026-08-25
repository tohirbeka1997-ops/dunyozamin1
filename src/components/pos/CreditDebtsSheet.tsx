import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import {
  listOpenCreditOrders,
  updateOrderDueDate,
  type OpenCreditOrderRow,
} from '@/db/customerCredit.api';
import { Loader2 } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string | null;
};

function formatDueDateLabel(value?: string | null) {
  if (!value) return '—';
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

export default function CreditDebtsSheet({ open, onOpenChange, customerId }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<OpenCreditOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [draftDates, setDraftDates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listOpenCreditOrders({
        customerId: customerId || undefined,
        limit: 100,
      });
      setRows(Array.isArray(data) ? data : []);
      const nextDraft: Record<string, string> = {};
      for (const row of data || []) {
        if (row.due_date) nextDraft[row.id] = String(row.due_date).slice(0, 10);
      }
      setDraftDates(nextDraft);
    } catch (e) {
      toast({
        title: 'Qarzlar ro\'yxati',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, toast]);

  useEffect(() => {
    if (open) void loadRows();
  }, [open, loadRows]);

  const handleSave = async (row: OpenCreditOrderRow) => {
    const dueDate = draftDates[row.id]?.trim();
    if (!dueDate) {
      toast({
        title: 'Sana kerak',
        description: 'Qarz qaytarish sanasini tanlang.',
        variant: 'destructive',
      });
      return;
    }
    setSavingId(row.id);
    try {
      const out = await updateOrderDueDate({ orderId: row.id, dueDate });
      if (!out.ok) {
        throw new Error(out.error || 'Saqlab bo\'lmadi');
      }
      toast({ title: 'Sana saqlandi', description: row.order_number });
      await loadRows();
    } catch (e) {
      toast({
        title: 'Xatolik',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[min(100vw,34rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[34rem]">
        <SheetHeader className="shrink-0 border-b px-5 pb-4 pr-12 pt-5">
          <SheetTitle>Qarzlar (nasiya)</SheetTitle>
          <SheetDescription>
            Ochiq nasiya buyurtmalar va qarz qaytarish sanasi.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Yuklanmoqda...
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Ochiq nasiya buyurtma yo‘q.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border p-3 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.order_number}</p>
                      <p className="text-muted-foreground">{row.customer_name || '—'}</p>
                    </div>
                    <p className="font-semibold tabular-nums text-destructive">
                      {formatMoneyUZS(Number(row.credit_amount || 0))}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Joriy muddat: {formatDueDateLabel(row.due_date)}
                  </div>
                  {row.credit_reminder_note ? (
                    <p className="text-xs text-muted-foreground italic">
                      {row.credit_reminder_note}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor={`due-${row.id}`} className="text-xs">
                      Qarz qaytarish sanasi
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`due-${row.id}`}
                        type="date"
                        value={draftDates[row.id] || ''}
                        onChange={(e) =>
                          setDraftDates((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={savingId === row.id}
                        onClick={() => void handleSave(row)}
                      >
                        {savingId === row.id ? '...' : 'Saqlash'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
