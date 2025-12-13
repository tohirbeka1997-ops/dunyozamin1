import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getOrders } from '@/db/api';
import type { OrderWithDetails } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, subDays, eachDayOfInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';

export default function ProfitLossReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadData();
  }, [period, dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const ordersData = await getOrders();
      
      let from = new Date(dateFrom);
      let to = new Date(dateTo);

      if (period === 'daily') {
        from = new Date();
        to = new Date();
      } else if (period === 'weekly') {
        from = startOfWeek(new Date());
        to = endOfWeek(new Date());
      } else if (period === 'monthly') {
        from = startOfMonth(new Date());
        to = endOfMonth(new Date());
      }

      const filtered = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at);
        return orderDate >= from && orderDate <= to;
      });

      setOrders(filtered);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load financial data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateCOGS = (order: OrderWithDetails) => {
    const items = order.items || [];
    return items.reduce((sum, item) => {
      const product = item.product;
      const cost = product?.purchase_price || 0;
      return sum + (cost * Number(item.quantity));
    }, 0);
  };

  const completedOrders = orders.filter((o) => o.status === 'completed');
  const returnedOrders = orders.filter((o) => o.status === 'returned');

  const grossSales = completedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const totalDiscounts = completedOrders.reduce((sum, o) => sum + Number(o.discount_amount || 0), 0);
  const netSales = grossSales - totalDiscounts;
  const cogs = completedOrders.reduce((sum, o) => sum + calculateCOGS(o), 0);
  const grossProfit = netSales - cogs;
  const returns = returnedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const finalProfit = grossProfit - returns;

  const profitMargin = netSales > 0 ? (finalProfit / netSales) * 100 : 0;

  const getChartData = () => {
    const days = eachDayOfInterval({
      start: period === 'daily' ? subDays(new Date(), 6) : new Date(dateFrom),
      end: period === 'daily' ? new Date() : new Date(dateTo),
    });

    return days.map((day) => {
      const dayOrders = completedOrders.filter((o) => {
        const orderDate = new Date(o.created_at).toISOString().split('T')[0];
        return orderDate === day.toISOString().split('T')[0];
      });

      const sales = dayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
      const cost = dayOrders.reduce((sum, o) => sum + calculateCOGS(o), 0);
      const profit = sales - cost;

      return {
        date: format(day, 'MMM dd'),
        sales,
        cost,
        profit,
      };
    });
  };

  const chartData = getChartData();

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
            <h1 className="text-3xl font-bold">Profit & Loss Report</h1>
            <p className="text-muted-foreground">Comprehensive financial performance analysis</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Period</label>
              <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === 'custom' && (
              <>
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
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profit & Loss Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" name="Sales" />
              <Line type="monotone" dataKey="cost" stroke="hsl(var(--destructive))" name="Cost" />
              <Line type="monotone" dataKey="profit" stroke="hsl(var(--success))" name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Income Statement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">Gross Sales</span>
                <span className="font-bold">{formatMoneyUZS(grossSales)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Less: Discounts</span>
                <span className="text-destructive">-{formatMoneyUZS(totalDiscounts)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">Net Sales</span>
                <span className="font-bold">{formatMoneyUZS(netSales)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Less: Cost of Goods Sold</span>
                <span className="text-destructive">-{formatMoneyUZS(cogs)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">Gross Profit</span>
                <span className="font-bold text-success">{formatMoneyUZS(grossProfit)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Less: Returns</span>
                <span className="text-destructive">-{formatMoneyUZS(returns)}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-lg font-bold">Final Profit</span>
                <span className={`text-lg font-bold ${finalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatMoneyUZS(finalProfit)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Profit Margin</span>
                  <span className="font-bold">{profitMargin.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-success h-2 rounded-full"
                    style={{ width: `${Math.min(profitMargin, 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Total Orders</span>
                  <span className="font-bold">{completedOrders.length}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Average Order Value</span>
                  <span className="font-bold">
                    {completedOrders.length > 0 ? formatMoneyUZS(grossSales / completedOrders.length) : formatMoneyUZS(0)}
                  </span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Return Rate</span>
                  <span className="font-bold">
                    {orders.length > 0 ? ((returnedOrders.length / orders.length) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
