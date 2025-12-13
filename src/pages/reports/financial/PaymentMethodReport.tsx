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

interface PaymentMethodData {
  method: string;
  count: number;
  total: number;
  percentage: number;
}

export default function PaymentMethodReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [paymentData, setPaymentData] = useState<PaymentMethodData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const ordersData = await getOrders();
      
      const filtered = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      const methodMap = new Map<string, { count: number; total: number }>();

      filtered.forEach((order) => {
        const payments = order.payments || [];
        
        if (payments.length === 0) {
          const method = 'cash';
          const existing = methodMap.get(method);
          const amount = Number(order.total_amount);

          if (existing) {
            existing.count += 1;
            existing.total += amount;
          } else {
            methodMap.set(method, { count: 1, total: amount });
          }
        } else {
          payments.forEach((payment) => {
            const method = payment.payment_method;
            const existing = methodMap.get(method);
            const amount = Number(payment.amount);

            if (existing) {
              existing.count += 1;
              existing.total += amount;
            } else {
              methodMap.set(method, { count: 1, total: amount });
            }
          });
        }
      });

      const totalAmount = Array.from(methodMap.values()).reduce((sum, m) => sum + m.total, 0);

      const data = Array.from(methodMap.entries()).map(([method, stats]) => ({
        method: method.charAt(0).toUpperCase() + method.slice(1),
        count: stats.count,
        total: stats.total,
        percentage: totalAmount > 0 ? (stats.total / totalAmount) * 100 : 0,
      }));

      data.sort((a, b) => b.total - a.total);

      setPaymentData(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load payment method data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const chartData = paymentData.map((item) => ({
    name: item.method,
    value: item.total,
  }));

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--secondary))'];

  const getPaymentIcon = (method: string) => {
    const lower = method.toLowerCase();
    if (lower === 'cash') return <Banknote className="h-5 w-5" />;
    if (lower === 'card') return <CreditCard className="h-5 w-5" />;
    return <Wallet className="h-5 w-5" />;
  };

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Export',
      description: `Exporting to ${format.toUpperCase()}...`,
    });
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
            <h1 className="text-3xl font-bold">Payment Method Breakdown</h1>
            <p className="text-muted-foreground">Analyze payment method usage and trends</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To Date</label>
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
            <CardTitle>Payment Method Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentData.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No payment data found</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${formatMoneyUZS(entry.value)}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {paymentData.map((item, index) => (
                <div key={item.method} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-3">
                    <div 
                      className="h-10 w-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: COLORS[index % COLORS.length] + '20' }}
                    >
                      {getPaymentIcon(item.method)}
                    </div>
                    <div>
                      <p className="font-medium">{item.method}</p>
                      <p className="text-sm text-muted-foreground">{item.count} transactions</p>
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
              <p className="text-muted-foreground">No payment data found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment Method</TableHead>
                  <TableHead className="text-right">Number of Transactions</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                  <TableHead className="text-right">Avg Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentData.map((item) => (
                  <TableRow key={item.method}>
                    <TableCell className="font-medium">{item.method}</TableCell>
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
