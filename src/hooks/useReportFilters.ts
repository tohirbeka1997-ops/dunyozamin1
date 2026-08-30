import { useCallback } from 'react';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';

type Options = {
  storageKey: string;
  trackedKeys: string[];
  defaults?: Record<string, string>;
};

/**
 * Report sahifalari uchun URL + sessionStorage filtr sinxronizatsiyasi.
 */
export function useReportFilters({ storageKey, trackedKeys, defaults = {} }: Options) {
  const { searchParams, updateParams, restored } = useSessionSearchParams({
    storageKey,
    trackedKeys,
  });

  const get = useCallback(
    (key: string, fallback = '') => searchParams.get(key) ?? defaults[key] ?? fallback,
    [searchParams, defaults],
  );

  const set = useCallback(
    (updates: Record<string, string | null | undefined>, replace = true) => {
      const mapped: Record<string, string | null> = {};
      for (const [key, raw] of Object.entries(updates)) {
        if (raw == null || raw === '') {
          mapped[key] = null;
        } else {
          mapped[key] = String(raw);
        }
      }
      updateParams(mapped, { replace });
    },
    [updateParams],
  );

  return { searchParams, updateParams, restored, get, set };
}
