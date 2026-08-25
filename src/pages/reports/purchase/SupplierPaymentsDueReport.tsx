import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ArrowLeft, CalendarClock, FileDown, RefreshCw } from 'lucide-react';
import { requireElectron, isElectron } from '@/utils/electron';
import { ipc } from '@/db/internal';
import { formatMoney } from '@/lib/currency';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type DueFilter = 'open' | 'today' | 'overdue' | 'upcoming7' | 'upcoming30' | 'no_due';

type DueRow = {
  row_type: 'open' | 'partial' | 'installment';
  po_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  currency: 'UZS' | 'USD';
  amount: number;
  due_date: string | null;
  due_status: string;
  payment_scheme: string;
  schedule_seq: number | null;
};

export default function SupplierPaymentsDueReport() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [filter, setFilter] = useState<DueFilter>('open');
  const [rows, setRows] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGenRef = useRef(0);

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      overdue: t('reports.supplier_due_page.status.overdue', "Muddati o'tgan"),
      today: t('reports.supplier_due_page.status.today', 'Bugun'),
      upcoming: t('reports.supplier_due_page.status.upcoming', 'Kelyapti'),
      no_due: t('reports.supplier_due_page.status.no_due', 'Muddat yo‘q'),
      // legacy hardcoded Uzbek from older backend
      "O'tgan": t('reports.supplier_due_page.status.overdue', "Muddati o'tgan"),
      Bugun: t('reports.supplier_due_page.status.today', 'Bugun'),
      Kelyapti: t('reports.supplier_due_page.status.upcoming', 'Kelyapti'),
    };
    return map[status] || status || '—';
  };

  const statusVariant = (status: string) => {
    const key = status === "O'tgan" ? 'overdue' : status === 'Bugun' ? 'today' : status;
    if (key === 'overdue') return 'destructive' as const;
    if (key === 'today') return 'default' as const;
    if (key === 'no_due') return 'outline' as const;
    return 'secondary' as const;
  };

  const schemeLabel = (row: DueRow) => {
    if (row.row_type === 'installment') {
      return t('reports.supplier_due_page.scheme.installment', "Bo'lib #{{n}}", {
        n: row.schedule_seq ?? '—',
      });
    }
    if (row.row_type === 'partial' || row.payment_scheme === 'partial') {
      return t('reports.supplier_due_page.scheme.partial', 'Qisman');
    }
    return t('reports.supplier_due_page.scheme.full', 'To‘liq (ochiq qarz)');
  };

  const load = useCallback(async () => {
    if (!isElectron()) {
      setRows([]);
      setError(
        t(
          'reports.supplier_due_page.errors.desktop_only',
          'Bu hisobot faqat desktop ilovada mavjud.'
        )
      );
      setLoading(false);
      return;
    }

    const gen = ++loadGenRef.current;
    try {
      setLoading(true);
      setError(null);
      const api = requireElectron();
      const data = await ipc<DueRow[]>(api.reports.supplierPaymentsDue({ filter }));
      if (gen !== loadGenRef.current) return;
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setRows([]);
      setError(msg || t('reports.supplier_due_page.errors.load_failed', 'Yuklashda xatolik'));
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t('reports.supplier_due_page.errors.load_failed', 'Yuklashda xatolik')}${
          msg ? ` (${msg})` : ''
        }`,
        variant: 'destructive',
      });
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [filter, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let uzs = 0;
    let usd = 0;
    let overdueUzs = 0;
    let overdueUsd = 0;
    let todayUzs = 0;
    let todayUsd = 0;
    let noDueUzs = 0;
    let noDueUsd = 0;
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      const st = r.due_status === "O'tgan" ? 'overdue' : r.due_status === 'Bugun' ? 'today' : r.due_status;
      if (r.currency === 'USD') {
        usd += amt;
        if (st === 'overdue') overdueUsd += amt;
        else if (st === 'today') todayUsd += amt;
        else if (st === 'no_due' || !r.due_date) noDueUsd += amt;
      } else {
        uzs += amt;
        if (st === 'overdue') overdueUzs += amt;
        else if (st === 'today') todayUzs += amt;
        else if (st === 'no_due' || !r.due_date) noDueUzs += amt;
      }
    }
    return {
      count: rows.length,
      uzs,
      usd,
      overdueUzs,
      overdueUsd,
      todayUzs,
      todayUsd,
      noDueUzs,
      noDueUsd,
    };
  }, [rows]);

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (rows.length === 0) {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.supplier_due_page.export.no_data', "Eksport qilish uchun ma'lumot yo'q"),
        variant: 'destructive',
      });
      return;
    }
    try {
      setExporting(true);
      const headers = [
        t('reports.supplier_due_page.table.po', 'PO'),
        t('reports.supplier_due_page.table.supplier', "Ta'minotchi"),
        t('reports.supplier_due_page.table.scheme', 'Sxema'),
        t('reports.supplier_due_page.table.amount', 'Summa'),
        t('reports.supplier_due_page.table.currency', 'Valyuta'),
        t('reports.supplier_due_page.table.due', 'Muddat'),
        t('reports.supplier_due_page.table.status', 'Holat'),
      ];
      const body = rows.map((r) => [
        r.po_number,
        r.supplier_name || '—',
        schemeLabel(r),
        r.amount,
        r.currency,
        r.due_date || '—',
        statusLabel(r.due_status),
      ]);
      const suffix = filter;
      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
          [t('reports.supplier_due_page.title', "To'lanishi kerak")],
          [t('reports.supplier_due_page.export.filter', 'Filtr'), filter],
          [],
          headers,
          ...body,
        ]);
        ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
        XLSX.writeFile(wb, `supplier-payments-due_${suffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(t('reports.supplier_due_page.title', "To'lanishi kerak"), 14, 12);
        autoTable(doc, {
          head: [headers],
          body: body.map((r) => [
            String(r[0]),
            String(r[1]),
            String(r[2]),
            formatMoney(Number(r[3]), r[4] as 'UZS' | 'USD'),
            String(r[4]),
            String(r[5]),
            String(r[6]),
          ]),
          startY: 18,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`supplier-payments-due_${suffix}.pdf`);
      }
      toast({
        title: t('reports.supplier_due_page.export.success_title', 'Muvaffaqiyatli'),
        description: t(
          'reports.supplier_due_page.export.success',
          '{{format}} formatida eksport qilindi',
          { format: format.toUpperCase() }
        ),
      });
    } catch (err) {
      console.error(err);
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.supplier_due_page.export.failed', 'Eksportda xatolik yuz berdi'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports/purchase')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="page-heading">
            {t('reports.supplier_due_page.title', "To'lanishi kerak")}
          </h1>
          <p className="text-muted-foreground">
            {t(
              'reports.supplier_due_page.subtitle',
              "Yetkazib beruvchi qarzlari — muddat bo'yicha"
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={filter} onValueChange={(v) => setFilter(v as DueFilter)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                {t('reports.supplier_due_page.filters.open', 'Barcha ochiq qarz')}
              </SelectItem>
              <SelectItem value="today">
                {t('reports.supplier_due_page.filters.today', 'Bugun')}
              </SelectItem>
              <SelectItem value="overdue">
                {t('reports.supplier_due_page.filters.overdue', "Muddati o'tgan")}
              </SelectItem>
              <SelectItem value="upcoming7">
                {t('reports.supplier_due_page.filters.upcoming7', '7 kun ichida')}
              </SelectItem>
              <SelectItem value="upcoming30">
                {t('reports.supplier_due_page.filters.upcoming30', '30 kun ichida')}
              </SelectItem>
              <SelectItem value="no_due">
                {t('reports.supplier_due_page.filters.no_due', 'Muddat belgilanmagan')}
              </SelectItem>
            </SelectContent>
          </Select>
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
            {t('common.update', 'Yangilash')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.supplier_due_page.scope_hint',
              'Qarz — hujjat qoldig‘i (buyurtma − to‘lovlar), ombor landed cost emas. «Bugun» faqat bugungi muddatli to‘lovlarni ko‘rsatadi; muddatsiz ochiq qarzlar «Barcha ochiq qarz» yoki «Muddat belgilanmagan»da.'
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.supplier_due_page.summary.total', 'Jami (filtr)')}
            </p>
            <DualCurrencyAmount uzs={totals.uzs} usd={totals.usd} className="text-xl font-bold" />
            <p className="text-xs text-muted-foreground mt-1">
              {t('reports.supplier_due_page.summary.rows', '{{count}} qator', { count: totals.count })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.supplier_due_page.summary.overdue', "Muddati o'tgan")}
            </p>
            <DualCurrencyAmount
              uzs={totals.overdueUzs}
              usd={totals.overdueUsd}
              className="text-xl font-bold text-destructive"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.supplier_due_page.summary.today', 'Bugun')}
            </p>
            <DualCurrencyAmount
              uzs={totals.todayUzs}
              usd={totals.todayUsd}
              className="text-xl font-bold"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">
              {t('reports.supplier_due_page.summary.no_due', 'Muddat yo‘q')}
            </p>
            <DualCurrencyAmount
              uzs={totals.noDueUzs}
              usd={totals.noDueUsd}
              className="text-xl font-bold"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            {t('reports.supplier_due_page.list_title', "To'lovlar ro'yxati")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          ) : error ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('common.update', 'Yangilash')}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="space-y-2 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {filter === 'today'
                  ? t(
                      'reports.supplier_due_page.empty_today',
                      'Bugun muddati kelgan to‘lov yo‘q. Ochiq qarzlar uchun «Barcha ochiq qarz» yoki «Muddat belgilanmagan»ni tanlang.'
                    )
                  : t(
                      'reports.supplier_due_page.empty',
                      'Tanlangan filtr bo‘yicha qarz topilmadi.'
                    )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.supplier_due_page.table.po', 'PO')}</TableHead>
                  <TableHead>{t('reports.supplier_due_page.table.supplier', "Ta'minotchi")}</TableHead>
                  <TableHead>{t('reports.supplier_due_page.table.scheme', 'Sxema')}</TableHead>
                  <TableHead className="text-right">
                    {t('reports.supplier_due_page.table.amount', 'Summa')}
                  </TableHead>
                  <TableHead>{t('reports.supplier_due_page.table.due', 'Muddat')}</TableHead>
                  <TableHead>{t('reports.supplier_due_page.table.status', 'Holat')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow
                    key={`${row.po_id}-${row.schedule_seq ?? 'p'}-${idx}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/purchase-orders/${row.po_id}`)}
                  >
                    <TableCell className="font-medium">{row.po_number}</TableCell>
                    <TableCell>{row.supplier_name || '—'}</TableCell>
                    <TableCell>{schemeLabel(row)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.amount, row.currency)}
                    </TableCell>
                    <TableCell>{row.due_date || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.due_status)}>
                        {statusLabel(row.due_status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
