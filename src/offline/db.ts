// Offline persistence + sync outbox.
//
// Uses IndexedDB when available (browser / Electron renderer) and transparently
// falls back to localStorage otherwise (tests, SSR, locked-down webviews). The
// exported async signatures are stable so call sites never need to care which
// backend is active.
//
// NOTE: replaying the outbox (re-submitting orders) is intentionally NOT done
// automatically here — that belongs to an explicit, idempotent sync handler so
// a flaky connection can never double-charge a customer.

import type { Order, OrderItem, Payment } from '@/types/database';

export interface OutboxEntry {
  type: string;
  payload: unknown;
  idempotencyKey: string;
  entityId: string;
}

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface StoredOutboxEntry extends OutboxEntry {
  timestamp: string;
  retryCount: number;
  status: OutboxStatus;
  lastError?: string | null;
}

const DB_NAME = 'pos-offline';
const DB_VERSION = 1;
const STORE_ORDERS = 'orders';
const STORE_OUTBOX = 'outbox';

const LS_ORDERS = 'offline_orders';
const LS_OUTBOX = 'sync_outbox';

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ORDERS)) {
        db.createObjectStore(STORE_ORDERS, { keyPath: 'orderId' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'idempotencyKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function idbRun<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openIdb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
      }),
  );
}

// --- localStorage fallback helpers ------------------------------------------

function lsRead<T>(key: string, fallback: T): T {
  if (!hasLocalStorage()) return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

function lsWrite(key: string, value: unknown): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — best effort */
  }
}

// --- Public API -------------------------------------------------------------

/** Open (and cache) the offline database. Safe to call repeatedly. */
export async function openOfflineDB(): Promise<void> {
  if (!hasIndexedDB()) return; // localStorage fallback needs no setup
  try {
    await openIdb();
  } catch (error) {
    console.warn('[offline] IndexedDB unavailable, using localStorage fallback:', error);
  }
}

/** Persist a full order locally (so it survives reloads while offline). */
export async function saveLocalOrder(
  orderId: string,
  order: Order,
  items: OrderItem[],
  payments: Payment[],
): Promise<void> {
  const record = { orderId, order, items, payments, timestamp: new Date().toISOString() };
  if (hasIndexedDB()) {
    try {
      await idbRun(STORE_ORDERS, 'readwrite', (s) => s.put(record));
      return;
    } catch (error) {
      console.warn('[offline] saveLocalOrder IndexedDB failed, falling back:', error);
    }
  }
  const orders = lsRead<unknown[]>(LS_ORDERS, []);
  orders.push(record);
  lsWrite(LS_ORDERS, orders);
}

/** Queue an operation for later synchronization. Idempotent on idempotencyKey. */
export async function addToOutbox(entry: OutboxEntry): Promise<void> {
  const record: StoredOutboxEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    lastError: null,
  };
  if (hasIndexedDB()) {
    try {
      await idbRun(STORE_OUTBOX, 'readwrite', (s) => s.put(record));
      return;
    } catch (error) {
      console.warn('[offline] addToOutbox IndexedDB failed, falling back:', error);
    }
  }
  const outbox = lsRead<StoredOutboxEntry[]>(LS_OUTBOX, []);
  // Dedupe by idempotencyKey so a retry doesn't enqueue twice.
  const filtered = outbox.filter((e) => e.idempotencyKey !== entry.idempotencyKey);
  filtered.push(record);
  lsWrite(LS_OUTBOX, filtered);
}

/**
 * Convenience: persist an order AND enqueue it for sync in one call.
 * Centralizes the offline write path that used to be inlined in db/api.ts.
 */
export async function enqueueOfflineOrder(
  orderId: string,
  order: Order,
  items: OrderItem[],
  payments: Payment[],
  idempotencyKey: string,
): Promise<void> {
  await saveLocalOrder(orderId, order, items, payments);
  await addToOutbox({
    type: 'CREATE_ORDER',
    payload: { order, items, payments },
    idempotencyKey,
    entityId: orderId,
  });
}

/** Return all outbox entries that still need to be synced. */
export async function getPendingOutbox(): Promise<StoredOutboxEntry[]> {
  let all: StoredOutboxEntry[];
  if (hasIndexedDB()) {
    try {
      all = (await idbRun<StoredOutboxEntry[]>(STORE_OUTBOX, 'readonly', (s) => s.getAll())) || [];
    } catch {
      all = lsRead<StoredOutboxEntry[]>(LS_OUTBOX, []);
    }
  } else {
    all = lsRead<StoredOutboxEntry[]>(LS_OUTBOX, []);
  }
  return all.filter((e) => e.status === 'pending' || e.status === 'failed');
}

/** Count entries awaiting sync. */
export async function countPendingOutbox(): Promise<number> {
  return (await getPendingOutbox()).length;
}

async function updateOutboxEntry(
  idempotencyKey: string,
  patch: Partial<StoredOutboxEntry>,
): Promise<void> {
  if (hasIndexedDB()) {
    try {
      const existing = await idbRun<StoredOutboxEntry | undefined>(
        STORE_OUTBOX,
        'readonly',
        (s) => s.get(idempotencyKey),
      );
      if (!existing) return;
      await idbRun(STORE_OUTBOX, 'readwrite', (s) => s.put({ ...existing, ...patch }));
      return;
    } catch {
      /* fall through to localStorage */
    }
  }
  const outbox = lsRead<StoredOutboxEntry[]>(LS_OUTBOX, []);
  const next = outbox.map((e) => (e.idempotencyKey === idempotencyKey ? { ...e, ...patch } : e));
  lsWrite(LS_OUTBOX, next);
}

/** Mark an entry as successfully synced. */
export async function markOutboxSynced(idempotencyKey: string): Promise<void> {
  await updateOutboxEntry(idempotencyKey, { status: 'synced', lastError: null });
}

/** Mark an entry as failed and bump its retry counter. */
export async function markOutboxFailed(idempotencyKey: string, error: unknown): Promise<void> {
  const pending = await getPendingOutbox();
  const cur = pending.find((e) => e.idempotencyKey === idempotencyKey);
  await updateOutboxEntry(idempotencyKey, {
    status: 'failed',
    retryCount: (cur?.retryCount ?? 0) + 1,
    lastError: error instanceof Error ? error.message : String(error),
  });
}
