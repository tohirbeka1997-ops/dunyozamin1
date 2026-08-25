import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { FileDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type Summary = {
  days?: number;
  date_from?: string | null;
  date_to?: string | null;
  totals?: {
    orders: number;
    amount: number;
    avg_order?: number;
    cancelled_orders?: number;
  };
  by_status?: Array<{ status: string; count: number; amount: number }>;
  by_channel?: Array<{ channel: string; count: number; amount: number }>;
  by_payment?: Array<{ method: string; count: number; amount: number }>;
};

const CHANNELS = ['all', 'telegram', 'website', 'uzum', 'yandex', 'other'] as const;

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WebOnlineSalesReport() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const api = getElectronAPI();
  const [preset, setPreset] = useState('30');
  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const [channel, setChannel] = useState<string>('all');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGenRef = useRef(0);

  const statusLabel = (s: string) => {
    const key = `web_orders.status_${s}`;
    const tr = t(key);
    return tr === key ? s : tr;
  };

  const channelLabel = (ch: string) => {
    const key = `web_orders.channel_${ch}`;
    const tr = t(key);
    return tr === key ? ch : tr;
  };

  const paymentLabel = (m: string) => {
    const key = `web_orders.payment_${m}`;
    const tr = t(key);
    return tr === key ? m : tr;
  };

  const applyPreset = (value: string) => {
    setPreset(value);
    if (value === 'custom') return;
    const n = Number(value) || 30;
    setDateFrom(daysAgoYmd(n));
    setDateTo(todayYMD());
  };

  const load = useCallback(async () => {
    if (!api?.webOrders?.reportSummary) {
      setData(null);
      setError(t('web_orders.report_desktop_only', 'Bu hisobot faqat desktop ilovada mavjud.'));
      setLoading(false);
      return;
    }

    let from = dateFrom;
    let to = dateTo;
    if (from && to && from > to) {
      toast({
        title: t('web_orders.report_invalid_range_title', 'Sana oralig‘i'),
        description: t(
          'web_orders.report_invalid_range',
          'Boshlanish tugashdan keyin edi — sanalar almashtirildi.'
        ),
      });
      setDateFrom(to);
      setDateTo(from);
      setPreset('custom');
      return;
    }

    const gen = ++loadGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, unknown> = {
        date_from: from,
        date_to: to,
        days: Number(preset) || 30,
      };
      if (channel !== 'all') filters.sales_channel = channel;
      const res = await handleIpcResponse<Summary>(api.webOrders.reportSummary(filters));
      if (gen !== loadGenRef.current) return;
      setData(res);
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setData(null);
      setError(msg || t('web_orders.load_error', 'Yuklashda xatolik'));
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t('web_orders.load_error', 'Yuklashda xatolik')}${msg ? ` (${msg})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [api, channel, dateFrom, dateTo, preset, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async (format: 'excel' | 'pdf') => {
    const statusRows = data?.by_status || [];
    const channelRows = data?.by_channel || [];
    if (!statusRows.length && !channelRows.length) {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('web_orders.report_export_no_data', "Eksport qilish uchun ma'lumot yo'q"),
        variant: 'destructive',
      });
      return;
    }
    try {
      setExporting(true);
      const suffix = `${dateFrom}_${dateTo}`;
      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const statusSheet = XLSX.utils.aoa_to_sheet([
          [t('web_orders.report_by_status', "Holat bo'yicha")],
          [t('web_orders.status', 'Holat'), t('web_orders.report_count', 'Soni'), t('web_orders.total', 'Jami')],
          ...statusRows.map((r) => [statusLabel(r.status), r.count, r.amount]),
        ]);
        XLSX.utils.book_append_sheet(wb, statusSheet, 'Holat');
        const channelSheet = XLSX.utils.aoa_to_sheet([
          [t('web_orders.report_by_channel', "Kanal bo'yicha")],
          [t('web_orders.channel', 'Kanal'), t('web_orders.report_count', 'Soni'), t('web_orders.total', 'Jami')],
          ...channelRows.map((r) => [channelLabel(r.channel), r.count, r.amount]),
        ]);
        XLSX.utils.book_append_sheet(wb, channelSheet, 'Kanal');
        XLSX.writeFile(wb, `online-sales-report_${suffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text(t('navigation.web_orders_report', "Onlayn savdo hisoboti"), 14, 15);
        doc.setFontSize(10);
        doc.text(`${dateFrom} — ${dateTo}`, 14, 22);
        autoTable(doc, {
          head: [[t('web_orders.status', 'Holat'), t('web_orders.report_count', 'Soni'), t('web_orders.total', 'Jami')]],
          body: statusRows.map((r) => [
            statusLabel(r.status),
            String(r.count),
            formatMoneyUZS(r.amount),
          ]),
          startY: 28,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        autoTable(doc, {
          head: [[t('web_orders.channel', 'Kanal'), t('web_orders.report_count', 'Soni'), t('web_orders.total', 'Jami')]],
          body: channelRows.map((r) => [
            channelLabel(r.channel),
            String(r.count),
            formatMoneyUZS(r.amount),
          ]),
          startY: (doc as any).lastAutoTable?.finalY + 8 || 80,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`online-sales-report_${suffix}.pdf`);
      }
      toast({
        title: t('web_orders.report_export_ok_title', 'Muvaffaqiyatli'),
        description: t('web_orders.report_export_ok', '{{format}} formatida eksport qilindi', {
          format: format.toUpperCase(),
        }),
      });
    } catch (err) {
      console.error(err);
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('web_orders.report_export_failed', 'Eksportda xatolik yuz berdi'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const emptyCell = (
    <TableRow>
      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
        {t('web_orders.empty', "Onlayn buyurtmalar yo'q")}
      </TableCell>
    </TableRow>
  );

  const periodHint = useMemo(() => {
    if (data?.date_from && data?.date_to) return `${data.date_from} — ${data.date_to}`;
    return `${dateFrom} — ${dateTo}`;
  }, [data?.date_from, data?.date_to, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.web_orders_report')}</h1>
          <p className="page-heading-sub">{t('web_orders.report_subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExport('excel')}
            disabled={loading || exporting}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExport('pdf')}
            disabled={loading || exporting}
          >
            <FileDown className="mr-2 h-4 w-4" />
            PDF
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('common.update')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'web_orders.report_scope_hint',
              'Hisob: Toshkent sanasi bo‘yicha onlayn (web_orders) buyurtmalar, summa UZS ekvivalentida. Bekor / refunded / failed jami KPI ga kirmaydi; holat jadvalida ko‘rinadi.'
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <Select value={preset} onValueChange={applyPreset}>
              <SelectTrigger className="h-9 w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t('web_orders.report_days_7')}</SelectItem>
                <SelectItem value="30">{t('web_orders.report_days_30')}</SelectItem>
                <SelectItem value="90">{t('web_orders.report_days_90')}</SelectItem>
                <SelectItem value="custom">{t('web_orders.report_days_custom', 'Maxsus')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="h-9 w-[10.5rem]"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreset('custom');
                  setDateFrom(v);
                  if (dateTo && v > dateTo) setDateTo(v);
                }}
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="date"
                className="h-9 w-[10.5rem]"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreset('custom');
                  setDateTo(v);
                  if (dateFrom && v < dateFrom) setDateFrom(v);
                }}
              />
            </div>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="h-9 w-[11rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === 'all' ? t('web_orders.all_channels') : channelLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{periodHint}</p>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_total_orders')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? '…' : data?.totals?.orders ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_total_amount')} (UZS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? '…' : formatMoneyUZS(Number(data?.totals?.amount ?? 0))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_avg_order', "O'rtacha buyurtma")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? '…' : formatMoneyUZS(Number(data?.totals?.avg_order ?? 0))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_cancelled', 'Bekor / refund')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {loading ? '…' : data?.totals?.cancelled_orders ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('web_orders.report_by_status')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('web_orders.status')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.report_count')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_status || []).map((row) => (
                    <TableRow key={row.status}>
                      <TableCell>{statusLabel(row.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoneyUZS(Number(row.amount || 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!(data?.by_status || []).length && !error ? emptyCell : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('web_orders.report_by_channel')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('web_orders.channel')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.report_count')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_channel || []).map((row) => (
                    <TableRow key={row.channel}>
                      <TableCell>{channelLabel(row.channel)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoneyUZS(Number(row.amount || 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!(data?.by_channel || []).length && !error ? emptyCell : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('web_orders.report_by_payment', "To'lov usuli bo'yicha")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('web_orders.payment')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.report_count')}</TableHead>
                    <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.by_payment || []).map((row) => (
                    <TableRow key={row.method}>
                      <TableCell>{paymentLabel(row.method)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoneyUZS(Number(row.amount || 0))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!(data?.by_payment || []).length && !error ? emptyCell : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
