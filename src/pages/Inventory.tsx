import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getInventory, getCategories, getLowStockProducts } from '@/db/api';
import type { Product, Category } from '@/types/database';
import { Search, Download, ArrowUpDown, AlertTriangle, Eye, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Inventory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockStatusFilter, setStockStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadInventory();
  }, [searchTerm, categoryFilter, stockStatusFilter, sortBy, sortOrder]);

  const loadData = async () => {
    try {
      const [categoriesData, lowStockData] = await Promise.all([
        getCategories(),
        getLowStockProducts(),
      ]);
      setCategories(categoriesData);
      setLowStockProducts(lowStockData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive',
      });
    }
  };

  const loadInventory = async () => {
    try {
      setLoading(true);
      const data = await getInventory({
        searchTerm: searchTerm || undefined,
        categoryId: categoryFilter,
        stockStatus: stockStatusFilter,
        sortBy,
        sortOrder,
      });
      setProducts(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load inventory',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getStockStatusBadge = (product: Product) => {
    const stock = Number(product.current_stock);
    const minStock = Number(product.min_stock_level);

    if (stock === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    } else if (stock <= minStock) {
      return <Badge className="bg-warning text-warning-foreground">Low Stock</Badge>;
    } else {
      return <Badge className="bg-success text-success-foreground">In Stock</Badge>;
    }
  };

  const calculateInventoryValue = (product: Product) => {
    return Number(product.current_stock) * Number(product.purchase_price);
  };

  const getTotalInventoryValue = () => {
    return products.reduce((sum, product) => sum + calculateInventoryValue(product), 0);
  };

  const handleExport = () => {
    toast({
      title: 'Export',
      description: 'Export functionality coming soon',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">Manage your stock and inventory movements</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {lowStockProducts.length > 0 && (
        <Alert className="border-warning bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertDescription className="ml-2">
            <span className="font-medium">{lowStockProducts.length} products</span> are running low on stock.{' '}
            <Button
              variant="link"
              className="p-0 h-auto text-warning"
              onClick={() => setStockStatusFilter('low_stock')}
            >
              View low stock items
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-2xl font-bold">{products.length}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">${getTotalInventoryValue().toFixed(2)}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Low Stock</p>
                <p className="text-2xl font-bold text-warning">{lowStockProducts.length}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-bold text-destructive">
                  {products.filter(p => Number(p.current_stock) === 0).length}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, SKU, or barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
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

              <Select value={stockStatusFilter} onValueChange={setStockStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Stock Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="low_stock">Low Stock</SelectItem>
                  <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No products found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => handleSort('name')}>
                        Product Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>SKU / Barcode</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleSort('current_stock')}>
                        Stock
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Cost Price</TableHead>
                    <TableHead className="text-right">Inventory Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{product.name}</p>
                          {product.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {product.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{product.sku}</p>
                          {product.barcode && (
                            <p className="text-muted-foreground">{product.barcode}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(product as any).category?.name || '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(product.current_stock).toFixed(2)}
                      </TableCell>
                      <TableCell>{product.unit}</TableCell>
                      <TableCell className="text-right">
                        ${Number(product.purchase_price).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${calculateInventoryValue(product).toFixed(2)}
                      </TableCell>
                      <TableCell>{getStockStatusBadge(product)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/inventory/${product.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
