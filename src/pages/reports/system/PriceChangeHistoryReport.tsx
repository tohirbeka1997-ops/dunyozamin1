import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDateTime } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface PriceChange {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  price_type: 'purchase' | 'sale';
  old_price: number;
  new_price: number;
  change_amount: number;
  change_percent: number;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
  reason?: string;
}

export default function PriceChangeHistoryReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [changeRows, setChangeRows] = useState<PriceChange[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [priceTypeFilter, setPriceTypeFilter] = useState<string>('all');
  const [selectedProduct, setSelectedProduct] = useState<string>('');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, priceTypeFilter]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const changes = await handleIpcResponse<PriceChange[]>(
        api.reports?.priceChangeHistory?.({
          date_from: dateFrom,
          date_to: dateTo,
          price_type: priceTypeFilter !== 'all' ? priceTypeFilter : undefined,
        }) || Promise.resolve([])
      );

      setChangeRows(Array.isArray(changes) ? changes : []);
    } catch (error: any) {
      console.error('[PriceChangeHistoryReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setChangeRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredChanges = useMemo(() => {
    let result = changeRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.product_name.toLowerCase().includes(term) ||
          row.product_sku.toLowerCase().includes(term) ||
          (row.changed_by_name || '').toLowerCase().includes(term)
      );
    }

    if (selectedProduct && selectedProduct !== 'all') {
      result = result.filter((row) => row.product_id === selectedProduct);
    }

    return result.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
  }, [changeRows, searchTerm, selectedProduct]);

  const uniqueProducts = useMemo(() => {
    const products = new Map<string, { name: string; sku: string }>();
    for (const change of changeRows) {
      if (!products.has(change.product_id)) {
        products.set(change.product_id, {
          name: change.product_name,
          sku: change.product_sku,
        });
      }
    }
    return Array.from(products.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [changeRows]);

  const summary = useMemo(() => {
    const totalChanges = filteredChanges.length;
    const priceIncreases = filteredChanges.filter((c) => c.change_amount > 0).length;
    const priceDecreases = filteredChanges.filter((c) => c.change_amount < 0).length;
    const avgIncrease =
      priceIncreases > 0
        ? filteredChanges
            .filter((c) => c.change_amount > 0)
            .reduce((sum, c) => sum + c.change_percent, 0) / priceIncreases
        : 0;
    const avgDecrease =
      priceDecreases > 0
        ? Math.abs(
            filteredChanges
              .filter((c) => c.change_amount < 0)
              .reduce((sum, c) => sum + c.change_percent, 0) / priceDecreases
          )
        : 0;
    return { totalChanges, priceIncreases, priceDecreases, avgIncrease, avgDecrease };
  }, [filteredChanges]);

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
        <Badge className="bg-green-600 flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          +{changePercent.toFixed(1)}%
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <TrendingDown className="h-3 w-3" />
        {changePercent.toFixed(1)}%
      </Badge>
    );
  };

  const getPriceTypeBadge = (type: string) => {
    if (type === 'purchase') {
      return <Badge className="bg-blue-600">Xarid narxi</Badge>;
    }
    return <Badge className="bg-purple-600">Sotuv narxi</Badge>;
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
              <DollarSign className="h-8 w-8 text-green-500" />
              Narx o'zgartirish tarixi
            </h1>
            <p className="text-muted-foreground">
              Barcha mahsulotlar narx o'zgarishlari audit jurnali
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
              <label className="text-sm text-muted-foreground">Narx turi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={priceTypeFilter}
                onChange={(e) => setPriceTypeFilter(e.target.value)}
              >
                <option value="all">Hammasi</option>
                <option value="purchase">Xarid narxi</option>
                <option value="sale">Sotuv narxi</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Mahsulot</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
              >
                <option value="">Hammasi</option>
                {uniqueProducts.map(([id, product]) => (
                  <option key={id} value={id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami o'zgarishlar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.totalChanges}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Narx oshirildi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">{summary.priceIncreases}</div>
            <div className="text-xs text-muted-foreground mt-1">
              O'rtacha: +{summary.avgIncrease.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <p className="text-sm text-muted-foreground">Narx tushirildi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-red-600">{summary.priceDecreases}</div>
            <div className="text-xs text-muted-foreground mt-1">
              O'rtacha: -{summary.avgDecrease.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Xarid narxi</p>
            </div>
            <div className="text-2xl font-bold mt-2">
              {filteredChanges.filter((c) => c.price_type === 'purchase').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-purple-500" />
              <p className="text-sm text-muted-foreground">Sotuv narxi</p>
            </div>
            <div className="text-2xl font-bold mt-2">
              {filteredChanges.filter((c) => c.price_type === 'sale').length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredChanges.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Narx o'zgarishlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sana/Vaqt</TableHead>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-center">Narx turi</TableHead>
                  <TableHead className="text-right">Eski narx</TableHead>
                  <TableHead className="text-right">Yangi narx</TableHead>
                  <TableHead className="text-right">Farq</TableHead>
                  <TableHead className="text-center">O'zgarish</TableHead>
                  <TableHead>O'zgartirgan</TableHead>
                  <TableHead>Sabab</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredChanges.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(row.changed_at)}
                    </TableCell>
                    <TableCell className="font-medium">{row.product_name}</TableCell>
                    <TableCell>{row.product_sku}</TableCell>
                    <TableCell className="text-center">{getPriceTypeBadge(row.price_type)}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(row.old_price)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatMoneyUZS(row.new_price)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        row.change_amount > 0
                          ? 'text-green-600'
                          : row.change_amount < 0
                          ? 'text-red-600'
                          : ''
                      }`}
                    >
                      {row.change_amount > 0 ? '+' : ''}
                      {formatMoneyUZS(row.change_amount)}
                    </TableCell>
                    <TableCell className="text-center">
                      {getPriceChangeBadge(row.change_amount, row.change_percent)}
                    </TableCell>
                    <TableCell>{row.changed_by_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {row.reason || '-'}
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
