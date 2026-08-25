import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPromotionUsageReport, getWarehouses } from '@/db/api';
import type { Warehouse } from '@/types/database';
import { ArrowLeft, FileDown, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PromotionUsageRow {
  promotion_id: string;
  promotion_name: string;
  promotion_type: string;
  usage_count: number;
  total_discount: number;
}

type PromoSortKey = 'promotion_name' | 'promotion_type' | 'usage_count' | 'total_discount';

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function typeLabel(type: string, t: (key: string, fallback: string) => string): string {
  switch (type) {
    case 'percent_discount':
      return t('reports.promotions_page.types.percent', 'Foizli chegirma');
    case 'amount_discount':
      return t('reports.promotions_page.types.amount', "Summali chegirma");
    case 'fixed_price':
      return t('reports.promotions_page.types.fixed', 'Belgilangan narx');
    default:
      return type || '—';
  }
}

export default function PromotionReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [rows, setRows] = useState<PromotionUsageRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const loadGenRef = useRef(0);
  const { sortKey, sortOrder, toggleSort } = useTableSort<PromoSortKey>('total_discount', 'desc');

  const warehouseOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((w) => ({ value: w.id, label: w.name })),
    ],
    [warehouses, t]
  );

  const loadData = useCallback(async () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast({
        title: t('reports.promotions_page.errors.invalid_range_title', 'Sana oralig‘i'),
        description: t(
          'reports.promotions_page.errors.invalid_range',
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
      const data = await getPromotionUsageReport({
        date_from: dateFrom,
        date_to: dateTo,
        warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
      });
      if (gen !== loadGenRef.current) return;
      setRows(
        (data || []).map((r: any) => ({
          promotion_id: String(r.promotion_id || ''),
          promotion_name: r.promotion_name || r.promotion_id || '—',
          promotion_type: r.promotion_type || '',
          usage_count: Number(r.usage_count) || 0,
          total_discount: Number(r.total_discount) || 0,
        }))
      );
    } catch (error) {
      if (gen !== loadGenRef.current) return;
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t(
          'reports.promotions_page.errors.load_failed',
          "Aksiya hisobotini yuklab bo'lmadi"
        )}${msg ? ` (${msg})` : ''}`,
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo, warehouseId, toast, t]);

  useEffect(() => {
    (async () => {
      try {
        const w = await getWarehouses();
        setWarehouses((w as Warehouse[]) || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    if (!searchTerm) return rows;
    const q = searchTerm.toLowerCase();
    return rows.filter(
      (r) =>
        r.promotion_name.toLowerCase().includes(q) ||
        r.promotion_type.toLowerCase().includes(q)
    );
  }, [rows, searchTerm]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      switch (sortKey) {
        case 'promotion_name':
          return compareScalar(a.promotion_name.toLowerCase(), b.promotion_name.toLowerCase(), sortOrder);
        case 'promotion_type':
          return compareScalar(a.promotion_type.toLowerCase(), b.promotion_type.toLowerCase(), sortOrder);
        case 'usage_count':
          return compareScalar(a.usage_count, b.usage_count, sortOrder);
        case 'total_discount':
          return compareScalar(a.total_discount, b.total_discount, sortOrder);
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey, sortOrder]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.usage += r.usage_count;
        acc.discount += r.total_discount;
        return acc;
      },
      { usage: 0, discount: 0 }
    );
  }, [filtered]);

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (sorted.length === 0) {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.promotions_page.export.no_data', "Eksport qilish uchun ma'lumot yo'q"),
        variant: 'destructive',
      });
      return;
    }
    try {
      setExporting(true);
      const fileSuffix = dateFrom === dateTo ? dateFrom : `${dateFrom}_${dateTo}`;
      const headers = [
        t('reports.promotions_page.table.name', 'Aksiya nomi'),
        t('reports.promotions_page.table.type', 'Turi'),
        t('reports.promotions_page.table.usage', 'Ishlatilish soni'),
        t('reports.promotions_page.table.discount', 'Jami chegirma'),
      ];
      const body = sorted.map((r) => [
        r.promotion_name,
        typeLabel(r.promotion_type, t),
        r.usage_count,
        r.total_discount,
      ]);

      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
          [t('reports.promotions_page.title', "Aksiyalar bo'yicha hisobot")],
          [t('reports.promotions_page.export.period', 'Davr'), `${dateFrom} — ${dateTo}`],
          [],
          headers,
          ...body,
        ]);
        ws['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
        XLSX.writeFile(wb, `promotions-report_${fileSuffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text(t('reports.promotions_page.title', "Aksiyalar bo'yicha hisobot"), 14, 15);
        doc.setFontSize(10);
        doc.text(`${dateFrom} — ${dateTo}`, 14, 22);
        autoTable(doc, {
          head: [headers],
          body: body.map((r) => [
            String(r[0]),
            String(r[1]),
            String(r[2]),
            formatMoneyUZS(Number(r[3])),
          ]),
          startY: 28,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`promotions-report_${fileSuffix}.pdf`);
      }

      toast({
        title: t('reports.promotions_page.export.success_title', 'Muvaffaqiyatli'),
        description: t(
          'reports.promotions_page.export.success',
          '{{format}} formatida eksport qilindi',
          { format: format.toUpperCase() }
        ),
      });
    } catch (error) {
      console.error('Promotion report export error:', error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.promotions_page.export.failed', 'Eksportda xatolik yuz berdi'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/sales')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading flex items-center gap-2">
              <Tag className="h-7 w-7" />
              {t('reports.promotions_page.title', "Aksiyalar bo'yicha hisobot")}
            </h1>
            <p className="text-muted-foreground">
              {t(
                'reports.promotions_page.subtitle',
                'Aksiya ishlatilishi va chegirma summasi'
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')} disabled={exporting || loading}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.promotions_page.export.excel', 'Excel')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')} disabled={exporting || loading}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.promotions_page.export.pdf', 'PDF')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.promotions_page.scope_hint',
              'Hisob: yakunlangan buyurtmalardagi aksiya qo‘llanilishi (UZS ekv.). POS savat qaytarishlari chiqarib tashlanadi. Standart davr — oxirgi 30 kun.'
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.promotions_page.filters.from', 'Boshlanish')}
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
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.promotions_page.filters.to', 'Tugash')}
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
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.promotions_page.filters.warehouse', 'Ombor')}
              </label>
              <SearchableCombobox
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={warehouseOptions}
                placeholder={t('combobox.all_warehouses', 'Barcha omborlar')}
                searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.promotions_page.filters.search', 'Qidirish')}
              </label>
              <Input
                placeholder={t(
                  'reports.promotions_page.filters.search_ph',
                  "Aksiya nomi bo'yicha qidirish..."
                )}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.promotions_page.summary.promotions', 'Aksiyalar soni')}
            </p>
            <p className="text-2xl font-bold mt-1">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.promotions_page.summary.usage', 'Jami ishlatilish')}
            </p>
            <p className="text-2xl font-bold mt-1">{totals.usage}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.promotions_page.summary.discount', 'Jami chegirma (UZS ekv.)')}
            </p>
            <p className="text-2xl font-bold mt-1">{formatMoneyUZS(totals.discount)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center min-h-[200px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-muted-foreground">
                {t(
                  'reports.promotions_page.table.empty',
                  "Tanlangan davrda aksiya ishlatilmagan. Standart — oxirgi 30 kun; sana oralig'ini kengaytiring yoki omborni o'zgartiring."
                )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<PromoSortKey>
                    columnKey="promotion_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.promotions_page.table.name', 'Aksiya nomi')}
                  </SortableTableHead>
                  <SortableTableHead<PromoSortKey>
                    columnKey="promotion_type"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.promotions_page.table.type', 'Turi')}
                  </SortableTableHead>
                  <SortableTableHead<PromoSortKey>
                    columnKey="usage_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.promotions_page.table.usage', 'Ishlatilish soni')}
                  </SortableTableHead>
                  <SortableTableHead<PromoSortKey>
                    columnKey="total_discount"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.promotions_page.table.discount', 'Jami chegirma')}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <TableRow key={r.promotion_id}>
                    <TableCell className="font-medium">{r.promotion_name}</TableCell>
                    <TableCell>{typeLabel(r.promotion_type, t)}</TableCell>
                    <TableCell className="text-right">{r.usage_count}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(r.total_discount)}
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
