import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
import { createProduct, deleteProduct, getProducts, updateProduct, productUpdateEmitter } from '@/db/api';
import { useProducts } from '@/hooks/useProducts';
import type { ProductWithCategory } from '@/types/database';
import { Plus, Search, Package, FileDown, ChevronDown, Percent, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { normalizeImportImageUrl } from '@/lib/productImageUrl';
import { formatUnit } from '@/utils/formatters';
import { productShowInMarketplace } from '@/lib/productMarketplace';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import VirtualizedProductsTable from '@/components/products/VirtualizedProductsTable';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { useProductsListStore } from '@/store/productsListStore';
import { ProductDetailContent } from '@/pages/ProductDetail';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import MoneyInput from '@/components/common/MoneyInput';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BulkPriceUpdateDialog from '@/components/products/BulkPriceUpdateDialog';
import { useDebounce } from '@/hooks/use-debounce';
import { filterProductsBySearchTerm } from '@/lib/productSearchMatch';
import { extractHttpStatus, reportApiFailure } from '@/lib/apiFailureTelemetry';
import { useAuth } from '@/contexts/AuthContext';
import {
  listScrollStorageKey,
  normalizeListPathAndQuery,
  persistListScroll,
  withReturnToPath,
} from '@/lib/listState';

export default function Products() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const confirmDialog = useConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const listQueryParams = new URLSearchParams(searchParams);
  listQueryParams.delete('detail');
  const listQueryKey = listQueryParams.toString();
  const detailId = searchParams.get('detail');
  const filtersRestoredRef = useRef(false);
  const FILTERS_STORAGE_KEY = 'products.filters.query';
  const FILTER_QUERY_KEYS = ['search', 'category', 'status', 'stock', 'marketplace', 'sortBy', 'sortOrder'];
  const [restoreNonce, setRestoreNonce] = useState(0);
  const refetchRef = useRef<(() => Promise<void>) | null>(null);
  const storedQueryKey = useProductsListStore((state) => state.queryKey);
  const storedFiltersQuery = useProductsListStore((state) => state.filtersQuery);
  const storedPage = useProductsListStore((state) => state.page);
  const setStoredPage = useProductsListStore((state) => state.setPage);
  // Do NOT subscribe to scrollTop — writing it on every scroll would re-render the whole page.
  const setStoredScrollTop = useProductsListStore((state) => state.setScrollTop);
  const setStoredFiltersQuery = useProductsListStore((state) => state.setFiltersQuery);
  const setStoredPageSize = useProductsListStore((state) => state.setPageSize);
  const setLastFocusedProductId = useProductsListStore((state) => state.setLastFocusedProductId);
  const resetForQuery = useProductsListStore((state) => state.resetForQuery);
  const setProductsCache = useProductsListStore((state) => state.setProductsCache);
  const getFreshProductsCache = useProductsListStore((state) => state.getFreshProductsCache);
  const [restoreDone, setRestoreDone] = useState(false);
  const [restoreScrollTop, setRestoreScrollTop] = useState(0);
  const PAGE_SIZE = 200;
  
  // Read filters from URL query params (persistent across navigation)
  const searchTerm = searchParams.get('search') || '';
  const [searchInput, setSearchInput] = useState(searchTerm);
  const debouncedSearchTerm = useDebounce(searchInput, 250);
  const categoryFilter = searchParams.get('category') || 'all';
  const statusFilter = searchParams.get('status') || 'active';
  const stockFilter = searchParams.get('stock') || 'all';
  const marketplaceFilter = (searchParams.get('marketplace') || 'all') as 'all' | 'online' | 'pos_only';
  const sortBy = (searchParams.get('sortBy') || 'name') as 'name' | 'sku' | 'created_at' | 'current_stock' | 'sale_price';
  const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';

  useEffect(() => {
    setSearchInput(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    const trimmed = debouncedSearchTerm.trim();
    if (trimmed === searchTerm) return;
    const newParams = new URLSearchParams(searchParams);
    if (!trimmed) newParams.delete('search');
    else newParams.set('search', trimmed);
    setSearchParams(newParams, { replace: true });
  }, [debouncedSearchTerm, searchTerm, searchParams, setSearchParams]);
  
  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);

  useEffect(() => {
    setRestoreDone(false);
    setRestoreScrollTop(0);
  }, [listQueryKey]);

  useEffect(() => {
    setStoredPageSize(PAGE_SIZE);
  }, [setStoredPageSize]);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const reviewResolveRef = useRef<((result: ImportReviewResult) => void) | null>(null);
  const [reviewItems, setReviewItems] = useState<ImportReviewItem[] | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  
  // Helper to update a single filter in URL
  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === '' || value === 'all' || (key === 'sortBy' && value === 'name') || (key === 'sortOrder' && value === 'asc')) {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Restore filters from session storage if user re-enters Products without query params.
  useEffect(() => {
    if (filtersRestoredRef.current) return;
    const hasQueryFilters = FILTER_QUERY_KEYS.some((key) => searchParams.has(key));
    if (hasQueryFilters) {
      filtersRestoredRef.current = true;
      return;
    }
    const saved = storedFiltersQuery || sessionStorage.getItem(FILTERS_STORAGE_KEY);
    if (saved) {
      filtersRestoredRef.current = true;
      const merged = new URLSearchParams(saved);
      const detail = searchParams.get('detail');
      if (detail) {
        merged.set('detail', detail);
      }
      // Ensure status is active or inactive (default active)
      if (!merged.has('status') || !['active', 'inactive'].includes(merged.get('status')!)) {
        merged.set('status', 'active');
      }
      setSearchParams(merged, { replace: true });
      setRestoreNonce(Date.now());
      return;
    }
    filtersRestoredRef.current = true;
    // No saved filters: default to active products
    if (!searchParams.has('status') || searchParams.get('status') === 'all') {
      const next = new URLSearchParams(searchParams);
      next.set('status', 'active');
      setSearchParams(next, { replace: true });
      setRestoreNonce(Date.now());
    }
  }, [searchParams, setSearchParams, storedFiltersQuery]);

  // Persist current filters for navigation within the same session.
  useEffect(() => {
    const params = new URLSearchParams();
    FILTER_QUERY_KEYS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    });
    const query = params.toString();
    if (query) {
      sessionStorage.setItem(FILTERS_STORAGE_KEY, query);
    } else {
      sessionStorage.removeItem(FILTERS_STORAGE_KEY);
    }
    if (storedFiltersQuery !== query) {
      setStoredFiltersQuery(query);
    }
  }, [searchParams, storedFiltersQuery, setStoredFiltersQuery]);

  // Keep initial load light to avoid UI stalls on open; infinite scroll can load more.
  const productsCacheBootstrap = getFreshProductsCache(listQueryKey);
  const { products, categories, loading, loadingMore, error, lastUpdatedAt, refetch, loadMore, hasMore, page } = useProducts(true, {
    searchTerm: debouncedSearchTerm || undefined,
    categoryId: categoryFilter !== 'all' ? categoryFilter : undefined,
    status: statusFilter === 'all' ? 'all' : (statusFilter as 'active' | 'inactive'),
    stockStatus: stockFilter === 'all' ? 'all' : (stockFilter as 'low' | 'out'),
    marketplace: marketplaceFilter === 'all' ? 'all' : marketplaceFilter,
    sortBy,
    sortOrder,
  }, PAGE_SIZE, {
    bootstrap: productsCacheBootstrap
      ? {
          products: productsCacheBootstrap.products,
          categories: productsCacheBootstrap.categories,
          page: productsCacheBootstrap.page,
          hasMore: productsCacheBootstrap.hasMore,
        }
      : null,
    skipInitialLoad: Boolean(productsCacheBootstrap),
  });

  useEffect(() => {
    if (loading || loadingMore) return;
    if (storedQueryKey !== listQueryKey) return;
    setProductsCache({
      queryKey: listQueryKey,
      products,
      categories,
      page,
      hasMore,
      cachedAt: Date.now(),
    });
  }, [loading, loadingMore, products, categories, page, hasMore, listQueryKey, storedQueryKey, setProductsCache]);

  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Ensure data reloads after restoring filters from session storage.
  useEffect(() => {
    if (!restoreNonce) return;
    const timeoutId = setTimeout(() => {
      void refetchRef.current?.();
    }, 650);
    return () => clearTimeout(timeoutId);
  }, [restoreNonce]);

  const targetPage = storedQueryKey === listQueryKey ? storedPage : 0;

  useEffect(() => {
    if (restoreDone) return;
    if (loading || loadingMore) return;
    if (page < targetPage && hasMore) {
      void loadMore();
      return;
    }
    setRestoreScrollTop(
      storedQueryKey === listQueryKey ? useProductsListStore.getState().scrollTop : 0
    );
    setRestoreDone(true);
  }, [restoreDone, loading, loadingMore, page, targetPage, hasMore, loadMore, storedQueryKey, listQueryKey]);

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) return;
    setStoredPage(page);
  }, [page, storedQueryKey, listQueryKey, setStoredPage]);

  // Show error toast if loading fails
  useEffect(() => {
    if (error) {
      reportApiFailure({
        page: 'Products',
        apiUrl: 'pos:products:list',
        httpCode: extractHttpStatus(error),
        userRole: user?.role || null,
        message: error.message,
      });
      toast({
        title: t('products.load_failed_title', { defaultValue: "Ma'lumot yuklanmadi" }),
        description: t('products.load_failed_body', {
          defaultValue: 'Server vaqtincha javob bermayapti',
        }),
        variant: 'destructive',
      });
    }
  }, [error, toast, t, user?.role]);

  const handleDelete = async (id: string, name: string) => {
    let impact: { softDelete?: boolean; hardDelete?: boolean } | null = null;
    try {
      const { getProductDeleteImpact } = await import('@/db/products.api');
      impact = await getProductDeleteImpact(id);
    } catch {
      impact = null;
    }
    const soft = impact?.softDelete === true;
    const ok = await confirmDialog({
      title: soft
        ? t('products.deactivate_confirm_title', { defaultValue: 'Mahsulotni nofaol qilish' })
        : t('products.hard_delete_confirm_title', {
            defaultValue: 'Mahsulotni butunlay o‘chirish',
          }),
      description: soft
        ? t('products.deactivate_confirm', {
            name,
            defaultValue: `"${name}" tarixga ega. Faqat nofaol qilinadi (o‘chirilmaydi). Nofaol ro‘yxatda qoladi.`,
          })
        : t('products.hard_delete_confirm', {
            name,
            defaultValue: `"${name}" tarixisiz. Butunlay o‘chiriladi — bu amalni qaytarib bo‘lmaydi.`,
          }),
      confirmText: soft
        ? t('products.actions.deactivate', { defaultValue: 'Nofaol qilish' })
        : t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await deleteProduct(id);
      toast({
        title: t('common.success'),
        description: (res as { softDeleted?: boolean })?.softDeleted
          ? t('products.archived')
          : t('products.product_deleted'),
      });
      await refetch();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('products.failed_to_delete'),
        variant: 'destructive',
      });
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await updateProduct(id, { is_active: true });
      productUpdateEmitter.emit();
      toast({ title: t('common.success'), description: t('products.restored') });
      await refetch();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('products.failed_to_delete'),
        variant: 'destructive',
      });
    }
  };

  const buildCsv = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
    const escapeCell = (cell: any) => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(',')),
    ].join('\n');
    // BOM so Excel opens Uzbek text correctly
    return `\uFEFF${lines}`;
  };

  const buildCsvNoBom = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
    const escapeCell = (cell: any) => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    return [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(',')),
    ].join('\n');
  };

  const exportProductsCsv = async () => {
    if (exporting) return;
    try {
      setExporting(true);

      // Fetch a full set (not just what's currently loaded on screen)
      const status = statusFilter === 'all' ? 'all' : (statusFilter as 'active' | 'inactive');
      const stockStatus = stockFilter === 'all' ? 'all' : (stockFilter as 'low' | 'out');
      const productsAll = await getProducts(true, {
        searchTerm: searchTerm || undefined,
        categoryId: categoryFilter,
        status,
        stockStatus,
        marketplace: marketplaceFilter === 'all' ? 'all' : marketplaceFilter,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100000,
        offset: 0,
      } as any);

      const headers = [
        'Nomi',
        'SKU',
        'Artikul',
        'Shtrix-kod',
        'Kategoriya',
        'Birlik',
        'Sotib olish narxi',
        'Sotish narxi',
        'Qoldiq',
        'Min zaxira',
        'Holat',
        'Onlayn katalog',
        'Zaxira kuzatish',
        'Tavsif',
        'Rasm URL',
      ];

      const rows = (productsAll || []).map((p: any) => {
        const categoryName = p?.category?.name || p?.category_name || '';
        const unit = p?.unit || p?.unit_code || '';
        const active = p?.is_active === false || p?.is_active === 0 ? 'Nofaol' : 'Faol';
        const online = productShowInMarketplace(p) ? 'Ha' : 'Yoq';
        const track =
          p?.track_stock === false || p?.track_stock === 0 ? 'Yoq' : 'Ha';
        return [
          p?.name || '',
          p?.sku || '',
          p?.article || '',
          p?.barcode || '',
          categoryName,
          unit ? formatUnit(unit) : '',
          String(p?.purchase_price ?? ''),
          String(p?.sale_price ?? ''),
          String(p?.current_stock ?? ''),
          String(p?.min_stock_level ?? ''),
          active,
          online,
          track,
          String(p?.description ?? ''),
          String(p?.image_url ?? ''),
        ];
      });

      const content = buildCsv(headers, rows);
      const fileName = `products_${new Date().toISOString().slice(0, 10)}.csv`;

      if (isElectron()) {
        const api = requireElectron();
        const res = await handleIpcResponse<{ canceled: boolean; filePath?: string }>(
          api.files.saveTextFile({
            defaultFileName: fileName,
            content,
            filters: [{ name: 'CSV', extensions: ['csv'] }],
            encoding: 'utf8',
          })
        );
        if (!res?.canceled) {
          toast({ title: 'Muvaffaqiyatli', description: 'Mahsulotlar CSV eksport qilindi' });
        }
      } else {
        // Browser fallback
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast({ title: 'Muvaffaqiyatli', description: 'Mahsulotlar CSV eksport qilindi' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: 'Xatolik', description: msg || 'Eksportni bajarib bo‘lmadi', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const exportScaleCsv = async () => {
    if (exporting) return;
    try {
      setExporting(true);

      const status = statusFilter === 'all' ? 'all' : (statusFilter as 'active' | 'inactive');
      const stockStatus = stockFilter === 'all' ? 'all' : (stockFilter as 'low' | 'out');
      const productsAll = await getProducts(true, {
        searchTerm: searchTerm || undefined,
        categoryId: categoryFilter,
        status,
        stockStatus,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100000,
        offset: 0,
      } as any);

      const isKgUnit = (v: unknown) => {
        const s = String(v ?? '').trim().toLowerCase();
        return s === 'kg' || s.startsWith('kg') || s.includes('kilogram');
      };
      const kgProducts = (productsAll || []).filter((p: any) => {
        if (isKgUnit(p?.unit) || isKgUnit(p?.unit_code) || isKgUnit(p?.base_unit) || isKgUnit(p?.unit_symbol) || isKgUnit(p?.unit_name)) return true;
        const pu = Array.isArray(p?.product_units) ? p.product_units : [];
        return pu.some((u: any) => isKgUnit(u?.unit));
      });

      const toPlu = (p: any): string | null => {
        const candidates = [p?.sku, p?.barcode].map((v) => String(v ?? '').trim());
        for (const c of candidates) {
          if (!c) continue;
          if (/^\d+$/.test(c) && c.length >= 1 && c.length <= 6) {
            return c.padStart(5, '0');
          }
        }
        return null;
      };

      const totalAll = (productsAll || []).length;
      let skipped = 0;
      const rows: Array<[string, string, string]> = [];
      for (const p of kgProducts) {
        const plu = toPlu(p);
        if (!plu) { skipped += 1; continue; }
        const pricePerKg = Number(p?.sale_price ?? 0) || 0;
        rows.push([plu, String(p?.name || '').trim(), String(Math.round(pricePerKg))]);
      }
      const nonKgCount = totalAll - kgProducts.length;
      const scaleToastDesc = 'Tarozi: ' + rows.length + ' ta kg mahsulot. PLU yoq: ' + skipped + ' ta. Boshqa birlik: ' + nonKgCount + ' ta.';

      const headers = ['plu', 'name', 'price_per_kg'];
      const content = buildCsvNoBom(headers, rows);
      const fileName = 'scale_products_kg_' + new Date().toISOString().slice(0, 10) + '.csv';

      if (isElectron()) {
        const api = requireElectron();
        const res = await handleIpcResponse<{ canceled: boolean; filePath?: string }>(
          api.files.saveTextFile({
            defaultFileName: fileName,
            content,
            filters: [{ name: 'CSV', extensions: ['csv'] }],
            encoding: 'utf8',
          })
        );
        if (!res?.canceled) {
          toast({ title: 'Muvaffaqiyatli', description: scaleToastDesc });
        }
      } else {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast({ title: 'Muvaffaqiyatli', description: scaleToastDesc });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: 'Xatolik', description: msg || 'Eksport xatolik', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const downloadImportTemplate = async () => {
    const headers = [
      'Nomi',
      'SKU',
      'Artikul',
      'Shtrix-kod',
      'Kategoriya',
      'Birlik',
      'Sotib olish narxi',
      'Sotish narxi',
      'Qoldiq',
      'Min zaxira',
      'Holat',
      'Onlayn katalog',
      'Zaxira kuzatish',
      'Tavsif',
      'Rasm URL',
    ];
    const rows = [
      [
        'Sut 1L',
        'MILK-1L-001',
        'SUT-1L',
        '4780123456789',
        'Sut mahsulotlari',
        'pcs',
        '9000',
        '12000',
        '20',
        '5',
        'Faol',
        'Ha',
        'Ha',
        '1 litr sut',
        '',
      ],
      [
        'Guruch 1kg',
        'RICE-1KG-001',
        '',
        '',
        'Bakaleya',
        'kg',
        '13000',
        '16000',
        '50',
        '10',
        'Faol',
        'Ha',
        'Ha',
        '',
        'https://example.com/rice.jpg',
      ],
    ];
    const content = buildCsv(headers, rows);
    const fileName = `products_import_template.csv`;

    try {
      if (isElectron()) {
        const api = requireElectron();
        const res = await handleIpcResponse<{ canceled: boolean }>(
          api.files.saveTextFile({
            defaultFileName: fileName,
            content,
            filters: [{ name: 'CSV', extensions: ['csv'] }],
            encoding: 'utf8',
          })
        );
        if (!res?.canceled) {
          toast({ title: 'Muvaffaqiyatli', description: 'Import shabloni saqlandi' });
        }
      } else {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast({ title: 'Muvaffaqiyatli', description: 'Import shabloni yuklab olindi' });
      }
    } catch (e) {
      toast({
        title: 'Xatolik',
        description: e instanceof Error ? e.message : 'Shablonni saqlab bo‘lmadi',
        variant: 'destructive',
      });
    }
  };

  const parseCsv = (text: string): string[][] => {
    const s = String(text || '').replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const next = s[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(cell);
          cell = '';
        } else if (ch === '\n') {
          row.push(cell);
          cell = '';
          // Trim possible \r
          row = row.map((x) => x.replace(/\r$/, ''));
          // Skip empty trailing rows
          if (row.some((x) => String(x || '').trim() !== '')) rows.push(row);
          row = [];
        } else {
          cell += ch;
        }
      }
    }
    row.push(cell.replace(/\r$/, ''));
    if (row.some((x) => String(x || '').trim() !== '')) rows.push(row);
    return rows;
  };

  type ImportReviewItem = {
    id: string;
    rowIndex: number;
    include: boolean;
    name: string;
    sku: string;
    barcode: string;
    sale_price: number | null;
    payload: any;
    initial_stock: number;
    error?: string | null;
    display: {
      categoryName: string;
      unit: string;
      purchase_price: number;
      min_stock_level: number;
      is_active: boolean;
    };
  };

  type ImportReviewResult =
    | { action: 'confirm'; items: ImportReviewItem[] }
    | { action: 'cancel' };

  const openImportReview = (items: ImportReviewItem[]): Promise<ImportReviewResult> =>
    new Promise((resolve) => {
      reviewResolveRef.current = resolve;
      setReviewItems(items);
    });

  const closeImportReview = (result: ImportReviewResult) => {
    if (reviewResolveRef.current) {
      reviewResolveRef.current(result);
      reviewResolveRef.current = null;
    }
    setReviewItems(null);
    setReviewError(null);
  };

  const findHeaderIndex = (headers: string[], aliases: string[]) => {
    const set = new Set(aliases.map((a) => String(a).trim().toLowerCase()));
    return headers.findIndex((h) => set.has(String(h || '').trim().toLowerCase()));
  };

  const normalizeUnitToCode = (raw: string): string => {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return 'pcs';
    if (['pcs', 'dona'].includes(s)) return 'pcs';
    if (['kg', 'килограмм', 'килограм', 'килограмм.', 'килограм.'].includes(s)) return 'kg';
    if (['l', 'litr', 'литр'].includes(s)) return 'L';
    if (['ml', 'millilitr', 'миллилитр', 'mililitr'].includes(s)) return 'mL';
    if (['g', 'gramm', 'грамм'].includes(s)) return 'g';
    if (['m', 'metr', 'метр'].includes(s)) return 'm';
    if (['sqm', 'kv.m', 'kv m', 'm2', 'м2'].includes(s)) return 'sqm';
    if (['box', 'quti'].includes(s)) return 'box';
    if (['roll', 'rulon'].includes(s)) return 'roll';
    if (['bag', 'xalta'].includes(s)) return 'bag';
    if (['set', 'komplekt'].includes(s)) return 'set';
    // if user already provided a code, keep it
    return raw.trim();
  };

  const importProductsCsv = async () => {
    if (importing) return;
    if (!isElectron()) {
      toast({ title: 'Xatolik', description: 'Import faqat desktop ilovada mavjud', variant: 'destructive' });
      return;
    }

    try {
      setImporting(true);
      const api = requireElectron();

      const { canceled, content } = await handleIpcResponse<{ canceled: boolean; content?: string }>(
        api.files.openTextFile({
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          encoding: 'utf8',
        })
      );

      if (canceled || !content) return;

      const data = parseCsv(content);
      if (data.length < 2) {
        toast({ title: 'Xatolik', description: 'CSV fayl bo‘sh yoki noto‘g‘ri formatda', variant: 'destructive' });
        return;
      }

      const headers = data[0].map((h) => String(h || '').trim().toLowerCase());
      // Support BOTH Uzbek template/export headers and legacy English template headers
      const iName = findHeaderIndex(headers, ['nomi', 'name']);
      const iSku = findHeaderIndex(headers, ['sku']);
      const iArticle = findHeaderIndex(headers, ['artikul', 'article', 'article_number', 'vendor_code']);
      const iBarcode = findHeaderIndex(headers, ['shtrix-kod', 'barcode']);
      const iCategory = findHeaderIndex(headers, ['kategoriya', 'category']);
      const iUnit = findHeaderIndex(headers, ['birlik', 'unit']);
      const iPurchase = findHeaderIndex(headers, ['sotib olish narxi', 'purchase_price']);
      const iSale = findHeaderIndex(headers, ['sotish narxi', 'sale_price']);
      // Stock (initial/current) - Uzbek export uses "Qoldiq"
      const iStock = findHeaderIndex(headers, ['qoldiq', 'current_stock', 'initial_stock']);
      const iMin = findHeaderIndex(headers, ['min zaxira', 'min_stock_level']);
      const iActive = findHeaderIndex(headers, ['holat', 'is_active']);
      const iOnline = findHeaderIndex(headers, ['onlayn katalog', 'show_in_marketplace', 'marketplace']);
      const iTrack = findHeaderIndex(headers, ['zaxira kuzatish', 'track_stock']);
      const iDesc = findHeaderIndex(headers, ['tavsif', 'description']);
      const iImage = findHeaderIndex(headers, ['rasm url', 'image_url', 'rasm']);

      const parseYesNo = (raw: string, defaultVal: boolean) => {
        const v = String(raw || '').trim().toLowerCase();
        if (!v) return defaultVal;
        if (['0', 'false', 'yoq', "yo'q", 'off', 'nofaol'].includes(v)) return false;
        if (['1', 'true', 'ha', 'on', 'faol'].includes(v)) return true;
        return defaultVal;
      };

      if (iName < 0 || iSku < 0) {
        toast({
          title: 'Xatolik',
          description: "CSV sarlavhalari mos emas. Eksport qilingan CSV formatidan foydalaning (Nomi, SKU, ...).",
          variant: 'destructive',
        });
        return;
      }

      // Category name -> id map
      const catByName = new Map<string, string>();
      (categories || []).forEach((c) => {
        if (!c?.name || !c?.id) return;
        catByName.set(String(c.name).trim().toLowerCase(), String(c.id));
      });

      let created = 0;
      let skipped = 0;
      let failed = 0;
      const resultRows: Array<Array<string | number>> = [
        ['row', 'sku', 'name', 'status', 'error'],
      ];
      const reviewRows: ImportReviewItem[] = [];

      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        const name = String(row[iName] || '').trim();
        const sku = String(row[iSku] || '').trim();

        const categoryName = iCategory >= 0 ? String(row[iCategory] || '').trim() : '';
        const categoryId = categoryName ? catByName.get(categoryName.toLowerCase()) || null : null;

        const unitRaw = iUnit >= 0 ? String(row[iUnit] || '').trim() : 'pcs';
        const unit = normalizeUnitToCode(unitRaw) || 'pcs';

        // Normalize numeric strings:
        // - allow "1,5" (comma decimals) by converting commas to dots
        // - strip currency/spacing
        const toNumber = (v: any) => Number(String(v ?? '0').replace(/,/g, '.').replace(/[^\d.\-]/g, ''));

        const purchase_price = iPurchase >= 0 ? toNumber(row[iPurchase]) : 0;
        const sale_price = iSale >= 0 ? toNumber(row[iSale]) : 0;
        const min_stock_level = iMin >= 0 ? toNumber(row[iMin]) : 0;
        const initial_stock_raw = iStock >= 0 ? toNumber(row[iStock]) : 0;
        const initial_stock = Number.isFinite(initial_stock_raw) ? initial_stock_raw : 0;

        const activeRaw = iActive >= 0 ? String(row[iActive] || '').trim().toLowerCase() : 'faol';
        const is_active =
          activeRaw === '0' || activeRaw === 'false' || activeRaw === 'nofaol' || activeRaw === 'inactive'
            ? false
            : true;
        const show_in_marketplace =
          iOnline >= 0 ? parseYesNo(String(row[iOnline] || ''), true) : true;
        const track_stock =
          iTrack >= 0 ? parseYesNo(String(row[iTrack] || ''), true) : true;

        const imageRaw = iImage >= 0 ? String(row[iImage] || '').trim() : '';
        const image_url = imageRaw ? normalizeImportImageUrl(imageRaw) : null;
        if (imageRaw && !image_url) {
          failed += 1;
          continue;
        }

        const articleRaw = iArticle >= 0 ? String(row[iArticle] || '').trim() : '';
        const saleNum = Number.isFinite(sale_price) ? sale_price : 0;
        const purchaseNum = Number.isFinite(purchase_price) ? purchase_price : 0;
        const knownUnits = new Set([
          'pcs', 'kg', 'l', 'L', 'ml', 'mL', 'g', 'm', 'sqm', 'box', 'roll', 'bag', 'set',
        ]);
        let rowError: string | null = null;
        if (!name || !sku) {
          rowError = 'Name and SKU are required';
        } else if (purchaseNum < 0 || saleNum < 0) {
          rowError = 'Negative prices are not allowed';
        } else if (!(saleNum > 0)) {
          rowError = 'Sale price must be > 0';
        } else if (initial_stock < 0) {
          rowError = 'Initial stock must be >= 0';
        } else if (categoryName && !categoryId) {
          rowError = `Unknown category: ${categoryName}`;
        } else if (unitRaw && !knownUnits.has(unit) && unit === unitRaw.trim()) {
          // normalizeUnitToCode returned raw unchanged → unknown unit
          rowError = `Unknown unit: ${unitRaw}`;
        }

        const payload: any = {
          name,
          sku,
          article: articleRaw ? articleRaw.toUpperCase() : null,
          barcode: iBarcode >= 0 ? (String(row[iBarcode] || '').trim() || null) : null,
          description: iDesc >= 0 ? String(row[iDesc] || '').trim() || null : null,
          category_id: categoryId,
          unit,
          purchase_price: purchaseNum,
          sale_price: saleNum,
          min_stock_level: Number.isFinite(min_stock_level) ? min_stock_level : 0,
          track_stock,
          show_in_marketplace,
          image_url,
          is_active,
        };
        reviewRows.push({
          id: `row-${r}`,
          rowIndex: r,
          include: !rowError,
          name,
          sku,
          barcode: payload.barcode ? String(payload.barcode) : '',
          sale_price: saleNum,
          payload,
          initial_stock: initial_stock > 0 ? initial_stock : 0,
          error: rowError,
          display: {
            categoryName,
            unit,
            purchase_price: purchaseNum,
            min_stock_level: Number.isFinite(min_stock_level) ? min_stock_level : 0,
            is_active,
          },
        });
      }

      // Mark duplicate SKU/barcode within the import file as errors.
      const skuSeen = new Map<string, string>();
      const barcodeSeen = new Map<string, string>();
      for (const item of reviewRows) {
        const skuKey = item.sku.trim().toLowerCase();
        if (skuKey) {
          if (skuSeen.has(skuKey)) {
            item.error = item.error || `Duplicate SKU in file: ${item.sku}`;
            item.include = false;
          } else {
            skuSeen.set(skuKey, item.id);
          }
        }
        const bc = item.barcode.trim();
        if (bc) {
          const bcKey = bc.toLowerCase();
          if (barcodeSeen.has(bcKey)) {
            item.error = item.error || `Duplicate barcode in file: ${bc}`;
            item.include = false;
          } else {
            barcodeSeen.set(bcKey, item.id);
          }
        }
      }

      if (reviewRows.length === 0) {
        toast({ title: 'Xatolik', description: 'Import uchun mahsulot topilmadi', variant: 'destructive' });
        return;
      }

      const reviewResult = await openImportReview(reviewRows);
      if (reviewResult.action === 'cancel') {
        return;
      }

      for (const item of reviewResult.items) {
        if (!item.include || item.error) {
          skipped++;
          resultRows.push([
            item.rowIndex,
            item.sku,
            item.name,
            'skipped',
            item.error || 'unchecked',
          ]);
          continue;
        }

        const sale = Number(item.sale_price);
        if (!(sale > 0)) {
          skipped++;
          resultRows.push([item.rowIndex, item.sku, item.name, 'skipped', 'Sale price must be > 0']);
          continue;
        }

        const updatedPayload = {
          ...item.payload,
          name: item.name.trim(),
          sku: item.sku.trim(),
          barcode: item.barcode.trim() ? item.barcode.trim() : null,
          sale_price: sale,
        };

        try {
          // IMPORTANT: Use createProduct() so initial stock can be applied transactionally
          await createProduct(updatedPayload, item.initial_stock);
          created++;
          resultRows.push([item.rowIndex, item.sku, item.name, 'created', '']);
        } catch (e) {
          // SKU duplicate etc.
          failed++;
          resultRows.push([
            item.rowIndex,
            item.sku,
            item.name,
            'error',
            e instanceof Error ? e.message : String(e),
          ]);
        }
      }

      await refetch();
      toast({
        title: 'Import yakunlandi',
        description: `Qo‘shildi: ${created}, O‘tkazib yuborildi: ${skipped}, Xato: ${failed}`,
      });

      try {
        const csv = buildCsv(
          resultRows[0].map(String),
          resultRows.slice(1),
        );
        const api = requireElectron();
        await handleIpcResponse(
          api.files.saveTextFile({
            defaultPath: `products_import_result_${Date.now()}.csv`,
            content: csv,
            filters: [{ name: 'CSV', extensions: ['csv'] }],
          }),
        );
      } catch {
        // best-effort result download
      }
    } catch (e) {
      toast({
        title: 'Xatolik',
        description: e instanceof Error ? e.message : 'Importni bajarib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  // Always virtualize — non-virtual path re-rendered hundreds of rows on every scroll store write.
  const filteredProducts = searchInput.trim()
    ? filterProductsBySearchTerm(products, searchInput)
    : products;
  const detailOpen = Boolean(detailId);

  const openDetail = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('detail', id);
    setSearchParams(params);
  };

  const closeDetail = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('detail');
    setSearchParams(params, { replace: true });
  };

  const handleView = (id: string) => {
    setLastFocusedProductId(id);
    openDetail(id);
  };

  const listReturnPath = normalizeListPathAndQuery(location.pathname, searchParams);

  const persistListScrollBeforeLeave = () => {
    const scrollTop = useProductsListStore.getState().scrollTop;
    setStoredScrollTop(scrollTop);
    persistListScroll(
      listScrollStorageKey({
        userId: user?.id,
        branchId: (profile as { branch_id?: string } | null)?.branch_id,
        pathAndQuery: listReturnPath,
      }),
      scrollTop,
    );
  };

  const handleEdit = (id: string) => {
    setLastFocusedProductId(id);
    persistListScrollBeforeLeave();
    navigate(withReturnToPath(`/products/${id}/edit`, listReturnPath));
  };

  const handleNewProduct = () => {
    persistListScrollBeforeLeave();
    navigate(withReturnToPath('/products/new', listReturnPath));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('products.title')}</h1>
          <p className="page-heading-sub">{t('products.subtitle')}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Tabs value={statusFilter} onValueChange={(v) => updateFilter('status', v)}>
            <TabsList className="h-8 p-0.5">
              <TabsTrigger value="active" className="h-7 px-2.5 text-xs">
                {t('products.active_section')}
              </TabsTrigger>
              <TabsTrigger value="inactive" className="h-7 px-2.5 text-xs">
                {t('products.inactive_section')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={exporting || importing}>
                <FileDown className="mr-2 h-3.5 w-3.5" />
                Export / Import
                <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              <DropdownMenuItem disabled={exporting} onSelect={() => void exportProductsCsv()}>
                {exporting ? 'Eksport qilinmoqda...' : 'Eksport (CSV)'}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exporting} onSelect={() => void exportScaleCsv()}>
                Tarozi uchun eksport (CSV)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Import</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void downloadImportTemplate()}>
                Import shablon (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={importing} onSelect={() => void importProductsCsv()}>
                {importing ? 'Import qilinmoqda...' : 'Import (CSV)'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {statusFilter === 'active' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setBulkPriceOpen(true)}
            >
              <Percent className="mr-2 h-3.5 w-3.5" />
              Ommaviy narx yangilash
            </Button>
          )}
          {statusFilter === 'active' && (
            <Button size="sm" className="h-8 text-xs" onClick={handleNewProduct}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t('products.add_product')}
            </Button>
          )}
          </div>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('products.filters')}
            </span>
            <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
              <div className="relative h-8 w-[min(22rem,calc(100vw-8rem))] shrink-0">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('products.search_placeholder')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="h-8 py-1 pl-8 pr-8 text-xs sm:text-sm"
                  aria-label={t('products.search_placeholder')}
                />
                {searchInput ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2"
                    aria-label={t('products.clear_search')}
                    onClick={() => {
                      setSearchInput('');
                      const next = new URLSearchParams(searchParams);
                      next.delete('search');
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>
              <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
                <Select value={categoryFilter} onValueChange={(val) => updateFilter('category', val)}>
                  <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                    <SelectValue placeholder={t('products.all_categories')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('products.all_categories')}</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
                <Select
                  value={marketplaceFilter}
                  onValueChange={(val) => updateFilter('marketplace', val)}
                >
                  <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                    <SelectValue placeholder="Katalog" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha (katalog)</SelectItem>
                    <SelectItem value="online">{t('status.marketplace_on')}</SelectItem>
                    <SelectItem value="pos_only">{t('status.marketplace_off')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
                <Select value={stockFilter} onValueChange={(val) => updateFilter('stock', val)}>
                  <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                    <SelectValue placeholder={t('products.all_stock')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('products.all_stock')}</SelectItem>
                    <SelectItem value="low">{t('products.low_stock')}</SelectItem>
                    <SelectItem value="out">{t('products.out_of_stock')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
                <Select
                  value={`${sortBy}-${sortOrder}`}
                  onValueChange={(val) => {
                    const [field, order] = val.split('-');
                    const newParams = new URLSearchParams(searchParams);
                    if (field === 'name') newParams.delete('sortBy');
                    else newParams.set('sortBy', field);
                    if (order === 'asc') newParams.delete('sortOrder');
                    else newParams.set('sortOrder', order);
                    setSearchParams(newParams, { replace: true });
                  }}
                >
                  <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                    <SelectValue placeholder="Saralash" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name-asc">Nomi (A-Z)</SelectItem>
                    <SelectItem value="name-desc">Nomi (Z-A)</SelectItem>
                    <SelectItem value="sale_price-asc">Narx (Arzon)</SelectItem>
                    <SelectItem value="sale_price-desc">Narx (Qimmat)</SelectItem>
                    <SelectItem value="current_stock-asc">Qoldiq (Kam)</SelectItem>
                    <SelectItem value="current_stock-desc">Qoldiq (Ko'p)</SelectItem>
                    <SelectItem value="created_at-desc">Yangi qo'shilgan</SelectItem>
                    <SelectItem value="created_at-asc">Eski qo'shilgan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b px-4 py-2">
          <CardTitle className="text-base font-semibold">
            {statusFilter === 'inactive' ? t('products.inactive_section') : t('products.active_section')} ({filteredProducts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && products.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : error && products.length === 0 ? (
            <div className="space-y-3 py-12 text-center">
              <p className="font-medium text-destructive">
                {t('products.load_failed_title', { defaultValue: "Ma'lumot yuklanmadi" })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('products.load_failed_body', {
                  defaultValue: 'Server vaqtincha javob bermayapti',
                })}
              </p>
              {lastUpdatedAt && (
                <p className="text-xs text-muted-foreground">
                  {t('products.last_updated', { defaultValue: 'Oxirgi yangilanish' })}:{' '}
                  {lastUpdatedAt.toLocaleString()}
                </p>
              )}
              <Button type="button" variant="outline" onClick={() => void refetch()}>
                {t('common.retry', { defaultValue: 'Qayta urinish' })}
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {statusFilter === 'inactive' ? t('products.no_inactive_products') : t('products.no_products_found')}
              </p>
              {statusFilter === 'active' && (
                <Button className="mt-4" onClick={handleNewProduct}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('products.add_product')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {error && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span>
                    {t('products.load_failed_body', {
                      defaultValue: 'Server vaqtincha javob bermayapti',
                    })}
                  </span>
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void refetch()}>
                    {t('common.retry', { defaultValue: 'Qayta urinish' })}
                  </Button>
                </div>
              )}
              <VirtualizedProductsTable
                products={filteredProducts}
                t={t}
                statusFilter={statusFilter}
                hasMore={hasMore}
                loadingMore={loadingMore}
                loadMore={loadMore}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={(id, name) => void handleDelete(id, name)}
                onRestore={handleRestore}
                onHistory={(id) => {
                  const next = new URLSearchParams(searchParams);
                  next.set('detail', id);
                  next.set('tab', 'audit');
                  setSearchParams(next);
                }}
                showRestore={statusFilter === 'inactive'}
                initialScrollTop={restoreDone ? restoreScrollTop : undefined}
                onScrollTopChange={setStoredScrollTop}
              />
            </div>
          )}
        </CardContent>
      </Card>
      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDetail();
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-4xl p-0">
          <div className="h-full max-h-[90vh] overflow-y-auto p-6">
            {detailId && <ProductDetailContent productId={detailId} onClose={closeDetail} />}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={!!reviewItems}
        onOpenChange={(open) => {
          if (!open && reviewItems) {
            closeImportReview({ action: 'cancel' });
          }
        }}
      >
        <DialogContent className="sm:max-w-[1100px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import tasdiqlash</DialogTitle>
          </DialogHeader>
          {reviewItems && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">Jami qator: {reviewItems.length}</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Import</TableHead>
                    <TableHead>Nomi *</TableHead>
                    <TableHead>SKU *</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Sotish narxi</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead>Birlik</TableHead>
                    <TableHead>Sotib olish</TableHead>
                    <TableHead>Qoldiq</TableHead>
                    <TableHead>Holat</TableHead>
                    <TableHead>Xato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewItems.map((item) => (
                    <TableRow key={item.id} className={item.error ? 'bg-destructive/5' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={item.include && !item.error}
                          disabled={Boolean(item.error)}
                          onCheckedChange={(checked) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id
                                  ? { ...row, include: Boolean(checked) && !row.error }
                                  : row
                              ) || null
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-[180px]">
                        <Input
                          value={item.name}
                          onChange={(e) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id ? { ...row, name: e.target.value } : row
                              ) || null
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <Input
                          value={item.sku}
                          onChange={(e) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id ? { ...row, sku: e.target.value } : row
                              ) || null
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <Input
                          value={item.barcode}
                          onChange={(e) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id ? { ...row, barcode: e.target.value } : row
                              ) || null
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <MoneyInput
                          value={item.sale_price}
                          onValueChange={(val) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id ? { ...row, sale_price: val } : row
                              ) || null
                            )
                          }
                          placeholder="0"
                          allowZero={false}
                          min={0}
                        />
                      </TableCell>
                      <TableCell>{item.display.categoryName || '-'}</TableCell>
                      <TableCell>{item.display.unit || '-'}</TableCell>
                      <TableCell>{formatMoneyUZS(item.display.purchase_price)}</TableCell>
                      <TableCell>{item.initial_stock}</TableCell>
                      <TableCell>{item.display.is_active ? 'Faol' : 'Nofaol'}</TableCell>
                      <TableCell className="max-w-[12rem] text-xs text-destructive">
                        {item.error || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {reviewError && <div className="text-sm text-destructive">{reviewError}</div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => closeImportReview({ action: 'cancel' })}>
              Bekor qilish
            </Button>
            <Button
              onClick={() => {
                if (!reviewItems) return;
                const invalid = reviewItems.some(
                  (item) =>
                    item.include &&
                    !item.error &&
                    (!item.name.trim() ||
                      !item.sku.trim() ||
                      !(Number(item.sale_price) > 0))
                );
                if (invalid) {
                  setReviewError('Nomi, SKU va sotish narxi (>0) majburiy (tanlangan qatorlarda).');
                  return;
                }
                closeImportReview({ action: 'confirm', items: reviewItems });
              }}
            >
              Tasdiqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BulkPriceUpdateDialog
        open={bulkPriceOpen}
        onOpenChange={setBulkPriceOpen}
        categories={categories || []}
        defaultCategoryId={categoryFilter !== 'all' ? categoryFilter : undefined}
        onApplied={() => {
          void refetch();
        }}
      />
    </div>
  );
}
