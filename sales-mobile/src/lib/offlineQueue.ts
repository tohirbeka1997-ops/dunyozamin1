/**
 * Offline sales queue — persists pending completeSale payloads for retry.
 * Uses platform storage (SecureStore / localStorage) via secureStorage helpers.
 */

import { completeSale } from '@/api/client';
import { getItem, setItem } from '@/lib/secureStorage';
import type { CompleteSalePayload } from '@/types/sales';

const QUEUE_KEY = 'dz_staff_offline_sales_queue';
export const MAX_OFFLINE_RETRIES = 5;

export interface QueuedSale {
  id: string;
  payload: CompleteSalePayload;
  created_at: string;
  retry_count?: number;
  last_error?: string | null;
  failed_permanently?: boolean;
}

export interface SyncedSaleResult {
  queueId: string;
  orderId: string;
  orderNumber: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
  syncedOrders: SyncedSaleResult[];
  permanentFailures: QueuedSale[];
}

type SyncListener = (syncing: boolean) => void;
const syncListeners = new Set<SyncListener>();
let syncing = false;

function notifySyncing(value: boolean) {
  syncing = value;
  syncListeners.forEach((fn) => fn(value));
}

/** Subscribe to global offline sync in-progress state (for cart spinner). */
export function subscribeSyncState(listener: SyncListener): () => void {
  syncListeners.add(listener);
  listener(syncing);
  return () => syncListeners.delete(listener);
}

export function isSyncInProgress(): boolean {
  return syncing;
}

function parseQueue(raw: string | null): QueuedSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedSale[]) : [];
  } catch {
    return [];
  }
}

export async function getOfflineQueue(): Promise<QueuedSale[]> {
  return parseQueue(await getItem(QUEUE_KEY));
}

/** Count items still eligible for automatic retry. */
export async function getOfflineQueueCount(): Promise<number> {
  const q = await getOfflineQueue();
  return q.filter((e) => !e.failed_permanently).length;
}

export async function getPermanentSyncFailures(): Promise<QueuedSale[]> {
  const q = await getOfflineQueue();
  return q.filter((e) => e.failed_permanently);
}

export async function enqueueSale(payload: CompleteSalePayload): Promise<QueuedSale> {
  const queue = await getOfflineQueue();
  const entry: QueuedSale = {
    id: payload.order_uuid || `offline-${Date.now()}`,
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
    failed_permanently: false,
  };
  queue.push(entry);
  await setItem(QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getOfflineQueue();
  const next = queue.filter((e) => e.id !== id);
  await setItem(QUEUE_KEY, JSON.stringify(next));
}

export async function clearPermanentFailures(): Promise<void> {
  const queue = await getOfflineQueue();
  const next = queue.filter((e) => !e.failed_permanently);
  await setItem(QUEUE_KEY, JSON.stringify(next));
}

/** Retry all queued sales (idempotent via order_uuid). Skips permanently failed items. */
export async function syncNow(): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncNowInner().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

let syncInFlight: Promise<SyncResult> | null = null;

async function syncNowInner(): Promise<SyncResult> {
  const queue = await getOfflineQueue();
  const pending = queue.filter((e) => !e.failed_permanently);
  if (pending.length === 0) {
    return { synced: 0, failed: 0, remaining: 0, syncedOrders: [], permanentFailures: queue.filter((e) => e.failed_permanently) };
  }

  notifySyncing(true);
  let synced = 0;
  let failed = 0;
  const syncedOrders: SyncedSaleResult[] = [];
  const nextQueue: QueuedSale[] = queue.filter((e) => e.failed_permanently);

  try {
    for (const entry of queue) {
      if (entry.failed_permanently) continue;

      try {
        const res = await completeSale(entry.payload);
        synced += 1;
        syncedOrders.push({
          queueId: entry.id,
          orderId: res.data.id,
          orderNumber: res.data.order_number,
        });
      } catch (err) {
        failed += 1;
        const retryCount = (entry.retry_count ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        const permanent = retryCount >= MAX_OFFLINE_RETRIES;
        nextQueue.push({
          ...entry,
          retry_count: retryCount,
          last_error: message,
          failed_permanently: permanent,
        });
      }
    }

    await setItem(QUEUE_KEY, JSON.stringify(nextQueue));
    const remaining = nextQueue.filter((e) => !e.failed_permanently).length;
    return {
      synced,
      failed,
      remaining,
      syncedOrders,
      permanentFailures: nextQueue.filter((e) => e.failed_permanently),
    };
  } finally {
    notifySyncing(false);
  }
}

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('load failed')
  );
}
