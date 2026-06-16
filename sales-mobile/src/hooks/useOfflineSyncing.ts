import { useEffect, useState } from 'react';
import { subscribeSyncState } from '@/lib/offlineQueue';

/** True while offline sales queue is being synced to the server. */
export function useOfflineSyncing(): boolean {
  const [syncing, setSyncing] = useState(false);
  useEffect(() => subscribeSyncState(setSyncing), []);
  return syncing;
}
