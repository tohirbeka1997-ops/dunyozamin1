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
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import type { CashFlowGranularity, CashFlowRow } from '@/types/financialReports';
import { getExpenses, getOrderById, getOrders, getSalesReturns, getSuppliers, getSupplierPayments } from '@/db/api';
import { startOfWeek } from 'date-fns';

export default function CashFlowReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [granularity, setGranularity] = useState<CashFlowGranularity>('day');
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [method, setMethod] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CashFlowRow[]>([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      let data: CashFlowRow[] | null = null;

      if (isElectron()) {
        try {
          const api = requireElectron();
          const res = await handleIpcResponse<CashFlowRow[]>(
            api.reports.cashFlow({
              granularity,
              date_from: dateFrom,
              date_to: dateTo,
            })
          );
          data = Array.isArray(res) ? res : [];
        } catch (error: any) {
          console.warn('[CashFlowReport] IPC cashFlow failed, using fallback:', error);
        }
      }

      if (!data || data.length === 0) {
        data = await buildFallbackRows();
      }

      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[CashFlowReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const buildFallbackRows = async (): Promise<CashFlowRow[]> => {
    const entries: Array<{ date: string; method: string; inflow: number; outflow: number }> = [];

    const inRange = (ymd: string) => ymd >= dateFrom && ymd <= dateTo;
    const normalizeMethod = (m: any) => String(m || 'unknown').toLowerCase();

    const ordersData = await getOrders(100000);
    const filteredOrders = ordersData.filter((order) => {
      const ymd = formatDateYMD(order.created_at);
      return inRange(ymd) && order.status === 'completed';
    });

    const resolvedOrders = await Promise.all(
      filteredOrders.map(async (order) => {
        const hasPaymentAmounts =
          Array.isArray(order.payments) &&
          order.payments.length > 0 &&
          order.payments.every((p: any) => p?.amount !== null && p?.amount !== undefined);
        if (hasPaymentAmounts) return order;
        try {
          const full = await getOrderById(order.id);
          return full || order;
        } catch {
          return order;
        }
      })
    );

    resolvedOrders.forEach((order) => {
      const ymd = formatDateYMD(order.created_at);
      const payments = order.payments || [];
      if (payments.length === 0) {
        const method = normalizeMethod((order as any).payment_type || 'cash');
        entries.push({ date: ymd, method, inflow: Number(order.total_amount || 0), outflow: 0 });
        return;
      }
      const rawSum = payments.reduce((sum, p: any) => sum + Number(p?.amount ?? 0), 0);
      const shouldFallbackSinglePaymentAmount =
        payments.length === 1 && rawSum <= 0 && Number(order.total_amount) > 0;

      payments.forEach((payment: any) => {
        const method = normalizeMethod(payment.payment_method);
        const amount = shouldFallbackSinglePaymentAmount ? Number(order.total_amount || 0) : Number(payment?.amount ?? 0);
        if (amount <= 0) return;
        entries.push({ date: ymd, method, inflow: amount, outflow: 0 });
      });
    });

    const expenses = await getExpenses({ dateFrom, dateTo });
    expenses
      .filter((e) => e.status === 'approved')
      .forEach((e) => {
        const ymd = formatDateYMD(e.expense_date || e.created_at);
        if (!inRange(ymd)) return;
        entries.push({
          date: ymd,
          method: normalizeMethod(e.payment_method),
          inflow: 0,
          outflow: Number(e.amount || 0),
        });
      });

    const returns = await getSalesReturns({ status: 'Completed', startDate: dateFrom, endDate: dateTo });
    (returns || []).forEach((r: any) => {
      const ymd = formatDateYMD(r.created_at);
      if (!inRange(ymd)) return;
      entries.push({
        date: ymd,
        method: normalizeMethod(r.refund_method || 'cash'),
        inflow: 0,
        outflow: Number(r.total_amount || 0),
      });
    });

    const suppliers = await getSuppliers(true);
    const supplierPayments = await Promise.all(
      (suppliers || []).map(async (s) => {
        try {
          return await getSupplierPayments(s.id);
        } catch {
          return [];
        }
      })
    );
    supplierPayments.flat().forEach((p: any) => {
      const ymd = formatDateYMD(p.paid_at || p.created_at);
      if (!inRange(ymd)) return;
      entries.push({
        date: ymd,
        method: normalizeMethod(p.payment_method || 'transfer'),
        inflow: 0,
        outflow: Number(p.amount || 0),
      });
    });

    const toPeriodStart = (ymd: string) => {
      if (granularity === 'week') {
        const d = new Date(ymd);
        const start = startOfWeek(d, { weekStartsOn: 1 });
        return formatDateYMD(start);
      }
      return ymd;
    };

    const grouped = new Map<string, CashFlowRow>();
    entries.forEach((e) => {
      const period_start = toPeriodStart(e.date);
      const method = e.method;
      const key = `${period_start}|${method}`;
      const existing = grouped.get(key) || {
        period_start,
        period_key: period_start,
        method,
        inflow: 0,
        outflow: 0,
        net: 0,
      };
      existing.inflow += e.inflow;
      existing.outflow += e.outflow;
      existing.net = existing.inflow - existing.outflow;
      grouped.set(key, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => a.period_start.localeCompare(b.period_start));
  };

  const methods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(String(r.method || 'unknown'));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return method === 'all' ? rows : rows.filter((r) => String(r.method) === method);
  }, [rows, method]);

  const summary = useMemo(() => {
    const inflow = filtered.reduce((sum, r) => sum + Number(r.inflow || 0), 0);
    const outflow = filtered.reduce((sum, r) => sum + Number(r.outflow || 0), 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [filtered]);

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
            <h1 className="text-3xl font-bold">Pul oqimi</h1>
            <p className="text-muted-foreground">Kirim / chiqim va net pul oqimi</p>
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
              <label className="text-sm text-muted-foreground">Davriylik</label>
              <Select value={granularity} onValueChange={(v) => setGranularity(v as CashFlowGranularity)}>
                <SelectTrigger>
                  <SelectValue placeholder="Kun/hafta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Kunlik</SelectItem>
                  <SelectItem value="week">Haftalik</SelectItem>
                </SelectContent>
              </Select>
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
              <label className="text-sm text-muted-foreground">To'lov usuli</label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Kirim</p>
                <p className="text-2xl font-bold text-success">{formatMoneyUZS(summary.inflow)}</p>
              </div>
              <TrendingUp className="h-6 w-6 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Chiqim</p>
                <p className="text-2xl font-bold text-destructive">{formatMoneyUZS(summary.outflow)}</p>
              </div>
              <TrendingDown className="h-6 w-6 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net</p>
            <p className={`text-2xl font-bold ${summary.net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(summary.net)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma'lumot topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Davr</TableHead>
                  <TableHead>To'lov usuli</TableHead>
                  <TableHead className="text-right">Kirim</TableHead>
                  <TableHead className="text-right">Chiqim</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, idx) => (
                  <TableRow key={`${r.period_start}-${r.method}-${idx}`}>
                    <TableCell className="font-medium">
                      {granularity === 'week' ? `Hafta: ${r.period_start}` : r.period_start}
                    </TableCell>
                    <TableCell>{r.method}</TableCell>
                    <TableCell className="text-right text-success">{formatMoneyUZS(Number(r.inflow || 0))}</TableCell>
                    <TableCell className="text-right text-destructive">{formatMoneyUZS(Number(r.outflow || 0))}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Number(r.net || 0) >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatMoneyUZS(Number(r.net || 0))}
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

