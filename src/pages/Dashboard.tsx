import { useEffect, useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
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
            <p className="text-xs text-destructive">Error loading metric</p>
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

  // Data state
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<ProductWithCategory[]>([]);
  const [dailySales, setDailySales] = useState<DailySales[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [totalCustomerDebt, setTotalCustomerDebt] = useState<number>(0);
  
  // Loading and error state
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [lowStockError, setLowStockError] = useState(false);
  const [chartsError, setChartsError] = useState(false);

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
        title: 'Invalid Date Range',
        description: 'Please select both start and end dates',
        variant: 'destructive',
      });
    }
  };

  // Load dashboard data
  useEffect(() => {
    loadDashboardData();
  }, [dateRange]);

  const loadDashboardData = async () => {
    setLoading(true);
    setAnalyticsError(false);
    setLowStockError(false);
    setChartsError(false);

    // Load analytics
    try {
      const analyticsData = await getDashboardAnalytics(dateRange.from, dateRange.to);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Failed to load analytics:', error);
      setAnalyticsError(true);
      setAnalytics({
        total_sales: 0,
        total_orders: 0,
        low_stock_count: 0,
        active_customers: 0,
        average_order_value: 0,
        items_sold: 0,
        returns_count: 0,
        returns_amount: 0,
        pending_purchase_orders: 0,
      });
    }

    // Load total customer debt
    try {
      const debt = await getTotalCustomerDebt();
      setTotalCustomerDebt(debt);
    } catch (error) {
      console.error('Failed to load customer debt:', error);
      setTotalCustomerDebt(0);
    }

    // Load low stock products
    try {
      const lowStockData = await getLowStockProducts();
      setLowStockProducts(lowStockData || []);
    } catch (error) {
      console.error('Failed to load low stock products:', error);
      setLowStockError(true);
      setLowStockProducts([]);
    }

    // Load charts data
    try {
      const [salesData, productsData] = await Promise.all([
        getDailySalesData(dateRange.from, dateRange.to),
        getTopProducts(dateRange.from, dateRange.to, 5),
      ]);
      setDailySales(salesData);
      setTopProducts(productsData);
    } catch (error) {
      console.error('Failed to load charts data:', error);
      setChartsError(true);
      setDailySales([]);
      setTopProducts([]);
    }

    setLoading(false);
  };

  // Format currency
  const formatCurrency = (amount: number): string => {
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UZS`;
  };

  // Format date for display
  const formatDateRange = (): string => {
    if (datePreset === 'today') return 'Today';
    if (datePreset === 'yesterday') return 'Yesterday';
    if (datePreset === 'last7days') return 'Last 7 Days';
    if (datePreset === 'thisMonth') return 'This Month';
    return `${format(dateRange.from, 'MMM dd')} - ${format(dateRange.to, 'MMM dd, yyyy')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Range Selector */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your POS system</p>
        </div>
        
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={datePreset} onValueChange={(value) => handlePresetChange(value as DateRangePreset)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="last7days">Last 7 Days</SelectItem>
              <SelectItem value="thisMonth">This Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {datePreset === 'custom' && (
            <Popover open={showCustomDatePicker} onOpenChange={setShowCustomDatePicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDateFrom && customDateTo
                    ? `${format(customDateFrom, 'MMM dd')} - ${format(customDateTo, 'MMM dd')}`
                    : 'Pick dates'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="end">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">From Date</p>
                    <Calendar
                      mode="single"
                      selected={customDateFrom}
                      onSelect={setCustomDateFrom}
                      disabled={(date) => date > new Date()}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">To Date</p>
                    <Calendar
                      mode="single"
                      selected={customDateTo}
                      onSelect={setCustomDateTo}
                      disabled={(date) => date > new Date() || (customDateFrom ? date < customDateFrom : false)}
                    />
                  </div>
                  <Button onClick={applyCustomDateRange} className="w-full">
                    Apply Date Range
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Period Label */}
      <div className="text-sm text-muted-foreground">
        Showing data for: <span className="font-medium text-foreground">{formatDateRange()}</span>
      </div>

      {/* Row 1: Main KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total Sales"
          value={formatCurrency(analytics?.total_sales || 0)}
          subtitle={`${analytics?.total_orders || 0} orders`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Orders"
          value={analytics?.total_orders || 0}
          subtitle="Completed orders"
          icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Low Stock Items"
          value={analytics?.low_stock_count || 0}
          subtitle="Items need restocking"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Active Customers"
          value={analytics?.active_customers || 0}
          subtitle="Customers with orders"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />
      </div>

      {/* Row 2: Additional KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Average Order Value"
          value={formatCurrency(analytics?.average_order_value || 0)}
          subtitle="Per order"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Items Sold"
          value={analytics?.items_sold || 0}
          subtitle="Total quantity"
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Returns"
          value={analytics?.returns_count || 0}
          subtitle={formatCurrency(analytics?.returns_amount || 0)}
          icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />

        <MetricCard
          title="Pending Purchase Orders"
          value={analytics?.pending_purchase_orders || 0}
          subtitle="Draft or Approved"
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={analyticsError}
        />
      </div>

      {/* Row 3: Customer Debt */}
      {totalCustomerDebt > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Total Customer Debt"
            value={formatCurrency(totalCustomerDebt)}
            subtitle="Outstanding balance"
            icon={<DollarSign className="h-4 w-4 text-destructive" />}
            loading={loading}
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
              Sales Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-80 flex items-center justify-center">
                <Skeleton className="h-full w-full bg-muted" />
              </div>
            ) : chartsError ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Failed to load chart data</p>
              </div>
            ) : dailySales.length === 0 ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No sales data in this period</p>
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
                    formatter={(value: number) => [formatCurrency(value), 'Sales']}
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
              Top 5 Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-80 flex items-center justify-center">
                <Skeleton className="h-full w-full bg-muted" />
              </div>
            ) : chartsError ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Failed to load chart data</p>
              </div>
            ) : topProducts.length === 0 ? (
              <div className="h-80 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No product sales in this period</p>
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
                      if (name === 'total_amount') return [formatCurrency(value), 'Total Sales'];
                      return [value, 'Quantity'];
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
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Link to="/pos">
              <Button className="w-full h-24 flex flex-col gap-2" size="lg">
                <ShoppingCart className="h-8 w-8" />
                <span>Open POS Terminal</span>
              </Button>
            </Link>
            <Link to="/products">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <Package className="h-8 w-8" />
                <span>Manage Products</span>
              </Button>
            </Link>
            <Link to="/orders">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <TrendingUp className="h-8 w-8" />
                <span>View Orders</span>
              </Button>
            </Link>
            <Link to="/reports">
              <Button variant="outline" className="w-full h-24 flex flex-col gap-2" size="lg">
                <BarChart3 className="h-8 w-8" />
                <span>View Reports</span>
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
              Low Stock Alert
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
              Unable to load low stock products. Please try refreshing the page.
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
                      SKU: {product.sku} | Category: {product.category?.name || 'N/A'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-warning">
                      {product.current_stock || 0} {product.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Min: {product.min_stock_level || 0}
                    </p>
                  </div>
                </div>
              ))}
              {lowStockProducts.length > 5 && (
                <Link to="/inventory">
                  <Button variant="link" className="w-full">
                    View all {lowStockProducts.length} low stock items →
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
                Failed to load some dashboard data. Please try refreshing the page.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
