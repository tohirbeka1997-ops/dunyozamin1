import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { getProducts, getCategories } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { Search, Package, AlertTriangle } from 'lucide-react';
import { highlightMatch } from '@/utils/searchHighlight';
import StockAdjustmentDialog from '@/components/inventory/StockAdjustmentDialog';
import { formatUnit } from '@/utils/formatters';
import { formatNumberUZ } from '@/lib/format';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';

export default function Inventory() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'inventory.filters.query',
    trackedKeys: ['search', 'category', 'stock', 'sortBy'],
  });
  
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const [searchDebounced, setSearchDebounced] = useState('');
  const categoryFilter = searchParams.get('category') || 'all';
  const stockFilter = searchParams.get('stock') || 'all';
  const sortBy = searchParams.get('sortBy') || 'name-asc';
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);

  // Helper: Get stock from product data (single source of truth - from IPC)
  // CRITICAL FIX: Use stock_available (real-time from inventory_movements) instead of current_stock
  const getCurrentStock = (product: ProductWithCategory): number => {
    return product.stock_available ?? product.available_stock ?? product.current_stock ?? product.stock_quantity ?? 0;
  };

  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchTerm.trim()), 200);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const PAGE_SIZE = 200;

  const loadData = async (opts?: { append?: boolean; pageOverride?: number }) => {
    try {
      setLoading(true);
      const effectivePage = opts?.pageOverride ?? 0;
      const offset = effectivePage * PAGE_SIZE;

      const backendStockStatus =
        stockFilter === 'low' ? 'low' : stockFilter === 'out_of_stock' ? 'out' : undefined;

      const [sortField, sortDir] = String(sortBy || 'name-asc').split('-');
      const backendSortField =
        sortField === 'name' || sortField === 'sku' || sortField === 'created_at' || sortField === 'sale_price'
          ? sortField
          : 'name';
      const backendSortOrder = sortDir === 'desc' ? 'desc' : 'asc';

      const [productsData, categoriesData] = await Promise.all([
        getProducts(false, {
          searchTerm: searchDebounced,
          categoryId: categoryFilter,
          status: 'active',
          stockStatus: backendStockStatus as any,
          sortBy: backendSortField as any,
          sortOrder: backendSortOrder as any,
          limit: PAGE_SIZE,
          offset,
        }),
        getCategories(),
      ]);

      setProducts((prev) => (opts?.append ? [...prev, ...(productsData as any)] : (productsData as any)));
      setCategories(categoriesData);
      setPage(effectivePage);
      setHasMore(Array.isArray(productsData) && productsData.length >= PAGE_SIZE);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Xatolik',
        description: "Ombor ma'lumotlarini yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData({ append: false, pageOverride: 0 });

    const handleProductUpdate = () => {
      console.log('Product update detected, refreshing inventory...');
      loadData({ append: false, pageOverride: 0 });
    };

    let unsubscribe: (() => void) | null = null;
    import('@/db/api').then(({ productUpdateEmitter }) => {
      unsubscribe = productUpdateEmitter.subscribe(handleProductUpdate);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(0);
    loadData({ append: false, pageOverride: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDebounced, categoryFilter, stockFilter, sortBy]);

  // Products are loaded paginated + mostly filtered server-side via getProducts().
  // Keep client-side filtering only for "in_stock" which backend doesn't explicitly support.
  const baseFilteredProducts =
    stockFilter === 'in_stock'
      ? products.filter((p) => {
          const s = getCurrentStock(p);
          return s >= p.min_stock_level && s > 0;
        })
      : products;

  // Optional client-side sorting for stock-based ordering (backend doesn't support it).
  const filteredProducts = (() => {
    const [sortField, sortDir] = String(sortBy || 'name-asc').split('-');
    if (sortField !== 'stock') return baseFilteredProducts;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...baseFilteredProducts].sort((a, b) => (getCurrentStock(a) - getCurrentStock(b)) * dir);
  })();

  const lowStockCount = products.filter(
    (p) => getCurrentStock(p) < p.min_stock_level
  ).length;

  const handleAdjustStock = (product: ProductWithCategory) => {
    setSelectedProduct(product);
    setAdjustmentDialogOpen(true);
  };

  const handleAdjustmentSuccess = () => {
    loadData();
    setAdjustmentDialogOpen(false);
    setSelectedProduct(null);
  };

  const handleRowClick = (product: ProductWithCategory) => {
    if (!product.id) {
      console.error('[Inventory] Product ID is missing:', product);
      toast({
        title: 'Xatolik',
        description: 'Mahsulot ID topilmadi',
        variant: 'destructive',
      });
      return;
    }
    navigate(`/inventory/${product.id}`, {
      state: createBackNavigationState(location),
    });
  };

  const handleAdjustStockClick = (e: React.MouseEvent, product: ProductWithCategory) => {
    e.stopPropagation(); // Prevent row click navigation
    handleAdjustStock(product);
  };

  return (
    <div className="space-y-3">
      <PageBreadcrumb
        items={[
          { label: 'Bosh sahifa', href: '/' },
          { label: 'Ombor', href: '/inventory' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Ombor bo'limi</h1>
          <p className="text-sm text-muted-foreground">Mahsulot qoldiqlari va harakatlarini boshqarish</p>
        </div>
      </div>

      {/* Summary Card */}
      {lowStockCount > 0 && (
        <Card className="border-yellow-200 bg-yellow-50 py-3 dark:border-yellow-800 dark:bg-yellow-950">
          <CardContent className="px-4 py-0 sm:px-6">
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
      <Card className="gap-3 py-3">
        <CardHeader className="px-4 pb-0 pt-0 sm:px-6">
          <CardTitle className="text-lg">Mahsulot qoldiqlari ro'yxati</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-2 sm:px-6">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1 xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Mahsulot nomi yoki SKU bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => updateParams({ search: e.target.value })}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={categoryFilter} onValueChange={(value) => updateParams({ category: value })}>
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
              <Select value={stockFilter} onValueChange={(value) => updateParams({ stock: value })}>
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
              <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Saralash" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Nomi (A-Z)</SelectItem>
                  <SelectItem value="name-desc">Nomi (Z-A)</SelectItem>
                  <SelectItem value="sku-asc">SKU (A-Z)</SelectItem>
                  <SelectItem value="sku-desc">SKU (Z-A)</SelectItem>
                  <SelectItem value="stock-desc">Qoldiq (Ko'p → Kam)</SelectItem>
                  <SelectItem value="stock-asc">Qoldiq (Kam → Ko'p)</SelectItem>
                  <SelectItem value="created_at-desc">Eng yangisi</SelectItem>
                  <SelectItem value="created_at-asc">Eng eskisi</SelectItem>
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
                    // Use current_stock from product data (single source of truth from IPC)
                    const currentStock = getCurrentStock(product);
                    const isLowStock = currentStock < product.min_stock_level;
                    const isOutOfStock = currentStock === 0;

                    return (
                      <TableRow
                        key={product.id}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                          isLowStock ? 'bg-red-50 dark:bg-red-950/20' : ''
                        }`}
                        onClick={() => handleRowClick(product)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {searchDebounced ? highlightMatch(product.name, searchDebounced) : product.name}
                            {isLowStock && (
                              <Badge variant="destructive" className="text-xs">
                                Qoldiq kam
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {searchDebounced ? highlightMatch(product.sku, searchDebounced) : product.sku}
                        </TableCell>
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleAdjustStockClick(e, product)}
                          >
                            Qoldiqni to'g'rilash
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {hasMore && (
                <div className="flex justify-center py-4">
                  <Button
                    variant="outline"
                    onClick={() => loadData({ append: true, pageOverride: page + 1 })}
                    disabled={loading}
                  >
                    Ko'proq yuklash
                  </Button>
                </div>
              )}
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
