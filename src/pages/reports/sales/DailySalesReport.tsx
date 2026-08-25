import { useState, useEffect, useMemo } from 'react';
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
import { FileDown, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { aggregateSalesOrders, formatOrderMoney, getOrderSaleCurrency } from '@/lib/currency';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { exportDailySalesToExcel, exportDailySalesToPDF } from '@/lib/export';
import { formatOrderDateTime, todayYMD } from '@/lib/datetime';
import { calculateOrderProfit } from '@/lib/reportProfit';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import { useTranslation } from 'react-i18next';

export default function DailySalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
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
  const [netProfitUzsFromApi, setNetProfitUzsFromApi] = useState(0);
  const [salesReturns, setSalesReturns] = useState<SalesReturnWithDetails[]>([]);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [warnings, setWarnings] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseSelection, setWarehouseSelection] = useState<string>('AUTO');

  const warehouseOptions = useMemo(
    () => [
      { value: 'AUTO', label: 'Auto (Default ombor)' },
      { value: 'ALL', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((wh) => ({
        value: wh.id,
        label: `${wh.name}${wh.is_default ? ' (Default)' : ''}`,
      })),
    ],
    [warehouses, t]
  );

  const cashierOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_cashiers', 'Barcha kassirlar') },
      ...cashiers.map((cashier) => ({
        value: cashier.id,
        label: cashier.username || cashier.full_name || cashier.email || cashier.id,
        keywords: [cashier.full_name, cashier.email].filter(Boolean).join(' '),
      })),
    ],
    [cashiers, t]
  );

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
      setNetProfitUzsFromApi(
        Number(
          report?.summary?.net_profit ??
            (Number(report?.summary?.total_profit || 0) - Number(report?.summary?.returns_profit_impact || 0)),
        ) || 0,
      );
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

  const calculateProfit = (order: OrderWithDetails) => calculateOrderProfit(order as any);

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

  const salesAgg = aggregateSalesOrders(orders, { status: 'completed' });

  const profitByCurrency = orders
    .filter((o) => o.status === 'completed')
    .reduce(
      (acc, o) => {
        const p = calculateProfit(o);
        if (getOrderSaleCurrency(o) === 'USD') acc.usd += p;
        else acc.uzs += p;
        return acc;
      },
      { uzs: 0, usd: 0 }
    );

  const netProfitUzs = netProfitUzsFromApi;
  const netProfitUsd = profitByCurrency.usd;
  const avgUzs =
    salesAgg.countUzs > 0 ? salesAgg.totalUzs / salesAgg.countUzs : 0;
  const avgUsd =
    salesAgg.countUsd > 0 ? salesAgg.totalUsd / salesAgg.countUsd : 0;

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
        totalSales: salesAgg.totalUzs,
        totalSalesUsd: salesAgg.totalUsd,
        totalProfit: netProfitUzs,
        totalProfitUsd: netProfitUsd,
        totalReturns,
        avgOrderValue: avgUzs,
        avgOrderUsd: avgUsd,
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
      {warnings?.cogs_anomaly ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
          <span className="inline-flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Tannarx anomaliyasi: {Number(warnings.cogs_anomaly_count || 0)} ta sotuv
          </span>
          <p className="mt-1 text-muted-foreground">
            {(warnings as any).cogs_anomaly_hint ||
              'Daromaddan ancha katta COGS — ko‘pincha USD maydoniga UZS kiritib kursga ko‘paytirilgan. order_items.cost_price / partiya unit_cost ni tekshiring.'}
          </p>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/sales')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Kunlik sotuv hisobotlari</h1>
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jami savdo (Gross)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <DualCurrencyAmount uzs={salesAgg.totalUzs} usd={salesAgg.totalUsd} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Qaytarishdan oldingi</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Qaytarilgan summa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatMoneyUZS(totalReturns)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sof savdo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMoneyUZS(Math.max(0, salesAgg.totalUzs - totalReturns))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Net tushum (yalpi − qaytarish)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sof foyda
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netProfitUzs >= 0 ? 'text-success' : 'text-destructive'}`}>
              <DualCurrencyAmount uzs={netProfitUzs} usd={netProfitUsd} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              O'rtacha buyurtma qiymati
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <DualCurrencyAmount uzs={avgUzs} usd={avgUsd} />
            </div>
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
              <SearchableCombobox
                value={warehouseSelection}
                onValueChange={handleWarehouseChange}
                options={warehouseOptions}
                placeholder="Auto (Default ombor)"
                searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Kassir</label>
              <SearchableCombobox
                value={cashierFilter}
                onValueChange={(value) => updateParams({ cashier: value })}
                options={cashierOptions}
                placeholder={t('combobox.all_cashiers', 'Barcha kassirlar')}
                searchPlaceholder={t('combobox.search_employee', "Nom yoki email bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_employee', 'Xodim topilmadi')}
              />
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
                  <TableHead className="text-right">Foyda (UZS)</TableHead>
                  <TableHead>Holat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const profit = calculateProfit(order);
                  const cogsAnomaly = !!(order as any).cogs_anomaly;
                  return (
                    <TableRow key={order.id} className={cogsAnomaly ? 'bg-amber-500/5' : undefined}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {order.order_number}
                          {cogsAnomaly ? (
                            <AlertTriangle
                              className="h-3.5 w-3.5 text-amber-600"
                              title="Tannarx anomaliyasi (COGS >> daromad)"
                            />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        {formatOrderDateTime(order.created_at)}
                      </TableCell>
                      <TableCell>
                        {(order as any).cashier_name ||
                          getCashierNameById(order.cashier_id || (order as any).user_id)}
                      </TableCell>
                      <TableCell>{getPaymentType(order)}</TableCell>
                      <TableCell className="text-right">
                        {formatOrderMoney(order, order.total_amount)}
                      </TableCell>
                      <TableCell className={`text-right ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {/* Backend profit is always UZS (revenue×fx − COGS) */}
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
