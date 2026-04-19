import { useState, useEffect, useCallback, useMemo } from 'react';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategories, getProductSalesReport } from '@/db/api';
import type { Category } from '@/types/database';
import { FileDown, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface ProductSalesData {
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  quantity_sold: number;
  revenue: number;
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

export default function ProductSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [productSales, setProductSales] = useState<ProductSalesData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<ProductSalesSortKey>(
    'quantity_sold',
    'desc'
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rows, categoriesData] = await Promise.all([
        getProductSalesReport({
          date_from: dateFrom,
          date_to: dateTo,
          category_id: categoryFilter === 'all' ? null : categoryFilter,
          price_tier: tierFilter === 'all' ? null : tierFilter,
        }),
        getCategories(),
      ]);

      const salesData: ProductSalesData[] = (rows || []).map((r: any) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        category: r.category_name || 'Uncategorized',
        quantity_sold: Number(r.quantity_sold || 0),
        revenue: Number(r.revenue || 0),
        retail_revenue: Number(r.retail_revenue || 0),
        master_revenue: Number(r.master_revenue || 0),
        cost: Number(r.cost || 0),
        profit: Number(r.profit || 0),
        profit_margin: Number(r.profit_margin || 0),
      }));

      setProductSales(salesData);
      setCategories(categoriesData);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Xatolik',
        description: `Mahsulotlar bo'yicha sotuv ma'lumotlarini yuklab bo'lmadi. ${msg ? `(${msg})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, categoryFilter, tierFilter, toast]);

  useReportAutoRefresh(loadData);

  // Initial load + reload when filters change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // (auto-refresh handled by useReportAutoRefresh)

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
  const slowMoving = [...byQuantityDesc].slice(-10).reverse();

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

  const chartData = topProducts.map((p) => ({
    name: p.product_name.length > 15 ? p.product_name.substring(0, 15) + '...' : p.product_name,
    quantity: p.quantity_sold,
    revenue: p.revenue,
  }));

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} formatiga eksport qilinmoqda...`,
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Mahsulotlar bo'yicha sotuv hisobotlari</h1>
            <p className="text-muted-foreground">Mahsulotlarning sotuv samaradorligi va foydaliligini tahlil qilish</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Kategoriya</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
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
            <div>
              <label className="text-sm text-muted-foreground">Narx turi</label>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha tierlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha tierlar</SelectItem>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="master">Master/Usta</SelectItem>
                  <SelectItem value="wholesale">Wholesale</SelectItem>
                  <SelectItem value="marketplace">Marketplace</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Nomi yoki SKU bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              Eng ko'p sotilgan 10 ta mahsulot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="quantity" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-warning" />
              Sezilarli sotilmayotgan mahsulotlar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {slowMoving.slice(0, 5).map((product) => (
                <div key={product.product_id} className="flex justify-between items-center p-2 rounded-lg bg-muted">
                  <div>
                    <p className="font-medium">{product.product_name}</p>
                    <p className="text-sm text-muted-foreground">{product.sku}</p>
                  </div>
                  <Badge variant="outline">{product.quantity_sold} sotilgan</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {sortedForTable.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Mahsulotlar bo'yicha sotuv maʼlumotlari topilmadi</p>
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
                    Mahsulot nomi
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="sku"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    SKU
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="category"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Kategoriya
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="quantity_sold"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Sotilgan miqdor
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Daromad
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="retail_revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Oddiy
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="master_revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Usta
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="profit"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Foyda
                  </SortableTableHead>
                  <SortableTableHead<ProductSalesSortKey>
                    columnKey="profit_margin"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Foyda foizi
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
                    <TableCell className="text-right">{formatMoneyUZS(product.revenue)}</TableCell>
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
