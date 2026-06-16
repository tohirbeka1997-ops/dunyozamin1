/**
 * CLIENT-mode offline sales queue — mirrors sales-mobile/src/lib/offlineQueue.ts.
 * Persists completePOSOrder payloads in IndexedDB/localStorage for replay when HOST is back.
 */

import type { Order, OrderItem, Payment } from '@/types/database';

const QUEUE_KEY = 'dz_pos_offline_sales_queue';
export const MAX_OFFLINE_SALE_RETRIES = 5;

export interface QueuedPosSale {
  id: string;
  order: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  created_at: string;
  retry_count?: number;
  last_error?: string | null;
  failed_permanently?: boolean;
}

export interface SyncedPosSaleResult {
  queueId: string;
  orderId: string;
  orderNumber: string;
}

export interface PosSalesSyncResult {
  synced: number;
  failed: number;
  remaining: number;
  syncedOrders: SyncedPosSaleResult[];
  permanentFailures: QueuedPosSale[];
}

type SyncListener = (syncing: boolean) => void;
const syncListeners = new Set<SyncListener>();
let syncing = false;

function notifySyncing(value: boolean) {
  syncing = value;
  syncListeners.forEach((fn) => fn(value));
}

export function subscribeOfflineSalesSync(listener: SyncListener): () => void {
  syncListeners.add(listener);
  listener(syncing);
  return () => syncListeners.delete(listener);
}

export function isOfflineSalesSyncInProgress(): boolean {
  return syncing;
}

function parseQueue(raw: string | null): QueuedPosSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedPosSale[]) : [];
  } catch {
    return [];
  }
}

async function readQueueRaw(): Promise<string | null> {
  try {
    return localStorage.getItem(QUEUE_KEY);
  } catch {
    return null;
  }
}

async function writeQueueRaw(value: string): Promise<void> {
  try {
    localStorage.setItem(QUEUE_KEY, value);
  } catch {
    /* quota / disabled */
  }
}

export async function getOfflineSalesQueue(): Promise<QueuedPosSale[]> {
  return parseQueue(await readQueueRaw());
}

export async function getOfflineSalesQueueCount(): Promise<number> {
  const q = await getOfflineSalesQueue();
  return q.filter((e) => !e.failed_permanently).length;
}

export async function enqueueOfflinePosSale(
  order: Omit<Order, 'id' | 'created_at'> & Record<string, unknown>,
  items: Array<Omit<OrderItem, 'id' | 'order_id'>>,
  payments: Array<Omit<Payment, 'id' | 'order_id' | 'created_at'>>,
): Promise<QueuedPosSale> {
  const queue = await getOfflineSalesQueue();
  const orderUuid = String(order.order_uuid || order.id || `offline-${Date.now()}`);
  const entry: QueuedPosSale = {
    id: orderUuid,
    order: order as Record<string, unknown>,
    items: items as Array<Record<string, unknown>>,
    payments: payments as Array<Record<string, unknown>>,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
    failed_permanently: false,
  };
  queue.push(entry);
  await writeQueueRaw(JSON.stringify(queue));
  return entry;
}

export async function removeOfflinePosSale(id: string): Promise<void> {
  const queue = await getOfflineSalesQueue();
  await writeQueueRaw(JSON.stringify(queue.filter((e) => e.id !== id)));
}

let syncInFlight: Promise<PosSalesSyncResult> | null = null;

/** Replay queued sales via pos:sales:completePOSOrder (idempotent via order_uuid). */
export async function syncOfflinePosSalesNow(): Promise<PosSalesSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncOfflinePosSalesInner().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function syncOfflinePosSalesInner(): Promise<PosSalesSyncResult> {
  const { replayQueuedPosSale } = await import('@/lib/offlineSalesSync');
  const queue = await getOfflineSalesQueue();
  const pending = queue.filter((e) => !e.failed_permanently);
  if (pending.length === 0) {
    return {
      synced: 0,
      failed: 0,
      remaining: 0,
      syncedOrders: [],
      permanentFailures: queue.filter((e) => e.failed_permanently),
    };
  }

  notifySyncing(true);
  let synced = 0;
  let failed = 0;
  const syncedOrders: SyncedPosSaleResult[] = [];
  const nextQueue: QueuedPosSale[] = queue.filter((e) => e.failed_permanently);

  try {
    for (const entry of queue) {
      if (entry.failed_permanently) continue;
      try {
        const res = await replayQueuedPosSale(entry);
        synced += 1;
        syncedOrders.push({
          queueId: entry.id,
          orderId: res.order_id,
          orderNumber: res.order_number,
        });
      } catch (err) {
        failed += 1;
        const retryCount = (entry.retry_count ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        const permanent = retryCount >= MAX_OFFLINE_SALE_RETRIES;
        nextQueue.push({
          ...entry,
          retry_count: retryCount,
          last_error: message,
          failed_permanently: permanent,
        });
      }
    }

    await writeQueueRaw(JSON.stringify(nextQueue));
    const remaining = nextQueue.filter((e) => !e.failed_permanently).length;
    return { synced, failed, remaining, syncedOrders, permanentFailures: nextQueue.filter((e) => e.failed_permanently) };
  } finally {
    notifySyncing(false);
  }
}
