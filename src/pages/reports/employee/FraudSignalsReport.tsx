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
import { ArrowLeft, Shield, AlertTriangle, XCircle, Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDate } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface FraudSignal {
  employee_id: string;
  employee_name: string;
  total_sales: number;
  cancelled_count: number;
  cancelled_rate: number; // %
  excessive_discount_count: number;
  excessive_discount_rate: number; // %
  total_discount_given: number;
  avg_discount_percent: number;
  suspicious_returns: number;
  void_pattern_score: number; // 0-100
  discount_pattern_score: number; // 0-100
  overall_risk_score: number; // 0-100
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  alert_count: number;
}

interface FraudIncident {
  id: string;
  employee_name: string;
  incident_date: string;
  incident_time: string;
  type: 'excessive_cancel' | 'excessive_discount' | 'suspicious_return' | 'other';
  order_number: string;
  amount: number;
  discount_percent?: number;
  description: string;
  risk_score: number;
}

export default function FraudSignalsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [signalRows, setSignalRows] = useState<FraudSignal[]>([]);
  const [incidentRows, setIncidentRows] = useState<FraudIncident[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'signals' | 'incidents'>('signals');

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
      
      const [signals, incidents] = await Promise.all([
        handleIpcResponse<FraudSignal[]>(
          api.reports?.fraudSignals?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
        handleIpcResponse<FraudIncident[]>(
          api.reports?.fraudIncidents?.({
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve([])
        ),
      ]);

      setSignalRows(Array.isArray(signals) ? signals : []);
      setIncidentRows(Array.isArray(incidents) ? incidents : []);
    } catch (error: any) {
      console.error('[FraudSignalsReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setSignalRows([]);
      setIncidentRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredSignals = useMemo(() => {
    let result = signalRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((row) => row.employee_name.toLowerCase().includes(term));
    }

    if (riskFilter !== 'all') {
      result = result.filter((row) => row.risk_level === riskFilter);
    }

    return result.sort((a, b) => b.overall_risk_score - a.overall_risk_score);
  }, [signalRows, searchTerm, riskFilter]);

  const filteredIncidents = useMemo(() => {
    if (!searchTerm) return incidentRows;
    const term = searchTerm.toLowerCase();
    return incidentRows.filter(
      (row) =>
        row.employee_name.toLowerCase().includes(term) ||
        row.order_number.toLowerCase().includes(term)
    );
  }, [incidentRows, searchTerm]);

  const overallStats = useMemo(() => {
    const critical = signalRows.filter((r) => r.risk_level === 'critical').length;
    const high = signalRows.filter((r) => r.risk_level === 'high').length;
    const medium = signalRows.filter((r) => r.risk_level === 'medium').length;
    const totalAlerts = signalRows.reduce((sum, r) => sum + Number(r.alert_count || 0), 0);
    const totalDiscountLoss = signalRows.reduce(
      (sum, r) => sum + Number(r.total_discount_given || 0),
      0
    );
    return { critical, high, medium, totalAlerts, totalDiscountLoss };
  }, [signalRows]);

  const getRiskBadge = (level: string) => {
    if (level === 'critical') {
      return (
        <Badge variant="destructive" className="animate-pulse">
          Jiddiy
        </Badge>
      );
    }
    if (level === 'high') return <Badge variant="destructive">Yuqori</Badge>;
    if (level === 'medium') return <Badge className="bg-orange-500">O'rtacha</Badge>;
    return <Badge variant="secondary">Past</Badge>;
  };

  const getIncidentTypeBadge = (type: string) => {
    if (type === 'excessive_cancel') {
      return <Badge variant="destructive">Ko'p bekor qilish</Badge>;
    }
    if (type === 'excessive_discount') {
      return <Badge className="bg-orange-500">Ko'p chegirma</Badge>;
    }
    if (type === 'suspicious_return') {
      return <Badge className="bg-yellow-600">Shubhali qaytarish</Badge>;
    }
    return <Badge variant="secondary">Boshqa</Badge>;
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
              <Shield className="h-8 w-8 text-red-500" />
              Fraud Signals (Nazorat)
            </h1>
            <p className="text-muted-foreground">
              Juda ko'p bekor qilish va chegirma aniqlash
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      {/* Critical Alert Banner */}
      {overallStats.critical > 0 && (
        <Card className="border-red-500 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-red-500 animate-pulse" />
              <div>
                <div className="font-bold text-red-700">
                  DIQQAT: {overallStats.critical} ta jiddiy xavf signali aniqlandi!
                </div>
                <div className="text-sm text-red-600">
                  Darhol tekshirish tavsiya etiladi
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                <option value="signals">Signallar</option>
                <option value="incidents">Hodisalar</option>
              </select>
            </div>
            {viewMode === 'signals' && (
              <div>
                <label className="text-sm text-muted-foreground">Xavf darajasi</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                >
                  <option value="all">Hammasi</option>
                  <option value="critical">Jiddiy</option>
                  <option value="high">Yuqori</option>
                  <option value="medium">O'rtacha</option>
                  <option value="low">Past</option>
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="border-red-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <p className="text-sm text-muted-foreground">Jiddiy</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-red-600">{overallStats.critical}</div>
          </CardContent>
        </Card>
        <Card className="border-orange-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Yuqori xavf</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-orange-600">{overallStats.high}</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">O'rtacha</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-yellow-600">{overallStats.medium}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami signallar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{overallStats.totalAlerts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Chegirma yo'qotishi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-destructive">
              {formatMoneyUZS(overallStats.totalDiscountLoss)}
            </div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'signals' ? (
        <Card>
          <CardContent className="p-0">
            {filteredSignals.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {riskFilter !== 'all'
                    ? `${riskFilter} darajadagi signallar topilmadi`
                    : 'Hech qanday shubhali faoliyat aniqlanmadi'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kassir</TableHead>
                    <TableHead className="text-right">Jami sotuv</TableHead>
                    <TableHead className="text-right">Bekor qilish</TableHead>
                    <TableHead className="text-right">Bekor %</TableHead>
                    <TableHead className="text-right">Ko'p chegirma</TableHead>
                    <TableHead className="text-right">Chegirma yo'qotishi</TableHead>
                    <TableHead className="text-right">O'rtacha chegirma</TableHead>
                    <TableHead className="text-right">Xavf balli</TableHead>
                    <TableHead className="text-center">Daraja</TableHead>
                    <TableHead className="text-center">Signallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSignals.map((row) => (
                    <TableRow
                      key={row.employee_id}
                      className={
                        row.risk_level === 'critical'
                          ? 'bg-red-50'
                          : row.risk_level === 'high'
                          ? 'bg-orange-50'
                          : ''
                      }
                    >
                      <TableCell className="font-medium">{row.employee_name}</TableCell>
                      <TableCell className="text-right">{row.total_sales}</TableCell>
                      <TableCell className="text-right text-destructive font-semibold">
                        {row.cancelled_count}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {row.cancelled_rate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right text-orange-600 font-semibold">
                        {row.excessive_discount_count}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {formatMoneyUZS(row.total_discount_given)}
                      </TableCell>
                      <TableCell className="text-right">{row.avg_discount_percent.toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-bold">
                        {row.overall_risk_score.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-center">{getRiskBadge(row.risk_level)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{row.alert_count}</Badge>
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
            {filteredIncidents.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Hodisalar topilmadi</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Vaqt</TableHead>
                    <TableHead>Kassir</TableHead>
                    <TableHead>Chek №</TableHead>
                    <TableHead className="text-center">Turi</TableHead>
                    <TableHead className="text-right">Summa</TableHead>
                    <TableHead className="text-right">Chegirma %</TableHead>
                    <TableHead>Tavsif</TableHead>
                    <TableHead className="text-right">Xavf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncidents.map((row) => (
                    <TableRow
                      key={row.id}
                      className={row.risk_score >= 75 ? 'bg-red-50' : ''}
                    >
                      <TableCell>
                        {formatDate(row.incident_date)}
                      </TableCell>
                      <TableCell>{row.incident_time}</TableCell>
                      <TableCell className="font-medium">{row.employee_name}</TableCell>
                      <TableCell>{row.order_number}</TableCell>
                      <TableCell className="text-center">{getIncidentTypeBadge(row.type)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(row.amount)}</TableCell>
                      <TableCell className="text-right">
                        {row.discount_percent ? `${row.discount_percent.toFixed(1)}%` : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {row.description}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <span
                          className={
                            row.risk_score >= 75
                              ? 'text-red-600'
                              : row.risk_score >= 50
                              ? 'text-orange-600'
                              : 'text-yellow-600'
                          }
                        >
                          {row.risk_score.toFixed(0)}
                        </span>
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
