import { useState, useEffect, useCallback, useRef } from 'react';
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
import { getProducts, getCategories, getOpenInventoryRevision } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { Search, Package, AlertTriangle } from 'lucide-react';
import { highlightMatch } from '@/utils/searchHighlight';
import StockAdjustmentDialog from '@/components/inventory/StockAdjustmentDialog';
import { formatUnit } from '@/utils/formatters';
import { formatQuantity } from '@/utils/quantity';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { useMainScrollRestoration } from '@/hooks/useMainScrollRestoration';
import { buildCurrentPath } from '@/lib/pageState';
import { listSessionStorageKey, withReturnToPath } from '@/lib/listState';
import { useInventoryListStore } from '@/store/inventoryListStore';
import { useTranslation } from 'react-i18next';
import { filterProductsBySearchTerm } from '@/lib/productSearchMatch';
import { extractHttpStatus, reportApiFailure } from '@/lib/apiFailureTelemetry';
import { useAuth } from '@/contexts/AuthContext';

export default function Inventory() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const listAnchorRef = useRef<HTMLDivElement | null>(null);
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: listSessionStorageKey(
      'inventory',
      user?.id,
      (profile as { branch_id?: string } | null)?.branch_id,
    ),
    trackedKeys: ['search', 'category', 'stock', 'sortBy'],
  });
  const listQueryKey = searchParams.toString();
  const storedQueryKey = useInventoryListStore((state) => state.queryKey);
  const storedScrollTop = useInventoryListStore((state) => state.scrollTop);
  const setStoredScrollTop = useInventoryListStore((state) => state.setScrollTop);
  const resetForQuery = useInventoryListStore((state) => state.resetForQuery);
  const restoredScrollTop = storedQueryKey === listQueryKey ? storedScrollTop : 0;
  
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const searchTerm = searchParams.get('search') || '';
  const [searchDebounced, setSearchDebounced] = useState('');
  const categoryFilter = searchParams.get('category') || 'all';
  const stockFilter = searchParams.get('stock') || 'all';
  const sortBy = searchParams.get('sortBy') || 'name-asc';
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);
  const [openRevision, setOpenRevision] = useState<{
    id: string;
    revision_number: string;
  } | null>(null);

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);

  const { saveScroll } = useMainScrollRestoration({
    scrollTop: restoredScrollTop,
    setScrollTop: setStoredScrollTop,
    ready: !loading,
    anchorRef: listAnchorRef,
  });

  // Helper: Get stock from product data
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
      setLoadError(null);
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
      setLastUpdatedAt(new Date());
      setLoadError(null);
    } catch (error) {
      console.error('Error loading data:', error);
      // Do NOT clear existing table data on API error/timeout.
      const httpCode = extractHttpStatus(error);
      reportApiFailure({
        page: 'Inventory',
        apiUrl: 'pos:products:list',
        httpCode,
        userRole: user?.role || null,
        message: error instanceof Error ? error.message : String(error),
      });
      setLoadError(t('inventory.load_failed_body', {
        defaultValue: 'Server vaqtincha javob bermayapti',
      }));
      toast({
        title: t('inventory.load_failed_title', { defaultValue: "Ma'lumot yuklanmadi" }),
        description: t('inventory.load_failed_body', {
          defaultValue: 'Server vaqtincha javob bermayapti',
        }),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, categoryFilter, stockFilter, sortBy, toast, t, user?.role]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const open = await getOpenInventoryRevision();
        if (!cancelled) setOpenRevision(open || null);
      } catch {
        if (!cancelled) setOpenRevision(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // Products are loaded paginated + mostly filtered server-side via getProducts().
  // Client-side search guard prevents showing non-matches while debounce/network lags.
  // Keep client-side stock filter only for "in_stock" which backend doesn't explicitly support.
  const baseFilteredProducts =
    stockFilter === 'in_stock'
      ? products.filter((p) => {
          const s = getCurrentStock(p);
          return s > 0;
        })
      : products;

  const searchGuardedProducts = searchTerm.trim()
    ? filterProductsBySearchTerm(baseFilteredProducts, searchTerm)
    : baseFilteredProducts;

  // Optional client-side sorting for stock-based ordering (backend doesn't support it).
  const filteredProducts = (() => {
    const [sortField, sortDir] = String(sortBy || 'name-asc').split('-');
    if (sortField !== 'stock') return searchGuardedProducts;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...searchGuardedProducts].sort((a, b) => (getCurrentStock(a) - getCurrentStock(b)) * dir);
  })();

  const lowStockCount = products.filter(
    (p) => {
      const s = getCurrentStock(p);
      return s > 0 && s <= p.min_stock_level;
    }
  ).length;

  const handleAdjustStock = (product: ProductWithCategory) => {
    if (openRevision) {
      toast({
        title: t('inventory_revision.open_banner_title'),
        description: t('inventory_revision.open_banner_body', {
          number: openRevision.revision_number,
        }),
        variant: 'destructive',
      });
      return;
    }
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
    saveScroll();
    navigate(withReturnToPath(`/inventory/${product.id}`, buildCurrentPath(location)));
  };

  const handleAdjustStockClick = (e: React.MouseEvent, product: ProductWithCategory) => {
    e.stopPropagation(); // Prevent row click navigation
    handleAdjustStock(product);
  };

  return (
    <div className="w-full min-w-0 space-y-4" ref={listAnchorRef}>
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

      {openRevision && (
        <Card className="border-amber-200 bg-amber-50 py-0 shadow-sm dark:border-amber-800 dark:bg-amber-950">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {t('inventory_revision.open_banner_title')}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {t('inventory_revision.open_banner_body', {
                    number: openRevision.revision_number,
                  })}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => navigate(`/inventory/revisions/${openRevision.id}`)}
              aria-label={t('inventory_revision.open_banner_action')}
            >
              {t('inventory_revision.open_banner_action')}
            </Button>
          </CardContent>
        </Card>
      )}

      {lowStockCount > 0 && (
        <Card
          className={`border-yellow-200 bg-yellow-50 py-0 shadow-sm dark:border-yellow-800 dark:bg-yellow-950 ${
            stockFilter !== 'low' ? 'cursor-pointer transition-colors hover:bg-yellow-100/80 dark:hover:bg-yellow-900/40' : ''
          }`}
          role={stockFilter !== 'low' ? 'button' : undefined}
          tabIndex={stockFilter !== 'low' ? 0 : undefined}
          onClick={() => {
            if (stockFilter !== 'low') updateParams({ stock: 'low' });
          }}
          onKeyDown={(e) => {
            if (stockFilter === 'low') return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              updateParams({ stock: 'low' });
            }
          }}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold leading-snug text-yellow-900 dark:text-yellow-100">
                  Ushbu ro'yxatda {lowStockCount} ta mahsulot minimal qoldiqdan past
                </p>
                <p className="text-xs leading-snug text-yellow-800 dark:text-yellow-300">
                  {stockFilter === 'low'
                    ? 'Hozir «Qoldiq kam» filtri yoqilgan. Barcha mahsulotlarni ko\'rish uchun filtrni tozalang.'
                    : 'Bu son joriy yuklangan ro\'yxatdagi mahsulotlarga tegishli. Bosib «Qoldiq kam» filtrini yoqing. Dashboard\'dagi son — butun katalog bo\'yicha.'}
                </p>
              </div>
            </div>
            {stockFilter !== 'low' ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  updateParams({ stock: 'low' });
                }}
              >
                Kamlarini ko&apos;rsat
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  updateParams({ stock: 'all' });
                }}
              >
                Filtrni tozalash
              </Button>
            )}
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
          {loading && products.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Omborni yuklanmoqda...</div>
          ) : loadError && products.length === 0 ? (
            <div className="mx-4 my-8 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 py-10 text-center">
              <p className="text-sm font-medium text-destructive">
                {t('inventory.load_failed_title', { defaultValue: "Ma'lumot yuklanmadi" })}
              </p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
              {lastUpdatedAt && (
                <p className="text-xs text-muted-foreground">
                  {t('inventory.last_updated', {
                    defaultValue: 'Oxirgi yangilanish',
                  })}
                  : {lastUpdatedAt.toLocaleString()}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadData({ append: false, pageOverride: 0 })}
              >
                {t('common.retry', { defaultValue: 'Qayta urinish' })}
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
              Filtrga mos mahsulotlar topilmadi
            </div>
          ) : (
            <>
              {loadError && (
                <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <span>{loadError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => void loadData({ append: false, pageOverride: 0 })}
                  >
                    {t('common.retry', { defaultValue: 'Qayta urinish' })}
                  </Button>
                </div>
              )}
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
                      const minLevel = Number(product.min_stock_level) || 0;
                      const isOutOfStock = currentStock === 0;
                      const isAtMin =
                        minLevel > 0 && Math.abs(currentStock - minLevel) < 0.0001;
                      const isBelowMin =
                        minLevel > 0 && currentStock > 0 && currentStock < minLevel;
                      const isLowStock = isAtMin || isBelowMin;

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
                              {formatQuantity(Number(currentStock) || 0, product.unit)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-xs tabular-nums text-muted-foreground">
                            {Number(product.min_stock_level) > 0
                              ? formatQuantity(Number(product.min_stock_level) || 0, product.unit)
                              : '—'}
                          </TableCell>
                          <TableCell className="py-2">
                            {isOutOfStock ? (
                              <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
                                Omborda yo'q
                              </Badge>
                            ) : isBelowMin ? (
                              <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
                                {t('inventory.stock_critical', { defaultValue: 'Kritik kam' })}
                              </Badge>
                            ) : isAtMin ? (
                              <Badge
                                variant="outline"
                                className="border-yellow-400 px-1.5 py-0 text-[10px] font-normal text-yellow-800 dark:border-yellow-600 dark:text-yellow-400 sm:text-xs"
                              >
                                {t('inventory.stock_at_min', { defaultValue: 'Minimalda' })}
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
                              disabled={!!openRevision}
                              aria-label={
                                openRevision
                                  ? t('inventory_revision.adjust_blocked_aria', {
                                      defaultValue:
                                        'Qo‘lda to‘g‘rilash bloklangan — ochiq reviziya bor',
                                    })
                                  : t('inventory.adjust_stock_aria', {
                                      defaultValue: 'Qoldiqni to‘g‘rilash',
                                    })
                              }
                              title={
                                openRevision
                                  ? t('inventory_revision.open_banner_body', {
                                      number: openRevision.revision_number,
                                    })
                                  : t('inventory.adjust_stock_aria', {
                                      defaultValue: 'Qoldiqni to‘g‘rilash',
                                    })
                              }
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
