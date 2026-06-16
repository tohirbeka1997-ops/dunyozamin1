import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';

interface Options {
  delay?: number;
  enabled?: boolean;
  /** Clear result list when `enabled` becomes false (e.g. modal closed). */
  clearWhenDisabled?: boolean;
}

/**
 * Debounced search that keeps the previous result set visible while fetching,
 * so list scroll position is not reset by an empty intermediate state.
 */
export function useDebouncedSearch<T>(
  query: string,
  fetcher: (q: string) => Promise<T[]>,
  options: Options = {},
): { results: T[]; searching: boolean; error: string | null } {
  const { delay = 250, enabled = true, clearWhenDisabled = false } = options;
  const [results, setResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1;
      setSearching(false);
      if (clearWhenDisabled) {
        setResults([]);
        setError(null);
      }
      return;
    }
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      setSearching(true);
      setError(null);
      void fetcher(query)
        .then((rows) => {
          if (requestId.current !== id) return;
          setResults(Array.isArray(rows) ? rows : []);
          setError(null);
        })
        .catch((e) => {
          if (requestId.current !== id) return;
          setError(e instanceof Error ? e.message : t('networkError'));
        })
        .finally(() => {
          if (requestId.current === id) setSearching(false);
        });
    }, delay);
    return () => clearTimeout(handle);
  }, [query, fetcher, delay, enabled]);

  return { results, searching, error };
}
