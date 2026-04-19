import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { ArrowLeft, TrendingUp, TrendingDown, Minus, LineChart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface PriceHistory {
  product_id: string;
  product_name: string;
  product_sku: string;
  supplier_id: string;
  supplier_name: string;
  purchase_date: string;
  unit_price: number;
  quantity: number;
  total_cost: number;
  price_change: number; // vs previous purchase
  price_change_percent: number;
  is_latest: boolean;
}

interface ProductPriceSummary {
  product_id: string;
  product_name: string;
  product_sku: string;
  current_price: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  price_volatility: number; // std deviation or range %
  supplier_count: number;
  best_supplier: string;
  worst_supplier: string;
}

export default function PriceHistoryReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [historyRows, setHistoryRows] = useState<PriceHistory[]>([]);
  const [summaryRows, setSummaryRows] = useState<ProductPriceSummary[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'summary' | 'history'>('summary');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const [history, summary] = await Promise.all([
        handleIpcResponse<PriceHistory[]>(
          api.reports?.priceHistory?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<ProductPriceSummary[]>(
          api.reports?.productPriceSummary?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
      ]);

      setHistoryRows(Array.isArray(history) ? history : []);
      setSummaryRows(Array.isArray(summary) ? summary : []);
    } catch (error: any) {
      console.error('[PriceHistoryReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setHistoryRows([]);
      setSummaryRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSummary = useMemo(() => {
    if (!searchTerm) return summaryRows;
    const term = searchTerm.toLowerCase();
    return summaryRows.filter(
      (row) =>
        row.product_name.toLowerCase().includes(term) ||
        row.product_sku.toLowerCase().includes(term)
    );
  }, [summaryRows, searchTerm]);

  const filteredHistory = useMemo(() => {
    let result = historyRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.product_name.toLowerCase().includes(term) ||
          row.product_sku.toLowerCase().includes(term) ||
          row.supplier_name.toLowerCase().includes(term)
      );
    }

    if (selectedProduct && selectedProduct !== 'all') {
      result = result.filter((row) => row.product_id === selectedProduct);
    }

    if (selectedSupplier && selectedSupplier !== 'all') {
      result = result.filter((row) => row.supplier_id === selectedSupplier);
    }

    return result;
  }, [historyRows, searchTerm, selectedProduct, selectedSupplier]);

  const uniqueProducts = useMemo(() => {
    const products = historyRows.reduce((acc, row) => {
      if (!acc.find((p) => p.id === row.product_id)) {
        acc.push({ id: row.product_id, name: row.product_name });
      }
      return acc;
    }, [] as { id: string; name: string }[]);
    return products.sort((a, b) => a.name.localeCompare(b.name));
  }, [historyRows]);

  const uniqueSuppliers = useMemo(() => {
    const suppliers = filteredHistory.reduce((acc, row) => {
      if (!acc.find((s) => s.id === row.supplier_id)) {
        acc.push({ id: row.supplier_id, name: row.supplier_name });
      }
      return acc;
    }, [] as { id: string; name: string }[]);
    return suppliers.sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredHistory]);

  const getPriceChangeBadge = (change: number, changePercent: number) => {
    if (change === 0) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Minus className="h-3 w-3" />
          0%
        </Badge>
      );
    }
    if (change > 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          +{changePercent.toFixed(1)}%
        </Badge>
      );
    }
    return (
      <Badge className="bg-green-600 flex items-center gap-1">
        <TrendingDown className="h-3 w-3" />
        {changePercent.toFixed(1)}%
      </Badge>
    );
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
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <LineChart className="h-8 w-8 text-purple-500" />
              Narx o'zgarishi tarixi
            </h1>
            <p className="text-muted-foreground">
              Bir mahsulot bo'yicha postavshiklar kesimida
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Mahsulot yoki SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Ko'rinish</label>
              <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">Umumiy</SelectItem>
                  <SelectItem value="history">Tarix</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {viewMode === 'history' && (
              <div>
                <label className="text-sm text-muted-foreground">Mahsulot</label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tanlang..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Hammasi</SelectItem>
                    {uniqueProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {viewMode === 'history' && selectedProduct && selectedProduct !== 'all' && (
            <div className="mt-4">
              <label className="text-sm text-muted-foreground">Postavshik</label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger className="max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  {uniqueSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {viewMode === 'summary' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSummary.length === 0 ? (
              <div className="text-center py-12">
                <LineChart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Hozirgi narx</TableHead>
                    <TableHead className="text-right">Min narx</TableHead>
                    <TableHead className="text-right">Max narx</TableHead>
                    <TableHead className="text-right">O'rtacha narx</TableHead>
                    <TableHead className="text-right">O'zgaruvchanlik</TableHead>
                    <TableHead className="text-center">Postavshiklar</TableHead>
                    <TableHead>Eng arzon</TableHead>
                    <TableHead>Eng qimmat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummary.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell className="font-medium">{row.product_name}</TableCell>
                      <TableCell>{row.product_sku}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoneyUZS(row.current_price)}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatMoneyUZS(row.min_price)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatMoneyUZS(row.max_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.avg_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={row.price_volatility > 20 ? 'destructive' : 'secondary'}
                        >
                          {row.price_volatility.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{row.supplier_count}</TableCell>
                      <TableCell className="text-green-600 text-xs">
                        {row.best_supplier}
                      </TableCell>
                      <TableCell className="text-red-600 text-xs">
                        {row.worst_supplier}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-12">
                <LineChart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {selectedProduct && selectedProduct !== 'all'
                    ? 'Mahsulot narx tarixi mavjud emas'
                    : 'Mahsulotni tanlang'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>Postavshik</TableHead>
                    <TableHead className="text-right">Birlik narxi</TableHead>
                    <TableHead className="text-right">Miqdor</TableHead>
                    <TableHead className="text-right">Jami summa</TableHead>
                    <TableHead className="text-center">O'zgarish</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map((row, idx) => (
                    <TableRow key={`${row.product_id}-${row.supplier_id}-${idx}`}>
                      <TableCell>{formatDate(row.purchase_date)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{row.product_name}</div>
                        <div className="text-xs text-muted-foreground">{row.product_sku}</div>
                      </TableCell>
                      <TableCell>{row.supplier_name}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoneyUZS(row.unit_price)}
                      </TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.total_cost)}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.price_change !== 0
                          ? getPriceChangeBadge(row.price_change, row.price_change_percent)
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
