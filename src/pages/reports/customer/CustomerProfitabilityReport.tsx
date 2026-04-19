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
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface CustomerProfitability {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  total_sales: number;
  total_cost: number;
  total_discounts: number;
  total_returns: number;
  net_profit: number;
  profit_margin: number; // percentage
  order_count: number;
  avg_profit_per_order: number;
  profitability_score: number; // 0-100
}

type ProfitSortKey =
  | 'customer_name'
  | 'customer_phone'
  | 'total_sales'
  | 'total_cost'
  | 'total_discounts'
  | 'total_returns'
  | 'net_profit'
  | 'profit_margin'
  | 'order_count'
  | 'profitability_score';

export default function CustomerProfitabilityReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CustomerProfitability[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const { sortKey, sortOrder, toggleSort } = useTableSort<ProfitSortKey>('net_profit', 'desc');
  const [filterProfitable, setFilterProfitable] = useState<string>('all');

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
      const data = await handleIpcResponse<CustomerProfitability[]>(
        api.reports?.customerProfitability?.({
          date_from: dateFrom,
          date_to: dateTo,
        }) || Promise.resolve([])
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[CustomerProfitabilityReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let result = rows;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.customer_name.toLowerCase().includes(term) ||
          (row.customer_phone && row.customer_phone.toLowerCase().includes(term))
      );
    }

    // Profitability filter
    if (filterProfitable === 'profitable') {
      result = result.filter((row) => row.net_profit > 0);
    } else if (filterProfitable === 'unprofitable') {
      result = result.filter((row) => row.net_profit < 0);
    }

    return result;
  }, [rows, searchTerm, filterProfitable]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (key) {
        case 'customer_name':
          va = a.customer_name.toLowerCase();
          vb = b.customer_name.toLowerCase();
          break;
        case 'customer_phone':
          va = (a.customer_phone || '').toLowerCase();
          vb = (b.customer_phone || '').toLowerCase();
          break;
        case 'total_sales':
          va = Number(a.total_sales);
          vb = Number(b.total_sales);
          break;
        case 'total_cost':
          va = Number(a.total_cost);
          vb = Number(b.total_cost);
          break;
        case 'total_discounts':
          va = Number(a.total_discounts);
          vb = Number(b.total_discounts);
          break;
        case 'total_returns':
          va = Number(a.total_returns);
          vb = Number(b.total_returns);
          break;
        case 'net_profit':
          va = Number(a.net_profit);
          vb = Number(b.net_profit);
          break;
        case 'profit_margin':
          va = Number(a.profit_margin);
          vb = Number(b.profit_margin);
          break;
        case 'order_count':
          va = Number(a.order_count);
          vb = Number(b.order_count);
          break;
        case 'profitability_score':
          va = Number(a.profitability_score);
          vb = Number(b.profitability_score);
          break;
        default:
          return 0;
      }
      return compareScalar(va, vb, ord);
    });
    return list;
  }, [filtered, sortKey, sortOrder]);

  const summary = useMemo(() => {
    const totalSales = filtered.reduce((sum, r) => sum + Number(r.total_sales || 0), 0);
    const totalCost = filtered.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
    const totalDiscounts = filtered.reduce((sum, r) => sum + Number(r.total_discounts || 0), 0);
    const totalReturns = filtered.reduce((sum, r) => sum + Number(r.total_returns || 0), 0);
    const netProfit = filtered.reduce((sum, r) => sum + Number(r.net_profit || 0), 0);
    const avgMargin =
      filtered.length > 0
        ? filtered.reduce((sum, r) => sum + Number(r.profit_margin || 0), 0) / filtered.length
        : 0;
    const profitable = filtered.filter((r) => r.net_profit > 0).length;
    const unprofitable = filtered.filter((r) => r.net_profit < 0).length;
    return {
      totalSales,
      totalCost,
      totalDiscounts,
      totalReturns,
      netProfit,
      avgMargin,
      profitable,
      unprofitable,
    };
  }, [filtered]);

  const getProfitabilityBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-600">A+</Badge>;
    if (score >= 60) return <Badge className="bg-blue-600">A</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-600">B</Badge>;
    if (score >= 20) return <Badge className="bg-orange-600">C</Badge>;
    return <Badge variant="destructive">D</Badge>;
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
              Mijoz rentabelligi
            </h1>
            <p className="text-muted-foreground">
              Sotuv - tan narx - chegirma - qaytarish tahlili
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Ism yoki telefon..."
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
              <label className="text-sm text-muted-foreground">Filtr</label>
              <Select value={filterProfitable} onValueChange={setFilterProfitable}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="profitable">Foydali</SelectItem>
                  <SelectItem value="unprofitable">Zararli</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Jadval ustunlariga bosing — tartib o‘sish / kamayish almashadi (masalan, Buyurtmalar).
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami sotuv</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Tan narx</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalCost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">Chegirma</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalDiscounts)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Qaytarish</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalReturns)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Net foyda</p>
            </div>
            <div
              className={`text-2xl font-bold mt-2 ${
                summary.netProfit >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {formatMoneyUZS(summary.netProfit)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Marja: {summary.avgMargin.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Foydali mijozlar</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">{summary.profitable}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {filtered.length > 0
                ? ((summary.profitable / filtered.length) * 100).toFixed(1)
                : 0}
              % jami mijozlardan
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Zararli mijozlar</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-red-600">{summary.unprofitable}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {filtered.length > 0
                ? ((summary.unprofitable / filtered.length) * 100).toFixed(1)
                : 0}
              % jami mijozlardan
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {sortedFiltered.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm ? 'Qidiruv natijasi topilmadi' : 'Ma\'lumotlar mavjud emas'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="customer_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Mijoz
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="customer_phone"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Telefon
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="total_sales"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Sotuv
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="total_cost"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Tan narx
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="total_discounts"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Chegirma
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="total_returns"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Qaytarish
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="net_profit"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Net foyda
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="profit_margin"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Marja %
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="order_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Buyurtmalar
                  </SortableTableHead>
                  <SortableTableHead<ProfitSortKey>
                    columnKey="profitability_score"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="center"
                  >
                    Ball
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedFiltered.map((row) => {
                  const isProfitable = row.net_profit >= 0;
                  return (
                    <TableRow key={row.customer_id}>
                      <TableCell className="font-medium">{row.customer_name}</TableCell>
                      <TableCell>{row.customer_phone || '-'}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.total_sales)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {formatMoneyUZS(row.total_cost)}
                      </TableCell>
                      <TableCell className="text-right text-yellow-600">
                        {formatMoneyUZS(row.total_discounts)}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {formatMoneyUZS(row.total_returns)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          isProfitable ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {formatMoneyUZS(row.net_profit)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${
                          row.profit_margin >= 20
                            ? 'text-green-600'
                            : row.profit_margin >= 10
                            ? 'text-yellow-600'
                            : 'text-red-600'
                        }`}
                      >
                        {row.profit_margin.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">{row.order_count}</TableCell>
                      <TableCell className="text-center">
                        {getProfitabilityBadge(row.profitability_score)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
