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
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';

interface CashierPerformance {
  employee_id: string;
  employee_name: string;
  total_sales: number;
  total_revenue: number;
  revenue_uzs?: number;
  revenue_usd?: number;
  total_profit: number;
  order_count: number;
  voided_orders: number;
  cancelled_value?: number;
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
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return formatDateYMD(d);
  });
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const { sortKey, sortOrder, toggleSort } = useTableSort<CashierSortKey>('total_revenue', 'desc');

  const calculateProfit = (order: any) => {
    const items = order.items || [];
    const totalCost = items.reduce((sum: number, item: any) => {
      const cost = Number(item?.cost_price ?? 0) || 0;
      return sum + cost * Number(item.quantity);
    }, 0);
    return Number(order.total_amount) - totalCost;
  };

  const loadData = async () => {
    try {
      setLoading(true);

      // PRIMARY: backend SQL endpoint (no 100-order limit, includes cancelled stats and COGS)
      if (isElectron()) {
        try {
          const api = requireElectron();
          const rows = await handleIpcResponse<Array<{
            employee_id: string;
            employee_name: string;
            order_count: number;
            total_revenue: number;
            revenue_uzs?: number;
            revenue_usd?: number;
            total_profit: number;
            cancelled_count: number;
            cancelled_value: number;
          }>>(
            api.reports?.cashierPerformance?.({
              date_from: dateFrom,
              date_to: dateTo,
            }) || Promise.resolve([])
          );
          const performanceData: CashierPerformance[] = (rows || []).map((r) => ({
            employee_id: r.employee_id,
            employee_name: r.employee_name || r.employee_id,
            total_sales: Number(r.total_revenue) || 0,
            total_revenue: Number(r.total_revenue) || 0,
            revenue_uzs: Number(r.revenue_uzs ?? r.total_revenue) || 0,
            revenue_usd: Number(r.revenue_usd ?? 0) || 0,
            total_profit: Number(r.total_profit) || 0,
            order_count: Number(r.order_count) || 0,
            voided_orders: Number(r.cancelled_count) || 0,
            cancelled_value: Number(r.cancelled_value) || 0,
          }));
          setPerformance(performanceData);
          return;
        } catch (err) {
          console.warn('[CashierPerformanceReport] backend endpoint failed, falling back:', err);
        }
      }

      // FALLBACK: client-side aggregation (mock/browser mode), with high limit
      const [ordersData, profilesData] = await Promise.all([
        getOrders(100000),
        getProfiles(),
      ]);

      const cashierMap = new Map<string, CashierPerformance>();

      const inRange = ordersData.filter((order) => {
        const orderDate = formatDateYMD(order.created_at);
        return orderDate >= dateFrom && orderDate <= dateTo;
      });

      inRange.forEach((order: any) => {
        // Use cashier_id with user_id fallback (matches backend convention)
        const empId = order.cashier_id || order.user_id;
        if (!empId) return;

        const existing = cashierMap.get(empId);
        const revenue = Number(order.total_amount) || 0;
        const profit = calculateProfit(order);

        const isCompleted = order.status === 'completed';
        const isCancelled = order.status === 'cancelled' || order.status === 'hold';

        if (existing) {
          if (isCompleted) {
            existing.total_sales += revenue;
            existing.total_revenue += revenue;
            existing.total_profit += profit;
            existing.order_count += 1;
          }
          if (isCancelled) {
            existing.voided_orders += 1;
            existing.cancelled_value = (existing.cancelled_value || 0) + revenue;
          }
        } else {
          const employee = profilesData.find((p) => p.id === empId);
          cashierMap.set(empId, {
            employee_id: empId,
            employee_name: employee?.full_name || employee?.username || 'Noma\'lum',
            total_sales: isCompleted ? revenue : 0,
            total_revenue: isCompleted ? revenue : 0,
            total_profit: isCompleted ? profit : 0,
            order_count: isCompleted ? 1 : 0,
            voided_orders: isCancelled ? 1 : 0,
            cancelled_value: isCancelled ? revenue : 0,
          });
        }
      });

      setPerformance(Array.from(cashierMap.values()));
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: "Kassir faoliyati ma'lumotlarini yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

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

  const revenueTotals = useMemo(
    () =>
      performance.reduce(
        (acc, p) => {
          acc.uzs += p.revenue_uzs ?? p.total_revenue;
          acc.usd += p.revenue_usd ?? 0;
          return acc;
        },
        { uzs: 0, usd: 0 }
      ),
    [performance]
  );
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/employee')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Kassir faoliyati</h1>
            <p className="text-muted-foreground text-sm">
              Kassirlarning sotuv samaradorligi (tushum UZS ekvivalent + USD ajratilgan; foyda — UZS). Sana:{' '}
              <span className="text-foreground/80">Asia/Tashkent</span>.
            </p>
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
                <div className="text-2xl font-bold">
                  <DualCurrencyAmount uzs={revenueTotals.uzs} usd={revenueTotals.usd} className="items-start" />
                </div>
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
                <p className="text-sm text-muted-foreground">Jami foyda (UZS)</p>
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
                    Jami tushum (UZS/USD)
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
                    <TableCell className="text-right">
                      <DualCurrencyAmount
                        uzs={perf.revenue_uzs ?? perf.total_revenue}
                        usd={perf.revenue_usd}
                      />
                    </TableCell>
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

