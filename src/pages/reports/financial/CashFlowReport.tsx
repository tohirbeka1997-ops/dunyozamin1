import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { expenseToUzsAmount, getOrderSaleCurrency } from '@/lib/currency';
import { toShiftUzsAmount } from '@/lib/posSaleCurrency';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import type {
  CashFlowGranularity,
  CashFlowReconciliation,
  CashFlowReportPayload,
  CashFlowRow,
  CashFlowSourceRow,
} from '@/types/financialReports';
import { getExpenses, getOrderById, getOrders, getSalesReturns, getSuppliers, getSupplierPayments } from '@/db/api';
import { startOfWeek } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { ReportLoadPanel } from '@/components/reports/ReportLoadPanel';
import {
  createReportCorrelationId,
  reportLoadErrorMessage,
  resolveReportStatus,
  telemetryFromReportError,
  type ReportLoadStatus,
} from '@/lib/reportLoadState';
import { useReportFilters } from '@/hooks/useReportFilters';
import { getCashFlowSourceLabel, getPaymentMethodLabel } from '@/lib/paymentMethodLabels';

type FallbackEntry = { date: string; method: string; source: string; inflow: number; outflow: number };

function isCashFlowPayload(value: unknown): value is CashFlowReportPayload {
  return !!value && typeof value === 'object' && Array.isArray((value as CashFlowReportPayload).rows);
}

export default function CashFlowReport() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const { get, set } = useReportFilters({
    storageKey: 'reports.cash-flow.filters',
    trackedKeys: ['granularity', 'dateFrom', 'dateTo', 'method'],
    defaults: {
      granularity: 'day',
      dateFrom: todayYMD(),
      dateTo: todayYMD(),
      method: 'all',
    },
  });
  const granularity = get('granularity', 'day') as CashFlowGranularity;
  const dateFrom = get('dateFrom', todayYMD());
  const dateTo = get('dateTo', todayYMD());
  const method = get('method', 'all');
  const [loadStatus, setLoadStatus] = useState<ReportLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [rows, setRows] = useState<CashFlowRow[]>([]);
  const [bySource, setBySource] = useState<CashFlowSourceRow[]>([]);
  const [reconciliation, setReconciliation] = useState<CashFlowReconciliation | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);

  const buildFallbackBundle = useCallback(async (): Promise<CashFlowReportPayload> => {
    const entries: FallbackEntry[] = [];

    const inRange = (ymd: string) => ymd >= dateFrom && ymd <= dateTo;
    const normalizeMethod = (m: unknown) => String(m || 'unknown').toLowerCase();
    const isRefundPayoutMethod = (m: string) => m === 'refund_cash';

    const ordersData = await getOrders(100000);
    const filteredOrders = ordersData.filter((order) => {
      const ymd = formatDateYMD(order.created_at);
      return inRange(ymd) && order.status === 'completed';
    });

    const resolvedOrders = await Promise.all(
      filteredOrders.map(async (order) => {
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
      }),
    );

    const toUzs = (order: any, amount: number) => {
      const cur = getOrderSaleCurrency(order);
      const fx = Number(order.fx_rate ?? 0);
      return toShiftUzsAmount(amount, cur, fx);
    };

    resolvedOrders.forEach((order) => {
      const ymd = formatDateYMD(order.created_at);
      const payments = order.payments || [];
      if (payments.length === 0) {
        const m = normalizeMethod((order as any).payment_type || 'cash');
        entries.push({
          date: ymd,
          method: m,
          source: 'order_payments',
          inflow: toUzs(order, Number(order.total_amount || 0)),
          outflow: 0,
        });
        return;
      }
      const rawSum = payments.reduce((sum, p: any) => sum + Number(p?.amount ?? 0), 0);
      const shouldFallbackSinglePaymentAmount =
        payments.length === 1 && rawSum <= 0 && Number(order.total_amount) > 0;

      payments.forEach((payment: any) => {
        const m = normalizeMethod(payment.payment_method);
        const raw = shouldFallbackSinglePaymentAmount
          ? Number(order.total_amount || 0)
          : Number(payment?.amount ?? 0);
        const amount = toUzs(order, raw);
        if (amount <= 0) return;
        entries.push({
          date: ymd,
          method: m,
          source: 'order_payments',
          inflow: isRefundPayoutMethod(m) ? 0 : amount,
          outflow: isRefundPayoutMethod(m) ? amount : 0,
        });
      });
    });

    const expenses = await getExpenses({ dateFrom, dateTo });
    expenses
      .filter((e) => e.status === 'approved')
      .forEach((e) => {
        const ymd = formatDateYMD(e.expense_date || e.created_at);
        if (!inRange(ymd)) return;
        entries.push({
          date: ymd,
          method: normalizeMethod(e.payment_method),
          source: 'expenses',
          inflow: 0,
          outflow: expenseToUzsAmount(e),
        });
      });

    const returns = await getSalesReturns({ status: 'Completed', startDate: dateFrom, endDate: dateTo });
    (returns || []).forEach((r: any) => {
      const ymd = formatDateYMD(r.created_at);
      if (!inRange(ymd)) return;
      const refundRaw = Number(r.refund_amount ?? r.total_amount ?? 0);
      const refundUzs = toShiftUzsAmount(
        refundRaw,
        String(r.order_currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS',
        Number(r.order_fx_rate ?? 0),
      );
      entries.push({
        date: ymd,
        method: normalizeMethod(r.refund_method || 'cash'),
        source: 'refunds',
        inflow: 0,
        outflow: refundUzs,
      });
    });

    const suppliers = await getSuppliers(true);
    const supplierPayments = await Promise.all(
      (suppliers || []).map(async (s) => {
        try {
          return await getSupplierPayments(s.id);
        } catch {
          return [];
        }
      }),
    );
    supplierPayments.flat().forEach((p: any) => {
      const ymd = formatDateYMD(p.paid_at || p.created_at);
      if (!inRange(ymd)) return;
      const m = normalizeMethod(p.payment_method || 'transfer');
      if (m === 'credit_note') return;
      const amount = Number(p.amount || 0);
      entries.push({
        date: ymd,
        method: m,
        source: 'supplier_payments',
        inflow: amount < 0 ? Math.abs(amount) : 0,
        outflow: amount > 0 ? amount : 0,
      });
    });

    const toPeriodStart = (ymd: string) => {
      if (granularity === 'week') {
        const d = new Date(ymd);
        const start = startOfWeek(d, { weekStartsOn: 1 });
        return formatDateYMD(start);
      }
      return ymd;
    };

    const grouped = new Map<string, CashFlowRow>();
    const sourceMap = new Map<string, CashFlowSourceRow>();

    entries.forEach((e) => {
      const period_start = toPeriodStart(e.date);
      const key = `${period_start}|${e.method}`;
      const existing = grouped.get(key) || {
        period_start,
        period_key: period_start,
        method: e.method,
        inflow: 0,
        outflow: 0,
        net: 0,
      };
      existing.inflow += e.inflow;
      existing.outflow += e.outflow;
      existing.net = existing.inflow - existing.outflow;
      grouped.set(key, existing);

      const src = sourceMap.get(e.source) || {
        source: e.source,
        inflow: 0,
        outflow: 0,
        net: 0,
      };
      src.inflow += e.inflow;
      src.outflow += e.outflow;
      src.net = src.inflow - src.outflow;
      sourceMap.set(e.source, src);
    });

    const cashNet = Array.from(grouped.values())
      .filter((r) => String(r.method).toLowerCase() === 'cash')
      .reduce((sum, r) => sum + Number(r.net || 0), 0);

    return {
      rows: Array.from(grouped.values()).sort((a, b) => a.period_start.localeCompare(b.period_start)),
      by_source: Array.from(sourceMap.values()),
      reconciliation: {
        opening_cash: 0,
        closing_cash: 0,
        net_cash_movement: cashNet,
        delta: -cashNet,
      },
    };
  }, [dateFrom, dateTo, granularity]);

  const loadData = useCallback(async () => {
    const cid = createReportCorrelationId('cash-flow');
    setCorrelationId(cid);
    setLoadStatus('loading');
    setLoadError(null);

    try {
      let bundle: CashFlowReportPayload | null = null;
      let fallback = false;

      if (isElectron()) {
        try {
          const api = requireElectron();
          const res = await handleIpcResponse<CashFlowReportPayload | CashFlowRow[]>(
            api.reports.cashFlow({
              granularity,
              date_from: dateFrom,
              date_to: dateTo,
            }),
          );
          if (Array.isArray(res)) {
            bundle = { rows: res, by_source: [], reconciliation: null };
          } else if (isCashFlowPayload(res)) {
            bundle = res;
          }
        } catch (error) {
          console.warn('[CashFlowReport] IPC cashFlow failed, using fallback:', error);
          telemetryFromReportError(
            'reports/financial/cash-flow',
            'pos:reports:cashFlow',
            error,
            cid,
            user?.role,
          );
        }
      }

      if (!bundle) {
        bundle = await buildFallbackBundle();
        fallback = true;
      }

      setRows(bundle.rows || []);
      setBySource(bundle.by_source || []);
      setReconciliation(bundle.reconciliation);
      setUsedFallback(fallback);
      setLoadedAt(new Date().toISOString());
      setLoadStatus(resolveReportStatus(bundle.rows, (r) => r.length === 0));
    } catch (error) {
      const message = reportLoadErrorMessage(
        error,
        t('reports.cash_flow.errors.load_failed', "Pul oqimini yuklab bo'lmadi"),
      );
      setLoadError(message);
      setRows([]);
      setBySource([]);
      setReconciliation(null);
      setLoadStatus('error');
      telemetryFromReportError(
        'reports/financial/cash-flow',
        'cashFlow:fallback',
        error,
        cid,
        user?.role,
      );
    }
  }, [buildFallbackBundle, dateFrom, dateTo, granularity, t, user?.role]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const methods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(String(r.method || 'unknown'));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return method === 'all' ? rows : rows.filter((r) => String(r.method) === method);
  }, [rows, method]);

  const summary = useMemo(() => {
    const inflow = filtered.reduce((sum, r) => sum + Number(r.inflow || 0), 0);
    const outflow = filtered.reduce((sum, r) => sum + Number(r.outflow || 0), 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [filtered]);

  const filteredSources = useMemo(() => bySource, [bySource]);

  if (loadStatus === 'loading' || loadStatus === 'error') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/financial')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="page-heading">{t('reports.cash_flow.title', 'Pul oqimi')}</h1>
        </div>
        <ReportLoadPanel
          status={loadStatus}
          error={loadError}
          correlationId={correlationId}
          onRetry={() => void loadData()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/financial')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">{t('reports.cash_flow.title', 'Pul oqimi')}</h1>
            <p className="text-muted-foreground">
              {t(
                'reports.cash_flow.subtitle',
                'Kirim / chiqim va net pul oqimi (UZS ekvivalent, USD sotuvlar kurs bo‘yicha)',
              )}
              {loadedAt ? (
                <span className="ml-2 opacity-70">
                  · {dateFrom} — {dateTo} · UZS
                </span>
              ) : null}
            </p>
            {usedFallback ? (
              <p className="text-xs text-amber-600">
                {t('reports.cash_flow.fallback_notice', 'Server hisoboti mavjud emas — mahalliy hisob-kitob ishlatildi')}
              </p>
            ) : null}
          </div>
        </div>
        <Button variant="outline" onClick={() => void loadData()}>
          {t('reports.load_state.retry', 'Yangilash')}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.cash_flow.filters.granularity', 'Davriylik')}
              </label>
              <Select
                value={granularity}
                onValueChange={(v) => set({ granularity: v as CashFlowGranularity })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t('reports.cash_flow.filters.daily', 'Kunlik')}</SelectItem>
                  <SelectItem value="week">{t('reports.cash_flow.filters.weekly', 'Haftalik')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.cash_flow.filters.from', 'Boshlanish sana')}
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => set({ dateFrom: e.target.value || null })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.cash_flow.filters.to', 'Tugash sana')}
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => set({ dateTo: e.target.value || null })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.cash_flow.filters.method', "To'lov usuli")}
              </label>
              <Select
                value={method}
                onValueChange={(value) => set({ method: value === 'all' ? null : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('reports.cash_flow.filters.all_methods', 'Barchasi')}</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {getPaymentMethodLabel(m, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.cash_flow.inflow', 'Kirim')}</p>
                <p className="text-2xl font-bold text-success">{formatMoneyUZS(summary.inflow)}</p>
              </div>
              <TrendingUp className="h-6 w-6 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.cash_flow.outflow', 'Chiqim')}</p>
                <p className="text-2xl font-bold text-destructive">{formatMoneyUZS(summary.outflow)}</p>
              </div>
              <TrendingDown className="h-6 w-6 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t('reports.cash_flow.net', 'Net')}</p>
            <p className={`text-2xl font-bold ${summary.net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(summary.net)}
            </p>
          </CardContent>
        </Card>
      </div>

      {bySource.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('reports.cash_flow.by_source', 'Manba bo‘yicha (drill-down)')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.cash_flow.source', 'Manba')}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.inflow', 'Kirim')}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.outflow', 'Chiqim')}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.net', 'Net')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSources.map((s) => (
                  <TableRow key={s.source}>
                    <TableCell>{getCashFlowSourceLabel(s.source, t)}</TableCell>
                    <TableCell className="text-right text-success">{formatMoneyUZS(s.inflow)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatMoneyUZS(s.outflow)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoneyUZS(s.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {reconciliation ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('reports.cash_flow.reconciliation', 'Naqd kassa tekshiruvi (smena)')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted-foreground">{t('reports.cash_flow.opening', 'Boshlang‘ich')}</p>
              <p className="font-semibold">{formatMoneyUZS(reconciliation.opening_cash)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('reports.cash_flow.closing', 'Yakuniy')}</p>
              <p className="font-semibold">{formatMoneyUZS(reconciliation.closing_cash)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('reports.cash_flow.net_cash', 'Naqd harakat')}</p>
              <p className="font-semibold">{formatMoneyUZS(reconciliation.net_cash_movement)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('reports.cash_flow.delta', 'Farq')}</p>
              <p
                className={`font-semibold ${
                  Math.abs(reconciliation.delta) < 1 ? 'text-success' : 'text-amber-600'
                }`}
              >
                {formatMoneyUZS(reconciliation.delta)}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loadStatus === 'empty' || filtered.length === 0 ? (
            <ReportLoadPanel
              status="empty"
              overlay={false}
              emptyTitle={t('reports.cash_flow.empty', "Tanlangan davrda pul oqimi yo'q")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.cash_flow.period', 'Davr')}</TableHead>
                  <TableHead>{t('reports.cash_flow.filters.method', "To'lov usuli")}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.inflow', 'Kirim')}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.outflow', 'Chiqim')}</TableHead>
                  <TableHead className="text-right">{t('reports.cash_flow.net', 'Net')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, idx) => (
                  <TableRow key={`${r.period_start}-${r.method}-${idx}`}>
                    <TableCell className="font-medium">
                      {granularity === 'week'
                        ? `${t('reports.cash_flow.week', 'Hafta')}: ${r.period_start}`
                        : r.period_start}
                    </TableCell>
                    <TableCell>{getPaymentMethodLabel(r.method, t)}</TableCell>
                    <TableCell className="text-right text-success">
                      {formatMoneyUZS(Number(r.inflow || 0))}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {formatMoneyUZS(Number(r.outflow || 0))}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Number(r.net || 0) >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatMoneyUZS(Number(r.net || 0))}
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
