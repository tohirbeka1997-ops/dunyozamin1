import { useState, useMemo } from 'react';
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
  Package,
  RotateCcw,
  FileText,
  CalendarIcon,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatUnit } from '@/utils/formatters';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  loading?: boolean;
  error?: boolean;
}

function MetricCard({ title, value, subtitle, icon, loading, error }: MetricCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-24 mb-2 bg-muted" />
            <Skeleton className="h-4 w-32 bg-muted" />
          </>
        ) : error ? (
          <>
            <div className="text-2xl font-bold text-muted-foreground">–</div>
            <p className="text-xs text-destructive">{t('dashboard.error_loading_metric')}</p>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type DateRangePreset = 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'custom';

interface DateRange {
  from: Date;
  to: Date;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  // Date range state
  const [datePreset, setDatePreset] = useState<DateRangePreset>('today');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
  const { data: analytics, isLoading: analyticsLoading, isError: analyticsError } = useQuery({
    queryKey: ['dashboardAnalytics', dateRangeKey],
    queryFn: () => getDashboardAnalytics(dateRange.from, dateRange.to),
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    retry: 1,
  });

  const { data: lowStockProducts = [], isLoading: lowStockLoading, isError: lowStockError } = useQuery({
    queryKey: ['lowStockProducts'],
    queryFn: getLowStockProducts,
    refetchInterval: 30000,
    retry: 1,
  });

  const { data: dailySales = [], isLoading: chartsLoading, isError: chartsError } = useQuery({
    queryKey: ['dailySales', dateRangeKey],
    queryFn: () => getDailySalesData(dateRange.from, dateRange.to),
    refetchInterval: 30000,
    retry: 1,
  });

  const { data: topProducts = [], isLoading: topProductsLoading } = useQuery({
    queryKey: ['topProducts', dateRangeKey],
    queryFn: () => getTopProducts(dateRange.from, dateRange.to, 5),
    refetchInterval: 30000,
    retry: 1,
  });

  const { data: totalCustomerDebt = 0 } = useQuery({
    queryKey: ['totalCustomerDebt'],
    queryFn: getTotalCustomerDebt,
    refetchInterval: 30000,
    retry: 1,
  });

  // Combined loading state
  const loading = analyticsLoading || lowStockLoading || chartsLoading || topProductsLoading;

  // Calculate date range based on preset
  const calculateDateRange = (preset: DateRangePreset): DateRange => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch (preset) {
      case 'today':
        return { from: today, to: today };
      
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { from: yesterday, to: yesterday };
      }
      
      case 'last7days': {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 6);
        return { from: weekAgo, to: today };
      }
      
      case 'thisMonth': {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
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
      setDateRange({ from: customDateFrom, to: customDateTo });
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
    return `${format(dateRange.from, 'MMM dd')} - ${format(dateRange.to, 'MMM dd, yyyy')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Range Selector */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={datePreset} onValueChange={(value) => handlePresetChange(value as DateRangePreset)}>
            <SelectTrigger className="w-full sm:w-48">
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
                <Button variant="outline" className="w-full sm:w-auto">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDateFrom && customDateTo
                    ? `${format(customDateFrom, 'MMM dd')} - ${format(customDateTo, 'MMM dd')}`
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

      {/* Period Label */}
      <div className="text-sm text-muted-foreground">
        {t('dashboard.showing_data_for')}: <span className="font-medium text-foreground">{formatDateRange()}</span>
      </div>

      {/* Row 1: Main KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={t('dashboard.cards.total_sales.title')}
          value={formatCurrency(analytics?.total_sales || 0)}
          subtitle={`${analytics?.total_orders || 0} ${t('dashboard.cards.total_sales.orders')}`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.orders.title')}
          value={analytics?.total_orders || 0}
          subtitle={t('dashboard.cards.orders.subtitle')}
          icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.low_stock.title')}
          value={analytics?.low_stock_count || 0}
          subtitle={t('dashboard.cards.low_stock.subtitle')}
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.active_customers.title')}
          value={analytics?.active_customers || 0}
          subtitle={t('dashboard.cards.active_customers.subtitle')}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />
      </div>

      {/* Row 2: Additional KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={t('dashboard.cards.average_order_value.title')}
          value={formatCurrency(analytics?.average_order_value || 0)}
          subtitle={t('dashboard.cards.average_order_value.subtitle')}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.items_sold.title')}
          value={analytics?.items_sold || 0}
          subtitle={t('dashboard.cards.items_sold.subtitle')}
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.returns.title')}
          value={analytics?.returns_count || 0}
          subtitle={formatCurrency(analytics?.returns_amount || 0)}
          icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />

        <MetricCard
          title={t('dashboard.cards.pending_purchase_orders.title')}
          value={analytics?.pending_purchase_orders || 0}
          subtitle={t('dashboard.cards.pending_purchase_orders.subtitle')}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          loading={analyticsLoading}
          error={analyticsError}
        />
      </div>

      {/* Row 3: Customer Debt */}
      {totalCustomerDebt > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title={t('dashboard.cards.total_customer_debt.title')}
            value={formatCurrency(totalCustomerDebt)}
            subtitle={t('dashboard.cards.total_customer_debt.subtitle')}
            icon={<DollarSign className="h-4 w-4 text-destructive" />}
            loading={analyticsLoading}
            error={analyticsError}
          />
        </div>
      )}

      {/* Charts Section */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Sales Over Time Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
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
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={dailySales}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                    className="text-xs"
                  />
                  <YAxis
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                    className="text-xs"
                  />
                  <Tooltip
                    formatter={(value: number) => [formatCurrency(value), t('dashboard.charts.sales')]}
                    labelFormatter={(label) => format(new Date(label), 'MMM dd, yyyy')}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_sales"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top 5 Products Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
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
                    width={120}
                    className="text-xs"
                    tickFormatter={(value) => value.length > 15 ? value.substring(0, 15) + '...' : value}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'total_amount') return [formatCurrency(value), t('dashboard.charts.total_sales')];
                      return [value, t('dashboard.charts.quantity')];
                    }}
                  />
                  <Bar dataKey="total_amount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.quick_actions.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link to="/pos">
              <Button className="w-full h-24 flex flex-col gap-2" size="lg">
                <ShoppingCart className="h-8 w-8" />
                <span>{t('dashboard.quick_actions.open_pos')}</span>
              </Button>
            </Link>
            <Link to="/products">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <Package className="h-8 w-8" />
                <span>{t('dashboard.quick_actions.manage_products')}</span>
              </Button>
            </Link>
            <Link to="/orders">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <TrendingUp className="h-8 w-8" />
                <span>{t('dashboard.quick_actions.view_orders')}</span>
              </Button>
            </Link>
            <Link to="/reports">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <BarChart3 className="h-8 w-8" />
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
              Low Stock Alert
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
              Low Stock Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lowStockProducts.slice(0, 5).map((product) => (
                <div key={product.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.low_stock_alert.sku')}: {product.sku} | {t('dashboard.low_stock_alert.category')}: {product.category?.name || t('dashboard.low_stock_alert.na')}
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
