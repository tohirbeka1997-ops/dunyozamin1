import { useState, useEffect, useCallback } from 'react';
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

  const loadData = useCallback(async (opts?: { append?: boolean; pageOverride?: number }) => {
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
          categoryId: categoryFilter === 'all' ? undefined : categoryFilter,
          status: 'active',
          stockStatus: backendStockStatus as any,
          sortBy: backendSortField as any,
          sortOrder: backendSortOrder as any,
          limit: PAGE_SIZE,
          offset,
        }),
        getCategories(),
      ]);

      const nextProducts = Array.isArray(productsData) ? productsData : [];
      setProducts((prev) => (opts?.append ? [...prev, ...nextProducts] : nextProducts));
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
  }, [searchDebounced, categoryFilter, stockFilter, sortBy, toast]);

  useEffect(() => {
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
  }, [loadData]);

  useEffect(() => {
    setPage(0);
    loadData({ append: false, pageOverride: 0 });
  }, [searchDebounced, categoryFilter, stockFilter, sortBy]);

  // Products are loaded paginated + mostly filtered server-side via getProducts().
  // Keep client-side filtering only for "in_stock" which backend doesn't explicitly support.
  const baseFilteredProducts =
    stockFilter === 'in_stock'
      ? products.filter((p) => {
          const s = getCurrentStock(p);
          return s > 0;
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
    (p) => {
      const s = getCurrentStock(p);
      return s > 0 && s <= p.min_stock_level;
    }
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
    <div className="w-full min-w-0 space-y-4">
      <PageBreadcrumb
        items={[
          { label: 'Bosh sahifa', href: '/' },
          { label: 'Ombor', href: '/inventory' },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Ombor bo'limi</h1>
          <p className="page-heading-sub">Mahsulot qoldiqlari va harakatlarini boshqarish</p>
        </div>
      </div>

      {lowStockCount > 0 && (
        <Card className="border-yellow-200 bg-yellow-50 py-0 shadow-sm dark:border-yellow-800 dark:bg-yellow-950">
          <CardContent className="flex items-start gap-2.5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold leading-snug text-yellow-900 dark:text-yellow-100">
                {lowStockCount} ta mahsulot minimal qoldiqdan past
              </p>
              <p className="text-xs leading-snug text-yellow-800 dark:text-yellow-300">
                Ushbu mahsulotlarni tekshiring va qo'shimcha qoldiq qo'shing
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="relative h-8 min-w-0 flex-1 lg:min-w-[14rem] lg:max-w-md">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Mahsulot nomi yoki SKU bo'yicha qidirish..."
                  value={searchTerm}
                  onChange={(e) => updateParams({ search: e.target.value })}
                  className="h-8 py-1 pl-8 text-xs sm:text-sm"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex-[2]">
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={categoryFilter} onValueChange={(value) => updateParams({ category: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
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
                </div>
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={stockFilter} onValueChange={(value) => updateParams({ stock: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
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
                <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
                  <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() =>
                    updateParams({
                      search: '',
                      category: 'all',
                      stock: 'all',
                      sortBy: 'name-asc',
                    })
                  }
                >
                  Filtrni tozalash
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Mahsulot qoldiqlari ro&apos;yxati</span>
            {!loading && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                ({filteredProducts.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Omborni yuklanmoqda...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
              Filtrga mos mahsulotlar topilmadi
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold sm:text-sm">Mahsulot nomi</TableHead>
                      <TableHead className="text-xs font-semibold sm:text-sm">SKU</TableHead>
                      <TableHead className="text-xs font-semibold sm:text-sm">O&apos;lchov birligi</TableHead>
                      <TableHead className="text-xs font-semibold sm:text-sm">Joriy qoldiq</TableHead>
                      <TableHead className="text-xs font-semibold sm:text-sm">Minimal qoldiq</TableHead>
                      <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                      <TableHead className="w-[1%] text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => {
                      const currentStock = getCurrentStock(product);
                      const isLowStock = currentStock > 0 && currentStock <= product.min_stock_level;
                      const isOutOfStock = currentStock === 0;

                      return (
                        <TableRow
                          key={product.id}
                          className={`cursor-pointer text-sm hover:bg-muted/50 ${
                            isLowStock ? 'bg-red-50 dark:bg-red-950/20' : ''
                          }`}
                          onClick={() => handleRowClick(product)}
                        >
                          <TableCell className="max-w-[16rem] py-2 font-medium">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate">
                                {searchDebounced ? highlightMatch(product.name, searchDebounced) : product.name}
                              </span>
                              {isLowStock && (
                                <Badge variant="destructive" className="px-1 py-0 text-[10px] font-normal sm:text-xs">
                                  Qoldiq kam
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[9rem] truncate py-2 font-mono text-xs">
                            {searchDebounced ? highlightMatch(product.sku, searchDebounced) : product.sku}
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-xs">{formatUnit(product.unit)}</TableCell>
                          <TableCell className="py-2">
                            <span
                              className={`text-xs tabular-nums ${
                                isOutOfStock
                                  ? 'font-bold text-red-600 dark:text-red-400'
                                  : isLowStock
                                    ? 'font-semibold text-orange-600 dark:text-orange-400'
                                    : 'font-medium text-green-600 dark:text-green-400'
                              }`}
                            >
                              {formatNumberUZ(currentStock)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-xs tabular-nums">{formatNumberUZ(product.min_stock_level)}</TableCell>
                          <TableCell className="py-2">
                            {isOutOfStock ? (
                              <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
                                Omborda yo'q
                              </Badge>
                            ) : isLowStock ? (
                              <Badge
                                variant="outline"
                                className="border-orange-300 px-1.5 py-0 text-[10px] font-normal text-orange-700 dark:border-orange-700 dark:text-orange-400 sm:text-xs"
                              >
                                Qoldiq kam
                              </Badge>
                            ) : (
                              <Badge className="bg-green-500/10 px-1.5 py-0 text-[10px] font-normal text-green-700 dark:text-green-400 sm:text-xs">
                                Omborda bor
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs"
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
              </div>
              {hasMore && (
                <div className="flex justify-center px-4 pb-1 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => loadData({ append: true, pageOverride: page + 1 })}
                    disabled={loading}
                  >
                    Ko'proq yuklash
                  </Button>
                </div>
              )}
            </>
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
