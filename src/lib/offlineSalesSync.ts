import { requireElectron } from '@/utils/electron';
import { ipc } from '@/db/internal';
import type { QueuedPosSale } from '@/lib/offlineSalesQueue';

let cachedClientMode: boolean | null = null;

/** True when pos-config.json mode is `client` (no local SQLite). */
export async function isClientMode(): Promise<boolean> {
  if (cachedClientMode !== null) return cachedClientMode;
  try {
    const api = requireElectron();
    const config = await ipc<{ mode?: string }>(api.appConfig.get());
    cachedClientMode = String(config?.mode || 'host').toLowerCase() === 'client';
  } catch {
    cachedClientMode = false;
  }
  return cachedClientMode;
}

export function resetClientModeCache(): void {
  cachedClientMode = null;
}

export async function replayQueuedPosSale(
  entry: QueuedPosSale,
): Promise<{ order_id: string; order_number: string }> {
  const api = requireElectron();
  return ipc<{ order_id: string; order_number: string }>(
    api.sales.completePOSOrder(entry.order, entry.items, entry.payments),
  );
}

/** Auto-sync when browser reports online; also poll HOST health periodically. */
export async function tryAutoSyncOfflineSales(): Promise<void> {
  const { getOfflineSalesQueueCount, syncOfflinePosSalesNow } = await import('@/lib/offlineSalesQueue');
  const pending = await getOfflineSalesQueueCount();
  if (pending === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  await syncOfflinePosSalesNow();
}
