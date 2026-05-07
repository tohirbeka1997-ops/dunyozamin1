import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateTime, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import {
  getDashboardAnalytics,
  getInventoryValuationSummary,
  getPurchaseOrders,
  getSuppliers,
  getTotalCustomerDebt,
  getWarehouses,
} from '@/db/api';
import type { PurchaseOrderWithDetails, Warehouse } from '@/types/database';
import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';

type Period = 'daily' | 'weekly' | 'monthly' | 'custom';

function parseYMDLocal(ymd: string): Date {
  const [y, m, d] = String(ymd || '').split('-').map((v) => Number(v));
  return new Date(y, (m || 1) - 1, d || 1);
}

function dateToYMDLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function OverallSummaryReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('daily');
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  const [analytics, setAnalytics] = useState<any>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [inventorySummary, setInventorySummary] = useState<null | {
    total_value: number;
    total_quantity: number;
    products_count: number;
    out_of_stock_count: number;
    low_stock_count: number;
  }>(null);
  const [customerDebt, setCustomerDebt] = useState<number>(0);
  const [supplierPayables, setSupplierPayables] = useState<number>(0);
  const [supplierCredits, setSupplierCredits] = useState<number>(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('all');

  const selectedRange = useMemo(() => {
    const today = todayYMD();
    const todayLocal = parseYMDLocal(today);

    let from: Date;
    let to: Date;
    let fromYMD: string;
    let toYMD: string;

    if (period === 'daily') {
      from = startOfDay(todayLocal);
      to = endOfDay(todayLocal);
      fromYMD = today;
      toYMD = today;
    } else if (period === 'weekly') {
      from = startOfWeek(todayLocal, { weekStartsOn: 1 });
      to = endOfWeek(todayLocal, { weekStartsOn: 1 });
      fromYMD = dateToYMDLocal(from);
      toYMD = dateToYMDLocal(to);
    } else if (period === 'monthly') {
      from = startOfMonth(todayLocal);
      to = endOfMonth(todayLocal);
      fromYMD = dateToYMDLocal(from);
      toYMD = dateToYMDLocal(to);
    } else {
      const a = dateFrom || today;
      const b = dateTo || today;
      const fromStr = a <= b ? a : b;
      const toStr = a <= b ? b : a;
      from = startOfDay(parseYMDLocal(fromStr));
      to = endOfDay(parseYMDLocal(toStr));
      fromYMD = fromStr;
      toYMD = toStr;
    }

    return { from, to, fromYMD, toYMD };
  }, [period, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo, warehouseId]);

  useEffect(() => {
    (async () => {
      try {
        const w = await getWarehouses();
        setWarehouses((w as Warehouse[]) || []);
      } catch {
        setWarehouses([]);
      }
    })();
  }, []);

  async function loadData() {
    try {
      setLoading(true);

      const warehouse_id = warehouseId === 'all' ? undefined : warehouseId;
      const { from, to, fromYMD, toYMD } = selectedRange;

      const [a, pos, inv, custDebt, suppliers] = await Promise.all([
        getDashboardAnalytics(from, to, { warehouse_id }),
        getPurchaseOrders({ date_from: fromYMD, date_to: toYMD, include_items: true, warehouse_id }),
        getInventoryValuationSummary({ warehouse_id: warehouse_id || 'ALL', status: 'active' }),
        getTotalCustomerDebt(),
        getSuppliers(true),
      ]);

      setAnalytics(a);
      setPurchaseOrders((pos || []) as any);
      setInventorySummary(inv);
      setCustomerDebt(Number(custDebt || 0));

      const payables = (suppliers || []).reduce((sum: number, s: any) => sum + (Number(s.balance || 0) > 0 ? Number(s.balance || 0) : 0), 0);
      const credits = (suppliers || []).reduce((sum: number, s: any) => sum + (Number(s.balance || 0) < 0 ? Math.abs(Number(s.balance || 0)) : 0), 0);
      setSupplierPayables(payables);
      setSupplierCredits(credits);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Umumiy hisobot maʼlumotlarini yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useReportAutoRefresh(loadData);

  const purchaseTotals = useMemo(() => {
    const active = (purchaseOrders || []).filter((po: any) => String(po.status || '').toLowerCase() !== 'cancelled');

    const totalOrdered = active.reduce((sum, po: any) => sum + Number(po.total_amount || 0), 0);
    const totalPaid = active.reduce((sum, po: any) => sum + Number(po.paid_amount || 0), 0);

    const totalReceived = active.reduce((sum, po: any) => {
      const items = Array.isArray(po.items) ? po.items : [];
      const received = items.reduce((s2: number, it: any) => s2 + (Number(it.received_qty || 0) * Number(it.unit_cost || 0)), 0);
      return sum + received;
    }, 0);

    // Debt should be based on received goods (if not received yet, it’s not a payable yet)
    const totalDebt = active.reduce((sum, po: any) => {
      const items = Array.isArray(po.items) ? po.items : [];
      const received = items.reduce((s2: number, it: any) => s2 + (Number(it.received_qty || 0) * Number(it.unit_cost || 0)), 0);
      const paid = Number(po.paid_amount || 0);
      return sum + Math.max(0, received - paid);
    }, 0);

    return { totalOrdered, totalReceived, totalPaid, totalDebt, count: active.length };
  }, [purchaseOrders]);

  const netDebtPosition = useMemo(() => {
    // As requested: net = customer receivables - supplier payables
    // Positive => we are owed overall; Negative => we owe overall.
    return Number(customerDebt || 0) - Number(supplierPayables || 0);
  }, [customerDebt, supplierPayables]);

  const rangeLabel = useMemo(() => {
    const from = selectedRange.fromYMD;
    const to = selectedRange.toYMD;
    if (from === to) return from;
    return `${from} — ${to}`;
  }, [selectedRange.fromYMD, selectedRange.toYMD]);

  const dataWarnings = useMemo(() => {
    const w = analytics?.warnings || {};
    const list: string[] = [];
    if ((Number(w.missing_cost_count || 0) || 0) > 0) {
      list.push(`cost_price yo‘q qatorlar: ${Number(w.missing_cost_count || 0)}`);
    }
    if (w.using_legacy_returns_table) {
      list.push('qaytarishlar legacy jadvaldan olinmoqda (sale_returns)');
    }
    if (warehouseId !== 'all' && !w.expenses_filtered_by_warehouse) {
      list.push('xarajatlar warehouse bo‘yicha alohida filtrlanmadi (schema cheklovi)');
    }
    return list;
  }, [analytics?.warnings, warehouseId]);
  const missingCostSamples = useMemo(() => {
    const rows = analytics?.warnings?.missing_cost_samples;
    return Array.isArray(rows) ? rows : [];
  }, [analytics?.warnings?.missing_cost_samples]);

  const exportAuditCsv = async () => {
    if (!isElectron()) return;
    const rows: Array<[string, string]> = [
      ['Band', 'So‘m'],
      ['Tovar kirimi (qabul qilingan)', String(purchaseTotals.totalReceived)],
      ['Sotuv tushumi', String(netSales)],
      ['Sotilgan tovar tannarxi (COGS)', String(-totalCogs)],
      ['Yalpi foyda', String(grossProfit)],
      ['Tijoriy xarajatlar', String(-totalExpenses)],
      ['Sotuv qaytarishlari', String(-returnsAmount)],
      ['Qaytish tannarxi (COGS qaytishi)', String(returnsCogs)],
      ['Sof foyda', String(netProfit)],
    ];
    const content = rows.map((r) => `${r[0]},${r[1]}`).join('\n');
    const api = requireElectron();
    await handleIpcResponse(
      api.files.saveTextFile({
        defaultFileName: `financial-act-sverka-${selectedRange.fromYMD}_${selectedRange.toYMD}.csv`,
        content,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      })
    );
    toast({ title: 'CSV saqlandi' });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const netSales = Number(analytics?.total_sales || 0);
  const totalCogs = Number(analytics?.total_cogs || 0);
  const totalExpenses = Number(analytics?.total_expenses || 0);
  const returnsAmount = Number(analytics?.returns_amount || 0);
  const returnsCogs = Number(analytics?.returns_cogs || 0);
  // API `total_profit` = sotuv − tannarx (yalpi). Sof foyda: yalpi − xarajat − qaytarishlar.
  const grossProfit = netSales - totalCogs;
  const netProfit = Number.isFinite(Number(analytics?.net_profit))
    ? Number(analytics?.net_profit || 0)
    : grossProfit - totalExpenses - returnsAmount + returnsCogs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/financial')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-primary/10">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <div>
            <h1 className="page-heading">Moliyaviy akt sverka</h1>
            <p className="text-muted-foreground">
              Umumiy biznes hisob-kitobi: tanlangan davr bo‘yicha sotuv, xarid, foyda va xarajat; qarz va ombor
              hozirgi qoldiq sifatida. Sanalar odatda Tashkent kalendari (YYYY-MM-DD) bo‘yicha.
            </p>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Davr</label>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger>
                  <SelectValue placeholder="Davr" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Bugun</SelectItem>
                  <SelectItem value="weekly">Bu hafta</SelectItem>
                  <SelectItem value="monthly">Bu oy</SelectItem>
                  <SelectItem value="custom">Oraliq</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Boshlanish (YYYY-MM-DD)</label>
              <Input
                type="date"
                value={period === 'custom' ? dateFrom : selectedRange.fromYMD}
                onChange={(e) => {
                  setPeriod('custom');
                  setDateFrom(e.target.value);
                }}
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Tugash (YYYY-MM-DD)</label>
              <Input
                type="date"
                value={period === 'custom' ? dateTo : selectedRange.toYMD}
                onChange={(e) => {
                  setPeriod('custom');
                  setDateTo(e.target.value);
                }}
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Ombor</label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha omborlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha omborlar</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-2">
              <Button className="w-full" onClick={loadData}>
                Yangilash
              </Button>
              <Button variant="outline" onClick={exportAuditCsv}>
                CSV
              </Button>
            </div>
          </div>
          <div className="mt-3 text-sm text-muted-foreground">
            Tanlangan davr: <span className="font-medium text-foreground">{rangeLabel}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Jami sotuv (sof)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(netSales)}</div>
            <div className="text-sm text-muted-foreground">
              Buyurtmalar: {Number(analytics?.total_orders || 0)} · Tovarlar: {Number(analytics?.items_sold || 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Tannarx</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalCogs)}</div>
            <div className="text-sm text-muted-foreground">Hisob: order_items × mahsulot tannarxi (taxmin)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Jami xarajatlar (tasdiqlangan)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalExpenses)}</div>
            <div className="text-sm text-muted-foreground">Faqat tasdiqlangan xarajatlar</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Sof foyda (yakuniy)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(netProfit)}
            </div>
            <div className="text-sm text-muted-foreground">
              Yalpi: <span className="font-medium text-foreground">{formatMoneyUZS(grossProfit)}</span>
              {returnsAmount > 0 && (
                <span className="ml-1">· Qaytarishlar: {formatMoneyUZS(returnsAmount)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Akt sverka (davr: {rangeLabel})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Band</TableHead>
                <TableHead className="text-right">So‘m</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground">1. Tovar kirimi (qabul qilingan, xarid bo‘yicha)</TableCell>
                <TableCell className="text-right font-medium">{formatMoneyUZS(purchaseTotals.totalReceived)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-muted-foreground">2. Sotuv tushumi (yakunlangan buyurtmalar)</TableCell>
                <TableCell className="text-right font-medium">{formatMoneyUZS(netSales)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-muted-foreground">3. Sotilgan tovarning tannarxi (COGS)</TableCell>
                <TableCell className="text-right">−{formatMoneyUZS(totalCogs)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">4. Yalpi foyda (2 − 3)</TableCell>
                <TableCell className="text-right font-semibold">{formatMoneyUZS(grossProfit)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-muted-foreground">5. Tijoriy xarajatlar (tasdiqlangan)</TableCell>
                <TableCell className="text-right">−{formatMoneyUZS(totalExpenses)}</TableCell>
              </TableRow>
              {returnsAmount > 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground">6. Sotuv qaytarishlari (davr)</TableCell>
                  <TableCell className="text-right">−{formatMoneyUZS(returnsAmount)}</TableCell>
                </TableRow>
              )}
              {returnsCogs > 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground">7. Qaytgan tovar tannarxi (COGS qaytishi)</TableCell>
                  <TableCell className="text-right">+{formatMoneyUZS(returnsCogs)}</TableCell>
                </TableRow>
              )}
              <TableRow className="bg-muted/50">
                <TableCell className="font-medium">
                  {returnsAmount > 0 ? (returnsCogs > 0 ? '8' : '7') : '6'}. Sof foyda (yakuniy)
                </TableCell>
                <TableCell className={`text-right text-lg font-bold ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatMoneyUZS(netProfit)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="p-4 pt-0 text-xs text-muted-foreground border-t">
            Sotuvlar va tannarx serverdagi yuklangan buyurtmalar bo‘yicha. Tovar kirimi: xarid qatorlarida qabul
            soni va narxdan. Qarz va ombor stavkasi pastdagi kartalarda.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Qarzlar (global holat)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Bu blok umumiy balansni ko‘rsatadi va davr/ombor filtrlaridan mustaqil.
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mijozlardan qarz (hozir)</span>
              <span className="font-bold">{formatMoneyUZS(customerDebt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Yetkazib beruvchiga qarz (hozir)</span>
              <span className="font-bold text-destructive">{formatMoneyUZS(supplierPayables)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-muted-foreground">Umumiy balans (mijoz − yetkazib beruvchi)</span>
              <span className={`font-bold ${netDebtPosition >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatMoneyUZS(Math.abs(netDebtPosition))}
              </span>
            </div>
            <div className="text-xs text-muted-foreground -mt-1">
              {netDebtPosition >= 0
                ? `Natija: sizning haqqingiz ${formatMoneyUZS(netDebtPosition)}`
                : `Natija: sizning qarzingiz ${formatMoneyUZS(Math.abs(netDebtPosition))}`}
            </div>
            {supplierCredits > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Yetkazib beruvchidan haqim (hozir)</span>
                <span className="font-bold text-success">{formatMoneyUZS(supplierCredits)}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Izoh: filtrlangan (davr/ombor) qarz analitikasi alohida hisobot sifatida beriladi.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Xarid (davr bo‘yicha)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Buyurtma qilingan</span>
              <span className="font-bold">{formatMoneyUZS(purchaseTotals.totalOrdered)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Qabul qilingan (tovar)</span>
              <span className="font-bold text-success">{formatMoneyUZS(purchaseTotals.totalReceived)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">To‘langan</span>
              <span className="font-bold">{formatMoneyUZS(purchaseTotals.totalPaid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Qarz (qabul qilingan − to‘langan)</span>
              <span className="font-bold text-destructive">{formatMoneyUZS(purchaseTotals.totalDebt)}</span>
            </div>
            <div className="text-xs text-muted-foreground">PO soni: {purchaseTotals.count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ombor (hozir)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tovar qiymati (tannarxda)</span>
              <span className="font-bold">{formatMoneyUZS(Number(inventorySummary?.total_value || 0))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mahsulotlar soni</span>
              <span className="font-bold">{Number(inventorySummary?.products_count || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Jami qoldiq (miqdor)</span>
              <span className="font-bold">{Number(inventorySummary?.total_quantity || 0)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Tugagan: {Number(inventorySummary?.out_of_stock_count || 0)} · Kam zaxira: {Number(inventorySummary?.low_stock_count || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {dataWarnings.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-sm space-y-2">
          <span className="font-medium text-amber-800">Data quality ogohlantirishlar:</span>{' '}
          <span className="text-amber-900">{dataWarnings.join(' | ')}</span>
          {missingCostSamples.length > 0 && (
            <div className="text-xs text-amber-900">
              <div className="font-medium mb-1">Aniqlangan qatorlar (top 5):</div>
              {missingCostSamples.map((s: any) => (
                <div key={s.order_item_id} className="flex flex-wrap items-center gap-2">
                  <span>{formatDateTime(s.created_at)}</span>
                  <span>•</span>
                  <span>{s.order_number || s.order_id}</span>
                  <span>•</span>
                  <span>{s.product_name || s.product_id}</span>
                  {s.order_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 py-0 text-[11px]"
                      onClick={() => navigate(`/orders/${s.order_id}`)}
                    >
                      Buyurtmani ochish
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Bog‘liq hisobotlar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/reports/financial/profit-loss')}>
            Foyda va zarar (P&amp;L) <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports/financial/cash-flow')}>
            Pul oqimi
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports/act-sverka')}>
            Ombor akt sverkasi (partiyalar)
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports/customer/act-sverka')}>
            Mijoz bilan akt sverka
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports/supplier/act-sverka')}>
            Yetkazib beruvchi bilan akt sverka
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formulalar (qisqa)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>• Yalpi foyda = Sotuv tushumi − tannarx (davr bo‘yicha)</div>
          <div>• Sof foyda = Yalpi foyda − xarajatlar − qaytarishlar + qaytish tannarxi</div>
          <div>• Xarid: qabul = ∑ (qabul soni × buyurtma birlik narxi)</div>
          <div>• Ombor qiymati = joriy qoldiq baholangan tannarx bo‘yicha (alohida hisob)</div>
          <div className="pt-2 text-xs">
            FIFO / o‘rtacha usul — batafsil ombor va P&amp;L hisobotlarida.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


