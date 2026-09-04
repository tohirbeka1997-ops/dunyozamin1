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
import { formatQuantity } from '@/utils/quantity';
import { aggregatePurchaseOrders, formatMoney, splitSupplierBalances } from '@/lib/currency';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatDateTime, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import { useTranslation } from 'react-i18next';
import {
  getDashboardAnalytics,
  getFinancialActSverka,
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
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('daily');
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  const [actSverka, setActSverka] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [inventorySummary, setInventorySummary] = useState<null | {
    total_value: number;
    total_quantity: number;
    products_count: number;
    out_of_stock_count: number;
    low_stock_count: number;
  }>(null);
  const [customerDebtUzs, setCustomerDebtUzs] = useState(0);
  const [customerDebtUsd, setCustomerDebtUsd] = useState(0);
  const [supplierPayablesUzs, setSupplierPayablesUzs] = useState(0);
  const [supplierPayablesUsd, setSupplierPayablesUsd] = useState(0);
  const [supplierCreditsUzs, setSupplierCreditsUzs] = useState(0);
  const [supplierCreditsUsd, setSupplierCreditsUsd] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('all');

  const warehouseOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
      })),
    ],
    [warehouses, t]
  );

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

      const [a, act, pos, inv, custDebt, suppliers] = await Promise.all([
        getDashboardAnalytics(from, to, { warehouse_id }),
        getFinancialActSverka({
          date_from: fromYMD,
          date_to: toYMD,
          warehouse_id,
          cost_method: 'weighted_average',
        }).catch(() => null),
        getPurchaseOrders({ date_from: fromYMD, date_to: toYMD, include_items: true, warehouse_id }),
        getInventoryValuationSummary({ warehouse_id: warehouse_id || 'ALL', status: 'active', cost_method: 'weighted_average', as_of: toYMD }),
        getTotalCustomerDebt(),
        getSuppliers(true),
      ]);

      setAnalytics(a);
      setActSverka(act);
      setPurchaseOrders((pos || []) as any);
      setInventorySummary(inv);
      const actInv = Number(act?.period?.inventory_value ?? act?.current?.inventory_value ?? 0);
      if (Math.abs(actInv - Number(inv?.total_value || 0)) > 1) {
        console.warn('[OverallSummary] inventory value divergence', {
          act_sverka: actInv,
          valuation: inv?.total_value,
        });
      }
      setCustomerDebtUzs(Number(custDebt?.debt_uzs || 0));
      setCustomerDebtUsd(Number(custDebt?.debt_usd || 0));

      const split = splitSupplierBalances(suppliers || []);
      setSupplierPayablesUzs(split.payablesUzs);
      setSupplierPayablesUsd(split.payablesUsd);
      setSupplierCreditsUzs(split.creditsUzs);
      setSupplierCreditsUsd(split.creditsUsd);
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

  const purchaseTotals = useMemo(
    () => aggregatePurchaseOrders(purchaseOrders as any),
    [purchaseOrders]
  );

  const netDebtPositionUzs = useMemo(() => {
    // UZS-only net: customer AR (UZS) minus UZS supplier payables (USD payables shown separately).
    return Number(customerDebtUzs || 0) - Number(supplierPayablesUzs || 0);
  }, [customerDebtUzs, supplierPayablesUzs]);

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
    const rows: Array<[string, string]> = [['Band', 'So‘m']];
    const lines = Array.isArray(actSverka?.lines) ? actSverka.lines : [];
    if (lines.length) {
      for (const line of lines) {
        rows.push([String(line.label || line.key), String(line.amount ?? 0)]);
      }
    } else {
      rows.push(
        ['Tovar kirimi (qabul qilingan)', String(purchaseTotals.receivedUzs)],
        ['Sof tushum', String(netSales)],
        ['Sotilgan tovar tannarxi (COGS)', String(-totalCogs)],
        ['Yalpi foyda', String(grossProfit)],
        ['Tasdiqlangan xarajatlar', String(-totalExpenses)],
        ['Sof foyda', String(netProfit)],
      );
    }
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

  const pnl = actSverka?.pnl || {};
  const netSalesUzs = Number(pnl.net_sales_uzs ?? analytics?.net_sales_uzs ?? analytics?.total_sales_uzs ?? analytics?.total_sales ?? 0);
  const netSalesUsd = Number(pnl.net_sales_usd ?? analytics?.net_sales_usd ?? analytics?.total_sales_usd ?? 0);
  const netSales = Number(pnl.net_revenue ?? analytics?.net_sales ?? analytics?.total_sales ?? 0);
  const grossRevenue = Number(pnl.gross_revenue ?? analytics?.gross_revenue ?? analytics?.total_sales ?? 0);
  const discounts = Number(pnl.discounts ?? analytics?.discounts ?? 0);
  const totalCogs = Number(pnl.cogs ?? analytics?.total_cogs ?? 0);
  const totalExpenses = Number(pnl.expenses ?? analytics?.total_expenses ?? 0);
  const returnsAmount = Number(pnl.returns_revenue ?? analytics?.returns_amount ?? 0);
  const grossProfit = Number(pnl.gross_profit ?? netSales - totalCogs);
  const netProfit = Number.isFinite(Number(pnl.net_profit ?? analytics?.net_profit))
    ? Number(pnl.net_profit ?? analytics?.net_profit ?? 0)
    : grossProfit - totalExpenses;

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
              <SearchableCombobox
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={warehouseOptions}
                placeholder={t('combobox.all_warehouses', 'Barcha omborlar')}
                searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
              />
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
            <CardTitle className="text-sm text-muted-foreground">Sof tushum</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <DualCurrencyAmount uzs={netSalesUzs} usd={netSalesUsd} />
            </div>
            <div className="text-sm text-muted-foreground">
              Brutto: {formatMoneyUZS(grossRevenue)} · Chegirma: {formatMoneyUZS(discounts)}
              {returnsAmount > 0 ? ` · Qaytarish: ${formatMoneyUZS(returnsAmount)}` : ''}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Sotilgan mahsulot tannarxi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalCogs)}</div>
            <div className="text-sm text-muted-foreground">
              Manba:{' '}
              {pnl.cogs_source === 'fifo'
                ? 'FIFO'
                : pnl.cogs_source === 'weighted_average'
                  ? 'Weighted average'
                  : pnl.cogs_source === 'historical_fallback'
                    ? 'Tarixiy fallback'
                    : pnl.cogs_source === 'insufficient'
                      ? 'Ma’lumot yetarli emas'
                      : 'Yagona moliyaviy model'}
            </div>
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
              {(Array.isArray(actSverka?.lines) && actSverka.lines.length
                ? actSverka.lines
                : [
                    { key: 'inbound_goods', label: 'Tovar kirimi', amount: purchaseTotals.receivedUzs },
                    { key: 'gross_revenue', label: 'Brutto sotuv', amount: grossRevenue },
                    { key: 'discounts', label: 'Chegirmalar', amount: discounts },
                    { key: 'sales_returns', label: 'Sotuv qaytarishlari', amount: returnsAmount },
                    { key: 'net_revenue', label: 'Sof tushum', amount: netSales },
                    { key: 'cogs', label: 'Sotilgan mahsulot tannarxi', amount: totalCogs },
                    { key: 'gross_profit', label: 'Yalpi foyda', amount: grossProfit },
                    { key: 'approved_expenses', label: 'Tasdiqlangan xarajatlar', amount: totalExpenses },
                    { key: 'net_profit', label: 'Sof foyda', amount: netProfit },
                  ]
              ).map((line: any, idx: number) => {
                const highlight = line.key === 'net_profit' || line.key === 'gross_profit' || line.key === 'net_revenue';
                const minus = ['discounts', 'sales_returns', 'cogs', 'approved_expenses'].includes(String(line.key));
                return (
                  <TableRow key={line.key || idx} className={line.key === 'net_profit' ? 'bg-muted/50' : undefined}>
                    <TableCell className={highlight ? 'font-medium' : 'text-muted-foreground'}>
                      {idx + 1}. {line.label}
                    </TableCell>
                    <TableCell className={`text-right ${highlight ? 'font-semibold' : 'font-medium'}`}>
                      {minus && Number(line.amount || 0) !== 0 ? '−' : ''}
                      {formatMoneyUZS(Math.abs(Number(line.amount || 0)))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="p-4 pt-0 text-xs text-muted-foreground border-t">
            Davr bloki yagona moliyaviy modeldan. Qarz kartalarida joriy holat alohida. Ombor qiymati — davr oxiri
            (as-of).
            {actSverka?.meta?.computed_at
              ? ` · ${actSverka.meta.computed_at} · ${actSverka.meta.timezone || ''} · ${actSverka.meta.data_version || ''}`
              : ''}
            {actSverka?.period?.closing_is_provisional
              ? ' · Smena yopilmagan: davr oxiridagi kassa kutilayotgan qiymat (haqiqiy 0 emas).'
              : ''}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Qarzlar (joriy holat)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Joriy holat: umumiy balans, davr filtrlari bilan aralashtirilmaydi. Davr o‘zgarishi akt-sverka
              jadvalida (11–13-satrlar).
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mijozlardan qarz (hozir)</span>
              {customerDebtUsd > 0 ? (
                <DualCurrencyAmount
                  uzs={customerDebtUzs}
                  usd={customerDebtUsd}
                  className="font-bold"
                />
              ) : (
                <span className="font-bold">{formatMoneyUZS(customerDebtUzs)}</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Yetkazib beruvchiga qarz (UZS)</span>
              <span className="font-bold text-destructive">{formatMoney(supplierPayablesUzs, 'UZS')}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-muted-foreground">Umumiy balans (UZS, mijoz − UZS qarz)</span>
              <span className={`font-bold ${netDebtPositionUzs >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatMoney(Math.abs(netDebtPositionUzs), 'UZS')}
              </span>
            </div>
            <div className="text-xs text-muted-foreground -mt-1">
              {netDebtPositionUzs >= 0
                ? `Natija (UZS): sizning haqqingiz ${formatMoney(netDebtPositionUzs, 'UZS')}`
                : `Natija (UZS): sizning qarzingiz ${formatMoney(Math.abs(netDebtPositionUzs), 'UZS')}`}
            </div>
            {supplierPayablesUsd > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Yetkazib beruvchiga qarz (USD)</span>
                <span className="font-bold text-destructive">{formatMoney(supplierPayablesUsd, 'USD')}</span>
              </div>
            )}
            {(supplierCreditsUzs > 0 || supplierCreditsUsd > 0) && (
              <div className="space-y-1">
                {supplierCreditsUzs > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Yetkazib beruvchidan haq (UZS)</span>
                    <span className="font-bold text-success">{formatMoney(supplierCreditsUzs, 'UZS')}</span>
                  </div>
                )}
                {supplierCreditsUsd > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Yetkazib beruvchidan haq (USD)</span>
                    <span className="font-bold text-success">{formatMoney(supplierCreditsUsd, 'USD')}</span>
                  </div>
                )}
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
              <DualCurrencyAmount
                uzs={purchaseTotals.orderedUzs}
                usd={purchaseTotals.orderedUsd}
                className="font-bold"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Qabul qilingan (tovar, UZS)</span>
              <span className="font-bold text-success">{formatMoneyUZS(purchaseTotals.receivedUzs)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">To‘langan</span>
              <DualCurrencyAmount
                uzs={purchaseTotals.paidUzs}
                usd={purchaseTotals.paidUsd}
                className="font-bold"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Qarz</span>
              <DualCurrencyAmount
                uzs={purchaseTotals.debtUzs}
                usd={purchaseTotals.debtUsd}
                className="font-bold text-destructive"
              />
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
              <span className="font-bold">{formatQuantity(Number(inventorySummary?.total_quantity || 0), 'pcs')}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Tugagan: {Number(inventorySummary?.out_of_stock_count || 0)} · Kam zaxira: {Number(inventorySummary?.low_stock_count || 0)}
            </div>
            {Math.abs(Number(actSverka?.period?.inventory_value || 0) - Number(inventorySummary?.total_value || 0)) > 1 ? (
              <p className="text-xs text-destructive">
                Ogohlantirish: moliyaviy bosh sahifa ({formatMoneyUZS(Number(analytics?.inventory_value || 0))}) va
                baholash hisoboti ({formatMoneyUZS(Number(inventorySummary?.total_value || 0))}) farq qiladi. Diagnostika
                jurnaliga yozildi.
              </p>
            ) : null}
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


