import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';
import { Eye, Printer, RefreshCw, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { printHtml } from '@/lib/print';

const WEB_ORDER_STATUSES = ['new', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
const DELIVERY_METHODS = ['courier', 'pickup'] as const;

type WebOrderStatus = (typeof WEB_ORDER_STATUSES)[number];
type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

type WebOrderRow = {
  id: number;
  order_number: string;
  status: string;
  payment_method?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  created_at?: string | null;
  delivery_address?: string | null;
  delivery_method?: string | null;
  note?: string | null;
  rating?: number | null;
  feedback?: string | null;
  rated_at?: string | null;
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

function customerNameValue(row?: WebOrderRow | null): string {
  return [row?.first_name, row?.last_name].filter(Boolean).join(' ');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeDeliveryMethod(raw?: string | null): DeliveryMethod {
  return raw === 'pickup' ? 'pickup' : 'courier';
}

function normalizeWebOrderStatus(raw?: string | null): WebOrderStatus {
  const status = String(raw || 'new').toLowerCase();
  return WEB_ORDER_STATUSES.includes(status as WebOrderStatus) ? (status as WebOrderStatus) : 'new';
}

function allowedNextStatuses(status: string | undefined, deliveryMethod: DeliveryMethod): WebOrderStatus[] {
  const s = String(status || '').toLowerCase();
  if (s === 'new' || s === 'paid') return ['processing', 'cancelled'];
  if (s === 'processing') return ['ready', 'cancelled'];
  if (s === 'ready') return deliveryMethod === 'pickup' ? ['delivered', 'cancelled'] : ['out_for_delivery', 'cancelled'];
  if (s === 'out_for_delivery') return ['delivered', 'cancelled'];
  return [];
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
  const [editingDeliveryMethod, setEditingDeliveryMethod] = useState<DeliveryMethod>('courier');
  const [editingCustomerName, setEditingCustomerName] = useState('');
  const [editingPhone, setEditingPhone] = useState('');
  const [editingAddress, setEditingAddress] = useState('');
  const [editingNote, setEditingNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const limit = 50;
  const emitPendingWebOrdersCount = useCallback((count: number) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('pos:web-orders-pending-count', {
        detail: { count: Math.max(0, Number(count) || 0) },
      })
    );
  }, []);

  const refreshPendingCount = useCallback(async () => {
    if (!api?.webOrders?.list) return;
    try {
      const res = await handleIpcResponse<{ meta?: { total?: number } }>(
        api.webOrders.list({ status: 'new', page: 1, limit: 1 })
      );
      const total = Number(res?.meta?.total ?? 0);
      emitPendingWebOrdersCount(total);
    } catch {
      // non-blocking: pending badge will be corrected by layout polling
    }
  }, [api, emitPendingWebOrdersCount]);

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

  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  const openDetail = async (id: number) => {
    if (!api?.webOrders?.get) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const row = await handleIpcResponse<WebOrderDetail | null>(api.webOrders.get(id));
      setDetail(row);
      const st = normalizeWebOrderStatus(row?.status);
      setPendingStatus(st);
      setEditingDeliveryMethod(normalizeDeliveryMethod(row?.delivery_method));
      setEditingCustomerName(customerNameValue(row));
      setEditingPhone(String(row?.phone || ''));
      setEditingAddress(String(row?.delivery_address || row?.customer_address || ''));
      setEditingNote(String(row?.note || ''));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('web_orders.load_error'), description: msg });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveEditableFields = async () => {
    if (!detail?.id) return;
    const customerNameChanged = editingCustomerName.trim() !== customerNameValue(detail).trim();
    const phoneChanged = editingPhone.trim() !== String(detail.phone || '').trim();
    const addressChanged = editingAddress.trim() !== String(detail.delivery_address || detail.customer_address || '').trim();
    const noteChanged = editingNote.trim() !== String(detail.note || '').trim();
    const deliveryMethodChanged = editingDeliveryMethod !== normalizeDeliveryMethod(detail.delivery_method);
    const currentStatus = normalizeWebOrderStatus(detail.status);
    const statusChanged = pendingStatus !== currentStatus;
    if (!customerNameChanged && !phoneChanged && !addressChanged && !noteChanged && !deliveryMethodChanged && !statusChanged) return;
    setSavingEdit(true);
    try {
      let updated = detail;
      if ((customerNameChanged || phoneChanged || addressChanged || noteChanged || deliveryMethodChanged) && api?.webOrders?.update) {
        const nameParts = editingCustomerName.trim().split(/\s+/).filter(Boolean);
        updated = await handleIpcResponse<WebOrderDetail>(
          api.webOrders.update(detail.id, {
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' '),
            phone: editingPhone,
            delivery_address: editingAddress,
            delivery_method: editingDeliveryMethod,
            note: editingNote,
          }),
        );
      }
      if (statusChanged && api?.webOrders?.updateStatus) {
        updated = await handleIpcResponse<WebOrderDetail>(api.webOrders.updateStatus(detail.id, pendingStatus));
      }
      setDetail(updated);
      setPendingStatus(normalizeWebOrderStatus(updated.status || pendingStatus));
      setEditingDeliveryMethod(normalizeDeliveryMethod(updated.delivery_method));
      setEditingCustomerName(customerNameValue(updated));
      setEditingPhone(String(updated.phone || ''));
      setEditingAddress(String(updated.delivery_address || updated.customer_address || ''));
      setEditingNote(String(updated.note || ''));
      toast({ title: t('common.saved') });
      void load();
      void refreshPendingCount();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    } finally {
      setSavingEdit(false);
    }
  };

  const cancelOrder = async () => {
    if (!api?.webOrders?.cancel || !detail?.id) return;
    setCancelling(true);
    try {
      const updated = await handleIpcResponse<WebOrderDetail>(api.webOrders.cancel(detail.id));
      setDetail(updated);
      setPendingStatus('cancelled');
      toast({ title: t('navigation.web_online_orders'), description: t('web_orders.cancelled_toast', 'Buyurtma bekor qilindi.') });
      void load();
      void refreshPendingCount();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: t('common.error'), description: msg });
    } finally {
      setCancelling(false);
    }
  };

  const printPickingList = () => {
    if (!detail) return;
    const customer = escapeHtml(editingCustomerName.trim() || displayCustomer(detail));
    const phone = escapeHtml(editingPhone || detail.phone || '');
    const address = escapeHtml(editingAddress || detail.delivery_address || detail.customer_address || '');
    const items = (detail.items || [])
      .map((it, index) => {
        const name = escapeHtml(it.product_name || it.product_id);
        const sku = it.sku ? ` <span class="muted">(${escapeHtml(it.sku)})</span>` : '';
        return `<tr><td>${index + 1}</td><td>${name}${sku}</td><td class="right">x${escapeHtml(it.quantity)}</td></tr>`;
      })
      .join('');
    printHtml(
      `Yig'ish varaqasi ${detail.order_number}`,
      `
        <div style="padding:16px;font-family:Arial,sans-serif;color:#111">
          <h2 style="margin:0 0 8px">Yig'ish varaqasi</h2>
          <div style="font-size:13px;line-height:1.5">
            <div><b>Buyurtma:</b> ${escapeHtml(detail.order_number)} (#${escapeHtml(detail.id)})</div>
            <div><b>Mijoz:</b> ${customer}</div>
            <div><b>Telefon:</b> ${phone || '-'}</div>
            <div><b>Manzil:</b> ${address || '-'}</div>
            <div><b>Izoh:</b> ${escapeHtml(editingNote || detail.note || '-')}</div>
          </div>
          <hr style="margin:12px 0;border:0;border-top:1px solid #999" />
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr><th style="text-align:left;width:28px">#</th><th style="text-align:left">Mahsulot</th><th style="text-align:right">Miqdor</th></tr>
            </thead>
            <tbody>${items || '<tr><td colspan="3">Mahsulot yo‘q</td></tr>'}</tbody>
          </table>
          <style>
            td, th { padding: 6px 0; border-bottom: 1px solid #ddd; vertical-align: top; }
            .right { text-align: right; white-space: nowrap; }
            .muted { color: #555; font-size: 11px; }
          </style>
        </div>
      `,
      'A4',
    );
  };

  const statusLabel = (s: string) => {
    const key = `web_orders.status_${s}` as const;
    const tr = t(key);
    return tr === key ? s : tr;
  };

  const deliveryMethodLabel = (method?: string | null) => {
    return normalizeDeliveryMethod(method) === 'pickup' ? "O'zi olib ketish" : 'Kuryer';
  };

  const canImportToPos = (status: string | undefined) => {
    const s = String(status || '').toLowerCase();
    return s !== 'cancelled' && s !== 'delivered';
  };

  const detailStatus = detail ? normalizeWebOrderStatus(detail.status) : 'new';
  const isSoldOrder = detailStatus === 'delivered';
  const detailCustomerNameChanged = !!detail && editingCustomerName.trim() !== customerNameValue(detail).trim();
  const detailPhoneChanged = !!detail && editingPhone.trim() !== String(detail.phone || '').trim();
  const detailAddressChanged = !!detail && editingAddress.trim() !== String(detail.delivery_address || detail.customer_address || '').trim();
  const detailNoteChanged = !!detail && editingNote.trim() !== String(detail.note || '').trim();
  const detailDeliveryMethodChanged = !!detail && editingDeliveryMethod !== normalizeDeliveryMethod(detail.delivery_method);
  const detailStatusChanged = !!detail && pendingStatus !== detailStatus;
  const hasDetailChanges =
    detailCustomerNameChanged ||
    detailPhoneChanged ||
    detailAddressChanged ||
    detailNoteChanged ||
    detailDeliveryMethodChanged ||
    detailStatusChanged;
  const statusOptions = WEB_ORDER_STATUSES.slice();

  if (!api?.webOrders) {
    return (
      <div className="space-y-4">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.web_online_orders')}</h1>
          <p className="page-heading-sub">{t('web_orders.subtitle')}</p>
        </div>
        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="px-4 py-6">
            <p className="text-sm text-muted-foreground">
              POS API (`posApi.webOrders`) mavjud emas — bu sahifa faqat Electron yoki to‘liq POS API bilan ishlaydi.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.web_online_orders')}</h1>
          <p className="page-heading-sub">{t('web_orders.subtitle')}</p>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('products.filters')}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-[10rem] max-w-full flex-1 sm:max-w-[16rem]">
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setPage(1);
                    setStatusFilter(v);
                  }}
                >
                  <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
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
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                {t('common.update')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[88px] whitespace-nowrap">{t('web_orders.order_id')}</TableHead>
                  <TableHead className="min-w-[9rem] whitespace-nowrap">{t('web_orders.created')}</TableHead>
                  <TableHead className="min-w-[8rem]">{t('web_orders.customer')}</TableHead>
                  <TableHead className="min-w-[7rem]">{t('web_orders.phone')}</TableHead>
                  <TableHead className="min-w-[7rem] text-right whitespace-nowrap">{t('web_orders.total')}</TableHead>
                  <TableHead className="min-w-[8rem]">{t('web_orders.payment')}</TableHead>
                  <TableHead className="min-w-[7rem]">{t('web_orders.delivery_method', 'Yetkazish')}</TableHead>
                  <TableHead className="min-w-[7rem] whitespace-nowrap">{t('web_orders.status')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap text-right pr-3" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin opacity-50" />
                      <span className="text-sm">{t('common.loading')}</span>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-14 text-center">
                      <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                      <p className="text-sm text-muted-foreground">{t('web_orders.empty')}</p>
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  rows.map((r) => (
                    <TableRow key={r.id} className="group">
                      <TableCell className="font-mono text-xs sm:text-sm">#{r.id}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs sm:text-sm">
                        {r.created_at ? formatOrderDateTime(r.created_at) : '—'}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm">{displayCustomer(r)}</TableCell>
                      <TableCell className="text-sm">{r.phone || '—'}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatMoneyUZS(Number(r.total_amount || 0))}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground sm:text-sm">
                        {[r.payment_method, r.payment_status].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground sm:text-sm">
                        {deliveryMethodLabel(r.delivery_method)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {statusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void openDetail(r.id)}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          {t('orders.view_details')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[94vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{t('web_orders.detail_title')}</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="px-6 py-4 text-sm text-muted-foreground">…</p>}
          {!detailLoading && detail && (
            <ScrollArea className="h-0 min-h-0 flex-1 px-6 pr-5">
              <div className="space-y-2 pb-5 pt-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/20 p-3 sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">ID</span>
                    <p className="font-mono">#{detail.id}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('orders.order_number')}</span>
                    <p>{detail.order_number}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('web_orders.created')}</span>
                    <p>{detail.created_at ? formatOrderDateTime(detail.created_at) : '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('web_orders.total')}</span>
                    <p className="tabular-nums font-medium">{formatMoneyUZS(Number(detail.total_amount || 0))}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-muted-foreground">{t('web_orders.payment')}</span>
                    <p>{[detail.payment_method, detail.payment_status].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">{t('web_orders.customer')}</Label>
                  <Input
                    className="mt-1 h-9"
                    value={editingCustomerName}
                    onChange={(e) => setEditingCustomerName(e.target.value)}
                    placeholder={displayCustomer(detail)}
                    disabled={savingEdit}
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('web_orders.phone')}</Label>
                  <Input
                    className="mt-1 h-9"
                    value={editingPhone}
                    onChange={(e) => setEditingPhone(e.target.value)}
                    placeholder={detail.phone || '+998'}
                    disabled={savingEdit}
                  />
                </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">{t('web_orders.delivery_method', 'Yetkazish usuli')}</Label>
                  <Select
                    value={editingDeliveryMethod}
                    onValueChange={(v) => {
                      const next = normalizeDeliveryMethod(v);
                      setEditingDeliveryMethod(next);
                      if (next === 'pickup' && !editingAddress.trim()) {
                        setEditingAddress("O'zi olib ketish");
                      }
                    }}
                    disabled={savingEdit}
                  >
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="courier">{t('web_orders.delivery_courier', 'Kuryer')}</SelectItem>
                      <SelectItem value="pickup">{t('web_orders.delivery_pickup', "O'zi olib ketish")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {editingDeliveryMethod === 'pickup' ? t('web_orders.pickup_note', 'Olib ketish izohi') : t('web_orders.address')}
                  </span>
                  <Input
                    className="mt-1 h-9"
                    value={editingAddress}
                    onChange={(e) => setEditingAddress(e.target.value)}
                    placeholder={String(detail.customer_address || '')}
                    disabled={savingEdit}
                  />
                </div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('web_orders.note')}</span>
                  <Textarea
                    className="mt-1 min-h-[58px]"
                    value={editingNote}
                    onChange={(e) => setEditingNote(e.target.value)}
                    disabled={savingEdit}
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('web_orders.status')}</Label>
                  {allowedNextStatuses(detailStatus, editingDeliveryMethod).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {allowedNextStatuses(detailStatus, editingDeliveryMethod).map((s) => (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={s === 'cancelled' ? 'destructive' : 'secondary'}
                          onClick={() => setPendingStatus(s)}
                        >
                          {statusLabel(s)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <Select value={pendingStatus} onValueChange={(v) => setPendingStatus(v as WebOrderStatus)} disabled={savingEdit}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {statusLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {detail.rating != null && Number(detail.rating) > 0 ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <span className="text-muted-foreground">{t('web_orders.customer_rating', 'Mijoz bahosi')}</span>
                    <p className="mt-1 font-medium">{detail.rating} / 5</p>
                    {detail.feedback ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{detail.feedback}</p> : null}
                  </div>
                ) : null}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground font-medium">{t('web_orders.items')}</span>
                    <Badge variant="secondary" className="font-normal">
                      {(detail.items || []).length} ta mahsulot
                    </Badge>
                  </div>
                  <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border divide-y">
                    {(detail.items || []).length === 0 && (
                      <li className="p-2 text-muted-foreground">—</li>
                    )}
                    {(detail.items || []).map((it) => (
                      <li key={it.id} className="p-2 flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 break-words">
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
          <div className="shrink-0 border-t bg-background px-6 py-4">
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={detailLoading || !detail}
                onClick={printPickingList}
              >
                <Printer className="h-4 w-4 mr-2" />
                Chop etish
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={detailLoading || !detail || !canImportToPos(detailStatus)}
                onClick={() => {
                  if (!detail) return;
                  navigate('/pos', { state: { importWebOrderId: detail.id } });
                  setDetailOpen(false);
                }}
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                {isSoldOrder ? 'Sotilgan' : t('web_orders.import_to_pos')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={() => void cancelOrder()}
                disabled={cancelling || savingEdit || detailLoading || !detail || detailStatus === 'cancelled' || detailStatus === 'delivered'}
              >
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setDetailOpen(false)}>
                {t('common.close')}
              </Button>
              <Button
                type="button"
                className="w-full"
                onClick={() => void saveEditableFields()}
                disabled={
                  savingEdit ||
                  detailLoading ||
                  !detail ||
                  !hasDetailChanges
                }
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
