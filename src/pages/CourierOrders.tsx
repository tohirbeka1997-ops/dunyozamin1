import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { RefreshCw, Send, Truck } from 'lucide-react';

type CourierOrderRow = {
  id: number;
  order_number: string;
  status: string;
  payment_method?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  delivery_address?: string | null;
  delivery_method?: string | null;
  note?: string | null;
  telegram_id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

function displayCustomer(row: CourierOrderRow): string {
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (row.telegram_id != null) return `TG ${row.telegram_id}`;
  return '-';
}

function extraPhoneFromNote(note?: string | null): string | null {
  const match = String(note || '').match(/^Qo'shimcha telefon:\s*(.+)$/im);
  return match?.[1]?.trim() || null;
}

export default function CourierOrders() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const api = getElectronAPI();
  const [rows, setRows] = useState<CourierOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [dispatchingId, setDispatchingId] = useState<number | null>(null);
  const limit = 100;

  const load = useCallback(async () => {
    if (!api?.webOrders?.list) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await handleIpcResponse<{ data: CourierOrderRow[]; meta?: { total_pages?: number } }>(
        api.webOrders.list({ status: 'ready', delivery_method: 'courier', page, limit }),
      );
      setRows(Array.isArray(res?.data) ? res.data.filter((r) => r.delivery_method !== 'pickup') : []);
      const tp = Number(res?.meta?.total_pages);
      setTotalPages(Number.isFinite(tp) && tp > 0 ? tp : 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('courier.load_error'), description: msg });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api, page, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatchToCourier = async (id: number) => {
    if (!api?.webOrders?.dispatchToCourier) return;
    setDispatchingId(id);
    try {
      await handleIpcResponse(api.webOrders.dispatchToCourier(id));
      toast({ title: t('courier.sent') });
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('courier.send_error'), description: msg });
    } finally {
      setDispatchingId(null);
    }
  };

  if (!api?.webOrders) {
    return (
      <div className="space-y-4">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.courier')}</h1>
          <p className="page-heading-sub">{t('courier.subtitle')}</p>
        </div>
        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="px-4 py-6">
            <p className="text-sm text-muted-foreground">POS API mavjud emas.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.courier')}</h1>
          <p className="page-heading-sub">{t('courier.subtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {t('common.update')}
        </Button>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[88px] whitespace-nowrap">{t('web_orders.order_id')}</TableHead>
                  <TableHead className="min-w-[9rem]">{t('web_orders.customer')}</TableHead>
                  <TableHead className="min-w-[8rem]">{t('web_orders.phone')}</TableHead>
                  <TableHead className="min-w-[14rem]">{t('web_orders.address')}</TableHead>
                  <TableHead className="min-w-[7rem] text-right whitespace-nowrap">{t('web_orders.total')}</TableHead>
                  <TableHead className="min-w-[7rem] whitespace-nowrap">{t('web_orders.payment')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap text-right pr-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin opacity-50" />
                      <span className="text-sm">{t('common.loading')}</span>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-14 text-center">
                      <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                      <p className="text-sm text-muted-foreground">{t('courier.empty')}</p>
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  rows.map((row) => {
                    const extraPhone = extraPhoneFromNote(row.note);
                    return (
                      <TableRow key={row.id} className="group">
                        <TableCell className="font-mono text-xs sm:text-sm">#{row.id}</TableCell>
                        <TableCell className="max-w-[14rem] truncate text-sm">
                          <div className="flex flex-col gap-1">
                            <span>{displayCustomer(row)}</span>
                            <Badge variant="secondary" className="w-fit font-normal">
                              {row.order_number}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex flex-col">
                            <span>{row.phone || '-'}</span>
                            {extraPhone ? <span className="text-xs text-muted-foreground">{extraPhone}</span> : null}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[20rem] truncate text-sm">{row.delivery_address || '-'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatMoneyUZS(Number(row.total_amount || 0))}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground sm:text-sm">
                          {[row.payment_method, row.payment_status].filter(Boolean).join(' / ') || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            disabled={dispatchingId === row.id}
                            onClick={() => void dispatchToCourier(row.id)}
                          >
                            <Send className="h-3.5 w-3.5" />
                            {dispatchingId === row.id ? t('courier.sending') : t('courier.send')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-1">
          <Button type="button" variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ←
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground sm:text-sm">
            {page} / {totalPages}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            →
          </Button>
        </div>
      )}
    </div>
  );
}
