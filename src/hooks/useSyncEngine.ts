/**
 * Hook to use sync engine
 * Provides sync engine instance and controls
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { SyncEngine } from '@/offline/syncEngine';
import { useNetworkStatus } from './useNetworkStatus';

let globalSyncEngine: SyncEngine | null = null;

/**
 * Hook to access and control sync engine
 */
export function useSyncEngine() {
  const [isSyncing, setIsSyncing] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);
  
  // Get network status - must always be called (hook rule)
  const networkStatus = useNetworkStatus();
  const setSyncStatus = networkStatus?.setSyncStatus || (() => {});

  // Initialize sync engine
  useEffect(() => {
    try {
      if (!globalSyncEngine && setSyncStatus) {
        globalSyncEngine = new SyncEngine((status, error) => {
          try {
            setSyncStatus(status, error);
            setIsSyncing(status === 'syncing');
          } catch (err) {
            console.error('Error in sync status callback:', err);
          }
        });
      }
      engineRef.current = globalSyncEngine;

      // Start engine if available
      if (globalSyncEngine) {
        globalSyncEngine.start();
      }
    } catch (error) {
      console.error('Failed to initialize sync engine:', error);
    }

    return () => {
      // Don't stop on unmount - keep running for the app lifetime
      // globalSyncEngine.stop();
    };
  }, [setSyncStatus]);

  // Manual sync trigger
  const syncNow = useCallback(async () => {
    if (engineRef.current) {
      setIsSyncing(true);
      try {
        await engineRef.current.syncNow();
      } catch (error) {
        console.error('Error during manual sync:', error);
      } finally {
        setIsSyncing(false);
      }
    }
  }, []);

  return {
    syncNow,
    isSyncing,
  };
}

