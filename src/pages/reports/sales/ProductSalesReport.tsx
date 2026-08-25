import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategories, getProductSalesReport, getWarehouses } from '@/db/api';
import type { Category, Warehouse } from '@/types/database';
import { FileDown, ArrowLeft, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoneyUZS } from '@/lib/format';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import SearchableCombobox from '@/components/common/SearchableCombobox';

interface ProductSalesData {
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  quantity_sold: number;
  revenue: number;
  revenue_uzs?: number;
  revenue_usd?: number;
  retail_revenue: number;
  master_revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
}

type ProductSalesSortKey =
  | 'product_name'
  | 'sku'
  | 'category'
  | 'quantity_sold'
  | 'revenue'
  | 'retail_revenue'
  | 'master_revenue'
  | 'profit'
  | 'profit_margin';

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ProductSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [productSales, setProductSales] = useState<ProductSalesData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<ProductSalesSortKey>(
    'quantity_sold',
    'desc'
  );

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
      {
        value: 'all',
        label: t('reports.product_sales_page.filters.all_categories', 'Barcha kategoriyalar'),
      },
      ...categories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    ],
    [categories, t]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await getProductSalesReport({
        date_from: dateFrom,
        date_to: dateTo,
        category_id: categoryFilter === 'all' ? null : categoryFilter,
        warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
        price_tier: tierFilter === 'all' ? null : tierFilter,
      });

      const salesData: ProductSalesData[] = (rows || []).map((r: any) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        category: r.category_name || 'Uncategorized',
        quantity_sold: Number(r.quantity_sold || 0),
        revenue: Number(r.revenue || 0),
        revenue_uzs: Number(r.revenue_uzs ?? r.revenue ?? 0),
        revenue_usd: Number(r.revenue_usd ?? 0),
        retail_revenue: Number(r.retail_revenue || 0),
        master_revenue: Number(r.master_revenue || 0),
        cost: Number(r.cost || 0),
        profit: Number(r.profit || 0),
        profit_margin: Number(r.profit_margin || 0),
      }));

      setProductSales(salesData);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t(
          'reports.product_sales_page.errors.load_failed',
          "Mahsulotlar bo'yicha sotuv ma'lumotlarini yuklab bo'lmadi"
        )}${msg ? ` (${msg})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, categoryFilter, warehouseId, tierFilter, toast, t]);

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

  const filteredProducts = useMemo(() => {
    return productSales.filter((product) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (
        product.product_name.toLowerCase().includes(search) ||
        product.sku.toLowerCase().includes(search)
      );
    });
  }, [productSales, searchTerm]);

  /** Grafiklar doim sotilgan miqdor bo‘yicha (jadval tartibidan mustaqil) */
  const byQuantityDesc = useMemo(() => {
    return [...filteredProducts].sort((a, b) => b.quantity_sold - a.quantity_sold);
  }, [filteredProducts]);

  const topProducts = byQuantityDesc.slice(0, 10);
  /** Eng past sotuvlar; top-10 bilan takrorlanmasin (yetarli mahsulot bo‘lsa) */
  const slowMoving = useMemo(() => {
    if (byQuantityDesc.length === 0) return [];
    const pool =
      byQuantityDesc.length > 10 ? byQuantityDesc.slice(10) : [...byQuantityDesc];
    return [...pool].sort((a, b) => a.quantity_sold - b.quantity_sold).slice(0, 5);
  }, [byQuantityDesc]);

  const sortedForTable = useMemo(() => {
    const list = [...filteredProducts];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      switch (key) {
        case 'product_name':
          return compareScalar(a.product_name.toLowerCase(), b.product_name.toLowerCase(), ord);
        case 'sku':
          return compareScalar(a.sku.toLowerCase(), b.sku.toLowerCase(), ord);
        case 'category':
          return compareScalar(a.category.toLowerCase(), b.category.toLowerCase(), ord);
        case 'quantity_sold':
          return compareScalar(a.quantity_sold, b.quantity_sold, ord);
        case 'revenue':
          return compareScalar(a.revenue, b.revenue, ord);
        case 'retail_revenue':
          return compareScalar(a.retail_revenue, b.retail_revenue, ord);
        case 'master_revenue':
          return compareScalar(a.master_revenue, b.master_revenue, ord);
        case 'profit':
          return compareScalar(a.profit, b.profit, ord);
        case 'profit_margin':
          return compareScalar(a.profit_margin, b.profit_margin, ord);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredProducts, sortKey, sortOrder]);

  const salesTotals = useMemo(() => {
    return filteredProducts.reduce(
      (acc, p) => {
        acc.revenue += p.revenue;
        acc.revenue_uzs += p.revenue_uzs ?? p.revenue;
        acc.revenue_usd += p.revenue_usd ?? 0;
        acc.profit += p.profit;
        return acc;
      },
      { revenue: 0, revenue_uzs: 0, revenue_usd: 0, profit: 0 }
    );
  }, [filteredProducts]);

  const chartData = topProducts.map((p) => ({
    name: p.product_name.length > 15 ? p.product_name.substring(0, 15) + '...' : p.product_name,
    quantity: p.quantity_sold,
    revenue: p.revenue,
  }));

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: t('reports.product_sales_page.export.title', 'Eksport'),
      description: t('reports.product_sales_page.export.exporting_to', '{{format}} formatiga eksport qilinmoqda...', {
        format: format.toUpperCase(),
      }),
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/sales')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">
              {t('reports.product_sales_page.title', "Mahsulotlar bo'yicha sotuv hisobotlari")}
            </h1>
            <p className="text-muted-foreground">
              {t(
                'reports.product_sales_page.subtitle',
                "Mahsulotlarning sotuv samaradorligi va foydaliligini tahlil qilish (daromad UZS ekvivalent + USD ajratilgan)"
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.product_sales_page.export.excel', 'Excel')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.product_sales_page.export.pdf', 'PDF')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.product_sales_page.scope_hint',
              'Hisob: yakunlangan sotuvlarning gross summasi (UZS ekv.). POS savat qaytarishlari (manfiy buyurtmalar) chiqarib tashlanadi; alohida sales_returns hujjatlari ayirilmaydi.'
            )}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            onClick={() => navigate('/reports/inventory/abc-analysis')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('reports.product_sales_page.abc_link', 'ABC tahlil (daromad ulushi)')}
          </button>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.product_sales_page.filters.from', 'Boshlanish sanasi')}
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.product_sales_page.filters.to', 'Tugash sanasi')}
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.product_sales_page.filters.warehouse', 'Ombor')}
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
                {t('reports.product_sales_page.filters.category', 'Kategoriya')}
              </label>
              <SearchableCombobox
                value={categoryFilter}
                onValueChange={setCategoryFilter}
                options={categoryOptions}
                placeholder={t(
                  'reports.product_sales_page.filters.all_categories',
                  'Barcha kategoriyalar'
                )}
                searchPlaceholder={t('combobox.search_category', "Kategoriya nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_category', 'Kategoriya topilmadi')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.product_sales_page.filters.price_tier', 'Narx turi')}
              </label>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('reports.product_sales_page.filters.all_tiers', 'Barcha turlar')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('reports.product_sales_page.filters.all_tiers', 'Barcha turlar')}
                  </SelectItem>
                  <SelectItem value="retail">
                    {t('reports.product_sales_page.filters.tier_retail', 'Oddiy (retail)')}
                  </SelectItem>
                  <SelectItem value="master">
                    {t('reports.product_sales_page.filters.tier_master', 'Usta (master)')}
                  </SelectItem>
                  <SelectItem value="wholesale">
                    {t('reports.product_sales_page.filters.tier_wholesale', 'Ulgurji (wholesale)')}
                  </SelectItem>
                  <SelectItem value="marketplace">
                    {t('reports.product_sales_page.filters.tier_marketplace', 'Marketplace')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.product_sales_page.filters.search', 'Qidirish')}
              </label>
              <Input
                placeholder={t(
                  'reports.product_sales_page.filters.search_ph',
                  "Nomi yoki SKU bo'yicha qidirish..."
                )}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.product_sales_page.summary.revenue', 'Jami daromad')}
            </p>
            <div className="text-2xl font-bold mt-1">
              <DualCurrencyAmount uzs={salesTotals.revenue_uzs} usd={salesTotals.revenue_usd} className="items-start" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('reports.product_sales_page.summary.cogs_note', 'COGS va foyda — UZS')}
              {' · '}
              {t('reports.product_sales_page.summary.products', '{{count}} ta mahsulot', {
                count: filteredProducts.length,
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.product_sales_page.summary.profit', 'Jami foyda')}
            </p>
            <p className="text-2xl font-bold mt-1">{formatMoneyUZS(salesTotals.profit)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              {t('reports.product_sales_page.top10.title', "Eng ko'p sotilgan 10 ta mahsulot")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'reports.product_sales_page.top10.empty',
                    'Tanlangan davrda sotuv yo‘q. Oxirgi 30 kunni tekshiring yoki filtrni kengaytiring.'
                  )}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="quantity" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-warning" />
              {t(
                'reports.product_sales_page.slow.title',
                'Sezilarli sotilmayotgan mahsulotlar'
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {slowMoving.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center rounded-md border border-dashed px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'reports.product_sales_page.slow.empty',
                    'Kam sotilgan mahsulotlar yo‘q — davrda sotuv bo‘lmagan yoki barcha mahsulotlar bir xil darajada sotilgan.'
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {slowMoving.map((product) => (
                  <div
                    key={product.product_id}
                    className="flex justify-between items-center p-2 rounded-lg bg-muted"
                  >
                    <div>
                      <p className="font-medium">{product.product_name}</p>
                      <p className="text-sm text-muted-foreground">{product.sku}</p>
                    </div>
                    <Badge variant="outline">
                      {t('reports.product_sales_page.slow.sold', '{{count}} sotilgan', {
                        count: product.quantity_sold,
                      })}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {sortedForTable.length === 0 ? (
            <div className="text-center py-12 px-6">
              <p className="text-muted-foreground">
                {t(
                  'reports.product_sales_page.table.empty',
                  "Tanlangan davrda mahsulot sotuvi topilmadi. Sana oralig‘ini kengaytiring yoki filtrni o‘zgartiring."
                )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="product_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.product_sales_page.table.product', 'Mahsulot nomi')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="sku"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.product_sales_page.table.sku', 'SKU')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="category"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.product_sales_page.table.category', 'Kategoriya')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="quantity_sold"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.qty', 'Sotilgan miqdor')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.revenue', 'Daromad (UZS/USD)')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="retail_revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.retail', 'Oddiy')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="master_revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.master', 'Usta')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="profit"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.profit', 'Foyda')}
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="profit_margin"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.product_sales_page.table.margin', 'Foyda foizi')}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedForTable.map((product) => (
                  <TableRow key={product.product_id}>
                    <TableCell className="font-medium">{product.product_name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell className="text-right">{product.quantity_sold}</TableCell>
                    <TableCell className="text-right">
                      <DualCurrencyAmount
                        uzs={product.revenue_uzs ?? product.revenue}
                        usd={product.revenue_usd}
                      />
                    </TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(product.retail_revenue)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(product.master_revenue)}</TableCell>
                    <TableCell className={`text-right ${product.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatMoneyUZS(product.profit)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        className={
                          product.profit_margin >= 20
                            ? 'bg-success text-white'
                            : product.profit_margin >= 10
                              ? 'bg-warning text-white'
                              : 'bg-destructive text-white'
                        }
                      >
                        {product.profit_margin.toFixed(1)}%
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
