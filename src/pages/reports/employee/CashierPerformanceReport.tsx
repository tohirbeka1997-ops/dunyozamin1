import { useState, useEffect, useMemo } from 'react';
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
import { getOrders, getProfiles } from '@/db/api';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface CashierPerformance {
  employee_id: string;
  employee_name: string;
  total_sales: number;
  total_revenue: number;
  total_profit: number;
  order_count: number;
  voided_orders: number;
}

type CashierSortKey =
  | 'employee_name'
  | 'order_count'
  | 'total_revenue'
  | 'total_profit'
  | 'voided_orders';

export default function CashierPerformanceReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [performance, setPerformance] = useState<CashierPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const { sortKey, sortOrder, toggleSort } = useTableSort<CashierSortKey>('total_revenue', 'desc');

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, profilesData] = await Promise.all([
        getOrders(),
        getProfiles(),
      ]);

      const cashierMap = new Map<string, CashierPerformance>();

      const filteredOrders = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      filteredOrders.forEach((order) => {
        if (!order.cashier_id) return;

        const existing = cashierMap.get(order.cashier_id);
        const revenue = Number(order.total_amount);
        const profit = calculateProfit(order);

        if (existing) {
          existing.total_sales += revenue;
          existing.total_revenue += revenue;
          existing.total_profit += profit;
          existing.order_count += 1;
          if (order.status === 'cancelled' || order.status === 'hold') {
            existing.voided_orders += 1;
          }
        } else {
          const employee = profilesData.find((p) => p.id === order.cashier_id);
          cashierMap.set(order.cashier_id, {
            employee_id: order.cashier_id,
            employee_name: employee?.full_name || employee?.username || 'Noma\'lum',
            total_sales: revenue,
            total_revenue: revenue,
            total_profit: profit,
            order_count: 1,
            voided_orders: (order.status === 'cancelled' || order.status === 'hold') ? 1 : 0,
          });
        }
      });

      const performanceData = Array.from(cashierMap.values());
      setPerformance(performanceData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Kassir faoliyati ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateProfit = (order: any) => {
    const items = order.items || [];
    const totalCost = items.reduce((sum: number, item: any) => {
      const cost = Number(item?.cost_price ?? 0) || 0;
      return sum + (cost * Number(item.quantity));
    }, 0);
    return Number(order.total_amount) - totalCost;
  };

  const sortedPerformance = useMemo(() => {
    const list = [...performance];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      switch (key) {
        case 'employee_name':
          return compareScalar(a.employee_name.toLowerCase(), b.employee_name.toLowerCase(), ord);
        case 'order_count':
          return compareScalar(a.order_count, b.order_count, ord);
        case 'total_revenue':
          return compareScalar(a.total_revenue, b.total_revenue, ord);
        case 'total_profit':
          return compareScalar(a.total_profit, b.total_profit, ord);
        case 'voided_orders':
          return compareScalar(a.voided_orders, b.voided_orders, ord);
        default:
          return 0;
      }
    });
    return list;
  }, [performance, sortKey, sortOrder]);

  const totalRevenue = performance.reduce((sum, p) => sum + p.total_revenue, 0);
  const totalOrders = performance.reduce((sum, p) => sum + p.order_count, 0);
  const totalProfit = performance.reduce((sum, p) => sum + p.total_profit, 0);

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} ga eksport qilinmoqda...`,
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
            <h1 className="text-3xl font-bold">Kassir faoliyati</h1>
            <p className="text-muted-foreground">Kassirlarning sotuv samaradorligini ko'rish</p>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami tushum</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami buyurtmalar</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami foyda</p>
                <p className="text-2xl font-bold text-success">{formatMoneyUZS(totalProfit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {sortedPerformance.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Kassir faoliyati ma'lumotlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<CashierSortKey>
                    columnKey="employee_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Xodim
                  </SortableTableHead>
                  <SortableTableHead<CashierSortKey>
                    columnKey="order_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Sotuvlar soni
                  </SortableTableHead>
                  <SortableTableHead<CashierSortKey>
                    columnKey="total_revenue"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Jami tushum
                  </SortableTableHead>
                  <SortableTableHead<CashierSortKey>
                    columnKey="total_profit"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Jami foyda
                  </SortableTableHead>
                  <SortableTableHead<CashierSortKey>
                    columnKey="voided_orders"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Bekor qilingan
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPerformance.map((perf) => (
                  <TableRow key={perf.employee_id}>
                    <TableCell className="font-medium">{perf.employee_name}</TableCell>
                    <TableCell className="text-right">{perf.order_count}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(perf.total_revenue)}</TableCell>
                    <TableCell className="text-right text-success">{formatMoneyUZS(perf.total_profit)}</TableCell>
                    <TableCell className="text-right">{perf.voided_orders}</TableCell>
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

