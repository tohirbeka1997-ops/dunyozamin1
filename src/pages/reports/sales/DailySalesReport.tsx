import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { getDailySalesReportSQL, getPriceTiers, getProfiles, getSetting, updateSetting, getWarehouses } from '@/db/api';
import type { OrderWithDetails, Profile, SalesReturnWithDetails } from '@/types/database';
type PriceTier = { id: number; name: string; code?: string };
type Warehouse = { id: string; name: string; is_default?: number | boolean; is_active?: number | boolean };
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { exportDailySalesToExcel, exportDailySalesToPDF } from '@/lib/export';
import { formatOrderDateTime, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';

export default function DailySalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.daily-sales.filters.query',
    trackedKeys: ['dateFrom', 'dateTo', 'cashier', 'payment', 'status', 'tier'],
  });
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const dateFrom = searchParams.get('dateFrom') || todayYMD();
  const dateTo = searchParams.get('dateTo') || todayYMD();
  const cashierFilter = searchParams.get('cashier') || 'all';
  const paymentFilter = searchParams.get('payment') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const tierFilter = searchParams.get('tier') || 'all';
  const [isExporting, setIsExporting] = useState(false);
  const [totalReturns, setTotalReturns] = useState(0);
  const [returnsProfitImpact, setReturnsProfitImpact] = useState(0);
  const [salesReturns, setSalesReturns] = useState<SalesReturnWithDetails[]>([]);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [warnings, setWarnings] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseSelection, setWarehouseSelection] = useState<string>('AUTO');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, cashierFilter, paymentFilter, statusFilter, tierFilter, warehouseSelection]);

  useEffect(() => {
    loadWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const warehouseId =
        warehouseSelection === 'ALL'
          ? 'ALL'
          : warehouseSelection === 'AUTO'
            ? undefined
            : warehouseSelection;
      const [report, profilesData, tiers] = await Promise.all([
        getDailySalesReportSQL({
          date_from: dateFrom,
          date_to: dateTo,
          cashier_id: cashierFilter !== 'all' ? cashierFilter : null,
          payment_method: paymentFilter !== 'all' ? paymentFilter : null,
          status: statusFilter !== 'all' ? statusFilter : null,
          price_tier_id: tierFilter !== 'all' ? Number(tierFilter) : null,
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        }),
        getProfiles(),
        getPriceTiers(),
      ]);

      setOrders((report?.orders || []) as any);
      setSalesReturns((report?.returns || []) as any);
      setTotalReturns(Number(report?.summary?.total_returns || 0) || 0);
      setReturnsProfitImpact(Number(report?.summary?.returns_profit_impact || 0) || 0);
      setCashiers(profilesData);
      setPriceTiers(tiers || []);
      setWarnings(report?.warnings || null);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Sotuv ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadWarehouses() {
    try {
      const [rows, saved] = await Promise.all([
        getWarehouses({ is_active: true }),
        getSetting('reports', 'daily_sales.warehouse_id'),
      ]);
      const list = Array.isArray(rows) ? rows : [];
      setWarehouses(list);

      const savedValue = saved == null ? 'AUTO' : String(saved);
      if (savedValue === 'AUTO') {
        setWarehouseSelection('AUTO');
        return;
      }
      if (savedValue === 'ALL') {
        setWarehouseSelection('ALL');
        return;
      }
      if (savedValue && list.some((w) => String(w.id) === savedValue)) {
        setWarehouseSelection(savedValue);
        return;
      }
      setWarehouseSelection('AUTO');
    } catch {
      setWarehouses([]);
      setWarehouseSelection('AUTO');
    }
  }

  const handleWarehouseChange = async (value: string) => {
    setWarehouseSelection(value);
    try {
      await updateSetting('reports', 'daily_sales.warehouse_id', value, 'system');
    } catch {
      // ignore setting persistence failure
    }
  };

  const calculateProfit = (order: OrderWithDetails) => {
    const explicit = (order as any).profit;
    if (explicit != null) return Number(explicit) || 0;
    const items = order.items || [];
    const totalCost = items.reduce((sum, item) => {
      const qty = Number((item as any).quantity || 0);
      const unitCost = Number((item as any).cost_price ?? 0) || 0;
      return sum + unitCost * qty;
    }, 0);
    return Number(order.total_amount) - totalCost;
  };

  const getPaymentType = (order: OrderWithDetails) => {
    const explicit = (order as any).payment_method;
    if (explicit) {
      const val = String(explicit);
      if (val.toLowerCase() === 'mixed') return 'Mixed';
      return val.charAt(0).toUpperCase() + val.slice(1);
    }
    const payments = order.payments || [];
    if (payments.length === 0) return 'N/A';
    if (payments.length > 1) return 'Mixed';
    return payments[0].payment_method.charAt(0).toUpperCase() + payments[0].payment_method.slice(1);
  };

  const getCashierNameById = (id?: string | null) => {
    if (!id) return '-';
    const c = cashiers.find((p) => String(p.id) === String(id));
    return c?.full_name || c?.username || '-';
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      completed: { label: 'Tugallangan', className: 'bg-success text-white' },
      returned: { label: 'Qaytarilgan', className: 'bg-destructive text-white' },
      hold: { label: 'Kutilmoqda', className: 'bg-warning text-white' },
    };
    
    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const totalSales = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + Number((o as any).revenue ?? o.total_amount ?? 0), 0);
  
  const totalProfit = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + calculateProfit(o), 0);

  // Net profit after subtracting profit impact from completed returns in the selected date range
  const netProfit = totalProfit - returnsProfitImpact;
  
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const avgOrderValue = completedOrders.length > 0 
    ? totalSales / completedOrders.length 
    : 0;

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (orders.length === 0) {
      toast({
        title: 'Xatolik',
        description: 'Eksport qilish uchun ma\'lumot yo\'q',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsExporting(true);

      // Prepare data for export
      const exportData = orders.map((order) => ({
        order_number: order.order_number,
        created_at: order.created_at,
        cashier: (order as any).cashier_name || getCashierNameById(order.cashier_id || (order as any).user_id),
        payment_type: getPaymentType(order),
        total_amount: order.total_amount,
        profit: calculateProfit(order),
        status: order.status,
      }));

      const filters = {
        dateFrom,
        dateTo,
        cashierFilter,
        paymentFilter,
        statusFilter,
      };

      const summary = {
        totalSales,
        totalProfit: netProfit,
        totalReturns,
        avgOrderValue,
      };

      if (format === 'excel') {
        await exportDailySalesToExcel(exportData, filters, summary, cashiers);
      } else {
        await exportDailySalesToPDF(exportData, filters, summary, cashiers);
      }

      toast({
        title: 'Muvaffaqiyatli',
        description: `${format.toUpperCase()} formatida eksport qilindi`,
      });
    } catch (error) {
      console.error('Eksport xatosi:', error);
      toast({
        title: 'Xatolik',
        description: 'Eksportda xatolik yuz berdi',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getRefundMethodLabel = (m: any) => {
    const v = String(m || '').toLowerCase();
    if (v === 'cash') return 'Naqd';
    if (v === 'card') return 'Karta';
    if (v === 'credit' || v === 'customer_account') return 'Mijoz hisobiga';
    return m || '-';
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
      {warnings?.warehouse_not_set && warehouseSelection === 'AUTO' ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Default ombor belgilanmagan. Hisobot barcha omborlar bo‘yicha ko‘rsatilmoqda.
          <Button
            variant="link"
            className="ml-2 h-auto p-0 text-destructive underline"
            onClick={() => navigate('/settings')}
          >
            Sozlamaga o‘tish
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Kunlik sotuv hisobotlari</h1>
            <p className="text-muted-foreground">Kunlik sotuvlar samaradorligi va foydasini kuzatish</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => handleExport('excel')}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                Yuklanmoqda...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                Excel
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => handleExport('pdf')}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                Yuklanmoqda...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                PDF
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jami sotuv
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jami foyda
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{formatMoneyUZS(netProfit)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Qaytarilganlar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatMoneyUZS(totalReturns)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              O'rtacha buyurtma qiymati
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(avgOrderValue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => updateParams({ dateFrom: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => updateParams({ dateTo: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Ombor</label>
              <Select value={warehouseSelection} onValueChange={handleWarehouseChange}>
                <SelectTrigger>
              <SelectValue placeholder="Auto (Default ombor)" />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="AUTO">Auto (Default ombor)</SelectItem>
                  <SelectItem value="ALL">Barcha omborlar</SelectItem>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                      {wh.is_default ? ' (Default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Kassir</label>
              <Select value={cashierFilter} onValueChange={(value) => updateParams({ cashier: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha kassirlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha kassirlar</SelectItem>
                  {cashiers.map((cashier) => (
                    <SelectItem key={cashier.id} value={cashier.id}>
                      {cashier.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To'lov turi</label>
              <Select value={paymentFilter} onValueChange={(value) => updateParams({ payment: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha turlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha turlar</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="terminal">Terminal</SelectItem>
                  <SelectItem value="qr">QR</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Narx turi</label>
              <Select value={tierFilter} onValueChange={(value) => updateParams({ tier: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha tierlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha tierlar</SelectItem>
                  {priceTiers.map((tier) => (
                    <SelectItem key={tier.id} value={String(tier.id)}>
                      {tier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Holati</label>
              <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha holatlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holatlar</SelectItem>
                  <SelectItem value="completed">Tugallangan</SelectItem>
                  <SelectItem value="returned">Qaytarilgan</SelectItem>
                  <SelectItem value="hold">Kutilmoqda</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Tanlangan davr uchun sotuv ma'lumotlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hisob-faktura raqami</TableHead>
                  <TableHead>Sana / Vaqt</TableHead>
                  <TableHead>Kassir</TableHead>
                  <TableHead>To'lov turi</TableHead>
                  <TableHead className="text-right">Jami sotuv</TableHead>
                  <TableHead className="text-right">Foyda</TableHead>
                  <TableHead>Holat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const profit = calculateProfit(order);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.order_number}</TableCell>
                      <TableCell>
                        {formatOrderDateTime(order.created_at)}
                      </TableCell>
                      <TableCell>
                        {(order as any).cashier_name ||
                          getCashierNameById(order.cashier_id || (order as any).user_id)}
                      </TableCell>
                      <TableCell>{getPaymentType(order)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(order.total_amount)}
                      </TableCell>
                      <TableCell className={`text-right ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatMoneyUZS(profit)}
                      </TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qaytarishlar</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {salesReturns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Tanlangan davr uchun qaytarishlar topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Qaytarish raqami</TableHead>
                  <TableHead>Hisob-faktura raqami</TableHead>
                  <TableHead>Sana / Vaqt</TableHead>
                  <TableHead>Kassir</TableHead>
                  <TableHead>Usul</TableHead>
                  <TableHead className="text-right">Summa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesReturns.map((ret: any) => (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium font-mono">{ret.return_number || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {ret.order_number ||
                        ret.original_order_number ||
                        orders.find((o) => o.id === ret.order_id)?.order_number ||
                        '-'}
                    </TableCell>
                    <TableCell>{formatOrderDateTime(ret.created_at)}</TableCell>
                    <TableCell>{getCashierNameById(ret.cashier_id || ret.user_id)}</TableCell>
                    <TableCell>{getRefundMethodLabel(ret.refund_method)}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {formatMoneyUZS(Number(ret.total_amount || 0))}
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
