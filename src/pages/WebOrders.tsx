import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';
import { Eye, RefreshCw, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Label } from '@/components/ui/label';

const WEB_ORDER_STATUSES = ['new', 'paid', 'processing', 'ready', 'delivered', 'cancelled'] as const;

type WebOrderStatus = (typeof WEB_ORDER_STATUSES)[number];

type WebOrderRow = {
  id: number;
  order_number: string;
  status: string;
  payment_method?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  created_at?: string | null;
  delivery_address?: string | null;
  note?: string | null;
  telegram_id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

type WebOrderItem = {
  id: number;
  product_id: string;
  quantity: number;
  price_at_order: number;
  product_name?: string | null;
  sku?: string | null;
};

type WebOrderDetail = WebOrderRow & { items?: WebOrderItem[]; customer_address?: string | null };

function displayCustomer(row: WebOrderRow): string {
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (row.telegram_id != null) return `TG ${row.telegram_id}`;
  return '—';
}

export default function WebOrders() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const api = getElectronAPI();

  const [rows, setRows] = useState<WebOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<WebOrderDetail | null>(null);
  const [pendingStatus, setPendingStatus] = useState<WebOrderStatus>('new');
  const [savingStatus, setSavingStatus] = useState(false);

  const limit = 50;

  const load = useCallback(async () => {
    if (!api?.webOrders?.list) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit };
      if (statusFilter !== 'all') filters.status = statusFilter;
      const res = await handleIpcResponse<{ data: WebOrderRow[]; meta: { total_pages?: number } }>(
        api.webOrders.list(filters),
      );
      setRows(Array.isArray(res?.data) ? res.data : []);
      const tp = Number(res?.meta?.total_pages);
      setTotalPages(Number.isFinite(tp) && tp > 0 ? tp : 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('web_orders.load_error'), description: msg });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, statusFilter, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: number) => {
    if (!api?.webOrders?.get) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const row = await handleIpcResponse<WebOrderDetail | null>(api.webOrders.get(id));
      setDetail(row);
      const st = (row?.status || 'new') as WebOrderStatus;
      setPendingStatus(WEB_ORDER_STATUSES.includes(st) ? st : 'new');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('web_orders.load_error'), description: msg });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveStatus = async () => {
    if (!api?.webOrders?.updateStatus || !detail?.id) return;
    setSavingStatus(true);
    try {
      const updated = await handleIpcResponse<WebOrderDetail>(api.webOrders.updateStatus(detail.id, pendingStatus));
      setDetail(updated);
      toast({ title: t('web_orders.status_updated') });
      void load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    } finally {
      setSavingStatus(false);
    }
  };

  const statusLabel = (s: string) => {
    const key = `web_orders.status_${s}` as const;
    const tr = t(key);
    return tr === key ? s : tr;
  };

  const canImportToPos = (status: string | undefined) => {
    const s = String(status || '');
    return s !== 'cancelled' && s !== 'delivered';
  };

  if (!api?.webOrders) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('navigation.web_online_orders')}</CardTitle>
            <CardDescription>{t('web_orders.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">POS API (posApi.webOrders) mavjud emas.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('navigation.web_online_orders')}</h1>
          <p className="text-muted-foreground text-sm">{t('web_orders.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setPage(1);
              setStatusFilter(v);
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('web_orders.filter_status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('web_orders.all')}</SelectItem>
              {WEB_ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">{t('web_orders.order_id')}</TableHead>
                <TableHead>{t('web_orders.created')}</TableHead>
                <TableHead>{t('web_orders.customer')}</TableHead>
                <TableHead>{t('web_orders.phone')}</TableHead>
                <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                <TableHead>{t('web_orders.payment')}</TableHead>
                <TableHead>{t('web_orders.status')}</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    …
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    {t('web_orders.empty')}
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">#{r.id}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.created_at ? formatOrderDateTime(r.created_at) : '—'}
                    </TableCell>
                    <TableCell>{displayCustomer(r)}</TableCell>
                    <TableCell className="text-sm">{r.phone || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoneyUZS(Number(r.total_amount || 0))}</TableCell>
                    <TableCell className="text-sm">
                      {[r.payment_method, r.payment_status].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{statusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void openDetail(r.id)}>
                        <Eye className="h-4 w-4 mr-1" />
                        {t('orders.view_details')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ←
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </Button>
        </div>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('web_orders.detail_title')}</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="text-sm text-muted-foreground py-4">…</p>}
          {!detailLoading && detail && (
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">ID</span>
                    <p className="font-mono">#{detail.id}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('orders.order_number')}</span>
                    <p>{detail.order_number}</p>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.created')}</span>
                  <p>{detail.created_at ? formatOrderDateTime(detail.created_at) : '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.customer')}</span>
                  <p>{displayCustomer(detail)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.phone')}</span>
                  <p>{detail.phone || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.total')}</span>
                  <p className="tabular-nums font-medium">{formatMoneyUZS(Number(detail.total_amount || 0))}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.payment')}</span>
                  <p>{[detail.payment_method, detail.payment_status].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.address')}</span>
                  <p className="whitespace-pre-wrap">{detail.delivery_address || detail.customer_address || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.note')}</span>
                  <p className="whitespace-pre-wrap">{detail.note || '—'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('web_orders.status')}</Label>
                  <Select value={pendingStatus} onValueChange={(v) => setPendingStatus(v as WebOrderStatus)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEB_ORDER_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {statusLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">{t('web_orders.items')}</span>
                  <ul className="mt-2 border rounded-md divide-y">
                    {(detail.items || []).length === 0 && (
                      <li className="p-2 text-muted-foreground">—</li>
                    )}
                    {(detail.items || []).map((it) => (
                      <li key={it.id} className="p-2 flex justify-between gap-2">
                        <span className="min-w-0 flex-1">
                          {it.product_name || it.product_id}
                          {it.sku ? <span className="text-muted-foreground ml-1">({it.sku})</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          ×{it.quantity} {formatMoneyUZS(it.price_at_order)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={detailLoading || !detail || !canImportToPos(detail.status)}
              onClick={() => {
                if (!detail) return;
                navigate('/pos', { state: { importWebOrderId: detail.id } });
                setDetailOpen(false);
              }}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              {t('web_orders.import_to_pos')}
            </Button>
            <div className="flex w-full sm:w-auto gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>
                {t('common.close')}
              </Button>
              <Button
                type="button"
                onClick={() => void saveStatus()}
                disabled={savingStatus || detailLoading || !detail || pendingStatus === detail.status}
              >
                {t('web_orders.save_status')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
