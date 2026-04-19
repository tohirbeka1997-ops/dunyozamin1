import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type Primitive = string | number | boolean | null | undefined;

type Options = {
  storageKey: string;
  trackedKeys: string[];
  preserveKeysOnRestore?: string[];
};

export function useSessionSearchParams({
  storageKey,
  trackedKeys,
  preserveKeysOnRestore = [],
}: Options) {
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState(false);

  const hasTrackedParams = useMemo(
    () => trackedKeys.some((key) => searchParams.has(key)),
    [searchParams, trackedKeys]
  );

  useEffect(() => {
    if (restoredRef.current) return;

    if (hasTrackedParams) {
      restoredRef.current = true;
      setRestored(true);
      return;
    }

    const saved = sessionStorage.getItem(storageKey);
    if (!saved) {
      restoredRef.current = true;
      setRestored(true);
      return;
    }

    const next = new URLSearchParams(saved);
    preserveKeysOnRestore.forEach((key) => {
      const currentValue = searchParams.get(key);
      if (currentValue !== null) {
        next.set(key, currentValue);
      }
    });

    restoredRef.current = true;
    setRestored(true);
    setSearchParams(next, { replace: true });
  }, [hasTrackedParams, preserveKeysOnRestore, searchParams, setSearchParams, storageKey]);

  useEffect(() => {
    if (!restoredRef.current) return;

    const params = new URLSearchParams();
    trackedKeys.forEach((key) => {
      const value = searchParams.get(key);
      if (value !== null && value !== '') {
        params.set(key, value);
      }
    });

    const query = params.toString();
    if (query) {
      sessionStorage.setItem(storageKey, query);
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [searchParams, storageKey, trackedKeys]);

  const updateParams = (
    updates: Record<string, Primitive>,
    options?: { replace?: boolean }
  ) => {
    const next = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, rawValue]) => {
      if (
        rawValue === undefined ||
        rawValue === null ||
        rawValue === '' ||
        rawValue === 'all'
      ) {
        next.delete(key);
      } else {
        next.set(key, String(rawValue));
      }
    });

    setSearchParams(next, { replace: options?.replace ?? true });
  };

  const clearTrackedParams = (options?: { replace?: boolean }) => {
    const next = new URLSearchParams(searchParams);
    trackedKeys.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: options?.replace ?? true });
  };

  return {
    searchParams,
    setSearchParams,
    updateParams,
    clearTrackedParams,
    restored,
  };
}
