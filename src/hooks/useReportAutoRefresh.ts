import { useEffect, useRef } from 'react';
import { productUpdateEmitter } from '@/db/api';

/**
 * Auto-refresh helper for report pages.
 *
 * Why: many report pages load data only on mount / filter change, so when a sale/return/purchase
 * happens elsewhere, the report UI can look stale. This hook refreshes on:
 * - productUpdateEmitter (emitted after sales/returns/purchases/stock changes)
 * - window focus
 * - document visibility change (tab becomes visible)
 */
export function useReportAutoRefresh(refresh: () => void | Promise<void>) {
  const refreshRef = useRef(refresh);

  // Always keep latest callback (avoid stale closures)
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const handle = () => {
      // Auto-refresh failures used to be swallowed silently. That hid
      // real bugs — a broken refresh would just stop updating without
      // any signal in DevTools. Catch unhandled promise rejections from
      // the async path too, since `void p.catch(...)` was missing here.
      try {
        const result = refreshRef.current?.();
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch((err) => {
            console.warn('[useReportAutoRefresh] refresh failed:', err);
          });
        }
      } catch (err) {
        console.warn('[useReportAutoRefresh] refresh threw:', err);
      }
    };

    const unsub = productUpdateEmitter.subscribe(handle);

    window.addEventListener('focus', handle);
    document.addEventListener('visibilitychange', handle);

    return () => {
      unsub?.();
      window.removeEventListener('focus', handle);
      document.removeEventListener('visibilitychange', handle);
    };
  }, []);
}





























