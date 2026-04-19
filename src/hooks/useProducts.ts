import { useState, useEffect, useCallback, useRef } from 'react';
import { getProducts, getCategories, productUpdateEmitter } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import type { ProductWithCategory, Category } from '@/types/database';

export function useProducts(
  includeInactive = true,
  filters?: {
    searchTerm?: string;
    categoryId?: string;
    status?: 'active' | 'inactive' | 'all';
    stockStatus?: 'all' | 'low' | 'out';
    // NOTE: sort fields must be supported by backend ProductsService.list allowedSortFields.
    sortBy?: 'name' | 'sku' | 'created_at' | 'current_stock' | 'sale_price';
    sortOrder?: 'asc' | 'desc';
  },
  pageSize: number = 200
) {
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Use refs to track loading state and prevent infinite loops
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef(0);
  const LOAD_DEBOUNCE_MS = 500; // Minimum time between loads

  const loadData = useCallback(async (opts?: { append?: boolean; pageOverride?: number; force?: boolean }) => {
    // Don't load if auth is still loading or user is not authenticated
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    // Prevent rapid successive calls (skip debounce when force=true, e.g. after delete)
    const now = Date.now();
    if (!opts?.force && (isLoadingRef.current || (now - lastLoadTimeRef.current < LOAD_DEBOUNCE_MS))) {
      return;
    }

    isLoadingRef.current = true;
    lastLoadTimeRef.current = now;

    try {
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const effectivePage = opts?.pageOverride ?? 0;
      const offset = effectivePage * pageSize;
      const [productsData, categoriesData] = await Promise.all([
        getProducts(includeInactive, {
          ...(filters || {}),
          limit: pageSize,
          offset,
        }),
        getCategories(),
      ]);
      const term = String(filters?.searchTerm || '').trim().toLowerCase();
      const prioritize = (items: ProductWithCategory[]) => {
        const getRank = (p: ProductWithCategory) => {
          const name = String(p.name || '').toLowerCase();
          const sku = String(p.sku || '').toLowerCase();
          const barcode = String(p.barcode || '').toLowerCase();
          if (term && (sku === term || barcode === term || name === term)) return 0;
          if (term && (sku.startsWith(term) || barcode.startsWith(term) || name.startsWith(term))) return 1;
          return 2;
        };
        return items
          .map((p, idx) => ({ p, idx, rank: getRank(p) }))
          .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
          .map((x) => x.p);
      };
      const nextProducts = term ? prioritize(productsData) : productsData;
      setProducts((prev) => (opts?.append ? [...prev, ...nextProducts] : nextProducts));
      setCategories(categoriesData);
      setPage(effectivePage);
      setHasMore(Array.isArray(productsData) && productsData.length >= pageSize);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load products');
      console.error('Error loading products:', error);
      setError(error);
      // Don't throw - let UI handle error state
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [includeInactive, authLoading, user, pageSize, filters?.searchTerm, filters?.categoryId, filters?.status, filters?.stockStatus, filters?.sortBy, filters?.sortOrder]);

  // Store latest loadData in a ref to use in subscription handler
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  // Initial load - wait for auth to be ready
  // Only run when auth state or includeInactive changes, NOT when loadData changes
  useEffect(() => {
    if (!authLoading && user) {
      loadData({ append: false, pageOverride: 0 });
    }
  }, [authLoading, user, includeInactive, filters?.searchTerm, filters?.categoryId, filters?.status, filters?.stockStatus, filters?.sortBy, filters?.sortOrder, pageSize]); // keep stable, avoids infinite loops

  // Subscribe to product update events
  // Use ref to access latest loadData without re-subscribing
  useEffect(() => {
    let isMounted = true;
    let updateTimeout: NodeJS.Timeout | null = null;
    
    const handleUpdate = () => {
      if (isMounted && !isLoadingRef.current) {
        // Debounce updates to prevent rapid successive calls
        if (updateTimeout) {
          clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
          if (isMounted && !isLoadingRef.current) {
            loadDataRef.current({ append: false, pageOverride: 0 }).catch((err) => {
              console.error('Failed to refetch products:', err);
            });
          }
        }, LOAD_DEBOUNCE_MS);
      }
    };

    const unsubscribe = productUpdateEmitter.subscribe(handleUpdate);

    return () => {
      isMounted = false;
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      unsubscribe();
    };
  }, []); // Empty dependency array - subscribe once, use ref for latest loadData

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || isLoadingRef.current || !hasMore) return;
    await loadData({ append: true, pageOverride: page + 1 });
  }, [loadData, page, hasMore, loading, loadingMore]);

  return {
    products,
    categories,
    loading,
    loadingMore,
    error,
    refetch: () => loadData({ append: false, pageOverride: 0, force: true }),
    loadMore,
    hasMore,
    page,
  };
}

