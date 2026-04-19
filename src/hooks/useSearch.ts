import { useState, useEffect, useRef, useCallback } from 'react';
import { addRecentSearch } from '@/utils/recentSearches';

export interface UseSearchOptions<T> {
  /** Fetch function called with the debounced search term */
  fetcher: (term: string) => Promise<T[]>;
  /** Debounce delay in ms (default: 200) */
  debounceMs?: number;
  /** Minimum term length before firing the fetcher (default: 1) */
  minLength?: number;
  /** Context key for recent searches (if provided, saves to history) */
  recentSearchContext?: string;
}

export interface UseSearchResult<T> {
  term: string;
  setTerm: (value: string) => void;
  results: T[];
  loading: boolean;
  error: string | null;
  clear: () => void;
}

export function useSearch<T>({
  fetcher,
  debounceMs = 200,
  minLength = 1,
  recentSearchContext,
}: UseSearchOptions<T>): UseSearchResult<T> {
  const [term, setTermState] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (value: string) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const data = await fetcher(value);
        if (seqRef.current === seq) {
          setResults(data);
          if (recentSearchContext && value.trim().length >= 2) {
            addRecentSearch(recentSearchContext, value.trim());
          }
        }
      } catch (err) {
        if (seqRef.current === seq) {
          setError(err instanceof Error ? err.message : 'Search error');
          setResults([]);
        }
      } finally {
        if (seqRef.current === seq) {
          setLoading(false);
        }
      }
    },
    [fetcher, recentSearchContext]
  );

  const setTerm = useCallback(
    (value: string) => {
      setTermState(value);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!value || value.trim().length < minLength) {
        seqRef.current++;
        setResults([]);
        setLoading(false);
        return;
      }
      timerRef.current = setTimeout(() => {
        runSearch(value.trim());
      }, debounceMs);
    },
    [runSearch, debounceMs, minLength]
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    seqRef.current++;
    setTermState('');
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { term, setTerm, results, loading, error, clear };
}
