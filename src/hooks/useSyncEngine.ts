// Sync engine hook.
//
// Tracks connectivity and the offline outbox so the UI can surface pending,
// unsynced work. Replaying the outbox is deliberately manual (`syncNow`) and
// requires an idempotent handler — we never auto-resubmit orders, to avoid
// double-charging when a connection flaps.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  countPendingOutbox,
  getPendingOutbox,
  markOutboxFailed,
  markOutboxSynced,
  openOfflineDB,
  type StoredOutboxEntry,
} from '@/offline/db';

export type OutboxProcessor = (entry: StoredOutboxEntry) => Promise<void>;

export interface SyncEngineState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  pendingItems: number;
  refreshPending: () => Promise<void>;
  syncNow: (processEntry: OutboxProcessor) => Promise<{ synced: number; failed: number }>;
}

function readOnline(): boolean {
  try {
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  } catch {
    return true;
  }
}

export function useSyncEngine(): SyncEngineState {
  const [isOnline, setIsOnline] = useState<boolean>(readOnline);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState(0);
  const syncingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPendingItems(await countPendingOutbox());
    } catch {
      /* ignore — count is best-effort */
    }
  }, []);

  const syncNow = useCallback(
    async (processEntry: OutboxProcessor) => {
      if (syncingRef.current || !readOnline()) {
        return { synced: 0, failed: 0 };
      }
      syncingRef.current = true;
      setIsSyncing(true);
      let synced = 0;
      let failed = 0;
      try {
        const entries = await getPendingOutbox();
        for (const entry of entries) {
          try {
            await processEntry(entry);
            await markOutboxSynced(entry.idempotencyKey);
            synced += 1;
          } catch (err) {
            await markOutboxFailed(entry.idempotencyKey, err);
            failed += 1;
          }
        }
        setLastSyncTime(new Date().toISOString());
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
        await refreshPending();
      }
      return { synced, failed };
    },
    [refreshPending],
  );

  useEffect(() => {
    let active = true;
    void openOfflineDB().then(() => {
      if (active) void refreshPending();
    });

    const onOnline = () => {
      setIsOnline(true);
      void refreshPending();
    };
    const onOffline = () => setIsOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
  }, [refreshPending]);

  return { isOnline, isSyncing, lastSyncTime, pendingItems, refreshPending, syncNow };
}
