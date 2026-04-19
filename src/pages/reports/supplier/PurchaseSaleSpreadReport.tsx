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
import { ArrowLeft, TrendingUp, TrendingDown, Percent, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface PurchaseSaleSpread {
  product_id: string;
  product_name: string;
  product_sku: string;
  category_name?: string;
  current_purchase_price: number;
  current_sale_price: number;
  avg_purchase_price: number;
  avg_sale_price: number;
  margin_amount: number;
  margin_percent: number;
  historical_min_margin: number;
  historical_max_margin: number;
  total_quantity_sold: number;
  total_revenue: number;
  total_profit: number;
  roi: number; // return on investment %
}

interface SpreadTimeSeries {
  date: string;
  product_id: string;
  product_name: string;
  avg_cost_price: number;
  avg_sale_price: number;
  margin_amount: number;
  margin_percent: number;
  quantity_sold: number;
}

export default function PurchaseSaleSpreadReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [spreadRows, setSpreadRows] = useState<PurchaseSaleSpread[]>([]);
  const [timeSeriesRows, setTimeSeriesRows] = useState<SpreadTimeSeries[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [marginFilter, setMarginFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'margin_percent' | 'margin_amount' | 'total_profit' | 'roi'>(
    'margin_percent'
  );
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [viewMode, setViewMode] = useState<'current' | 'timeseries'>('current');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, sortBy]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const [spread, timeseries] = await Promise.all([
        handleIpcResponse<PurchaseSaleSpread[]>(
          api.reports?.purchaseSaleSpread?.({
            date_from: dateFrom,
            date_to: dateTo,
            sort_by: sortBy,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<SpreadTimeSeries[]>(
          api.reports?.spreadTimeSeries?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
      ]);

      setSpreadRows(Array.isArray(spread) ? spread : []);
      setTimeSeriesRows(Array.isArray(timeseries) ? timeseries : []);
    } catch (error: any) {
      console.error('[PurchaseSaleSpreadReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setSpreadRows([]);
      setTimeSeriesRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSpread = useMemo(() => {
    let result = spreadRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.product_name.toLowerCase().includes(term) ||
          row.product_sku.toLowerCase().includes(term)
      );
    }

    if (marginFilter === 'high') {
      result = result.filter((row) => row.margin_percent >= 30);
    } else if (marginFilter === 'medium') {
      result = result.filter((row) => row.margin_percent >= 15 && row.margin_percent < 30);
    } else if (marginFilter === 'low') {
      result = result.filter((row) => row.margin_percent < 15);
    } else if (marginFilter === 'negative') {
      result = result.filter((row) => row.margin_percent < 0);
    }

    return result;
  }, [spreadRows, searchTerm, marginFilter]);

  const filteredTimeSeries = useMemo(() => {
    let result = timeSeriesRows;

    if (selectedProduct && selectedProduct !== 'all') {
      result = result.filter((row) => row.product_id === selectedProduct);
    }

    return result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [timeSeriesRows, selectedProduct]);

  const uniqueProducts = useMemo(() => {
    const products = spreadRows.map((row) => ({
      id: row.product_id,
      name: row.product_name,
    }));
    return products.sort((a, b) => a.name.localeCompare(b.name));
  }, [spreadRows]);

  const summary = useMemo(() => {
    const totalRevenue = filteredSpread.reduce(
      (sum, r) => sum + Number(r.total_revenue || 0),
      0
    );
    const totalProfit = filteredSpread.reduce((sum, r) => sum + Number(r.total_profit || 0), 0);
    const avgMargin =
      filteredSpread.length > 0
        ? filteredSpread.reduce((sum, r) => sum + Number(r.margin_percent || 0), 0) /
          filteredSpread.length
        : 0;
    const avgROI =
      filteredSpread.length > 0
        ? filteredSpread.reduce((sum, r) => sum + Number(r.roi || 0), 0) / filteredSpread.length
        : 0;
    return { totalRevenue, totalProfit, avgMargin, avgROI };
  }, [filteredSpread]);

  const getMarginBadge = (margin: number) => {
    if (margin >= 30) return <Badge className="bg-green-600">Yuqori</Badge>;
    if (margin >= 15) return <Badge className="bg-blue-600">O'rtacha</Badge>;
    if (margin >= 0) return <Badge className="bg-yellow-600">Past</Badge>;
    return <Badge variant="destructive">Salbiy</Badge>;
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
              <Percent className="h-8 w-8 text-green-500" />
              Purchase vs Sale Spread
            </h1>
            <p className="text-muted-foreground">
              Xarid narxi → sotuv narxi dinamikasi va marja tahlili
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
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
                  <SelectItem value="current">Hozirgi</SelectItem>
                  <SelectItem value="timeseries">Dinamika</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {viewMode === 'current' ? (
              <>
                <div>
                  <label className="text-sm text-muted-foreground">Marja filtri</label>
                  <Select value={marginFilter} onValueChange={setMarginFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Hammasi</SelectItem>
                      <SelectItem value="high">Yuqori (&gt;30%)</SelectItem>
                      <SelectItem value="medium">O'rtacha (15-30%)</SelectItem>
                      <SelectItem value="low">Past (&lt;15%)</SelectItem>
                      <SelectItem value="negative">Salbiy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Saralash</label>
                  <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="margin_percent">Marja %</SelectItem>
                      <SelectItem value="margin_amount">Marja summa</SelectItem>
                      <SelectItem value="total_profit">Jami foyda</SelectItem>
                      <SelectItem value="roi">ROI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="col-span-2">
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami sotuv</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Jami foyda</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">
              {formatMoneyUZS(summary.totalProfit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">O'rtacha marja</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.avgMargin.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <p className="text-sm text-muted-foreground">O'rtacha ROI</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.avgROI.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'current' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSpread.length === 0 ? (
              <div className="text-center py-12">
                <Percent className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead className="text-right">Xarid narxi</TableHead>
                    <TableHead className="text-right">Sotuv narxi</TableHead>
                    <TableHead className="text-right">Marja summa</TableHead>
                    <TableHead className="text-right">Marja %</TableHead>
                    <TableHead className="text-center">Daraja</TableHead>
                    <TableHead className="text-right">Sotildi</TableHead>
                    <TableHead className="text-right">Jami foyda</TableHead>
                    <TableHead className="text-right">ROI %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSpread.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell>
                        <div className="font-medium">{row.product_name}</div>
                        <div className="text-xs text-muted-foreground">{row.product_sku}</div>
                      </TableCell>
                      <TableCell>{row.category_name || '-'}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.current_purchase_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.current_sale_price)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoneyUZS(row.margin_amount)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          row.margin_percent >= 30
                            ? 'text-green-600'
                            : row.margin_percent >= 15
                            ? 'text-blue-600'
                            : row.margin_percent >= 0
                            ? 'text-yellow-600'
                            : 'text-red-600'
                        }`}
                      >
                        {row.margin_percent.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-center">
                        {getMarginBadge(row.margin_percent)}
                      </TableCell>
                      <TableCell className="text-right">{row.total_quantity_sold}</TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatMoneyUZS(row.total_profit)}
                      </TableCell>
                      <TableCell className="text-right">{row.roi.toFixed(1)}%</TableCell>
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
            {filteredTimeSeries.length === 0 ? (
              <div className="text-center py-12">
                <Percent className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {selectedProduct && selectedProduct !== 'all'
                    ? 'Dinamika mavjud emas'
                    : 'Mahsulotni tanlang'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead className="text-right">Xarid narxi</TableHead>
                    <TableHead className="text-right">Sotuv narxi</TableHead>
                    <TableHead className="text-right">Marja summa</TableHead>
                    <TableHead className="text-right">Marja %</TableHead>
                    <TableHead className="text-right">Sotilgan miqdor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTimeSeries.map((row, idx) => (
                    <TableRow key={`${row.product_id}-${row.date}-${idx}`}>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell className="font-medium">{row.product_name}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.avg_cost_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.avg_sale_price)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.margin_amount)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          row.margin_percent >= 30
                            ? 'text-green-600'
                            : row.margin_percent >= 15
                            ? 'text-blue-600'
                            : 'text-yellow-600'
                        }`}
                      >
                        {row.margin_percent.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">{row.quantity_sold}</TableCell>
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
