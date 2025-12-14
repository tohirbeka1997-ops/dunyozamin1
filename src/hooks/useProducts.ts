import { useState, useEffect, useCallback } from 'react';
import { getProducts, getCategories, productUpdateEmitter } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import type { ProductWithCategory, Category } from '@/types/database';

export function useProducts(includeInactive = true) {
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadData = useCallback(async () => {
    // Don't load if auth is still loading or user is not authenticated
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [productsData, categoriesData] = await Promise.all([
        getProducts(includeInactive),
        getCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load products');
      console.error('Error loading products:', error);
      setError(error);
      // Don't throw - let UI handle error state
    } finally {
      setLoading(false);
    }
  }, [includeInactive, authLoading, user]);

  // Initial load - wait for auth to be ready
  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  // Subscribe to product update events
  useEffect(() => {
    const unsubscribe = productUpdateEmitter.subscribe(() => {
      // Refetch products when inventory changes
      loadData().catch((err) => {
        console.error('Failed to refetch products:', err);
      });
    });

    return unsubscribe;
  }, [loadData]);

  return {
    products,
    categories,
    loading,
    error,
    refetch: loadData,
  };
}

