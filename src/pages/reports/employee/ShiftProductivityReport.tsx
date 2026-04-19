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
import { ArrowLeft, Clock, TrendingUp, DollarSign, Users, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface ShiftProductivity {
  shift_id: string;
  shift_date: string;
  employee_id: string;
  employee_name: string;
  start_time: string;
  end_time: string;
  hours_worked: number;
  total_sales: number;
  total_revenue: number;
  orders_count: number;
  avg_order_value: number;
  revenue_per_hour: number;
  orders_per_hour: number;
  productivity_score: number; // 0-100
}

interface ProductivitySummary {
  employee_id: string;
  employee_name: string;
  total_shifts: number;
  total_hours: number;
  total_revenue: number;
  total_orders: number;
  avg_revenue_per_hour: number;
  avg_orders_per_hour: number;
  best_shift_revenue: number;
  worst_shift_revenue: number;
  productivity_score: number;
}

export default function ShiftProductivityReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [shiftRows, setShiftRows] = useState<ShiftProductivity[]>([]);
  const [summaryRows, setSummaryRows] = useState<ProductivitySummary[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'summary' | 'shifts'>('summary');
  const [sortBy, setSortBy] = useState<'revenue_per_hour' | 'orders_per_hour' | 'productivity_score'>(
    'revenue_per_hour'
  );

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
      
      const [shifts, summary] = await Promise.all([
        handleIpcResponse<ShiftProductivity[]>(
          api.reports?.shiftProductivity?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<ProductivitySummary[]>(
          api.reports?.productivitySummary?.({
            date_from: dateFrom,
            date_to: dateTo,
            sort_by: sortBy,
          }) || Promise.resolve([])
        ),
      ]);

      setShiftRows(Array.isArray(shifts) ? shifts : []);
      setSummaryRows(Array.isArray(summary) ? summary : []);
    } catch (error: any) {
      console.error('[ShiftProductivityReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setShiftRows([]);
      setSummaryRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSummary = useMemo(() => {
    if (!searchTerm) return summaryRows;
    const term = searchTerm.toLowerCase();
    return summaryRows.filter((row) => row.employee_name.toLowerCase().includes(term));
  }, [summaryRows, searchTerm]);

  const filteredShifts = useMemo(() => {
    if (!searchTerm) return shiftRows;
    const term = searchTerm.toLowerCase();
    return shiftRows.filter((row) => row.employee_name.toLowerCase().includes(term));
  }, [shiftRows, searchTerm]);

  const overallStats = useMemo(() => {
    const totalShifts = summaryRows.reduce((sum, r) => sum + Number(r.total_shifts || 0), 0);
    const totalHours = summaryRows.reduce((sum, r) => sum + Number(r.total_hours || 0), 0);
    const totalRevenue = summaryRows.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);
    const totalOrders = summaryRows.reduce((sum, r) => sum + Number(r.total_orders || 0), 0);
    const avgRevenuePerHour = totalHours > 0 ? totalRevenue / totalHours : 0;
    const avgOrdersPerHour = totalHours > 0 ? totalOrders / totalHours : 0;
    return {
      totalShifts,
      totalHours,
      totalRevenue,
      totalOrders,
      avgRevenuePerHour,
      avgOrdersPerHour,
    };
  }, [summaryRows]);

  const getProductivityBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-600">A'lo</Badge>;
    if (score >= 60) return <Badge className="bg-blue-600">Yaxshi</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-600">O'rtacha</Badge>;
    return <Badge variant="destructive">Past</Badge>;
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
              <Zap className="h-8 w-8 text-yellow-500" />
              Smena samaradorligi
            </h1>
            <p className="text-muted-foreground">
              Kassir × soat × tushum tahlili
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
                placeholder="Kassir..."
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
                <option value="shifts">Smenalar</option>
              </select>
            </div>
            {viewMode === 'summary' && (
              <div>
                <label className="text-sm text-muted-foreground">Saralash</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                >
                  <option value="revenue_per_hour">Soat/tushum</option>
                  <option value="orders_per_hour">Soat/buyurtma</option>
                  <option value="productivity_score">Samaradorlik</option>
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
              <Clock className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami smenalar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.totalShifts}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {overallStats.totalHours.toFixed(1)} soat
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Jami tushum</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">
              {formatMoneyUZS(overallStats.totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Jami buyurtmalar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.totalOrders}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <p className="text-sm text-muted-foreground">Soat/tushum</p>
            </div>
            <div className="text-2xl font-bold mt-2">
              {formatMoneyUZS(overallStats.avgRevenuePerHour)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">Soat/buyurtma</p>
            </div>
            <div className="text-2xl font-bold mt-2">
              {overallStats.avgOrdersPerHour.toFixed(1)}
            </div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'summary' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSummary.length === 0 ? (
              <div className="text-center py-12">
                <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kassir</TableHead>
                    <TableHead className="text-right">Smenalar</TableHead>
                    <TableHead className="text-right">Jami soatlar</TableHead>
                    <TableHead className="text-right">Jami tushum</TableHead>
                    <TableHead className="text-right">Buyurtmalar</TableHead>
                    <TableHead className="text-right">Soat/tushum</TableHead>
                    <TableHead className="text-right">Soat/buyurtma</TableHead>
                    <TableHead className="text-right">Eng yaxshi smena</TableHead>
                    <TableHead className="text-center">Daraja</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummary.map((row) => (
                    <TableRow key={row.employee_id}>
                      <TableCell className="font-medium">{row.employee_name}</TableCell>
                      <TableCell className="text-right">{row.total_shifts}</TableCell>
                      <TableCell className="text-right">{row.total_hours.toFixed(1)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.total_revenue)}
                      </TableCell>
                      <TableCell className="text-right">{row.total_orders}</TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {formatMoneyUZS(row.avg_revenue_per_hour)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {row.avg_orders_per_hour.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right text-blue-600">
                        {formatMoneyUZS(row.best_shift_revenue)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getProductivityBadge(row.productivity_score)}
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
            {filteredShifts.length === 0 ? (
              <div className="text-center py-12">
                <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Kassir</TableHead>
                    <TableHead>Boshlanish</TableHead>
                    <TableHead>Tugash</TableHead>
                    <TableHead className="text-right">Soatlar</TableHead>
                    <TableHead className="text-right">Buyurtmalar</TableHead>
                    <TableHead className="text-right">Tushum</TableHead>
                    <TableHead className="text-right">Soat/tushum</TableHead>
                    <TableHead className="text-right">Soat/buyurtma</TableHead>
                    <TableHead className="text-center">Daraja</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShifts.map((row) => (
                    <TableRow key={row.shift_id}>
                      <TableCell>
                        {formatDate(row.shift_date)}
                      </TableCell>
                      <TableCell className="font-medium">{row.employee_name}</TableCell>
                      <TableCell>{row.start_time}</TableCell>
                      <TableCell>{row.end_time}</TableCell>
                      <TableCell className="text-right">{row.hours_worked.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{row.orders_count}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(row.total_revenue)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {formatMoneyUZS(row.revenue_per_hour)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {row.orders_per_hour.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getProductivityBadge(row.productivity_score)}
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
