import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrders } from '@/db/api';
import type { OrderWithDetails } from '@/types/database';
import { FileDown, ArrowLeft, CreditCard, Banknote, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { exportPaymentMethods } from '@/lib/exportManager';
import { useTranslation } from 'react-i18next';
import { getOrderById } from '@/db/api';

interface PaymentMethodData {
  methodCode: string;
  methodLabel: string;
  count: number;
  total: number;
  percentage: number;
}

export default function PaymentMethodReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [paymentData, setPaymentData] = useState<PaymentMethodData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      const ordersData = await getOrders();
      
      const filtered = ordersData.filter((order) => {
        const orderDate = formatDateYMD(order.created_at);
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      const labelForMethod = (method: string) =>
        method === 'cash'
          ? t('reports.payment_methods_page.methods.cash')
          : method === 'card'
            ? t('reports.payment_methods_page.methods.card')
            : method === 'qr'
              ? t('reports.payment_methods_page.methods.qr')
              : method === 'terminal'
                ? t('reports.payment_methods_page.methods.terminal')
                : method === 'mixed'
                  ? t('reports.payment_methods_page.methods.mixed')
                  : method === 'credit'
                    ? t('reports.payment_methods_page.methods.credit')
                    : t('reports.payment_methods_page.methods.other');

      const methodMap = new Map<string, { count: number; total: number }>();

      // IMPORTANT: In Electron mode, `getOrders()` may not include payment amounts.
      // To keep the report in sync with POS, fetch full order details when needed.
      const resolvedOrders: OrderWithDetails[] = await Promise.all(
        filtered.map(async (order) => {
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
        const payments = order.payments || [];

        if (payments.length === 0) {
          const method = (order as any).payment_type || 'cash';
          const existing = methodMap.get(method);
          const amount = Number(order.total_amount);

          if (existing) {
            existing.count += 1;
            existing.total += amount;
          } else {
            methodMap.set(method, { count: 1, total: amount });
          }
          return;
        }

        // If we have exactly one payment row but its amount is missing/zero,
        // treat it as full order amount (common in Electron summary queries).
        const rawSum = payments.reduce((sum, p: any) => sum + Number(p?.amount ?? 0), 0);
        const shouldFallbackSinglePaymentAmount =
          payments.length === 1 && rawSum <= 0 && Number(order.total_amount) > 0;

        payments.forEach((payment) => {
          const method = payment.payment_method;
          const existing = methodMap.get(method);
          const amount = shouldFallbackSinglePaymentAmount
            ? Number(order.total_amount)
            : Number(payment.amount ?? 0);

          if (existing) {
            existing.count += 1;
            existing.total += amount;
          } else {
            methodMap.set(method, { count: 1, total: amount });
          }
        });
      });

      const totalAmount = Array.from(methodMap.values()).reduce((sum, m) => sum + m.total, 0);

      const data: PaymentMethodData[] = Array.from(methodMap.entries()).map(([method, stats]) => ({
        methodCode: method,
        methodLabel: labelForMethod(method),
        count: stats.count,
        total: stats.total,
        percentage: totalAmount > 0 ? (stats.total / totalAmount) * 100 : 0,
      }));

      data.sort((a, b) => b.total - a.total);

      setPaymentData(data);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('reports.payment_methods_page.errors.load_failed'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const chartData = paymentData.map((item) => ({
    name: item.methodLabel,
    value: item.total,
  }));
  const chartDataNonZero = chartData.filter((x) => Number(x.value) > 0);

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--secondary))'];

  const getPaymentIcon = (method: string) => {
    const lower = method.toLowerCase();
    if (lower === 'cash') return <Banknote className="h-5 w-5" />;
    if (lower === 'card') return <CreditCard className="h-5 w-5" />;
    return <Wallet className="h-5 w-5" />;
  };

  const handleExport = async (format: 'excel' | 'pdf' | 'csv') => {
    toast({
      title: t('reports.payment_methods_page.export.title'),
      description: t('reports.payment_methods_page.export.exporting_to', {
        format: format.toUpperCase(),
      }),
    });
    await exportPaymentMethods(format, { dateFrom, dateTo });
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
            <h1 className="text-3xl font-bold">{t('reports.payment_methods_page.title')}</h1>
            <p className="text-muted-foreground">{t('reports.payment_methods_page.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.payment_methods_page.export.excel')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.payment_methods_page.export.pdf')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">{t('reports.payment_methods_page.filters.from_date')}</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t('reports.payment_methods_page.filters.to_date')}</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.payment_methods_page.distribution.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentData.length === 0 || chartDataNonZero.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">{t('reports.payment_methods_page.distribution.empty')}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartDataNonZero}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {chartDataNonZero.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatMoneyUZS(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('reports.payment_methods_page.summary.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {paymentData.filter((x) => x.total > 0).map((item, index) => (
                <div key={item.methodCode} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-3">
                    <div 
                      className="h-10 w-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: COLORS[index % COLORS.length] + '20' }}
                    >
                      {getPaymentIcon(item.methodCode)}
                    </div>
                    <div>
                      <p className="font-medium">{item.methodLabel}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.count} {t('reports.payment_methods_page.summary.transactions')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatMoneyUZS(item.total)}</p>
                    <p className="text-sm text-muted-foreground">{item.percentage.toFixed(1)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {paymentData.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">{t('reports.payment_methods_page.distribution.empty')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.payment_methods_page.table.method')}</TableHead>
                  <TableHead className="text-right">{t('reports.payment_methods_page.table.transactions')}</TableHead>
                  <TableHead className="text-right">{t('reports.payment_methods_page.table.total_amount')}</TableHead>
                  <TableHead className="text-right">{t('reports.payment_methods_page.table.percentage')}</TableHead>
                  <TableHead className="text-right">{t('reports.payment_methods_page.table.avg_transaction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentData.map((item) => (
                  <TableRow key={item.methodCode}>
                    <TableCell className="font-medium">{item.methodLabel}</TableCell>
                    <TableCell className="text-right">{item.count}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(item.total)}</TableCell>
                    <TableCell className="text-right">{item.percentage.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(item.total / item.count)}</TableCell>
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
