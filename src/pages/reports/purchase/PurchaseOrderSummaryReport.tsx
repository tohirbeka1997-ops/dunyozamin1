import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPurchaseOrders } from '@/db/api';
import type { PurchaseOrderWithDetails } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  aggregatePurchaseOrders,
  calculatePoReceivedAmountUzs,
  calculatePoReceivedDocAmount,
  formatMoneyUZS,
  formatPoMoney,
  getPoPaidAmount,
  getPoRemainingAmountSigned,
  getPoLedgerCurrency,
} from '@/lib/format';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatDate, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type PoSortKey =
  | 'po_number'
  | 'supplier'
  | 'order_date'
  | 'ordered'
  | 'received'
  | 'paid'
  | 'debt'
  | 'status';

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function PurchaseOrderSummaryReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [orders, setOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const loadGenRef = useRef(0);
  const { sortKey, sortOrder, toggleSort } = useTableSort<PoSortKey>('order_date', 'desc');

  const loadData = useCallback(async () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast({
        title: t('reports.po_summary_page.errors.invalid_range_title', 'Sana oralig‘i'),
        description: t(
          'reports.po_summary_page.errors.invalid_range',
          'Boshlanish tugashdan keyin edi — sanalar almashtirildi.'
        ),
      });
      setDateFrom(dateTo);
      setDateTo(dateFrom);
      return;
    }

    const gen = ++loadGenRef.current;
    try {
      setLoading(true);
      const ordersData = await getPurchaseOrders({
        date_from: dateFrom,
        date_to: dateTo,
        include_items: true,
      });
      if (gen !== loadGenRef.current) return;
      setOrders(ordersData || []);
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t(
          'reports.po_summary_page.errors.load_failed',
          "Xarid buyurtmalari hisobotini yuklab bo'lmadi"
        )}${msg ? ` (${msg})` : ''}`,
        variant: 'destructive',
      });
      setOrders([]);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo, toast, t]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const poTotals = useMemo(() => aggregatePurchaseOrders(orders), [orders]);

  const sorted = useMemo(() => {
    const list = [...orders];
    list.sort((a, b) => {
      const remA = getPoRemainingAmountSigned(a as any);
      const remB = getPoRemainingAmountSigned(b as any);
      switch (sortKey) {
        case 'po_number':
          return compareScalar(a.po_number || '', b.po_number || '', sortOrder);
        case 'supplier':
          return compareScalar(
            (a.supplier?.name || a.supplier_name || '').toLowerCase(),
            (b.supplier?.name || b.supplier_name || '').toLowerCase(),
            sortOrder
          );
        case 'order_date':
          return compareScalar(a.order_date || '', b.order_date || '', sortOrder);
        case 'ordered':
          return compareScalar(
            Number((a as any).total_usd ?? a.total_amount ?? 0),
            Number((b as any).total_usd ?? b.total_amount ?? 0),
            sortOrder
          );
        case 'received':
          return compareScalar(
            calculatePoReceivedDocAmount(a as any, a.items || []),
            calculatePoReceivedDocAmount(b as any, b.items || []),
            sortOrder
          );
        case 'paid':
          return compareScalar(getPoPaidAmount(a as any), getPoPaidAmount(b as any), sortOrder);
        case 'debt':
          return compareScalar(remA, remB, sortOrder);
        case 'status':
          return compareScalar(a.status || '', b.status || '', sortOrder);
        default:
          return 0;
      }
    });
    return list;
  }, [orders, sortKey, sortOrder]);

  const getStatusBadge = (status: string) => {
    const map: Record<string, { labelKey: string; fallback: string; className: string }> = {
      draft: {
        labelKey: 'reports.po_summary_page.status.draft',
        fallback: 'Qoralama',
        className: 'bg-muted text-muted-foreground',
      },
      approved: {
        labelKey: 'reports.po_summary_page.status.approved',
        fallback: 'Tasdiqlangan',
        className: 'bg-primary text-white',
      },
      partially_received: {
        labelKey: 'reports.po_summary_page.status.partial',
        fallback: 'Qisman qabul qilingan',
        className: 'bg-warning text-white',
      },
      received: {
        labelKey: 'reports.po_summary_page.status.received',
        fallback: 'Qabul qilingan',
        className: 'bg-success text-white',
      },
      cancelled: {
        labelKey: 'reports.po_summary_page.status.cancelled',
        fallback: 'Bekor qilingan',
        className: 'bg-destructive text-white',
      },
    };
    const config = map[status] || {
      labelKey: '',
      fallback: status,
      className: '',
    };
    return (
      <Badge className={config.className}>
        {config.labelKey ? t(config.labelKey, config.fallback) : config.fallback}
      </Badge>
    );
  };

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (sorted.length === 0) {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t(
          'reports.po_summary_page.export.no_data',
          "Eksport qilish uchun ma'lumot yo'q"
        ),
        variant: 'destructive',
      });
      return;
    }
    try {
      setExporting(true);
      const suffix = dateFrom === dateTo ? dateFrom : `${dateFrom}_${dateTo}`;
      const headers = [
        t('reports.po_summary_page.table.po_number', 'Buyurtma raqami'),
        t('reports.po_summary_page.table.supplier', 'Yetkazib beruvchi'),
        t('reports.po_summary_page.table.date', 'Sana'),
        t('reports.po_summary_page.table.currency', 'Valyuta'),
        t('reports.po_summary_page.table.ordered', 'Buyurtma summasi'),
        t('reports.po_summary_page.table.received_doc', 'Qabul (hujjat)'),
        t('reports.po_summary_page.table.received_wh', 'Ombor (UZS)'),
        t('reports.po_summary_page.table.paid', "To'langan"),
        t('reports.po_summary_page.table.debt', 'Qarz / kredit'),
        t('reports.po_summary_page.table.status', 'Holati'),
      ];
      const rows = sorted.map((order) => {
        const cur = getPoLedgerCurrency(order as any);
        const receivedDoc = calculatePoReceivedDocAmount(order as any, order.items || []);
        const receivedWh = calculatePoReceivedAmountUzs(order.items || []);
        const paid = getPoPaidAmount(order as any);
        const rem = getPoRemainingAmountSigned(order as any);
        return [
          order.po_number,
          order.supplier?.name || order.supplier_name || '-',
          formatDate(order.order_date),
          cur,
          formatPoMoney(order as any),
          formatPoMoney(order as any, receivedDoc),
          formatMoneyUZS(receivedWh),
          formatPoMoney(order as any, paid),
          formatPoMoney(order as any, rem),
          order.status,
        ];
      });

      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
          [t('reports.po_summary_page.title', 'Xarid buyurtmalari umumiy hisobot')],
          [t('reports.po_summary_page.export.period', 'Davr'), `${dateFrom} — ${dateTo}`],
          [],
          headers,
          ...rows,
        ]);
        ws['!cols'] = headers.map(() => ({ wch: 16 }));
        XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
        XLSX.writeFile(wb, `purchase-order-summary_${suffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(t('reports.po_summary_page.title', 'Xarid buyurtmalari umumiy hisobot'), 14, 12);
        doc.setFontSize(9);
        doc.text(`${dateFrom} — ${dateTo}`, 14, 18);
        autoTable(doc, {
          head: [headers],
          body: rows.map((r) => r.map(String)),
          startY: 22,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`purchase-order-summary_${suffix}.pdf`);
      }
      toast({
        title: t('reports.po_summary_page.export.success_title', 'Muvaffaqiyatli'),
        description: t(
          'reports.po_summary_page.export.success',
          '{{format}} formatida eksport qilindi',
          { format: format.toUpperCase() }
        ),
      });
    } catch (err) {
      console.error(err);
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.po_summary_page.export.failed', 'Eksportda xatolik yuz berdi'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/purchase')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">
              {t('reports.po_summary_page.title', 'Xarid buyurtmalari umumiy hisobot')}
            </h1>
            <p className="text-muted-foreground">
              {t(
                'reports.po_summary_page.subtitle',
                "Xarid buyurtmalari haqida umumiy ma'lumot"
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')} disabled={exporting}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.po_summary_page.export.excel', 'Excel')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')} disabled={exporting}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.po_summary_page.export.pdf', 'PDF')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="py-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.po_summary_page.scope_hint',
              'Buyurtma / to‘lov / qarz — hujjat valyutasida (UZS va USD alohida). «Ombor (UZS)» — qabul qilingan tovarning ombor qiymati (landed cost), USD buyurtmalarni ham UZS ga yig‘adi; shuning uchun u «Jami buyurtma»dan katta ko‘rinishi mumkin — bu xato emas.'
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.po_summary_page.filters.from', 'Boshlanish sanasi')}
              </label>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateFrom(v);
                  if (dateTo && v > dateTo) setDateTo(v);
                }}
                className="h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.po_summary_page.filters.to', 'Tugash sanasi')}
              </label>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateTo(v);
                  if (dateFrom && v < dateFrom) setDateFrom(v);
                }}
                className="h-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.po_summary_page.summary.ordered', 'Jami buyurtma (hujjat)')}
            </p>
            <DualCurrencyAmount
              uzs={poTotals.orderedUzs}
              usd={poTotals.orderedUsd}
              className="text-xl font-bold leading-tight"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('reports.po_summary_page.summary.count', '{{count}} ta buyurtma', {
                count: poTotals.count,
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.po_summary_page.summary.received_doc', 'Jami qabul (hujjat valyutasi)')}
            </p>
            <DualCurrencyAmount
              uzs={poTotals.receivedDocUzs}
              usd={poTotals.receivedDocUsd}
              className="text-xl font-bold leading-tight text-success"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.po_summary_page.summary.received_wh', 'Ombor qiymati (UZS)')}
            </p>
            <p className="text-xl font-bold leading-tight">{formatMoneyUZS(poTotals.receivedUzs)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                'reports.po_summary_page.summary.received_wh_hint',
                'Barcha PO (shu jumladan USD) — landed cost'
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.po_summary_page.summary.paid', "Jami to'langan")}
            </p>
            <DualCurrencyAmount
              uzs={poTotals.paidUzs}
              usd={poTotals.paidUsd}
              className="text-xl font-bold leading-tight"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.po_summary_page.summary.debt', "Jami qarz (to'lash kerak)")}
            </p>
            <DualCurrencyAmount
              uzs={poTotals.debtUzs}
              usd={poTotals.debtUsd}
              className={`text-xl font-bold leading-tight ${
                poTotals.debtUzs > 0 || poTotals.debtUsd > 0 ? 'text-destructive' : ''
              }`}
            />
            {(poTotals.creditUzs > 0 || poTotals.creditUsd > 0) && (
              <p className="text-xs text-success mt-1">
                {t('reports.po_summary_page.summary.credit', 'Ortiqcha to‘lov')}:{' '}
                <DualCurrencyAmount
                  uzs={poTotals.creditUzs}
                  usd={poTotals.creditUsd}
                  className="inline text-xs font-medium"
                />
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-muted-foreground">
                {t(
                  'reports.po_summary_page.table.empty',
                  "Tanlangan davrda xarid buyurtmalari topilmadi. Standart — oxirgi 30 kun."
                )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead columnKey="po_number" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="string">
                    {t('reports.po_summary_page.table.po_number', 'Buyurtma raqami')}
                  </SortableTableHead>
                  <SortableTableHead columnKey="supplier" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="string">
                    {t('reports.po_summary_page.table.supplier', 'Yetkazib beruvchi')}
                  </SortableTableHead>
                  <SortableTableHead columnKey="order_date" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="string">
                    {t('reports.po_summary_page.table.date', 'Sana')}
                  </SortableTableHead>
                  <SortableTableHead columnKey="ordered" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="number" align="right">
                    {t('reports.po_summary_page.table.ordered', 'Buyurtma summasi')}
                  </SortableTableHead>
                  <SortableTableHead columnKey="received" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="number" align="right">
                    {t('reports.po_summary_page.table.received_doc', 'Qabul (hujjat)')}
                  </SortableTableHead>
                  <TableHead className="text-right">
                    {t('reports.po_summary_page.table.received_wh', 'Ombor (UZS)')}
                  </TableHead>
                  <SortableTableHead columnKey="paid" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="number" align="right">
                    {t('reports.po_summary_page.table.paid', "To'langan")}
                  </SortableTableHead>
                  <SortableTableHead columnKey="debt" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="number" align="right">
                    {t('reports.po_summary_page.table.debt', 'Qarz')}
                  </SortableTableHead>
                  <SortableTableHead columnKey="status" sortKey={sortKey} sortOrder={sortOrder} onSort={toggleSort} kind="string">
                    {t('reports.po_summary_page.table.status', 'Holati')}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((order) => {
                  const receivedDoc = calculatePoReceivedDocAmount(order as any, order.items || []);
                  const receivedWh = calculatePoReceivedAmountUzs(order.items || []);
                  const paidAmount = getPoPaidAmount(order as any);
                  const remaining = getPoRemainingAmountSigned(order as any);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.po_number}</TableCell>
                      <TableCell>{order.supplier?.name || order.supplier_name || '-'}</TableCell>
                      <TableCell>{formatDate(order.order_date)}</TableCell>
                      <TableCell className="text-right">{formatPoMoney(order as any)}</TableCell>
                      <TableCell className="text-right">
                        {formatPoMoney(order as any, receivedDoc)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoneyUZS(receivedWh)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPoMoney(order as any, paidAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            remaining > 0.0001
                              ? 'text-destructive font-semibold'
                              : remaining < -0.0001
                                ? 'text-success font-semibold'
                                : ''
                          }
                        >
                          {formatPoMoney(order as any, remaining)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
