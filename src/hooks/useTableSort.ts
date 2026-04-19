import { useCallback, useState } from 'react';

export type SortValueKind = 'string' | 'number';

/**
 * Ustun bosilganda: bir xil ustun bo‘lsa tartib almashtiriladi, boshqasi bo‘lsa
 * raqamli ustunlar uchun odatda desc, matn uchun asc boshlanadi.
 */
export function useTableSort<K extends string>(initialKey: K, initialOrder: 'asc' | 'desc') {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialOrder);

  const toggleSort = useCallback((key: K, kind: SortValueKind) => {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder(kind === 'number' ? 'desc' : 'asc');
    }
  }, [sortKey]);

  return { sortKey, sortOrder, toggleSort, setSortKey, setSortOrder };
}
