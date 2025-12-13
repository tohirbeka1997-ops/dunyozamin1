import { useState, useEffect, useCallback } from 'react';
import { getProducts, getCategories, productUpdateEmitter } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';

export function useProducts(includeInactive = true) {
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadData = useCallback(async () => {
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
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

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

