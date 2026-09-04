import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { getInventoryValuationReport, getCategories, getWarehouses, listInventoryRevisions } from '@/db/api';
import type { Category, Warehouse } from '@/types/database';
import { FileDown, ArrowLeft, ArrowUpDown, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { formatQuantity } from '@/utils/quantity';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useReportFilters } from '@/hooks/useReportFilters';
import { useDebounce } from '@/hooks/use-debounce';
import { ReportLoadPanel } from '@/components/reports/ReportLoadPanel';
import {
  createReportCorrelationId,
  reportLoadErrorMessage,
  resolveReportStatus,
  telemetryFromReportError,
  type ReportLoadStatus,
} from '@/lib/reportLoadState';
import { todayYMD } from '@/lib/datetime';
import { useAuth } from '@/contexts/AuthContext';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const FILTERS_OPEN_KEY = 'reports.inventory-valuation.filtersOpen';

function readFiltersOpen(): boolean {
  try {
    return sessionStorage.getItem(FILTERS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

type SortField = 'name' | 'stock' | 'value' | 'diff';
type CostMethod = 'weighted_average' | 'fifo' | 'compare';
type AsOfMode = 'today' | 'date' | 'range';

type ValuationRow = {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  category_id: string | null;
  category_name: string | null;
  unit?: string | null;
  min_stock_level: number;
  current_stock: number;
  unit_cost: number | null;
  stock_value: number;
  wavg_unit_cost?: number;
  fifo_unit_cost?: number;
  wavg_value?: number;
  fifo_value?: number;
  diff_amount?: number;
  diff_pct?: number;
  phantom_batch_value?: number;
  phantom_batch_qty?: number;
};

type ValuationPayload = {
  rows: ValuationRow[];
  summary?: {
    total_value: number;
    wavg_total?: number;
    fifo_total?: number;
    diff_amount?: number;
    diff_pct?: number;
    phantom_batch_value?: number;
    phantom_product_count?: number;
    total_quantity?: number;
    products_count?: number;
    products_total?: number;
    out_of_stock_count?: number;
    low_stock_count?: number;
    page?: number;
    page_size?: number;
  };
  series?: Array<{
    as_of_date: string;
    total_value: number;
    wavg_total: number;
    fifo_total: number;
    diff_amount: number;
    total_quantity: number;
    products_count: number;
  }>;
  warnings?: {
    valuation_mismatch?: boolean;
    valuation_diff_amount?: number;
    fifo_total?: number;
    weighted_total?: number;
    dashboard_divergence?: boolean;
  };
  meta?: {
    computed_at?: string;
    timezone?: string;
    cost_method?: string;
    as_of_date?: string;
    as_of_mode?: string;
    data_source?: string;
  };
};

const PAGE_SIZE = 200;

export default function ValuationReport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const methodLabel = useCallback(
    (method: CostMethod, compact = false) => {
      if (method === 'weighted_average') {
        return compact
          ? t('reports.valuation.methods.weighted_average_short', 'O‘rtacha tannarx')
          : t('reports.valuation.methods.weighted_average', 'O‘rtacha og‘irlikli tannarx');
      }
      if (method === 'fifo') {
        return compact
          ? t('reports.valuation.methods.fifo_short', 'FIFO partiya')
          : t('reports.valuation.methods.fifo', 'FIFO (birinchi kirim — birinchi chiqim)');
      }
      return t('reports.valuation.methods.compare', 'Solishtirish');
    },
    [t],
  );
  const requestSeq = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen);
  const { get, set } = useReportFilters({
    storageKey: 'reports.inventory-valuation.filters',
    trackedKeys: [
      'warehouse',
      'category',
      'status',
      'search',
      'sort',
      'order',
      'method',
      'asOfMode',
      'asOf',
      'asOfFrom',
      'asOfTo',
      'diffs',
      'page',
    ],
    defaults: {
      warehouse: 'main-warehouse-001',
      category: 'all',
      status: 'all',
      search: '',
      sort: 'name',
      order: 'asc',
      method: 'weighted_average',
      asOfMode: 'today',
      diffs: '0',
      page: '1',
    },
  });

  const warehouseId = get('warehouse', 'main-warehouse-001');
  const categoryFilter = get('category', 'all');
  const statusFilter = get('status', 'all');
  const searchTerm = get('search', '');
  const sortField = (get('sort', 'name') as SortField) || 'name';
  const sortOrder = (get('order', 'asc') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';
  const costMethod = (get('method', 'weighted_average') as CostMethod) || 'weighted_average';
  const asOfMode = (get('asOfMode', 'today') as AsOfMode) || 'today';
  const asOfDate = get('asOf', todayYMD()) || todayYMD();
  const asOfFrom = get('asOfFrom', todayYMD()) || todayYMD();
  const asOfTo = get('asOfTo', todayYMD()) || todayYMD();
  const diffsOnly = get('diffs', '0') === '1' || (costMethod === 'compare' && get('diffs', '') === '');
  const page = Math.max(1, Number(get('page', '1')) || 1);

  const debouncedSearch = useDebounce(searchTerm, 300);

  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [revisions, setRevisions] = useState<Array<{ id: string; revision_number?: string; completed_at?: string }>>([]);
  const [payload, setPayload] = useState<ValuationPayload | null>(null);
  const [loadStatus, setLoadStatus] = useState<ReportLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_OPEN_KEY, filtersOpen ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [filtersOpen]);

  const products = payload?.rows || [];
  const summary = payload?.summary;
  const warnings = payload?.warnings;
  const meta = payload?.meta;
  const series = payload?.series || [];
  const compare = costMethod === 'compare';

  const warehouseOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Barcha omborlar' },
      ...warehouses.map((w) => ({ value: w.id, label: w.name })),
    ],
    [warehouses],
  );

  const loadLookups = useCallback(async () => {
    try {
      const [cats, whs, revs] = await Promise.all([
        getCategories(),
        getWarehouses(),
        listInventoryRevisions({ status: 'completed', limit: 8 }),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setWarehouses(Array.isArray(whs) ? (whs as Warehouse[]) : []);
      setRevisions(Array.isArray(revs) ? revs : []);
    } catch {
      /* lookups optional */
    }
  }, []);

  const loadData = useCallback(async () => {
    const seq = ++requestSeq.current;
    const cid = createReportCorrelationId('inventory-valuation');
    setCorrelationId(cid);
    setLoadStatus('loading');
    setLoadError(null);
    try {
      const opts: Record<string, unknown> = {
        warehouse_id: warehouseId || 'ALL',
        status: 'active',
        stock_status: statusFilter === 'all' ? undefined : statusFilter,
        category_id: categoryFilter === 'all' ? undefined : categoryFilter,
        search: debouncedSearch.trim() || undefined,
        sort: sortField,
        sort_order: sortOrder,
        cost_method: costMethod,
        diffs_only: diffsOnly ? 1 : 0,
        page,
        page_size: PAGE_SIZE,
      };
      if (asOfMode === 'date') {
        opts.as_of = asOfDate;
        opts.as_of_mode = 'date';
      } else if (asOfMode === 'range') {
        opts.as_of_from = asOfFrom;
        opts.as_of_to = asOfTo;
        opts.as_of_mode = 'range';
        opts.as_of = asOfTo;
      }

      const data = await getInventoryValuationReport(opts);
      if (seq !== requestSeq.current) return;
      const next = (data || { rows: [] }) as ValuationPayload;
      setPayload(next);
      setLoadStatus(resolveReportStatus(next.rows || [], (rows) => rows.length === 0));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      const message = reportLoadErrorMessage(error, "Ombor baholash ma'lumotlarini yuklab bo'lmadi");
      setLoadError(message);
      setPayload({ rows: [] });
      setLoadStatus('error');
      telemetryFromReportError('reports/inventory/valuation', 'getInventoryValuationReport', error, cid, user?.role);
    }
  }, [
    warehouseId,
    statusFilter,
    categoryFilter,
    debouncedSearch,
    sortField,
    sortOrder,
    costMethod,
    diffsOnly,
    page,
    asOfMode,
    asOfDate,
    asOfFrom,
    asOfTo,
    user?.role,
  ]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const getStockStatus = (product: ValuationRow) => {
    const stock = Number(product.current_stock || 0);
    const minStock = Number(product.min_stock_level || 0);
    if (stock <= 0) return { label: 'Tugagan', className: 'bg-destructive text-white' };
    if (stock <= minStock) return { label: 'Kam zaxira', className: 'bg-warning text-white' };
    return { label: 'Omborda bor', className: 'bg-success text-white' };
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      set({ order: sortOrder === 'asc' ? 'desc' : 'asc', page: '1' });
    } else {
      set({ sort: field, order: 'asc', page: '1' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(Number(summary?.products_total || products.length || 1) / PAGE_SIZE));

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (!products.length) {
      toast({ title: 'Eksport', description: "Eksport qilish uchun ma'lumot yo'q", variant: 'destructive' });
      return;
    }
    const selectedMethodLabel = methodLabel(costMethod);
    const skuLabel = t('reports.valuation.export.sku', 'Artikul');
    const asOfLabel = asOfMode === 'range' ? `${asOfFrom} — ${asOfTo}` : asOfMode === 'date' ? asOfDate : todayYMD();
    const headers = compare
      ? [
          'Mahsulot',
          skuLabel,
          'Kategoriya',
          'Qoldiq',
          t('reports.valuation.export.wavg_cost', 'O‘rtacha tannarx'),
          t('reports.valuation.export.fifo_cost', 'FIFO tannarx'),
          t('reports.valuation.export.wavg_value', 'O‘rtacha qiymat'),
          t('reports.valuation.export.fifo_value', 'FIFO qiymat'),
          'Farq',
          'Farq %',
        ]
      : ['Mahsulot', skuLabel, 'Kategoriya', 'Qoldiq', 'Birlik tannarx', 'Ombor qiymati'];
    const body = products.map((p) =>
      compare
        ? [
            p.product_name,
            p.product_sku || '',
            p.category_name || '',
            formatQuantity(Number(p.current_stock || 0), p.unit || undefined),
            Number(p.wavg_unit_cost || 0),
            Number(p.fifo_unit_cost || 0),
            Number(p.wavg_value || 0),
            Number(p.fifo_value || 0),
            Number(p.diff_amount || 0),
            Number(p.diff_pct || 0),
          ]
        : [
            p.product_name,
            p.product_sku || '',
            p.category_name || '',
            formatQuantity(Number(p.current_stock || 0), p.unit || undefined),
            Number(p.unit_cost || 0),
            Number(p.stock_value || 0),
          ],
    );
    const metaLines = [
      ['Baholash hisoboti'],
      ['Holat sanasi', asOfLabel],
      ['Vaqt zonasi', meta?.timezone || 'Asia/Tashkent'],
      ['Tannarx metodi', selectedMethodLabel],
      ['Hisoblash vaqti', meta?.computed_at || ''],
      ['Maʼlumot manbasi', meta?.data_source || ''],
      [t('reports.valuation.export.total_wavg', 'Jami o‘rtacha'), Number(summary?.wavg_total || 0)],
      [t('reports.valuation.export.total_fifo', 'Jami FIFO'), Number(summary?.fifo_total || 0)],
      ['Jami farq', Number(summary?.diff_amount || 0)],
      ['Tanlangan jami', Number(summary?.total_value || 0)],
    ];
    const suffix = `${asOfLabel}_${costMethod}`.replace(/\s+/g, '-');
    try {
      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...metaLines, [], headers, ...body]);
        XLSX.utils.book_append_sheet(wb, ws, 'Baholash');
        if (series.length) {
          const seriesSheet = XLSX.utils.aoa_to_sheet([
            [
              'Sana',
              t('reports.valuation.export.series_wavg', 'O‘rtacha'),
              t('reports.valuation.export.series_fifo', 'FIFO'),
              'Farq',
              'Jami (tanlangan)',
              'Qoldiq',
            ],
            ...series.map((s) => [
              s.as_of_date,
              s.wavg_total,
              s.fifo_total,
              s.diff_amount,
              s.total_value,
              s.total_quantity,
            ]),
          ]);
          XLSX.utils.book_append_sheet(wb, seriesSheet, 'Dinamika');
        }
        XLSX.writeFile(wb, `ombor-qiymati_${suffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text('Ombor baholash hisoboti', 14, 12);
        doc.setFontSize(8);
        doc.text(
          `Sana: ${asOfLabel} · TZ: ${meta?.timezone || 'Asia/Tashkent'} · Metod: ${selectedMethodLabel} · ${meta?.computed_at || ''}`,
          14,
          18,
        );
        doc.text(
          t('reports.valuation.export.pdf_totals', {
            defaultValue: 'O‘rtacha: {{wavg}}  FIFO: {{fifo}}  Farq: {{diff}}',
            wavg: formatMoneyUZS(Number(summary?.wavg_total || 0)),
            fifo: formatMoneyUZS(Number(summary?.fifo_total || 0)),
            diff: formatMoneyUZS(Number(summary?.diff_amount || 0)),
          }),
          14,
          23,
        );
        autoTable(doc, {
          head: [headers],
          body: body.map((row) =>
            row.map((cell, idx) =>
              idx >= (compare ? 4 : 4) && typeof cell === 'number' ? formatMoneyUZS(cell) : String(cell),
            ),
          ),
          startY: 27,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`ombor-qiymati_${suffix}.pdf`);
      }
      toast({ title: 'Eksport', description: `${format.toUpperCase()} yuklab olindi` });
    } catch (err: any) {
      toast({ title: 'Xatolik', description: err?.message || 'Eksport bajarilmadi', variant: 'destructive' });
    }
  };

  const SortButton = ({ field, children }: { field: SortField; children: ReactNode }) => (
    <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => handleSort(field)}>
      {children}
      <ArrowUpDown className="h-4 w-4" />
    </Button>
  );

  const phantomBatchValue = Number(summary?.phantom_batch_value || 0);
  const titleDate = asOfMode === 'range' ? `${asOfFrom} — ${asOfTo}` : asOfMode === 'date' ? asOfDate : todayYMD();
  const hasWarnings =
    Boolean(warnings?.valuation_mismatch) || phantomBatchValue > 0.009 || Boolean(warnings?.dashboard_divergence);
  const selectedTotal = Number(summary?.total_value || 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="page-heading">Baholash hisobotlari</h1>
            <p className="truncate text-xs text-muted-foreground">
              Holat sanasi: {titleDate} · {meta?.timezone || 'Asia/Tashkent'} · {methodLabel(costMethod, true)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleExport('excel')}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            {t('reports.valuation.export.excel', 'Excel')}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleExport('pdf')}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            {t('reports.valuation.export.pdf', 'PDF')}
          </Button>
        </div>
      </div>

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="group">
        <Card className="gap-0 py-0 shadow-sm">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left sm:px-4"
              aria-expanded={filtersOpen}
            >
              <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-semibold">Filtrlar / jami</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Tanlangan usul jami:{' '}
                  <span className="font-semibold text-success">{formatMoneyUZS(selectedTotal)}</span>
                  <span className="text-muted-foreground"> · {methodLabel(costMethod, true)}</span>
                </span>
                {hasWarnings && !filtersOpen ? (
                  <span className="text-[10px] font-medium text-destructive">Ogohlantirishlar bor</span>
                ) : null}
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-3 border-t px-3 pb-3 pt-2 sm:px-4">
              {hasWarnings ? (
                <div className="space-y-0.5 text-[11px] leading-snug text-destructive">
                  {phantomBatchValue > 0.009 ? (
                    <p>
                      {summary?.phantom_product_count || 0} mahsulotda zaxiradan tashqari yopilmagan partiya qiymati
                      bor (ombor qiymatiga kiritilmagan).
                    </p>
                  ) : null}
                  {warnings?.valuation_mismatch ? (
                    <p>
                      {t('reports.valuation.warnings.mismatch', {
                        defaultValue: 'FIFO − o‘rtacha farqi: {{diff}}. O‘rtacha: {{wavg}}, FIFO: {{fifo}}.',
                        diff: formatMoneyUZS(Number(warnings.valuation_diff_amount ?? summary?.diff_amount ?? 0)),
                        wavg: formatMoneyUZS(Number(summary?.wavg_total || 0)),
                        fifo: formatMoneyUZS(Number(summary?.fifo_total || 0)),
                      })}
                    </p>
                  ) : null}
                  {warnings?.dashboard_divergence ? (
                    <p>Hisobot qiymati moliyaviy bosh sahifa bilan mos kelmadi.</p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Ombor
                    </label>
                    <SearchableCombobox
                      value={warehouseId}
                      onValueChange={(v) => set({ warehouse: v, page: '1' })}
                      options={warehouseOptions}
                      placeholder="Ombor"
                      searchPlaceholder="Qidirish..."
                      emptyMessage="Topilmadi"
                      triggerClassName="h-8"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Kategoriya
                    </label>
                    <Select value={categoryFilter} onValueChange={(v) => set({ category: v, page: '1' })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Barcha kategoriyalar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Ombor holati
                    </label>
                    <Select value={statusFilter} onValueChange={(v) => set({ status: v, page: '1' })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Barchasi" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barchasi</SelectItem>
                        <SelectItem value="ok">Omborda bor</SelectItem>
                        <SelectItem value="low">Kam zaxira</SelectItem>
                        <SelectItem value="out_of_stock">Tugagan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Qidirish
                    </label>
                    <Input
                      placeholder={t('reports.valuation.filters.search_ph', 'Nomi yoki artikul...')}
                      value={searchTerm}
                      onChange={(e) => set({ search: e.target.value, page: '1' })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Baholash usuli
                    </label>
                    <Select
                      value={costMethod}
                      onValueChange={(v) =>
                        set({
                          method: v,
                          page: '1',
                          diffs: v === 'compare' ? '1' : '0',
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weighted_average">
                          {t('reports.valuation.methods.weighted_average', 'O‘rtacha og‘irlikli tannarx')}
                        </SelectItem>
                        <SelectItem value="fifo">
                          {t('reports.valuation.methods.fifo', 'FIFO (birinchi kirim — birinchi chiqim)')}
                        </SelectItem>
                        <SelectItem value="compare">
                          {t('reports.valuation.methods.compare', 'Solishtirish')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Holat sanasi
                    </label>
                    <Select value={asOfMode} onValueChange={(v) => set({ asOfMode: v, page: '1' })}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Bugungi holat</SelectItem>
                        <SelectItem value="date">Aniq sana</SelectItem>
                        <SelectItem value="range">Sana oralig‘i (dinamika)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {asOfMode === 'date' ? (
                    <div className="min-w-0">
                      <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Sana
                      </label>
                      <Input
                        type="date"
                        value={asOfDate}
                        onChange={(e) => set({ asOf: e.target.value, page: '1' })}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                  ) : null}
                  {asOfMode === 'range' ? (
                    <>
                      <div className="min-w-0">
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Dan
                        </label>
                        <Input
                          type="date"
                          value={asOfFrom}
                          onChange={(e) => set({ asOfFrom: e.target.value, page: '1' })}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Gacha
                        </label>
                        <Input
                          type="date"
                          value={asOfTo}
                          onChange={(e) => set({ asOfTo: e.target.value, page: '1' })}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="flex items-end gap-2 pb-1.5">
                    <Checkbox
                      id="diffs-only"
                      checked={diffsOnly}
                      onCheckedChange={(v) => set({ diffs: v ? '1' : '0', page: '1' })}
                    />
                    <label htmlFor="diffs-only" className="text-xs leading-tight">
                      Faqat farqi bor mahsulotlar
                    </label>
                  </div>
                </div>
                {revisions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-muted-foreground/25 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Reviziya yakuni:
                    </span>
                    {revisions.map((rev) => {
                      const ymd = String(rev.completed_at || '').slice(0, 10);
                      if (!ymd) return null;
                      return (
                        <Button
                          key={rev.id}
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => set({ asOfMode: 'date', asOf: ymd, page: '1' })}
                        >
                          {rev.revision_number || ymd} · {ymd}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div className="rounded-md border bg-background px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Tanlangan usul jami
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-success sm:text-base">
                    {formatMoneyUZS(selectedTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{methodLabel(costMethod, true)}</p>
                </div>
                <div className="rounded-md border bg-background px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('reports.valuation.summary.wavg', 'O‘rtacha tannarx')}
                  </p>
                  <p className="text-sm font-semibold tabular-nums sm:text-base">
                    {formatMoneyUZS(Number(summary?.wavg_total || 0))}
                  </p>
                </div>
                <div className="rounded-md border bg-background px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('reports.valuation.summary.fifo', 'FIFO partiya')}
                  </p>
                  <p className="text-sm font-semibold tabular-nums sm:text-base">
                    {formatMoneyUZS(Number(summary?.fifo_total || 0))}
                  </p>
                </div>
                <div className="rounded-md border bg-background px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('reports.valuation.summary.diff', 'Farq (FIFO − o‘rtacha)')}
                  </p>
                  <p className="text-sm font-semibold tabular-nums sm:text-base">
                    {formatMoneyUZS(Number(summary?.diff_amount || 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {Number(summary?.products_total || products.length)} mahsulot
                  </p>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {series.length > 0 ? (
        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b px-3 py-2 sm:px-4">
            <CardTitle className="text-sm">Kunlik qiymat dinamikasi</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sana</TableHead>
                  <TableHead className="text-right">
                    {t('reports.valuation.table.series_wavg', 'O‘rtacha')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('reports.valuation.table.series_fifo', 'FIFO')}
                  </TableHead>
                  <TableHead className="text-right">Farq</TableHead>
                  <TableHead className="text-right">Tanlangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((s) => (
                  <TableRow key={s.as_of_date}>
                    <TableCell>{s.as_of_date}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(s.wavg_total)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(s.fifo_total)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(s.diff_amount)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(s.total_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="p-0">
          {loadStatus !== 'success' ? (
            <ReportLoadPanel
              status={loadStatus}
              error={loadError}
              correlationId={correlationId}
              onRetry={() => void loadData()}
              emptyTitle="Mahsulot topilmadi"
              emptyDescription="Qidiruv yoki filtrga mos mahsulot yo‘q. Qidiruvni tozalang yoki filtrlarni o‘zgartiring."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <SortButton field="name">Mahsulot nomi</SortButton>
                    </TableHead>
                    <TableHead>{t('reports.valuation.table.sku', 'Artikul')}</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead className="text-right">
                      <SortButton field="stock">Joriy zaxira</SortButton>
                    </TableHead>
                    {compare ? (
                      <>
                        <TableHead className="text-right">
                          {t('reports.valuation.table.wavg_cost', 'O‘rt. tannarx')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('reports.valuation.table.fifo_cost', 'FIFO tannarx')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('reports.valuation.table.wavg_value', 'O‘rt. qiymat')}
                        </TableHead>
                        <TableHead className="text-right">
                          {t('reports.valuation.table.fifo_value', 'FIFO qiymat')}
                        </TableHead>
                        <TableHead className="text-right">
                          <SortButton field="diff">Farq</SortButton>
                        </TableHead>
                        <TableHead className="text-right">Farq %</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead className="text-right">Birlik tannarx</TableHead>
                        <TableHead className="text-right">
                          <SortButton field="value">Ombor qiymati</SortButton>
                        </TableHead>
                      </>
                    )}
                    {phantomBatchValue > 0.009 ? <TableHead className="text-right">Partiya farqi</TableHead> : null}
                    <TableHead>Holati</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => {
                    const qty = Number(product.current_stock || 0);
                    const status = getStockStatus(product);
                    return (
                      <TableRow key={product.product_id}>
                        <TableCell className="font-medium">{product.product_name}</TableCell>
                        <TableCell>{product.product_sku || '-'}</TableCell>
                        <TableCell>{product.category_name || '-'}</TableCell>
                        <TableCell className="text-right">{formatQuantity(qty, product.unit || undefined)}</TableCell>
                        {compare ? (
                          <>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.wavg_unit_cost || 0))}</TableCell>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.fifo_unit_cost || 0))}</TableCell>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.wavg_value || 0))}</TableCell>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.fifo_value || 0))}</TableCell>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.diff_amount || 0))}</TableCell>
                            <TableCell className="text-right">{Number(product.diff_pct || 0).toFixed(2)}%</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right">{formatMoneyUZS(Number(product.unit_cost || 0))}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatMoneyUZS(Number(product.stock_value || 0))}
                            </TableCell>
                          </>
                        )}
                        {phantomBatchValue > 0.009 ? (
                          <TableCell className="text-right text-destructive">
                            {Number(product.phantom_batch_value || 0) > 0.009
                              ? formatMoneyUZS(Number(product.phantom_batch_value || 0))
                              : '—'}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Badge className={status.className}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {totalPages > 1 ? (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    Sahifa {page} / {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => set({ page: String(page - 1) })}
                    >
                      Oldingi
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => set({ page: String(page + 1) })}
                    >
                      Keyingi
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {meta ? (
        <p className="text-xs text-muted-foreground">
          Hisoblash vaqti: {meta.computed_at || '—'} · Vaqt zonasi: {meta.timezone || 'Asia/Tashkent'} · Tannarx metodi:{' '}
          {methodLabel(costMethod)} · Manba: {meta.data_source || '—'}
        </p>
      ) : null}
    </div>
  );
}
