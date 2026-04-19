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
import { Badge } from '@/components/ui/badge';
import { createProduct, deleteProduct, getProducts, updateProduct, productUpdateEmitter } from '@/db/api';
import { useProducts } from '@/hooks/useProducts';
import type { ProductWithCategory } from '@/types/database';
import { Plus, Search, Pencil, Trash2, Eye, AlertTriangle, Package, FileDown, ChevronDown, RotateCcw } from 'lucide-react';
import { highlightMatch } from '@/utils/searchHighlight';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function Products() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const confirmDialog = useConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const listQueryParams = new URLSearchParams(searchParams);
  listQueryParams.delete('detail');
  const listQueryKey = listQueryParams.toString();
  const detailId = searchParams.get('detail');
  const filtersRestoredRef = useRef(false);
  const FILTERS_STORAGE_KEY = 'products.filters.query';
  const FILTER_QUERY_KEYS = ['search', 'category', 'status', 'stock', 'sortBy', 'sortOrder'];
  const [restoreNonce, setRestoreNonce] = useState(0);
  const refetchRef = useRef<(() => Promise<void>) | null>(null);
  const storedQueryKey = useProductsListStore((state) => state.queryKey);
  const storedFiltersQuery = useProductsListStore((state) => state.filtersQuery);
  const storedPage = useProductsListStore((state) => state.page);
  const storedScrollTop = useProductsListStore((state) => state.scrollTop);
  const setStoredPage = useProductsListStore((state) => state.setPage);
  const setStoredScrollTop = useProductsListStore((state) => state.setScrollTop);
  const setStoredFiltersQuery = useProductsListStore((state) => state.setFiltersQuery);
  const setStoredPageSize = useProductsListStore((state) => state.setPageSize);
  const setLastFocusedProductId = useProductsListStore((state) => state.setLastFocusedProductId);
  const resetForQuery = useProductsListStore((state) => state.resetForQuery);
  const [restoreDone, setRestoreDone] = useState(false);
  const PAGE_SIZE = 200;
  
  // Read filters from URL query params (persistent across navigation)
  const searchTerm = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || 'all';
  const statusFilter = searchParams.get('status') || 'active';
  const stockFilter = searchParams.get('stock') || 'all';
  const sortBy = (searchParams.get('sortBy') || 'name') as 'name' | 'sku' | 'created_at' | 'current_stock' | 'sale_price';
  const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';
  
  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);

  useEffect(() => {
    setRestoreDone(false);
  }, [listQueryKey]);

  useEffect(() => {
    setStoredPageSize(PAGE_SIZE);
  }, [setStoredPageSize]);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
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
  const { products, categories, loading, loadingMore, error, refetch, loadMore, hasMore, page } = useProducts(true, {
    searchTerm: searchTerm || undefined,
    categoryId: categoryFilter !== 'all' ? categoryFilter : undefined,
    status: statusFilter === 'all' ? 'all' : (statusFilter as 'active' | 'inactive'),
    stockStatus: stockFilter === 'all' ? 'all' : (stockFilter as 'low' | 'out'),
    sortBy,
    sortOrder,
  }, PAGE_SIZE);

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
    setRestoreDone(true);
  }, [restoreDone, loading, loadingMore, page, targetPage, hasMore, loadMore]);

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) return;
    setStoredPage(page);
  }, [page, storedQueryKey, listQueryKey, setStoredPage]);

  // Infinite scroll sentinel
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    if (!hasMore) return;

    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (loading || loadingMore) return;
        if (!hasMore) return;
        // Fire and forget (useProducts has its own internal guards/debounce)
        void loadMore();
      },
      {
        root: null, // viewport
        rootMargin: '200px', // start loading a bit before reaching the bottom
        threshold: 0,
      }
    );

    observerRef.current.observe(el);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [hasMore, loading, loadingMore, loadMore]);

  // Show error toast if loading fails
  useEffect(() => {
    if (error) {
      toast({
        title: t('common.error'),
        description: t('products.failed_to_load'),
        variant: 'destructive',
      });
    }
  }, [error, toast, t]);

  const handleDelete = async (id: string, name: string) => {
    // Avoid native `window.confirm()` which can leave the UI "blocked" in Electron.
    const ok = await confirmDialog({
      title: t('common.confirm'),
      description: t('products.delete_confirm', { name }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await deleteProduct(id);
      toast({
        title: t('common.success'),
        description: (res as { softDeleted?: boolean })?.softDeleted ? t('products.archived') : t('products.product_deleted'),
      });
      // Trigger product refetch
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
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100000,
        offset: 0,
      } as any);

      const headers = [
        'Nomi',
        'SKU',
        'Shtrix-kod',
        'Kategoriya',
        'Birlik',
        'Sotib olish narxi',
        'Sotish narxi',
        'Qoldiq',
        'Min zaxira',
        'Holat',
      ];

      const rows = (productsAll || []).map((p: any) => {
        const categoryName = p?.category?.name || p?.category_name || '';
        const unit = p?.unit || p?.unit_code || '';
        const active = p?.is_active === false || p?.is_active === 0 ? 'Nofaol' : 'Faol';
        return [
          p?.name || '',
          p?.sku || '',
          p?.barcode || '',
          categoryName,
          unit ? formatUnit(unit) : '',
          String(p?.purchase_price ?? ''),
          String(p?.sale_price ?? ''),
          String(p?.current_stock ?? ''),
          String(p?.min_stock_level ?? ''),
          active,
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
      'Shtrix-kod',
      'Kategoriya',
      'Birlik',
      'Sotib olish narxi',
      'Sotish narxi',
      'Qoldiq',
      'Min zaxira',
      'Holat',
    ];
    const rows = [
      ['Sut 1L', 'MILK-1L-001', '4780123456789', 'Sut mahsulotlari', 'pcs', '9000', '12000', '20', '5', 'Faol'],
      ['Guruch 1kg', 'RICE-1KG-001', '', 'Bakaleya', 'kg', '13000', '16000', '50', '10', 'Faol'],
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
      const iBarcode = findHeaderIndex(headers, ['shtrix-kod', 'barcode']);
      const iCategory = findHeaderIndex(headers, ['kategoriya', 'category']);
      const iUnit = findHeaderIndex(headers, ['birlik', 'unit']);
      const iPurchase = findHeaderIndex(headers, ['sotib olish narxi', 'purchase_price']);
      const iSale = findHeaderIndex(headers, ['sotish narxi', 'sale_price']);
      // Stock (initial/current) - Uzbek export uses "Qoldiq"
      const iStock = findHeaderIndex(headers, ['qoldiq', 'current_stock', 'initial_stock']);
      const iMin = findHeaderIndex(headers, ['min zaxira', 'min_stock_level']);
      const iActive = findHeaderIndex(headers, ['holat', 'is_active']);

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

        const payload: any = {
          name,
          sku,
          barcode: iBarcode >= 0 ? (String(row[iBarcode] || '').trim() || null) : null,
          description: null,
          category_id: categoryId,
          unit,
          purchase_price: Number.isFinite(purchase_price) ? purchase_price : 0,
          sale_price: Number.isFinite(sale_price) ? sale_price : 0,
          min_stock_level: Number.isFinite(min_stock_level) ? min_stock_level : 0,
          track_stock: true,
          image_url: null,
          is_active,
        };
        reviewRows.push({
          id: `row-${r}`,
          rowIndex: r,
          include: true,
          name,
          sku,
          barcode: payload.barcode ? String(payload.barcode) : '',
          sale_price: Number.isFinite(payload.sale_price) ? Number(payload.sale_price) : 0,
          payload,
          initial_stock: initial_stock > 0 ? initial_stock : 0,
          display: {
            categoryName,
            unit,
            purchase_price: Number.isFinite(purchase_price) ? purchase_price : 0,
            min_stock_level: Number.isFinite(min_stock_level) ? min_stock_level : 0,
            is_active,
          },
        });
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
        if (!item.include) {
          skipped++;
          continue;
        }

        const updatedPayload = {
          ...item.payload,
          name: item.name.trim(),
          sku: item.sku.trim(),
          barcode: item.barcode.trim() ? item.barcode.trim() : null,
          sale_price: Number.isFinite(item.sale_price) ? Number(item.sale_price) : 0,
        };

        try {
          // IMPORTANT: Use createProduct() so initial stock can be applied transactionally
          await createProduct(updatedPayload, item.initial_stock);
          created++;
        } catch (e) {
          // SKU duplicate etc.
          failed++;
        }
      }

      await refetch();
      toast({
        title: 'Import yakunlandi',
        description: `Qo‘shildi: ${created}, O‘tkazib yuborildi: ${skipped}, Xato: ${failed}`,
      });
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

  const getStockStatus = (product: ProductWithCategory) => {
    if (product.current_stock <= 0) {
      return { label: t('products.out_of_stock_label'), color: 'bg-destructive text-destructive-foreground' };
    }
    if (product.current_stock <= product.min_stock_level) {
      return { label: t('products.low_stock_label'), color: 'bg-warning text-warning-foreground' };
    }
    return { label: t('products.in_stock_label'), color: 'bg-success text-success-foreground' };
  };

  // Products are already filtered and sorted by useProducts hook based on filters passed to it
  const filteredProducts = products;
  const useVirtualized = filteredProducts.length > 500;
  const detailOpen = Boolean(detailId);

  const getScrollContainer = () => document.querySelector('main') as HTMLElement | null;

  useEffect(() => {
    if (useVirtualized) return;
    let ticking = false;
    const handleScroll = (event?: Event) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const target = (event?.currentTarget || event?.target) as HTMLElement | null;
        const scrollTop = target?.scrollTop ?? getScrollContainer()?.scrollTop ?? window.scrollY ?? 0;
        setStoredScrollTop(scrollTop);
        ticking = false;
      });
    };
    const scrollEl = getScrollContainer();
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollEl.removeEventListener('scroll', handleScroll);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [useVirtualized, setStoredScrollTop]);

  useEffect(() => {
    if (!restoreDone) return;
    if (useVirtualized) return;
    if (storedScrollTop <= 0) return;
    requestAnimationFrame(() => {
      const scrollEl = getScrollContainer();
      if (scrollEl) {
        scrollEl.scrollTop = storedScrollTop;
        return;
      }
      window.scrollTo(0, storedScrollTop);
    });
  }, [restoreDone, useVirtualized, storedScrollTop]);

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
    if (!useVirtualized) {
      const scrollTop = getScrollContainer()?.scrollTop ?? window.scrollY ?? 0;
      setStoredScrollTop(scrollTop);
    }
    setLastFocusedProductId(id);
    openDetail(id);
  };

  const handleEdit = (id: string) => {
    if (!useVirtualized) {
      const scrollTop = getScrollContainer()?.scrollTop ?? window.scrollY ?? 0;
      setStoredScrollTop(scrollTop);
    }
    navigate(`/products/${id}/edit`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('products.title')}</h1>
          <p className="text-muted-foreground">{t('products.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <Tabs value={statusFilter} onValueChange={(v) => updateFilter('status', v)}>
            <TabsList>
              <TabsTrigger value="active">{t('products.active_section')}</TabsTrigger>
              <TabsTrigger value="inactive">{t('products.inactive_section')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={exporting || importing}>
                <FileDown className="h-4 w-4 mr-2" />
                Export / Import
                <ChevronDown className="h-4 w-4 ml-2 opacity-70" />
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
            <Button onClick={() => navigate('/products/new')}>
              <Plus className="h-4 w-4 mr-2" />
              {t('products.add_product')}
            </Button>
          )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('products.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('products.search_placeholder')}
                value={searchTerm}
                onChange={(e) => updateFilter('search', e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(val) => updateFilter('category', val)}>
              <SelectTrigger>
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
            <Select value={stockFilter} onValueChange={(val) => updateFilter('stock', val)}>
              <SelectTrigger>
                <SelectValue placeholder={t('products.all_stock')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('products.all_stock')}</SelectItem>
                <SelectItem value="low">{t('products.low_stock')}</SelectItem>
                <SelectItem value="out">{t('products.out_of_stock')}</SelectItem>
              </SelectContent>
            </Select>
            <Select 
              value={`${sortBy}-${sortOrder}`} 
              onValueChange={(val) => {
                const [field, order] = val.split('-');
                const newParams = new URLSearchParams(searchParams);
                if (field === 'name') newParams.delete('sortBy'); else newParams.set('sortBy', field);
                if (order === 'asc') newParams.delete('sortOrder'); else newParams.set('sortOrder', order);
                setSearchParams(newParams, { replace: true });
              }}
            >
              <SelectTrigger>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === 'inactive' ? t('products.inactive_section') : t('products.active_section')} ({filteredProducts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {statusFilter === 'inactive' ? t('products.no_inactive_products') : t('products.no_products_found')}
              </p>
              {statusFilter === 'active' && (
                <Button className="mt-4" onClick={() => navigate('/products/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('products.add_product')}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto space-y-3">
              {useVirtualized ? (
                <VirtualizedProductsTable
                  products={filteredProducts}
                  t={t}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  loadMore={loadMore}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={(id, name) => void handleDelete(id, name)}
                  onRestore={handleRestore}
                  showRestore={statusFilter === 'inactive'}
                  initialScrollTop={restoreDone && storedQueryKey === listQueryKey ? storedScrollTop : 0}
                  onScrollTopChange={setStoredScrollTop}
                />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.product_name')}</TableHead>
                        <TableHead>{t('products.sku')} / {t('products.barcode')}</TableHead>
                        <TableHead>{t('products.category')}</TableHead>
                        <TableHead>{t('products.unit')}</TableHead>
                        <TableHead className="text-right">{t('products.purchase_price')}</TableHead>
                        <TableHead className="text-right">{t('products.sale_price')}</TableHead>
                        <TableHead className="text-right">{t('pos.stock')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                        <TableHead className="text-right">{t('common.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => {
                        const stockStatus = getStockStatus(product);
                        return (
                          <TableRow key={product.id}>
                            <TableCell className="whitespace-normal align-top max-w-[min(100%,36rem)]">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="h-10 w-10 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                                  {product.image_url ? (
                                    <img
                                      src={getProductImageDisplayUrl(product.image_url) || product.image_url}
                                      alt={product.name}
                                      className="h-full w-full object-cover rounded"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <Package className="h-5 w-5 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium break-words">
                                    {searchTerm ? highlightMatch(product.name, searchTerm) : product.name}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <p className="font-mono">
                                  {searchTerm ? highlightMatch(product.sku, searchTerm) : product.sku}
                                </p>
                                {product.barcode && (
                                  <p className="text-xs text-muted-foreground font-mono">
                                    {searchTerm ? highlightMatch(product.barcode, searchTerm) : product.barcode}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {product.category?.name || (product as any).category_name ? (
                                <Badge variant="outline">
                                  {product.category?.name || (product as any).category_name}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>{formatUnit(product.unit)}</TableCell>
                            <TableCell className="text-right">
                              {formatMoneyUZS(product.purchase_price)}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatMoneyUZS(product.sale_price)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {product.current_stock <= product.min_stock_level && (
                                  <AlertTriangle className="h-4 w-4 text-warning" />
                                )}
                                <span className="font-medium">{formatNumberUZ(product.current_stock)}</span>
                                <span className="text-xs text-muted-foreground">{formatUnit(product.unit)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Badge variant={product.is_active ? 'default' : 'secondary'}>
                                  {product.is_active ? t('common.active') : t('common.inactive')}
                                </Badge>
                                <Badge className={stockStatus.color} variant="secondary">
                                  {stockStatus.label}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleView(product.id)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEdit(product.id)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {statusFilter === 'inactive' ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRestore(product.id)}
                                    title={t('products.restore')}
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(product.id, product.name)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination / Load more */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-xs text-muted-foreground">
                      Yuklangan: <span className="font-medium">{products.length}</span>
                    </p>
                    {hasMore ? (
                      <Button variant="outline" onClick={() => loadMore()} disabled={loadingMore}>
                        {loadingMore ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                            Yuklanmoqda...
                          </>
                        ) : (
                          'Yana yuklash'
                        )}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Barchasi yuklandi</span>
                    )}
                  </div>

                  {/* Infinite scroll sentinel (auto-load) */}
                  <div ref={loadMoreRef} className="h-1 w-full" />
                </>
              )}
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={item.include}
                          onCheckedChange={(checked) =>
                            setReviewItems((prev) =>
                              prev?.map((row) =>
                                row.id === item.id ? { ...row, include: Boolean(checked) } : row
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
                        />
                      </TableCell>
                      <TableCell>{item.display.categoryName || '-'}</TableCell>
                      <TableCell>{item.display.unit || '-'}</TableCell>
                      <TableCell>{formatMoneyUZS(item.display.purchase_price)}</TableCell>
                      <TableCell>{formatNumberUZ(item.initial_stock)}</TableCell>
                      <TableCell>{item.display.is_active ? 'Faol' : 'Nofaol'}</TableCell>
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
                  (item) => item.include && (!item.name.trim() || !item.sku.trim())
                );
                if (invalid) {
                  setReviewError('Nomi va SKU majburiy (tanlangan qatorlarda).');
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
    </div>
  );
}
