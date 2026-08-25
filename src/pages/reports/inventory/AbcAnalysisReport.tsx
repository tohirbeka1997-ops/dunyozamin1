import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getCategories, getWarehouses } from '@/db/api';
import type { Category, Warehouse } from '@/types/database';
import SearchableCombobox from '@/components/common/SearchableCombobox';

type AbcClass = 'A' | 'B' | 'C';

type AbcRow = {
  product_id: string;
  product_name: string;
  sku: string;
  category_name?: string;
  quantity_sold: number;
  sales_amount: number;
  current_stock: number | null;
  rank: number;
  share_pct: number;
  cumulative_pct: number;
  abc_class: AbcClass;
};

type AbcSummaryBucket = {
  count: number;
  revenue: number;
  revenue_share_pct: number;
};

type AbcResult = {
  rows: AbcRow[];
  summary: {
    total_revenue: number;
    a: AbcSummaryBucket;
    b: AbcSummaryBucket;
    c: AbcSummaryBucket;
  };
  thresholds: { a: number; b: number };
};

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function classBadge(cls: AbcClass) {
  if (cls === 'A') return <Badge className="bg-success text-white">A</Badge>;
  if (cls === 'B') return <Badge className="bg-warning text-white">B</Badge>;
  return <Badge variant="secondary">C</Badge>;
}

const emptySummary: AbcResult['summary'] = {
  total_revenue: 0,
  a: { count: 0, revenue: 0, revenue_share_pct: 0 },
  b: { count: 0, revenue: 0, revenue_share_pct: 0 },
  c: { count: 0, revenue: 0, revenue_share_pct: 0 },
};

export default function AbcAnalysisReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<'all' | AbcClass>('all');
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AbcRow[]>([]);
  const [summary, setSummary] = useState(emptySummary);

  const warehouseOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
      })),
    ],
    [warehouses, t]
  );

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_categories', 'Hammasi') },
      ...categories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    ],
    [categories, t]
  );

  const loadData = useCallback(async () => {
    try {
      if (!isElectron()) {
        throw new Error(t('reports.abc_analysis.errors.desktop_only', 'Bu hisobot faqat desktop ilovada mavjud.'));
      }
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<AbcResult>(
        api.reports?.abcAnalysis?.({
          date_from: dateFrom,
          date_to: dateTo,
          warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
          category_id: categoryFilter === 'all' ? undefined : categoryFilter,
        }) || Promise.resolve({ rows: [], summary: emptySummary, thresholds: { a: 80, b: 95 } })
      );
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || emptySummary);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: msg || t('reports.abc_analysis.errors.load_failed', "Ma'lumotlarni yuklab bo'lmadi"),
        variant: 'destructive',
      });
      setRows([]);
      setSummary(emptySummary);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, warehouseId, categoryFilter, t, toast]);

  useEffect(() => {
    (async () => {
      try {
        const [c, w] = await Promise.all([getCategories(), getWarehouses()]);
        setCategories(c || []);
        setWarehouses((w as Warehouse[]) || []);
      } catch {
        // ignore lookup failures
      }
    })();
  }, []);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter !== 'all' && r.abc_class !== classFilter) return false;
      if (!term) return true;
      return (
        String(r.product_name || '')
          .toLowerCase()
          .includes(term) ||
        String(r.sku || '')
          .toLowerCase()
          .includes(term)
      );
    });
  }, [rows, classFilter, search]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">
              {t('reports.abc_analysis.title', 'ABC tahlil (sotuv bo‘yicha)')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t(
                'reports.abc_analysis.subtitle',
                'Mahsulotlar daromad ulushi bo‘yicha A / B / C sinflarga ajratiladi'
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData()}>
          <RotateCw className="h-4 w-4 mr-2" />
          {t('common.refresh', 'Yangilash')}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.abc_analysis.rule_hint',
              'Qoida: mahsulotlar sotuv summasi (UZS ekv.) bo‘yicha kamayish tartibida. A — kumulativ ~0–80%, B — ~80–95%, C — ~95–100%.'
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.abc_analysis.scope_hint',
              'Hisob: yakunlangan sotuvlarning gross summasi (UZS ekv.). POS savat qaytarishlari (manfiy buyurtmalar) chiqarib tashlanadi; alohida sales_returns hujjatlari ayirilmaydi.'
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.from', 'Boshlanish sanasi')}
              </label>
              <Input
                type="date"
                className="h-8"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.to', 'Tugash sanasi')}
              </label>
              <Input
                type="date"
                className="h-8"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.warehouse', 'Ombor')}
              </label>
              <SearchableCombobox
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={warehouseOptions}
                placeholder={t('combobox.all_warehouses', 'Barcha omborlar')}
                searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
                triggerClassName="h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.category', 'Kategoriya')}
              </label>
              <SearchableCombobox
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={categoryOptions}
                placeholder={t('combobox.select_category', 'Kategoriyani tanlang...')}
                searchPlaceholder={t('combobox.search_category', "Kategoriya nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_category', 'Kategoriya topilmadi')}
                triggerClassName="h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.class', 'Sinf')}
              </label>
              <Select
                value={classFilter}
                onValueChange={(v) => setClassFilter(v as 'all' | AbcClass)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('reports.abc_analysis.filters.all_classes', 'Barchasi')}
                  </SelectItem>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t('reports.abc_analysis.filters.search', 'Qidirish')}
              </label>
              <Input
                className="h-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('reports.abc_analysis.filters.search_ph', 'Nomi yoki SKU...')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('reports.abc_analysis.summary.total', 'Jami tushum')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-semibold">{formatMoneyUZS(summary.total_revenue)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('reports.abc_analysis.summary.products', '{{count}} ta mahsulot', {
                count: rows.length,
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">A</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-semibold">{summary.a.count}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumberUZ(summary.a.revenue_share_pct)}% · {formatMoneyUZS(summary.a.revenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">B</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-semibold">{summary.b.count}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumberUZ(summary.b.revenue_share_pct)}% · {formatMoneyUZS(summary.b.revenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">C</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-semibold">{summary.c.count}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumberUZ(summary.c.revenue_share_pct)}% · {formatMoneyUZS(summary.c.revenue)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('reports.abc_analysis.empty', 'Tanlangan davrda sotuv topilmadi')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{t('reports.abc_analysis.table.product', 'Mahsulot')}</TableHead>
                    <TableHead>{t('reports.abc_analysis.table.sku', 'SKU')}</TableHead>
                    <TableHead className="text-right">
                      {t('reports.abc_analysis.table.qty', 'Sotilgan')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('reports.abc_analysis.table.amount', 'Summa')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('reports.abc_analysis.table.share', 'Ulush %')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('reports.abc_analysis.table.cumulative', 'Kumulativ %')}
                    </TableHead>
                    <TableHead className="text-center">
                      {t('reports.abc_analysis.table.class', 'Sinf')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('reports.abc_analysis.table.stock', 'Qoldiq')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.product_id}>
                      <TableCell className="text-muted-foreground">{r.rank}</TableCell>
                      <TableCell className="font-medium">{r.product_name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.sku || '—'}</TableCell>
                      <TableCell className="text-right">{formatNumberUZ(r.quantity_sold)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(r.sales_amount)}</TableCell>
                      <TableCell className="text-right">{formatNumberUZ(r.share_pct)}%</TableCell>
                      <TableCell className="text-right">
                        {formatNumberUZ(r.cumulative_pct)}%
                      </TableCell>
                      <TableCell className="text-center">{classBadge(r.abc_class)}</TableCell>
                      <TableCell className="text-right">
                        {r.current_stock == null ? '—' : formatNumberUZ(r.current_stock)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
