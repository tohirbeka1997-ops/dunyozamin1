import { useState, useEffect } from 'react';
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
import { getOrders, getCategories } from '@/db/api';
import type { OrderWithDetails, Category } from '@/types/database';
import { FileDown, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ProductSalesData {
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  quantity_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
}

export default function ProductSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [productSales, setProductSales] = useState<ProductSalesData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, categoryFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, categoriesData] = await Promise.all([
        getOrders(),
        getCategories(),
      ]);
      
      const filtered = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      const productMap = new Map<string, ProductSalesData>();

      filtered.forEach((order) => {
        order.items?.forEach((item) => {
          const product = item.product;
          if (!product) return;

          const key = product.id;
          const existing = productMap.get(key);
          
          const quantity = Number(item.quantity);
          const revenue = Number(item.subtotal);
          const cost = Number(product.purchase_price || 0) * quantity;
          const profit = revenue - cost;

          if (existing) {
            existing.quantity_sold += quantity;
            existing.revenue += revenue;
            existing.cost += cost;
            existing.profit += profit;
            existing.profit_margin = (existing.profit / existing.revenue) * 100;
          } else {
            productMap.set(key, {
              product_id: product.id,
              product_name: product.name,
              sku: product.sku,
              category: product.category?.name || 'Uncategorized',
              quantity_sold: quantity,
              revenue,
              cost,
              profit,
              profit_margin: (profit / revenue) * 100,
            });
          }
        });
      });

      let salesData = Array.from(productMap.values());

      if (categoryFilter !== 'all') {
        const category = categoriesData.find((c) => c.id === categoryFilter);
        if (category) {
          salesData = salesData.filter((s) => s.category === category.name);
        }
      }

      salesData.sort((a, b) => b.quantity_sold - a.quantity_sold);

      setProductSales(salesData);
      setCategories(categoriesData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load product sales data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = productSales.filter((product) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      product.product_name.toLowerCase().includes(search) ||
      product.sku.toLowerCase().includes(search)
    );
  });

  const topProducts = filteredProducts.slice(0, 10);
  const slowMoving = filteredProducts.slice(-10).reverse();

  const chartData = topProducts.map((p) => ({
    name: p.product_name.length > 15 ? p.product_name.substring(0, 15) + '...' : p.product_name,
    quantity: p.quantity_sold,
    revenue: p.revenue,
  }));

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Export',
      description: `Exporting to ${format.toUpperCase()}...`,
    });
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Product Sales Report</h1>
            <p className="text-muted-foreground">Analyze product performance and profitability</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Category</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Search</label>
              <Input
                placeholder="Search by name or SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-success" />
              Top 10 Best-Selling Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="quantity" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-warning" />
              Slow-Moving Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {slowMoving.slice(0, 5).map((product) => (
                <div key={product.product_id} className="flex justify-between items-center p-2 rounded-lg bg-muted">
                  <div>
                    <p className="font-medium">{product.product_name}</p>
                    <p className="text-sm text-muted-foreground">{product.sku}</p>
                  </div>
                  <Badge variant="outline">{product.quantity_sold} sold</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No product sales data found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.product_id}>
                    <TableCell className="font-medium">{product.product_name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell className="text-right">{product.quantity_sold}</TableCell>
                    <TableCell className="text-right">${product.revenue.toFixed(2)}</TableCell>
                    <TableCell className={`text-right ${product.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      ${product.profit.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        className={product.profit_margin >= 20 ? 'bg-success' : product.profit_margin >= 10 ? 'bg-warning' : 'bg-destructive'}
                      >
                        {product.profit_margin.toFixed(1)}%
                      </Badge>
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
