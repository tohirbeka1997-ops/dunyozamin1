import { useEffect, useState, useCallback } from 'react';
import {
  getOfflineQueue,
  removeFromOfflineQueue,
  incrementRetry,
  isOnline,
  type OfflineOperation,
} from '@/utils/offline';

interface UseOfflineQueueOptions {
  onSync?: (operation: OfflineOperation) => Promise<boolean>;
  syncInterval?: number; // ms
}

/**
 * Hook to manage offline queue and auto-sync when online
 */
export const useOfflineQueue = ({
  onSync,
  syncInterval = 5000,
}: UseOfflineQueueOptions = {}) => {
  const [queue, setQueue] = useState<OfflineOperation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadQueue = useCallback(() => {
    const operations = getOfflineQueue();
    setQueue(operations);
  }, []);

  const syncOperation = useCallback(
    async (operation: OfflineOperation): Promise<boolean> => {
      if (!onSync) return false;

      try {
        const success = await onSync(operation);
        if (success) {
          removeFromOfflineQueue(operation.id);
          loadQueue();
          return true;
        } else {
          const canRetry = incrementRetry(operation.id);
          if (!canRetry) {
            // Max retries exceeded, remove from queue
            removeFromOfflineQueue(operation.id);
            loadQueue();
          }
          return false;
        }
      } catch (error) {
        console.error('Sync operation failed:', error);
        const canRetry = incrementRetry(operation.id);
        if (!canRetry) {
          removeFromOfflineQueue(operation.id);
          loadQueue();
        }
        return false;
      }
    },
    [onSync, loadQueue]
  );

  const syncAll = useCallback(async () => {
    if (!isOnline() || !onSync || isSyncing) return;

    setIsSyncing(true);
    const operations = getOfflineQueue();

    for (const operation of operations) {
      await syncOperation(operation);
    }

    setIsSyncing(false);
    loadQueue();
  }, [onSync, syncOperation, isSyncing, loadQueue]);

  // Load queue on mount
  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Auto-sync when online
  useEffect(() => {
    if (!isOnline() || !onSync) return;

    const interval = setInterval(() => {
      syncAll();
    }, syncInterval);

    // Also sync on online event
    const handleOnline = () => {
      syncAll();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  }, [syncAll, syncInterval, onSync]);

  return {
    queue,
    isSyncing,
    syncAll,
    syncOperation,
    loadQueue,
  };
};







