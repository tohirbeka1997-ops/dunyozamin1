import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategories, getProducts, getWarehouses } from '@/db/api';
import type { Category, Product, Warehouse } from '@/types/database';
import { ArrowLeft, FileDown, Package, Scale } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { formatDateYMD, formatDateTime, todayYMD } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useReportFilters } from '@/hooks/useReportFilters';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import { useTranslation } from 'react-i18next';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ActRow {
  product_id: string;
  product_name: string;
  product_sku: string;
  category_name: string;
  unit?: string;
  opening_qty?: number;
  opening_unit_cost?: number;
  opening_value?: number;
  purchase_qty: number;
  purchase_amount: number;
  sold_qty: number;
  sold_revenue: number;
  sold_cogs: number;
  return_qty: number;
  return_amount: number;
  return_cogs: number;
  outbound_qty?: number;
  revision_qty?: number;
  transfer_qty?: number;
  closing_qty?: number;
  closing_value?: number;
  net_sold_qty: number;
  net_revenue: number;
  net_cogs: number;
  net_profit: number;
  gross_profit?: number;
  profit_margin_percent: number;
  cost_method?: string;
}

interface ActPayload {
  period?: { date_from: string; date_to: string; timezone?: string };
  rows: ActRow[];
  totals?: {
    purchase_qty: number;
    purchase_amount: number;
    sold_qty: number;
    sold_revenue: number;
    return_qty: number;
    return_amount: number;
    opening_qty?: number;
    opening_value?: number;
    closing_qty?: number;
    closing_value?: number;
    net_cogs?: number;
    net_revenue: number;
    net_profit: number;
    product_count: number;
    profit_margin_percent: number;
    cost_method?: string;
  };
  meta?: {
    computed_at?: string;
    timezone?: string;
    cost_method?: string;
    data_source?: string;
    opening_as_of?: string;
    closing_as_of?: string;
  };
}

type SortKey =
  | 'product_name'
  | 'category_name'
  | 'purchase_qty'
  | 'purchase_amount'
  | 'net_sold_qty'
  | 'net_revenue'
  | 'net_profit'
  | 'profit_margin_percent';

interface HistoryRow {
  event_at: string;
  event_kind: string;
  event_label: string;
  doc_no: string | null;
  doc_id: string | null;
  doc_type: string;
  counterparty: string;
  payment_label?: string | null;
  qty_in: number;
  qty_out: number;
  amount_uzs: number;
  line_id: string;
  running_qty: number;
}

export default function ProductActSverkaReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ActPayload | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productOptions, setProductOptions] = useState<Product[]>([]);
  const defaultFrom = useMemo(() => {
    const t = new Date();
    t.setTime(t.getTime() - 30 * 86400000);
    return formatDateYMD(t, { timeZone: 'Asia/Tashkent' });
  }, []);
  const { get, set } = useReportFilters({
    storageKey: 'reports.product-act-sverka.filters',
    trackedKeys: ['from', 'to', 'category', 'product', 'warehouse', 'method', 'search'],
    defaults: {
      from: defaultFrom,
      to: todayYMD(),
      category: 'all',
      product: 'all',
      warehouse: 'all',
      method: 'weighted_average',
      search: '',
    },
  });
  const dateFrom = get('from', defaultFrom) || defaultFrom;
  const dateTo = get('to', todayYMD()) || todayYMD();
  const categoryFilter = get('category', 'all') || 'all';
  const productId = get('product', 'all') || 'all';
  const warehouseId = get('warehouse', 'all') || 'all';
  const costMethod = get('method', 'weighted_average') || 'weighted_average';
  const searchTerm = get('search', '');
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<HistoryRow[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

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

  const productPickerOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_products', 'Hammasi') },
      ...productOptions
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((product) => ({
          value: product.id,
          label: `${product.name} (${product.sku})`,
          keywords: [product.sku, product.barcode].filter(Boolean).join(' '),
        })),
    ],
    [productOptions, t]
  );

  const { sortKey, sortOrder, toggleSort } = useTableSort<SortKey>('net_revenue', 'desc');

  const loadData = useCallback(async () => {
    try {
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: "Bu hisobot faqat desktop ilovada.", variant: 'destructive' });
        setLoading(false);
        return;
      }
      setLoading(true);
      if (productId !== 'all') {
        setHistoryLoading(true);
      } else {
        setHistoryRows([]);
      }
      const api = requireElectron();
      const summaryPromise = handleIpcResponse<ActPayload | ActRow[]>(
        api.reports?.productActSverkaByPeriod?.({
          date_from: dateFrom,
          date_to: dateTo,
          category_id: categoryFilter === 'all' ? undefined : categoryFilter,
          product_id: productId === 'all' ? undefined : productId,
          warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
          cost_method: costMethod,
          search: searchTerm.trim() || undefined,
        }) || Promise.resolve({ rows: [] })
      );
      const historyPromise =
        productId !== 'all'
          ? handleIpcResponse<{ rows: HistoryRow[] }>(
              api.reports?.productDocumentHistory?.({
                product_id: productId,
                date_from: dateFrom,
                date_to: dateTo,
                warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
              }) || Promise.resolve({ rows: [] })
            )
          : Promise.resolve({ rows: [] });

      const [res, hist] = await Promise.all([summaryPromise, historyPromise]);

      if (Array.isArray(res)) {
        setPayload({ rows: res, totals: undefined, period: undefined });
      } else {
        setPayload(res || { rows: [] });
      }
      setHistoryRows(Array.isArray(hist?.rows) ? hist.rows : []);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Xatolik', description: e?.message || "Yuklab bo'lmadi", variant: 'destructive' });
      setPayload({ rows: [] });
      setHistoryRows([]);
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [dateFrom, dateTo, categoryFilter, productId, warehouseId, costMethod, searchTerm, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    (async () => {
      try {
        const [c, w, p] = await Promise.all([
          getCategories(),
          getWarehouses(),
          getProducts(true, { limit: 2000, sortBy: 'name', sortOrder: 'asc' }),
        ]);
        setCategories(c || []);
        setWarehouses((w as Warehouse[]) || []);
        setProductOptions((p as Product[]) || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  useReportAutoRefresh(loadData);

  const rows = payload?.rows || [];
  const totals = payload?.totals;

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const q = searchTerm.toLowerCase();
    return rows.filter(
      (r) =>
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.product_sku || '').toLowerCase().includes(q) ||
        (r.category_name || '').toLowerCase().includes(q)
    );
  }, [rows, searchTerm]);

  const sortedForTable = useMemo(() => {
    const list = [...filtered];
    const ord = sortOrder;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'product_name':
          cmp = compareScalar(
            (a.product_name || '').toLowerCase(),
            (b.product_name || '').toLowerCase(),
            ord
          );
          break;
        case 'category_name':
          cmp = compareScalar(
            (a.category_name || '').toLowerCase(),
            (b.category_name || '').toLowerCase(),
            ord
          );
          break;
        case 'purchase_qty':
          cmp = compareScalar(a.purchase_qty, b.purchase_qty, ord);
          break;
        case 'purchase_amount':
          cmp = compareScalar(a.purchase_amount, b.purchase_amount, ord);
          break;
        case 'net_sold_qty':
          cmp = compareScalar(a.net_sold_qty, b.net_sold_qty, ord);
          break;
        case 'net_revenue':
          cmp = compareScalar(a.net_revenue, b.net_revenue, ord);
          break;
        case 'net_profit':
          cmp = compareScalar(a.net_profit, b.net_profit, ord);
          break;
        case 'profit_margin_percent':
          cmp = compareScalar(a.profit_margin_percent, b.profit_margin_percent, ord);
          break;
        default:
          cmp = 0;
      }
      if (cmp !== 0) return cmp;
      return (a.product_name || '').localeCompare(b.product_name || '', 'uz');
    });
    return list;
  }, [filtered, sortKey, sortOrder]);

  const handleExport = async () => {
    if (!isElectron()) {
      toast({ title: 'Xatolik', description: "Eksport faqat desktop.", variant: 'destructive' });
      return;
    }
    const api = requireElectron();
    const headers = [
      'product_name',
      'product_sku',
      'opening_qty',
      'opening_value',
      'purchase_qty',
      'purchase_amount',
      'sold_qty',
      'return_qty',
      'net_cogs',
      'closing_qty',
      'closing_value',
      'net_revenue',
      'net_profit',
      'profit_margin_percent',
      'cost_method',
    ];
    const escape = (v: any) => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(','), ...sortedForTable.map((r) => headers.map((h) => escape((r as any)[h])).join(','))];
    const t = todayYMD();
    await api.files.saveTextFile({
      defaultFileName: `product-act-sverka-${t}.csv`,
      content: lines.join('\n'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      encoding: 'utf8',
    });
    toast({ title: 'CSV saqlandi' });
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedHistory([]);
      return;
    }
    if (!isElectron()) return;
    setExpandedId(id);
    setExpandedLoading(true);
    try {
      const api = requireElectron();
      const hist = await handleIpcResponse<{ rows: HistoryRow[] }>(
        api.reports?.productDocumentHistory?.({
          product_id: id,
          date_from: dateFrom,
          date_to: dateTo,
          warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
        }) || Promise.resolve({ rows: [] }),
      );
      setExpandedHistory(Array.isArray(hist?.rows) ? hist.rows : []);
    } catch {
      setExpandedHistory([]);
    } finally {
      setExpandedLoading(false);
    }
  };

  const exportHistoryCsv = async () => {
    if (!isElectron() || productId === 'all' || !historyRows.length) {
      toast({ title: 'Batafsil', description: 'Bitta mahsulotni tanlang va tarixni yuklang.', variant: 'default' });
      return;
    }
    const api = requireElectron();
    const headers = [
      'event_at',
      'event_label',
      'doc_no',
      'doc_type',
      'counterparty',
      'payment_label',
      'qty_in',
      'qty_out',
      'amount_uzs',
      'running_qty',
    ];
    const esc = (v: any) => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const body = historyRows
      .map((r) =>
        [
          r.event_at,
          r.event_label,
          r.doc_no,
          r.doc_type,
          r.counterparty,
          r.payment_label || '',
          r.qty_in,
          r.qty_out,
          r.amount_uzs,
          r.running_qty,
        ]
          .map(esc)
          .join(',')
      )
      .join('\n');
    await api.files.saveTextFile({
      defaultFileName: `product-tarix-${productId}-${dateFrom}-${dateTo}.csv`,
      content: [headers.join(','), body].join('\n'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      encoding: 'utf8',
    });
    toast({ title: 'Tarix CSV saqlandi' });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading flex items-center gap-2 text-xl">
              <Scale className="h-6 w-6 text-primary" />
              Mahsulot bo‘yicha akt sverka
            </h1>
            <p className="text-muted-foreground text-xs max-w-3xl leading-4">
              Yig‘ma jadval: ombor kirimi (qabul fakturalari), sotuv, qaytarishlar, sof daromad va foyda (Tashkent sanasi,
              UTC+5). Bitta mahsulotni tanlang — pastda qachon, qancha, kimga (yoki yetkazib beruvchidan) bo‘lgani
              bo‘yicha batafsil jadval chiqadi. Partiyalar va FIFO: Hisobotlar → Mahsulot tarixi (Traceability).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            PDF / chop etish
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
          {productId !== 'all' && historyRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportHistoryCsv}>
              <FileDown className="h-4 w-4 mr-2" />
              Tarix (CSV)
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Boshlanish</label>
              <Input type="date" value={dateFrom} onChange={(e) => set({ from: e.target.value })} className="mt-1 h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tugash</label>
              <Input type="date" value={dateTo} onChange={(e) => set({ to: e.target.value })} className="mt-1 h-8" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ombor (ixtiyoriy)</label>
              <SearchableCombobox
                value={warehouseId}
                onValueChange={(v) => set({ warehouse: v })}
                options={warehouseOptions}
                placeholder={t('combobox.all_warehouses', 'Barcha omborlar')}
                searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
                triggerClassName="mt-1 h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kategoriya</label>
              <SearchableCombobox
                value={categoryFilter}
                onValueChange={(v) => set({ category: v })}
                options={categoryOptions}
                placeholder={t('combobox.select_category', 'Kategoriyani tanlang...')}
                searchPlaceholder={t('combobox.search_category', "Kategoriya nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_category', 'Kategoriya topilmadi')}
                triggerClassName="mt-1 h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Mahsulot (ixtiyoriy)</label>
              <SearchableCombobox
                value={productId}
                onValueChange={(v) => set({ product: v })}
                options={productPickerOptions}
                placeholder={t('combobox.select_product', 'Mahsulotni tanlang...')}
                searchPlaceholder={t('combobox.search_product', "Nom, SKU yoki shtrix-kod bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_product', 'Mahsulot topilmadi')}
                triggerClassName="mt-1 h-8"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Qidirish (mahsulot, SKU, kategoriya)</label>
              <Input
                className="mt-1 h-8"
                value={searchTerm}
                onChange={(e) => set({ search: e.target.value })}
                placeholder="Jadval filtri..."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tannarx metodi</label>
              <Select value={costMethod} onValueChange={(v) => set({ method: v })}>
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weighted_average">Weighted average</SelectItem>
                  <SelectItem value="fifo">FIFO</SelectItem>
                  <SelectItem value="compare">Solishtirish (FIFO vs WAvg)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {totals && (
        <Card>
          <CardContent className="py-2 px-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="rounded-md border px-2 py-1">
                <p className="text-[11px] text-muted-foreground">Kirim</p>
                <p className="text-sm font-semibold leading-5">{formatMoneyUZS(totals.purchase_amount)}</p>
                <p className="text-[11px] text-muted-foreground">Miqdor: {formatNumberUZ(totals.purchase_qty)}</p>
              </div>
              <div className="rounded-md border px-2 py-1">
                <p className="text-[11px] text-muted-foreground">Sotuv</p>
                <p className="text-sm font-semibold leading-5">{formatMoneyUZS(totals.sold_revenue)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Qaytarish: {totals.return_amount > 0 ? `−${formatMoneyUZS(totals.return_amount)}` : '—'}
                </p>
              </div>
              <div className="rounded-md border px-2 py-1">
                <p className="text-[11px] text-muted-foreground">Sof daromad</p>
                <p className="text-sm font-semibold leading-5">{formatMoneyUZS(totals.net_revenue)}</p>
              </div>
              <div className="rounded-md border px-2 py-1">
                <p className="text-[11px] text-muted-foreground">Foyda · {totals.product_count} mahsulot</p>
                <p className={`text-sm font-semibold leading-5 ${totals.net_profit >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {formatMoneyUZS(totals.net_profit)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Marja: {formatNumberUZ(totals.profit_margin_percent)}% · COGS: {totals.cost_method || payload?.meta?.cost_method || 'weighted_average'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {sortedForTable.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Maʼlumot yo‘q yoki filtrga mos emas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead<SortKey>
                      columnKey="product_name"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="string"
                    >
                      Mahsulot
                    </SortableTableHead>
                    <SortableTableHead<SortKey>
                      columnKey="category_name"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="string"
                    >
                      Kategoriya
                    </SortableTableHead>
                    <TableHead className="text-right">Bosh. qoldiq</TableHead>
                    <TableHead className="text-right">Bosh. tannarx</TableHead>
                    <SortableTableHead<SortKey>
                      columnKey="purchase_qty"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Kirim (miq.)
                    </SortableTableHead>
                    <SortableTableHead<SortKey>
                      columnKey="purchase_amount"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Kirim (soʻm)
                    </SortableTableHead>
                    <TableHead className="text-right">Sot. miq.</TableHead>
                    <TableHead className="text-right">Qayt.</TableHead>
                    <TableHead className="text-right">Reviziya</TableHead>
                    <TableHead className="text-right">O‘tkazma</TableHead>
                    <TableHead className="text-right">Boshqa chiqim</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Oxir. qoldiq</TableHead>
                    <TableHead className="text-right">Oxir. qiymat</TableHead>
                    <SortableTableHead<SortKey>
                      columnKey="net_revenue"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Sof tushum
                    </SortableTableHead>
                    <SortableTableHead<SortKey>
                      columnKey="net_profit"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Foyda
                    </SortableTableHead>
                    <SortableTableHead<SortKey>
                      columnKey="profit_margin_percent"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Marja %
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedForTable.map((r) => (
                    <Fragment key={r.product_id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => void toggleExpand(r.product_id)}
                    >
                      <TableCell>
                        <div className="font-medium">{r.product_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.product_sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.category_name || '—'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatQuantity(Number(r.opening_qty || 0), r.unit)}
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(Number(r.opening_value || 0))}</TableCell>
                      <TableCell className="text-right font-mono">{formatQuantity(r.purchase_qty, r.unit)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(r.purchase_amount)}</TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono">
                        {formatQuantity(r.sold_qty, r.unit)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        {r.return_qty > 0 ? `−${formatQuantity(r.return_qty, r.unit)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono text-xs">
                        {Number(r.revision_qty || 0) ? formatQuantity(Number(r.revision_qty || 0), r.unit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono text-xs">
                        {Number(r.transfer_qty || 0) ? formatQuantity(Number(r.transfer_qty || 0), r.unit) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground font-mono text-xs">
                        {Number(r.outbound_qty || 0) ? formatQuantity(Number(r.outbound_qty || 0), r.unit) : '—'}
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(Number(r.net_cogs || 0))}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatQuantity(Number(r.closing_qty || 0), r.unit)}
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(Number(r.closing_value || 0))}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(r.net_revenue)}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          r.net_profit >= 0 ? 'text-emerald-600' : 'text-destructive'
                        }`}
                      >
                        {formatMoneyUZS(r.net_profit)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumberUZ(r.profit_margin_percent)}%</TableCell>
                    </TableRow>
                    {expandedId === r.product_id ? (
                      <TableRow>
                        <TableCell colSpan={17} className="bg-muted/30">
                          {expandedLoading ? (
                            <p className="text-sm text-muted-foreground py-2">Yuklanmoqda...</p>
                          ) : expandedHistory.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2">Harakatlar topilmadi.</p>
                          ) : (
                            <div className="max-h-64 overflow-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Sana</TableHead>
                                    <TableHead>Amal</TableHead>
                                    <TableHead>Hujjat</TableHead>
                                    <TableHead>Tomon</TableHead>
                                    <TableHead className="text-right">Kirim</TableHead>
                                    <TableHead className="text-right">Chiqim</TableHead>
                                    <TableHead className="text-right">Qoldiq</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {expandedHistory.map((h, i) => (
                                    <TableRow key={`${h.line_id || i}-${h.event_at}`}>
                                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(h.event_at)}</TableCell>
                                      <TableCell className="text-xs">{h.event_label}</TableCell>
                                      <TableCell className="text-xs">{h.doc_no || h.doc_type}</TableCell>
                                      <TableCell className="text-xs">{h.counterparty || '—'}</TableCell>
                                      <TableCell className="text-right font-mono text-xs">
                                        {h.qty_in > 0 ? formatQuantity(h.qty_in, r.unit) : '—'}
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-xs">
                                        {h.qty_out > 0 ? formatQuantity(h.qty_out, r.unit) : '—'}
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-xs">
                                        {formatQuantity(h.running_qty, r.unit)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {productId !== 'all' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">To‘liq harakatlar tarixi (batafsil)</CardTitle>
            <p className="text-sm text-muted-foreground font-normal">
              {productOptions.find((p) => p.id === productId)?.name || 'Mahsulot'} — qabul, sotuv, mijoz qaytarishlari; vaqti
              va mijoz yoki yetkazib beruvchi. Birinchi qatorda «Davr oldi qoldiq»: tanlangan davr boshigacha
              ombor bo‘yicha hujjatlarga ko‘ra hisoblangan miqdor. Keyingi qatorlardagi qoldiq shu zanjirdan yig‘iladi.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {historyLoading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : historyRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                Hujjat qatorlari topilmadi (davr yoki ombor filtrini tekshiring; qabul/ buyurtma/ qaytarish bo‘lishi
                kerak).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana / vaqt</TableHead>
                      <TableHead>Amal</TableHead>
                      <TableHead>Hujjat</TableHead>
                      <TableHead>Tomon (kimga / kimdan)</TableHead>
                      <TableHead>To‘lov usuli</TableHead>
                      <TableHead className="text-right">Kirim (dona)</TableHead>
                      <TableHead className="text-right">Chiqim (dona)</TableHead>
                      <TableHead className="text-right">So‘m (qator)</TableHead>
                      <TableHead className="text-right">Qoldiq (dona)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.map((h, i) => (
                      <TableRow
                        key={`${h.line_id || i}-${h.event_at}-${h.doc_type}`}
                        className={h.event_kind === 'opening_balance' ? 'bg-muted/40' : undefined}
                      >
                        <TableCell className="whitespace-nowrap text-sm">{formatDateTime(h.event_at)}</TableCell>
                        <TableCell className="text-sm">
                          <span
                            className={
                              h.event_kind === 'opening_balance'
                                ? 'text-muted-foreground'
                                : h.event_kind === 'sale'
                                  ? 'text-blue-600'
                                  : h.event_kind === 'receipt'
                                    ? 'text-emerald-600'
                                    : 'text-amber-600'
                            }
                          >
                            {h.event_label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {h.doc_no || '—'}
                          <div className="text-xs text-muted-foreground font-mono">{h.doc_type}</div>
                        </TableCell>
                        <TableCell className="text-sm max-w-[220px]">{h.counterparty || '—'}</TableCell>
                        <TableCell className="text-sm">{h.payment_label || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700">
                          {h.qty_in > 0 ? formatNumberUZ(h.qty_in) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-blue-700">
                          {h.qty_out > 0 ? formatNumberUZ(h.qty_out) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatMoneyUZS(h.amount_uzs)}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{formatNumberUZ(h.running_qty)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {payload?.meta ? (
        <p className="text-xs text-muted-foreground">
          Hisoblash vaqti: {payload.meta.computed_at || '—'} · Vaqt zonasi: {payload.meta.timezone || 'Asia/Tashkent'} ·
          Tannarx metodi: {payload.meta.cost_method || costMethod} · Manba: {payload.meta.data_source || '—'}
        </p>
      ) : null}
    </div>
  );
}
