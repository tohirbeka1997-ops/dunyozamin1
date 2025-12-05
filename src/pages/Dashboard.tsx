import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboardStats, getLowStockProducts } from '@/db/api';
import type { DashboardStats, ProductWithCategory } from '@/types/database';
import { DollarSign, ShoppingCart, AlertTriangle, Users, TrendingUp, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<ProductWithCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, lowStockData] = await Promise.all([
        getDashboardStats(),
        getLowStockProducts(),
      ]);
      setStats(statsData);
      setLowStockProducts(lowStockData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load dashboard data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your POS system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats?.today_sales.toFixed(2) || '0.00'}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.today_orders || 0} orders today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.today_orders || 0}</div>
            <p className="text-xs text-muted-foreground">Completed orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.low_stock_count || 0}</div>
            <p className="text-xs text-muted-foreground">Items need restocking</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.active_customers || 0}</div>
            <p className="text-xs text-muted-foreground">Total customers</p>
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
                <TrendingUp className="h-8 w-8" />
                <span>View Reports</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Low Stock Alert */}
      {lowStockProducts.length > 0 && (
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
                    <p className="font-bold text-warning">{product.current_stock} {product.unit}</p>
                    <p className="text-xs text-muted-foreground">
                      Min: {product.min_stock_level}
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
      )}
    </div>
  );
}
