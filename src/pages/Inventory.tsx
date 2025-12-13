import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInventoryStore } from '@/store/inventoryStore';
import { getProducts, getCategories } from '@/db/api';
import type { Product, Category } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { Search, Package, AlertTriangle } from 'lucide-react';
import StockAdjustmentDialog from '@/components/inventory/StockAdjustmentDialog';
import { formatUnit } from '@/utils/formatters';
import { formatNumberUZ } from '@/lib/format';

export default function Inventory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getCurrentStockByProductId } = useInventoryStore();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    loadData();
    // Load inventory from storage on mount
    useInventoryStore.getState().loadFromStorage();

    // Listen for product updates (e.g., when PO is received, stock is adjusted)
    // This ensures inventory page refreshes when stock changes
    const handleProductUpdate = () => {
      console.log('Product update detected, refreshing inventory...');
      loadData();
      // Also reload inventory store
      useInventoryStore.getState().loadFromStorage();
    };

    // Import productUpdateEmitter dynamically to avoid circular dependencies
    let unsubscribe: (() => void) | null = null;
    import('@/db/api').then(({ productUpdateEmitter }) => {
      unsubscribe = productUpdateEmitter.subscribe(handleProductUpdate);
    });

    // Cleanup listener on unmount
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([
        getProducts(),
        getCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Xatolik',
        description: 'Ombor ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      !searchTerm ||
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || product.category_id === categoryFilter;

    const currentStock = getCurrentStockByProductId(product.id);
    const matchesStock =
      stockFilter === 'all' ||
      (stockFilter === 'low' && currentStock < product.min_stock_level) ||
      (stockFilter === 'in_stock' && currentStock >= product.min_stock_level && currentStock > 0) ||
      (stockFilter === 'out_of_stock' && currentStock === 0);

    return matchesSearch && matchesCategory && matchesStock;
  });

  const lowStockCount = products.filter(
    (p) => getCurrentStockByProductId(p.id) < p.min_stock_level
  ).length;

  const handleAdjustStock = (product: Product) => {
    setSelectedProduct(product);
    setAdjustmentDialogOpen(true);
  };

  const handleAdjustmentSuccess = () => {
    loadData();
    setAdjustmentDialogOpen(false);
    setSelectedProduct(null);
  };

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Bosh sahifa', href: '/' },
          { label: 'Ombor', href: '/inventory' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Ombor bo'limi</h1>
          <p className="text-muted-foreground">Mahsulot qoldiqlari va harakatlarini boshqarish</p>
        </div>
      </div>

      {/* Summary Card */}
      {lowStockCount > 0 && (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <div>
                <p className="font-semibold text-yellow-900 dark:text-yellow-100">
                  {lowStockCount} ta mahsulot minimal qoldiqdan past
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Ushbu mahsulotlarni tekshiring va qo'shimcha qoldiq qo'shing
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Mahsulot qoldiqlari ro'yxati</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1 xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Mahsulot nomi yoki SKU bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Kategoriya bo'yicha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Qoldiq bo'yicha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha zaxira holatlari</SelectItem>
                  <SelectItem value="low">Qoldiq kam</SelectItem>
                  <SelectItem value="in_stock">Omborda bor</SelectItem>
                  <SelectItem value="out_of_stock">Omborda yo'q</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Omborni yuklanmoqda...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Filtrga mos mahsulotlar topilmadi
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot nomi</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>O'lchov birligi</TableHead>
                    <TableHead>Joriy qoldiq</TableHead>
                    <TableHead>Minimal qoldiq</TableHead>
                    <TableHead>Holati</TableHead>
                    <TableHead className="text-right">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const currentStock = getCurrentStockByProductId(product.id);
                    const isLowStock = currentStock < product.min_stock_level;
                    const isOutOfStock = currentStock === 0;

                    return (
                      <TableRow
                        key={product.id}
                        className={isLowStock ? 'bg-red-50 dark:bg-red-950/20' : ''}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {product.name}
                            {isLowStock && (
                              <Badge variant="destructive" className="text-xs">
                                Qoldiq kam
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{product.sku}</TableCell>
                        <TableCell>{formatUnit(product.unit)}</TableCell>
                        <TableCell>
                          <span
                            className={
                              isOutOfStock
                                ? 'font-bold text-red-600 dark:text-red-400'
                                : isLowStock
                                ? 'font-semibold text-orange-600 dark:text-orange-400'
                                : 'font-medium text-green-600 dark:text-green-400'
                            }
                          >
                            {formatNumberUZ(currentStock)}
                          </span>
                        </TableCell>
                        <TableCell>{formatNumberUZ(product.min_stock_level)}</TableCell>
                        <TableCell>
                          {isOutOfStock ? (
                            <Badge variant="destructive">Omborda yo'q</Badge>
                          ) : isLowStock ? (
                            <Badge variant="outline" className="border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
                              Qoldiq kam
                            </Badge>
                          ) : (
                            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">
                              Omborda bor
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/products/${product.id}`)}
                            >
                              Tafsilotlarni ko'rish
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAdjustStock(product)}
                            >
                              Qoldiqni to'g'rilash
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock Adjustment Dialog */}
      {selectedProduct && (
        <StockAdjustmentDialog
          open={adjustmentDialogOpen}
          onOpenChange={setAdjustmentDialogOpen}
          product={selectedProduct}
          onSuccess={handleAdjustmentSuccess}
        />
      )}
    </div>
  );
}
