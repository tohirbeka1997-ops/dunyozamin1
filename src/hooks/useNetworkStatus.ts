/**
 * Network status hook
 * Monitors online/offline status and provides sync state
 */

import { useState, useEffect, useCallback } from 'react';
import { getOutboxCount } from '@/offline/db';
import type { SyncStatus } from '@/offline/types';

export interface NetworkStatusState {
  isOnline: boolean;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  syncError: string | null;
  pendingCount: number;
}

/**
 * Hook to monitor network status and sync state
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Update online status
  const updateOnlineStatus = useCallback(() => {
    const online = navigator.onLine;
    setIsOnline(online);
    
    // If just came online, trigger sync
    if (online && syncStatus === 'idle') {
      // Sync will be triggered by sync engine
    }
  }, [syncStatus]);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getOutboxCount('pending');
      setPendingCount(count);
    } catch (error) {
      console.error('Failed to get pending count:', error);
      // Don't throw - just set to 0 on error
      setPendingCount(0);
    }
  }, []);

  // Listen to online/offline events
  useEffect(() => {
    const handleOnline = () => {
      updateOnlineStatus();
    };

    const handleOffline = () => {
      updateOnlineStatus();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check
    updateOnlineStatus();
    updatePendingCount();

    // Poll pending count every 5 seconds
    const interval = setInterval(updatePendingCount, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [updateOnlineStatus, updatePendingCount]);

  // Update sync status (called by sync engine)
  const setSyncStatusState = useCallback((status: SyncStatus, error?: string | null) => {
    setSyncStatus(status);
    setSyncError(error || null);
    if (status === 'success') {
      setLastSyncAt(new Date().toISOString());
      updatePendingCount();
    }
  }, [updatePendingCount]);

  return {
    isOnline,
    syncStatus,
    lastSyncAt,
    syncError,
    pendingCount,
    setSyncStatus: setSyncStatusState,
    updatePendingCount,
  };
}

