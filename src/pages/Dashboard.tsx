import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getDashboardStats, getLowStockProducts } from '@/db/api';
import type { DashboardStats, ProductWithCategory } from '@/types/database';
import { DollarSign, ShoppingCart, AlertTriangle, Users, TrendingUp, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

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
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-4 w-32" />
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

export default function Dashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<ProductWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [lowStockError, setLowStockError] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    setStatsError(false);
    setLowStockError(false);
    
    let statsSuccess = false;
    let lowStockSuccess = false;

    // Load dashboard stats
    try {
      const statsData = await getDashboardStats();
      setStats(statsData);
      statsSuccess = true;
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
      setStatsError(true);
      // Set default values to prevent crashes
      setStats({
        today_sales: 0,
        today_orders: 0,
        low_stock_count: 0,
        active_customers: 0,
        total_revenue: 0,
        total_profit: 0,
      });
    }

    // Load low stock products
    try {
      const lowStockData = await getLowStockProducts();
      setLowStockProducts(lowStockData || []);
      lowStockSuccess = true;
    } catch (error) {
      console.error('Failed to load low stock products:', error);
      setLowStockError(true);
      setLowStockProducts([]);
    }

    setLoading(false);

    // Only show error toast if both queries failed
    if (!statsSuccess && !lowStockSuccess) {
      toast({
        title: 'Error',
        description: 'Failed to load dashboard data. Please refresh the page.',
        variant: 'destructive',
      });
    } else if (!statsSuccess || !lowStockSuccess) {
      // Show warning if only one failed
      toast({
        title: 'Warning',
        description: 'Some dashboard metrics could not be loaded.',
        variant: 'default',
      });
    }
  };

  // Format currency based on stats
  const formatCurrency = (amount: number): string => {
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UZS`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your POS system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Today's Sales"
          value={formatCurrency(stats?.today_sales || 0)}
          subtitle={`${stats?.today_orders || 0} orders today`}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={statsError}
        />

        <MetricCard
          title="Today's Orders"
          value={stats?.today_orders || 0}
          subtitle="Completed orders"
          icon={<ShoppingCart className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={statsError}
        />

        <MetricCard
          title="Low Stock Items"
          value={stats?.low_stock_count || 0}
          subtitle="Items need restocking"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          loading={loading}
          error={statsError}
        />

        <MetricCard
          title="Active Customers"
          value={stats?.active_customers || 0}
          subtitle="Total customers"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          loading={loading}
          error={statsError}
        />
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
                <TrendingUp className="h-8 w-8" />
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
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-4 w-12" />
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
    </div>
  );
}
