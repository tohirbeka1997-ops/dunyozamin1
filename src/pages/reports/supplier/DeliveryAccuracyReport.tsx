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
import { ArrowLeft, Truck, Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface DeliveryAccuracy {
  supplier_id: string;
  supplier_name: string;
  total_orders: number;
  on_time_deliveries: number;
  late_deliveries: number;
  avg_delay_days: number;
  total_shortage_value: number;
  shortage_count: number;
  accuracy_score: number; // 0-100
  last_delivery_date?: string;
}

interface DeliveryDetail {
  order_id: string;
  order_number: string;
  supplier_name: string;
  order_date: string;
  expected_date: string;
  actual_date?: string;
  delay_days: number;
  ordered_items: number;
  received_items: number;
  shortage_items: number;
  shortage_value: number;
  status: 'on_time' | 'late' | 'pending';
}

export default function DeliveryAccuracyReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [summaryRows, setSummaryRows] = useState<DeliveryAccuracy[]>([]);
  const [detailRows, setDetailRows] = useState<DeliveryDetail[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'summary' | 'details'>('summary');
  const [statusFilter, setStatusFilter] = useState<string>('all');

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
        handleIpcResponse<DeliveryAccuracy[]>(
          api.reports?.deliveryAccuracy?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<DeliveryDetail[]>(
          api.reports?.deliveryDetails?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
      ]);

      setSummaryRows(Array.isArray(summary) ? summary : []);
      setDetailRows(Array.isArray(details) ? details : []);
    } catch (error: any) {
      console.error('[DeliveryAccuracyReport] loadData error:', error);
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
    return summaryRows.filter((row) => row.supplier_name.toLowerCase().includes(term));
  }, [summaryRows, searchTerm]);

  const filteredDetails = useMemo(() => {
    let result = detailRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.supplier_name.toLowerCase().includes(term) ||
          row.order_number.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((row) => row.status === statusFilter);
    }

    return result;
  }, [detailRows, searchTerm, statusFilter]);

  const overallStats = useMemo(() => {
    const totalOrders = summaryRows.reduce((sum, r) => sum + Number(r.total_orders || 0), 0);
    const onTime = summaryRows.reduce((sum, r) => sum + Number(r.on_time_deliveries || 0), 0);
    const late = summaryRows.reduce((sum, r) => sum + Number(r.late_deliveries || 0), 0);
    const totalShortage = summaryRows.reduce(
      (sum, r) => sum + Number(r.total_shortage_value || 0),
      0
    );
    const avgScore =
      summaryRows.length > 0
        ? summaryRows.reduce((sum, r) => sum + Number(r.accuracy_score || 0), 0) /
          summaryRows.length
        : 0;
    return { totalOrders, onTime, late, onTimeRate: totalOrders > 0 ? (onTime / totalOrders) * 100 : 0, totalShortage, avgScore };
  }, [summaryRows]);

  const getScoreBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-green-600">A'lo</Badge>;
    if (score >= 75) return <Badge className="bg-blue-600">Yaxshi</Badge>;
    if (score >= 60) return <Badge className="bg-yellow-600">O'rtacha</Badge>;
    return <Badge variant="destructive">Yomon</Badge>;
  };

  const getStatusBadge = (status: string) => {
    if (status === 'on_time') return <Badge className="bg-green-600">O'z vaqtida</Badge>;
    if (status === 'late') return <Badge variant="destructive">Kechikkan</Badge>;
    return <Badge variant="secondary">Kutilmoqda</Badge>;
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
              <Truck className="h-8 w-8 text-blue-500" />
              Yetkazib berish aniqligi
            </h1>
            <p className="text-muted-foreground">
              Kechikishlar va yetishmovchiliklar tahlili
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
                placeholder="Postavshik yoki buyurtma..."
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
                  <SelectItem value="details">Batafsil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {viewMode === 'details' && (
              <div>
                <label className="text-sm text-muted-foreground">Holat</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Hammasi</SelectItem>
                    <SelectItem value="on_time">O'z vaqtida</SelectItem>
                    <SelectItem value="late">Kechikkan</SelectItem>
                    <SelectItem value="pending">Kutilmoqda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami buyurtmalar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.totalOrders}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">O'z vaqtida</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">{overallStats.onTime}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {overallStats.onTimeRate.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Kechikishlar</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-orange-600">{overallStats.late}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {overallStats.totalOrders > 0 ? ((overallStats.late / overallStats.totalOrders) * 100).toFixed(1) : 0}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Yetishmovchilik</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-destructive">
              {formatMoneyUZS(overallStats.totalShortage)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">O'rtacha ball</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.avgScore.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground mt-1">100 dan</div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'summary' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSummary.length === 0 ? (
              <div className="text-center py-12">
                <Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Postavshik</TableHead>
                    <TableHead className="text-right">Buyurtmalar</TableHead>
                    <TableHead className="text-right">O'z vaqtida</TableHead>
                    <TableHead className="text-right">Kechikish</TableHead>
                    <TableHead className="text-right">O'rtacha kechikish</TableHead>
                    <TableHead className="text-right">Yetishmovchilik</TableHead>
                    <TableHead className="text-right">Yetishmovchilik qiymati</TableHead>
                    <TableHead className="text-center">Ball</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummary.map((row) => {
                    const onTimeRate = row.total_orders > 0 ? (row.on_time_deliveries / row.total_orders) * 100 : 0;
                    return (
                      <TableRow key={row.supplier_id}>
                        <TableCell className="font-medium">{row.supplier_name}</TableCell>
                        <TableCell className="text-right">{row.total_orders}</TableCell>
                        <TableCell className="text-right text-green-600">
                          {row.on_time_deliveries} ({onTimeRate.toFixed(0)}%)
                        </TableCell>
                        <TableCell className="text-right text-orange-600">
                          {row.late_deliveries}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.avg_delay_days > 0 ? `${row.avg_delay_days.toFixed(1)} kun` : '-'}
                        </TableCell>
                        <TableCell className="text-right text-destructive">
                          {row.shortage_count || 0}
                        </TableCell>
                        <TableCell className="text-right text-destructive">
                          {formatMoneyUZS(row.total_shortage_value)}
                        </TableCell>
                        <TableCell className="text-center">
                          {getScoreBadge(row.accuracy_score)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
                <Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Ma'lumotlar mavjud emas</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyurtma №</TableHead>
                    <TableHead>Postavshik</TableHead>
                    <TableHead>Buyurtma sanasi</TableHead>
                    <TableHead>Kutilgan sana</TableHead>
                    <TableHead>Haqiqiy sana</TableHead>
                    <TableHead className="text-right">Kechikish</TableHead>
                    <TableHead className="text-right">Buyurtma</TableHead>
                    <TableHead className="text-right">Qabul qilindi</TableHead>
                    <TableHead className="text-right">Yetishmovchilik</TableHead>
                    <TableHead className="text-right">Qiymati</TableHead>
                    <TableHead className="text-center">Holat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDetails.map((row) => (
                    <TableRow key={row.order_id}>
                      <TableCell className="font-medium">{row.order_number}</TableCell>
                      <TableCell>{row.supplier_name}</TableCell>
                      <TableCell>{formatDate(row.order_date)}</TableCell>
                      <TableCell>{formatDate(row.expected_date)}</TableCell>
                      <TableCell>
                        {row.actual_date ? formatDate(row.actual_date) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.delay_days > 0 ? (
                          <span className="text-orange-600 font-semibold">{row.delay_days} kun</span>
                        ) : (
                          <span className="text-green-600">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{row.ordered_items}</TableCell>
                      <TableCell className="text-right">{row.received_items}</TableCell>
                      <TableCell className="text-right text-destructive">
                        {row.shortage_items > 0 ? row.shortage_items : '-'}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {row.shortage_value > 0 ? formatMoneyUZS(row.shortage_value) : '-'}
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(row.status)}</TableCell>
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
