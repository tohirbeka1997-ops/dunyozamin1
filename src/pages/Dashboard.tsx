import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { getLowStockProducts, getDashboardAnalytics, getDailySalesData, getTopProducts, getTotalCustomerDebt } from '@/db/api';
import type { ProductWithCategory } from '@/types/database';
import type { DashboardAnalytics, DailySales, TopProduct } from '@/db/api';
import {
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  Users,
  TrendingUp,
  TrendingDown,
  Package,
  CalendarIcon,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatUnit } from '@/utils/formatters';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatMonthDay, formatMonthDayYear, todayYMD } from '@/lib/datetime';
import { cn } from '@/lib/utils';

type MetricVariant = 'sales' | 'teal' | 'profit' | 'accent' | 'warning' | 'expense';

/** To‘liq klass nomlari — Tailwind purge uchun (template string ishlamaydi). */
const METRIC_VARIANT_CLASS: Record<MetricVariant, string> = {
  sales: 'metric-card--sales',
  teal: 'metric-card--orders',
  profit: 'metric-card--profit',
  accent: 'metric-card--lime',
  warning: 'metric-card--warning',
  expense: 'metric-card--expense',
};

interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  subtitle: string;
  icon: React.ReactNode;
  variant?: MetricVariant;
  loading?: boolean;
  error?: boolean;
}

function MetricCard({ title, value, subtitle, icon, variant = 'sales', loading, error }: MetricCardProps) {
  const { t } = useTranslation();
  const variantClass = METRIC_VARIANT_CLASS[variant];

  return (
    <div className={cn('metric-card flex flex-col rounded-xl', variantClass)} role="group" aria-label={title}>
      <div className="relative z-[1] flex flex-row items-center justify-between px-6 pb-2 pt-5">
        <p className="metric-card-title">{title}</p>
        <div className="metric-card-icon [&_svg]:h-5 [&_svg]:w-5">{icon}</div>
      </div>
      <div className="relative z-[1] px-6 pb-5">
        {loading ? (
          <>
            <Skeleton className="mb-2 h-8 w-24 bg-white/25" />
            <Skeleton className="h-4 w-32 bg-white/20" />
          </>
        ) : error ? (
          <>
            <div className="metric-card-value">–</div>
            <p className="metric-card-sub text-red-100">{t('dashboard.error_loading_metric')}</p>
          </>
        ) : (
          <>
            <div className="metric-card-value">{value}</div>
            <p className="metric-card-sub">{subtitle}</p>
          </>
        )}
      </div>
    </div>
  );
}

type DateRangePreset = 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'custom';

interface DateRange {
  from: Date;
  to: Date;
}

const DASHBOARD_REFRESH_MS = 60_000;
const DASHBOARD_SLOW_REFRESH_MS = 120_000;

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
] as const;

function ymdToUtcDate(ymd: string): Date {
  const [yy, mm, dd] = String(ymd || '').split('-').map((v) => Number(v));
  const year = Number.isFinite(yy) ? yy : 1970;
  const month = Number.isFinite(mm) ? mm : 1;
  const day = Number.isFinite(dd) ? dd : 1;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function localCalendarDateToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const lastAnalyticsErrorToastAtRef = useRef(0);
  
  // Date range state
  const [datePreset, setDatePreset] = useState<DateRangePreset>('today');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = ymdToUtcDate(todayYMD());
    return { from: today, to: today };
  });
  const [customDateFrom, setCustomDateFrom] = useState<Date | undefined>();
  const [customDateTo, setCustomDateTo] = useState<Date | undefined>();
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

  // Memoize date range string for query keys
  const dateRangeKey = useMemo(() => {
    return `${dateRange.from.toISOString()}_${dateRange.to.toISOString()}`;
  }, [dateRange]);

  // React Query hooks for dashboard data
  // Keep dashboard fresh without creating unnecessary background load on shared SQLite/server deployments.
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    error: analyticsErrorObj,
  } = useQuery({
    queryKey: ['dashboardAnalytics', dateRangeKey],
    queryFn: () => getDashboardAnalytics(dateRange.from, dateRange.to),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: DASHBOARD_REFRESH_MS,
    retry: 1,
  });

  // React Query v5 removed `onError` from useQuery; surface errors via effect.
  useEffect(() => {
    if (!analyticsError) return;
    const err = analyticsErrorObj as { message?: string } | null;
    console.error('[Dashboard] dashboardAnalytics error:', err);
    const now = Date.now();
    const THROTTLE_MS = 2 * 60 * 1000;
    if (now - lastAnalyticsErrorToastAtRef.current < THROTTLE_MS) return;
    lastAnalyticsErrorToastAtRef.current = now;
    toast({
      title: t('dashboard.error_loading_metric'),
      description: err?.message || 'Unknown error',
      variant: 'destructive',
    });
  }, [analyticsError, analyticsErrorObj, t, toast]);

  const { data: lowStockProducts = [], isLoading: lowStockLoading, isError: lowStockError } = useQuery({
    queryKey: ['lowStockProducts'],
    queryFn: getLowStockProducts,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: DASHBOARD_SLOW_REFRESH_MS,
    retry: 1,
  });

  const { data: dailySales = [], isLoading: chartsLoading, isError: chartsError } = useQuery({
    queryKey: ['dailySales', dateRangeKey],
    queryFn: () => getDailySalesData(dateRange.from, dateRange.to),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: DASHBOARD_REFRESH_MS,
    retry: 1,
  });

  const { data: topProducts = [], isLoading: topProductsLoading } = useQuery({
    queryKey: ['topProducts', dateRangeKey],
    queryFn: () => getTopProducts(dateRange.from, dateRange.to, 5),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: DASHBOARD_REFRESH_MS,
    retry: 1,
  });

  const { data: totalCustomerDebt = { debt_uzs: 0, debt_usd: 0 } } = useQuery({
    queryKey: ['totalCustomerDebt'],
    queryFn: getTotalCustomerDebt,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: DASHBOARD_SLOW_REFRESH_MS,
    retry: 1,
  });

  // Combined loading state
  const loading = analyticsLoading || lowStockLoading || chartsLoading || topProductsLoading;

  // Calculate date range based on preset
  const calculateDateRange = (preset: DateRangePreset): DateRange => {
    const today = ymdToUtcDate(todayYMD());
    
    switch (preset) {
      case 'today':
        return { from: today, to: today };
      
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        return { from: yesterday, to: yesterday };
      }
      
      case 'last7days': {
        const weekAgo = new Date(today);
        weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
        return { from: weekAgo, to: today };
      }
      
      case 'thisMonth': {
        const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 0, 0, 0, 0));
        return { from: firstDay, to: today };
      }
      
      case 'custom':
        if (customDateFrom && customDateTo) {
          return { from: customDateFrom, to: customDateTo };
        }
        return { from: today, to: today };
      
      default:
        return { from: today, to: today };
    }
  };

  // Handle preset change
  const handlePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') {
      setShowCustomDatePicker(true);
    } else {
      setShowCustomDatePicker(false);
      const newRange = calculateDateRange(preset);
      setDateRange(newRange);
    }
  };

  // Handle custom date selection
  const applyCustomDateRange = () => {
    if (customDateFrom && customDateTo) {
      setDateRange({
        from: localCalendarDateToUtcDate(customDateFrom),
        to: localCalendarDateToUtcDate(customDateTo),
      });
      setShowCustomDatePicker(false);
    } else {
      toast({
        title: t('dashboard.errors.invalid_date_range'),
        description: t('dashboard.errors.select_both_dates'),
        variant: 'destructive',
      });
    }
  };


  // Use unified money formatter
  const formatCurrency = (amount: number): string => formatMoneyUZS(amount);

  // Format date for display
  const formatDateRange = (): string => {
    if (datePreset === 'today') return t('dashboard.filters.today');
    if (datePreset === 'yesterday') return t('dashboard.filters.yesterday');
    if (datePreset === 'last7days') return t('dashboard.filters.last_7_days');
    if (datePreset === 'thisMonth') return t('dashboard.filters.this_month');
    return `${formatMonthDay(dateRange.from)} - ${formatMonthDayYear(dateRange.to)}`;
  };

  return (
    <div className="space-y-4">
      {/* Compact header: title + period on one row; subtitle + active period on one line */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="page-heading">{t('dashboard.title')}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={datePreset} onValueChange={(value) => handlePresetChange(value as DateRangePreset)}>
              <SelectTrigger className="h-8 w-[min(100%,11rem)] min-w-[10rem] text-xs sm:w-44">
                <SelectValue placeholder={t('dashboard.filters.select_period')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t('dashboard.filters.today')}</SelectItem>
                <SelectItem value="yesterday">{t('dashboard.filters.yesterday')}</SelectItem>
                <SelectItem value="last7days">{t('dashboard.filters.last_7_days')}</SelectItem>
                <SelectItem value="thisMonth">{t('dashboard.filters.this_month')}</SelectItem>
                <SelectItem value="custom">{t('dashboard.filters.custom_range')}</SelectItem>
              </SelectContent>
            </Select>

            {datePreset === 'custom' && (
              <Popover open={showCustomDatePicker} onOpenChange={setShowCustomDatePicker}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-full text-xs sm:w-auto">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {customDateFrom && customDateTo
                      ? `${formatMonthDay(customDateFrom)} - ${formatMonthDay(customDateTo)}`
                      : t('dashboard.filters.pick_dates')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-4" align="end">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium mb-2">{t('dashboard.filters.from_date')}</p>
                      <Calendar
                        mode="single"
                        selected={customDateFrom}
                        onSelect={setCustomDateFrom}
                        disabled={(date) => date > new Date()}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2">{t('dashboard.filters.to_date')}</p>
                      <Calendar
                        mode="single"
                        selected={customDateTo}
                        onSelect={setCustomDateTo}
                        disabled={(date) => date > new Date() || (customDateFrom ? date < customDateFrom : false)}
                      />
                    </div>
                    <Button onClick={applyCustomDateRange} className="w-full">
                      {t('dashboard.filters.apply_date_range')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        <p className="text-xs leading-snug text-muted-foreground sm:text-sm">
          {t('dashboard.subtitle')}{' '}
          <span className="text-muted-foreground/80">—</span>{' '}
          {t('dashboard.showing_data_for')}:{' '}
          <span className="font-medium text-foreground">{formatDateRange()}</span>
        </p>
      </div>

      {/* Row 1: Main KPI Cards — gross / returns / net sales / net profit */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          variant="sales"
          title={t('dashboard.cards.total_sales.title')}
          value={
            (analytics?.total_sales_usd ?? 0) > 0 ? (
              <DualCurrencyAmount
                uzs={analytics?.total_sales_uzs ?? 0}
                usd={analytics?.total_sales_usd ?? 0}
                className="text-inherit"
              />
            ) : (
              formatCurrency(analytics?.total_sales || 0)
            )
          }
          subtitle={`${analytics?.total_orders || 0} ${t('dashboard.cards.total_sales.orders')} · ${t('dashboard.cards.total_sales.subtitle')}`}
          icon={<DollarSign />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="warning"
          title={t('dashboard.cards.returns_amount.title')}
          value={formatCurrency(analytics?.returns_amount || 0)}
          subtitle={`${analytics?.returns_count || 0} · ${t('dashboard.cards.returns_amount.subtitle')}`}
          icon={<TrendingDown />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="teal"
          title={t('dashboard.cards.net_sales.title')}
          value={formatCurrency(
            analytics?.net_sales ??
              Math.max(0, Number(analytics?.total_sales || 0) - Number(analytics?.returns_amount || 0))
          )}
          subtitle={t('dashboard.cards.net_sales.subtitle')}
          icon={<ShoppingCart />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="profit"
          title={t('dashboard.cards.total_profit.title')}
          value={formatCurrency((analytics?.net_profit ?? analytics?.total_profit) || 0)}
          subtitle={t('dashboard.cards.total_profit.subtitle')}
          icon={<TrendingUp />}
          loading={analyticsLoading}
          error={analyticsError}
        />
      </div>

      {/* Row 1b: secondary finance KPIs */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          variant="teal"
          title={t('dashboard.cards.total_collected.title')}
          value={formatCurrency(analytics?.total_collected || 0)}
          subtitle={t('dashboard.cards.total_collected.subtitle')}
          icon={<ShoppingCart />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="warning"
          title={t('dashboard.cards.credit_issued.title')}
          value={formatCurrency(analytics?.credit_issued || 0)}
          subtitle={t('dashboard.cards.credit_issued.subtitle')}
          icon={<TrendingDown />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="teal"
          title={t('dashboard.cards.total_cogs.title')}
          value={formatCurrency(analytics?.total_cogs || 0)}
          subtitle={t('dashboard.cards.total_cogs.subtitle')}
          icon={<Package />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="profit"
          title={t('dashboard.cards.profit_margin.title')}
          value={`${Number(analytics?.profit_margin || 0).toFixed(1)}%`}
          subtitle={t('dashboard.cards.profit_margin.subtitle')}
          icon={<TrendingUp />}
          loading={analyticsLoading}
          error={analyticsError}
        />
      </div>

      {/* Row 2: Other KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          variant="warning"
          title={t('dashboard.cards.low_stock.title')}
          value={analytics?.low_stock_count || 0}
          subtitle={t('dashboard.cards.low_stock.subtitle')}
          icon={<AlertTriangle />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="accent"
          title={t('dashboard.cards.active_customers.title')}
          value={analytics?.active_customers || 0}
          subtitle={t('dashboard.cards.active_customers.subtitle')}
          icon={<Users />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          variant="expense"
          title={t('dashboard.cards.total_expenses.title')}
          value={formatCurrency(analytics?.total_expenses || 0)}
          subtitle={t('dashboard.cards.total_expenses.subtitle')}
          icon={<TrendingDown />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        {(totalCustomerDebt.debt_uzs > 0 || totalCustomerDebt.debt_usd > 0) && (
          <MetricCard
            variant="expense"
            title={t('dashboard.cards.total_customer_debt.title')}
            value={
              totalCustomerDebt.debt_usd > 0 ? (
                <DualCurrencyAmount
                  uzs={totalCustomerDebt.debt_uzs}
                  usd={totalCustomerDebt.debt_usd}
                  className="text-inherit"
                />
              ) : (
                formatCurrency(totalCustomerDebt.debt_uzs)
              )
            }
            subtitle={t('dashboard.cards.total_customer_debt.subtitle')}
            icon={<DollarSign />}
            loading={analyticsLoading}
            error={analyticsError}
          />
        )}
      </div>

      {/* Charts Section */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Sales Over Time Chart */}
        <Card className="chart-card-accent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {t('dashboard.charts.sales_over_time')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="h-80 flex items-center justify-center">
                <Skeleton className="h-full w-full bg-muted" />
              </div>
            ) : chartsError ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">{t('dashboard.charts.failed_to_load')}</p>
              </div>
            ) : dailySales.length === 0 ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">{t('dashboard.charts.no_sales_data')}</p>
              </div>
            ) : (
              <>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={dailySales}>
                  <defs>
                    <linearGradient id="salesLineGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" />
                      <stop offset="50%" stopColor="hsl(var(--chart-2))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => formatMonthDay(value)}
                    className="text-xs"
                  />
                  <YAxis
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    className="text-xs"
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), t('dashboard.charts.sales')]}
                    labelFormatter={(label) => formatMonthDayYear(label)}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_sales"
                    stroke="url(#salesLineGradient)"
                    strokeWidth={3}
                    dot={{ fill: 'hsl(var(--chart-2))', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, fill: 'hsl(var(--chart-1))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {dailySales.length < 2 && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t('dashboard.charts.line_chart_hint_sub')}
                </p>
              )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Top 5 Products Chart */}
        <Card className="chart-card-teal">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-secondary" />
              {t('dashboard.charts.top_5_products')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="h-80 flex items-center justify-center">
                <Skeleton className="h-full w-full bg-muted" />
              </div>
            ) : chartsError ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">{t('dashboard.charts.failed_to_load')}</p>
              </div>
            ) : topProducts.length === 0 ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">{t('dashboard.charts.no_product_sales')}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    className="text-xs"
                  />
                  <YAxis
                    type="category"
                    dataKey="product_name"
                    width={160}
                    className="text-xs"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => (value.length > 22 ? `${value.substring(0, 22)}…` : value)}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'total_amount') return [formatCurrency(value), t('dashboard.charts.total_sales')];
                      return [value, t('dashboard.charts.quantity')];
                    }}
                  />
                  <Bar dataKey="total_amount" radius={[0, 6, 6, 0]}>
                    {topProducts.map((_, index) => (
                      <Cell key={`bar-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="quick-actions-card">
        <CardHeader>
          <CardTitle>{t('dashboard.quick_actions.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="quick-actions-grid grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link to="/pos">
              <Button type="button" variant="ghost" className="quick-action-primary">
                <span className="quick-action-icon" aria-hidden>
                  <ShoppingCart />
                </span>
                <span>{t('dashboard.quick_actions.open_pos')}</span>
              </Button>
            </Link>
            <Link to="/products">
              <Button type="button" variant="ghost" className="quick-action-teal">
                <span className="quick-action-icon" aria-hidden>
                  <Package />
                </span>
                <span>{t('dashboard.quick_actions.manage_products')}</span>
              </Button>
            </Link>
            <Link to="/orders">
              <Button type="button" variant="ghost" className="quick-action-accent">
                <span className="quick-action-icon" aria-hidden>
                  <TrendingUp />
                </span>
                <span>{t('dashboard.quick_actions.view_orders')}</span>
              </Button>
            </Link>
            <Link to="/reports">
              <Button type="button" variant="ghost" className="quick-action-reports">
                <span className="quick-action-icon" aria-hidden>
                  <BarChart3 />
                </span>
                <span>{t('dashboard.quick_actions.view_reports')}</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Low Stock Alert */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t('dashboard.low_stock_alert.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-48 bg-muted" />
                    <Skeleton className="h-4 w-64 bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-16 bg-muted" />
                    <Skeleton className="h-4 w-12 bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : lowStockError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t('dashboard.low_stock_alert.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.low_stock_alert.load_error')}
            </p>
          </CardContent>
        </Card>
      ) : lowStockProducts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t('dashboard.low_stock_alert.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lowStockProducts.slice(0, 5).map((product) => (
                <div key={product.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.low_stock_alert.sku')}: {product.sku} | {t('dashboard.low_stock_alert.category')}:{' '}
                      {product.category?.name || (product as { category_name?: string }).category_name || t('dashboard.low_stock_alert.na')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-warning">
                      {product.current_stock || 0} {formatUnit(product.unit)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('dashboard.low_stock_alert.min')}: {product.min_stock_level || 0}
                    </p>
                  </div>
                </div>
              ))}
              {lowStockProducts.length > 5 && (
                <Link to="/inventory">
                  <Button variant="link" className="w-full">
                    {t('dashboard.low_stock_alert.view_all', { count: lowStockProducts.length })} →
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Error Message Area */}
      {(analyticsError || lowStockError || chartsError) && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-sm">
                {t('dashboard.errors.failed_to_load')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
