import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import {
  getDashboardAnalytics,
  getInventoryValuationSummary,
  getPurchaseOrders,
  getSuppliers,
  getTotalCustomerDebt,
} from '@/db/api';
import type { PurchaseOrderWithDetails } from '@/types/database';
import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';

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

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);

      const warehouse_id = 'main-warehouse-001';
      const { from, to, fromYMD, toYMD } = selectedRange;

      const [a, pos, inv, custDebt, suppliers] = await Promise.all([
        getDashboardAnalytics(from, to),
        getPurchaseOrders({ date_from: fromYMD, date_to: toYMD, include_items: true }),
        getInventoryValuationSummary({ warehouse_id, status: 'active' }),
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
  const grossProfit = Number(analytics?.gross_profit || 0);
  const netProfit = Number(analytics?.total_profit || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-primary/10">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <div>
            <h1 className="text-3xl font-bold">Umumiy hisobot</h1>
            <p className="text-muted-foreground">Asosiy ko‘rsatkichlar (sotuv, xarid, qarzlar, ombor, foyda)</p>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

            <div className="flex items-end">
              <Button className="w-full" onClick={loadData}>
                Yangilash
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
            <CardTitle className="text-sm text-muted-foreground">Sof foyda</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(netProfit)}
            </div>
            <div className="text-sm text-muted-foreground">
              Yalpi foyda: <span className="font-medium text-foreground">{formatMoneyUZS(grossProfit)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Qarzlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
              Izoh: “hozir” — balanslar umumiy holati (davrga bog‘liq emas).
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

      <Card>
        <CardHeader>
          <CardTitle>Formulalar (qisqa)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>- Sotuv (sof) = Oraliq summa − chegirma</div>
          <div>- Yalpi foyda = Sof sotuv − tannarx</div>
          <div>- Sof foyda = Yalpi foyda − qaytishlar + qaytgan tannarx − xarajatlar</div>
          <div>- Xarid qarzi = Qabul qilingan tovar qiymati − to‘langan</div>
          <div>- Ombor qiymati = Qoldiq × tannarx (FIFO yoki weighted avg)</div>
          <div className="pt-2 text-xs">
            Eslatma: FIFO yoqilgan bo‘lsa partiya tannarxi, aks holda qabul kvitansiyalari bo‘yicha o‘rtacha tannarx ishlatiladi.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


