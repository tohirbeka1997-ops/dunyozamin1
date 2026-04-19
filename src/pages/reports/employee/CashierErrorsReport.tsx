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
import { ArrowLeft, XCircle, RefreshCw, AlertTriangle, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface CashierError {
  employee_id: string;
  employee_name: string;
  total_sales: number;
  cancelled_count: number;
  cancelled_value: number;
  returns_count: number;
  returns_value: number;
  error_rate: number; // (cancelled + returns) / total_sales * 100
  avg_cancelled_value: number;
  avg_return_value: number;
  error_score: number; // 0-100, higher is worse
}

interface ErrorDetail {
  id: string;
  order_number: string;
  employee_name: string;
  order_date: string;
  order_time: string;
  type: 'cancelled' | 'return';
  amount: number;
  items_count: number;
  reason?: string;
  customer_name?: string;
}

export default function CashierErrorsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [summaryRows, setSummaryRows] = useState<CashierError[]>([]);
  const [detailRows, setDetailRows] = useState<ErrorDetail[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'summary' | 'details'>('summary');
  const [typeFilter, setTypeFilter] = useState<string>('all');

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
      
      const [summary, details] = await Promise.all([
        handleIpcResponse<CashierError[]>(
          api.reports?.cashierErrors?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<ErrorDetail[]>(
          api.reports?.cashierErrorDetails?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
      ]);

      setSummaryRows(Array.isArray(summary) ? summary : []);
      setDetailRows(Array.isArray(details) ? details : []);
    } catch (error: any) {
      console.error('[CashierErrorsReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setSummaryRows([]);
      setDetailRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSummary = useMemo(() => {
    if (!searchTerm) return summaryRows;
    const term = searchTerm.toLowerCase();
    return summaryRows.filter((row) => row.employee_name.toLowerCase().includes(term));
  }, [summaryRows, searchTerm]);

  const filteredDetails = useMemo(() => {
    let result = detailRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.employee_name.toLowerCase().includes(term) ||
          row.order_number.toLowerCase().includes(term) ||
          (row.customer_name && row.customer_name.toLowerCase().includes(term))
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter((row) => row.type === typeFilter);
    }

    return result;
  }, [detailRows, searchTerm, typeFilter]);

  const overallStats = useMemo(() => {
    const totalCancelled = summaryRows.reduce(
      (sum, r) => sum + Number(r.cancelled_count || 0),
      0
    );
    const totalReturns = summaryRows.reduce((sum, r) => sum + Number(r.returns_count || 0), 0);
    const totalCancelledValue = summaryRows.reduce(
      (sum, r) => sum + Number(r.cancelled_value || 0),
      0
    );
    const totalReturnsValue = summaryRows.reduce(
      (sum, r) => sum + Number(r.returns_value || 0),
      0
    );
    const totalSales = summaryRows.reduce((sum, r) => sum + Number(r.total_sales || 0), 0);
    const avgErrorRate =
      summaryRows.length > 0
        ? summaryRows.reduce((sum, r) => sum + Number(r.error_rate || 0), 0) / summaryRows.length
        : 0;
    return {
      totalCancelled,
      totalReturns,
      totalCancelledValue,
      totalReturnsValue,
      totalSales,
      avgErrorRate,
    };
  }, [summaryRows]);

  const getErrorBadge = (score: number) => {
    if (score >= 75) return <Badge variant="destructive">Yuqori</Badge>;
    if (score >= 50) return <Badge className="bg-orange-500">O'rtacha</Badge>;
    if (score >= 25) return <Badge className="bg-yellow-600">Past</Badge>;
    return <Badge className="bg-green-600">Minimal</Badge>;
  };

  const getTypeBadge = (type: string) => {
    if (type === 'cancelled') {
      return <Badge variant="destructive">Bekor qilindi</Badge>;
    }
    return <Badge className="bg-orange-500">Qaytarish</Badge>;
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
              <AlertTriangle className="h-8 w-8 text-orange-500" />
              Kassir xatolari
            </h1>
            <p className="text-muted-foreground">
              Bekor qilingan cheklar va qaytarishlar tahlili
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
                placeholder="Kassir yoki chek..."
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
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as any)}
              >
                <option value="summary">Umumiy</option>
                <option value="details">Batafsil</option>
              </select>
            </div>
            {viewMode === 'details' && (
              <div>
                <label className="text-sm text-muted-foreground">Turi</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">Hammasi</option>
                  <option value="cancelled">Bekor qilindi</option>
                  <option value="return">Qaytarish</option>
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Bekor qilindi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-destructive">
              {overallStats.totalCancelled}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatMoneyUZS(overallStats.totalCancelledValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Qaytarishlar</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-orange-600">
              {overallStats.totalReturns}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatMoneyUZS(overallStats.totalReturnsValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Jami yo'qotish</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-destructive">
              {formatMoneyUZS(overallStats.totalCancelledValue + overallStats.totalReturnsValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">O'rtacha xatolik</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.avgErrorRate.toFixed(2)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Jami sotuv</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.totalSales}</div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'summary' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSummary.length === 0 ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kassir</TableHead>
                    <TableHead className="text-right">Jami sotuv</TableHead>
                    <TableHead className="text-right">Bekor qilindi</TableHead>
                    <TableHead className="text-right">Bekor summa</TableHead>
                    <TableHead className="text-right">Qaytarishlar</TableHead>
                    <TableHead className="text-right">Qaytarish summa</TableHead>
                    <TableHead className="text-right">Xatolik %</TableHead>
                    <TableHead className="text-center">Daraja</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummary.map((row) => (
                    <TableRow key={row.employee_id}>
                      <TableCell className="font-medium">{row.employee_name}</TableCell>
                      <TableCell className="text-right">{row.total_sales}</TableCell>
                      <TableCell className="text-right text-destructive">
                        {row.cancelled_count}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {formatMoneyUZS(row.cancelled_value)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {row.returns_count}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {formatMoneyUZS(row.returns_value)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {row.error_rate.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-center">
                        {getErrorBadge(row.error_score)}
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
            {filteredDetails.length === 0 ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chek №</TableHead>
                    <TableHead>Kassir</TableHead>
                    <TableHead>Sana</TableHead>
                    <TableHead>Vaqt</TableHead>
                    <TableHead className="text-center">Turi</TableHead>
                    <TableHead className="text-right">Summa</TableHead>
                    <TableHead className="text-right">Mahsulotlar</TableHead>
                    <TableHead>Mijoz</TableHead>
                    <TableHead>Sabab</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDetails.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.order_number}</TableCell>
                      <TableCell>{row.employee_name}</TableCell>
                      <TableCell>{formatDate(row.order_date)}</TableCell>
                      <TableCell>{row.order_time}</TableCell>
                      <TableCell className="text-center">{getTypeBadge(row.type)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(row.amount)}</TableCell>
                      <TableCell className="text-right">{row.items_count}</TableCell>
                      <TableCell>{row.customer_name || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.reason || '-'}
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
