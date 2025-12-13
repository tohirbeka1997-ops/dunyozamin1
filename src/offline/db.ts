/**
 * IndexedDB database for offline mode
 * Uses idb library for type-safe IndexedDB operations
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { OutboxItem, OutboxItemStatus } from './types';

interface POSOfflineDB extends DBSchema {
  orders: {
    key: string;
    value: {
      id: string;
      order: unknown;
      items: unknown[];
      payments: unknown[];
      synced: boolean;
      createdAt: string;
      updatedAt: string;
    };
    indexes: { 'by-synced': boolean; 'by-created': string };
  };
  returns: {
    key: string;
    value: {
      id: string;
      return: unknown;
      items: unknown[];
      synced: boolean;
      createdAt: string;
      updatedAt: string;
    };
    indexes: { 'by-synced': boolean; 'by-created': string };
  };
  inventory_snapshots: {
    key: string;
    value: {
      productId: string;
      stock: number;
      updatedAt: string;
    };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: {
      'by-status': OutboxItemStatus | string;
      'by-created': string;
      'by-type': string;
    };
  };
  meta: {
    key: string;
    value: {
      key: string;
      value: string;
    };
  };
}

type OutboxItemStatus = 'pending' | 'processing' | 'failed' | 'done';

const DB_NAME = 'pos-offline-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<POSOfflineDB> | null = null;

/**
 * Initialize and open IndexedDB
 */
export async function openOfflineDB(): Promise<IDBPDatabase<POSOfflineDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<POSOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Orders store
      if (!db.objectStoreNames.contains('orders')) {
        const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
        orderStore.createIndex('by-synced', 'synced');
        orderStore.createIndex('by-created', 'createdAt');
      }

      // Returns store
      if (!db.objectStoreNames.contains('returns')) {
        const returnStore = db.createObjectStore('returns', { keyPath: 'id' });
        returnStore.createIndex('by-synced', 'synced');
        returnStore.createIndex('by-created', 'createdAt');
      }

      // Inventory snapshots store
      if (!db.objectStoreNames.contains('inventory_snapshots')) {
        db.createObjectStore('inventory_snapshots', { keyPath: 'productId' });
      }

      // Outbox store (queue for pending syncs)
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
        outboxStore.createIndex('by-status', 'status');
        outboxStore.createIndex('by-created', 'createdAt');
        outboxStore.createIndex('by-type', 'type');
      }

      // Meta store (for sync timestamps, etc.)
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
  });

  return dbInstance;
}

/**
 * Close database connection
 */
export async function closeOfflineDB(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Get database instance (opens if not already open)
 */
export async function getDB(): Promise<IDBPDatabase<POSOfflineDB>> {
  return openOfflineDB();
}

// ============================================================================
// OUTBOX OPERATIONS
// ============================================================================

/**
 * Add item to outbox queue
 */
export async function addToOutbox(
  item: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'status' | 'serverId' | 'error' | 'lastAttemptAt'>
): Promise<string> {
  const db = await getDB();
  const id = `outbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const outboxItem: OutboxItem = {
    ...item,
    id,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    serverId: null,
    error: null,
    lastAttemptAt: null,
  };

  await db.add('outbox', outboxItem);
  return id;
}

/**
 * Get all pending outbox items
 */
export async function getPendingOutboxItems(): Promise<OutboxItem[]> {
  const db = await getDB();
  const index = db.transaction('outbox').store.index('by-status');
  return index.getAll('pending');
}

/**
 * Get all outbox items (for debugging/admin)
 */
export async function getAllOutboxItems(): Promise<OutboxItem[]> {
  const db = await getDB();
  return db.getAll('outbox');
}

/**
 * Get outbox item by ID
 */
export async function getOutboxItem(id: string): Promise<OutboxItem | undefined> {
  const db = await getDB();
  return db.get('outbox', id);
}

/**
 * Update outbox item
 */
export async function updateOutboxItem(id: string, updates: Partial<OutboxItem>): Promise<void> {
  const db = await getDB();
  const item = await db.get('outbox', id);
  if (!item) {
    throw new Error(`Outbox item ${id} not found`);
  }
  await db.put('outbox', { ...item, ...updates });
}

/**
 * Mark outbox item as processing
 */
export async function markOutboxProcessing(id: string): Promise<void> {
  await updateOutboxItem(id, {
    status: 'processing',
    lastAttemptAt: new Date().toISOString(),
  });
}

/**
 * Mark outbox item as done (successfully synced)
 */
export async function markOutboxDone(id: string, serverId?: string): Promise<void> {
  await updateOutboxItem(id, {
    status: 'done',
    serverId: serverId || null,
    error: null,
  });
}

/**
 * Mark outbox item as failed
 */
export async function markOutboxFailed(id: string, error: string): Promise<void> {
  const item = await getOutboxItem(id);
  if (!item) return;

  const newAttempts = item.attempts + 1;
  const maxAttempts = 5;
  
  await updateOutboxItem(id, {
    status: newAttempts >= maxAttempts ? 'failed' : 'pending',
    attempts: newAttempts,
    error,
    lastAttemptAt: new Date().toISOString(),
  });
}

/**
 * Delete outbox item (after successful sync)
 */
export async function deleteOutboxItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('outbox', id);
}

/**
 * Get outbox item count by status
 */
export async function getOutboxCount(status?: OutboxItemStatus): Promise<number> {
  try {
    const db = await getDB();
    if (status) {
      const index = db.transaction('outbox').store.index('by-status');
      return index.count(status);
    }
    return db.count('outbox');
  } catch (error) {
    console.error('Failed to get outbox count:', error);
    // Return 0 on error to prevent crash
    return 0;
  }
}

// ============================================================================
// ORDERS OPERATIONS
// ============================================================================

/**
 * Save order locally
 */
export async function saveLocalOrder(
  id: string,
  order: unknown,
  items: unknown[],
  payments: unknown[]
): Promise<void> {
  const db = await getDB();
  await db.put('orders', {
    id,
    order,
    items,
    payments,
    synced: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Get local order
 */
export async function getLocalOrder(id: string): Promise<{
  id: string;
  order: unknown;
  items: unknown[];
  payments: unknown[];
  synced: boolean;
  createdAt: string;
  updatedAt: string;
} | undefined> {
  const db = await getDB();
  return db.get('orders', id);
}

/**
 * Get all unsynced orders
 */
export async function getUnsyncedOrders(): Promise<unknown[]> {
  const db = await getDB();
  const index = db.transaction('orders').store.index('by-synced');
  const unsynced = await index.getAll(false);
  return unsynced.map(o => o.order);
}

/**
 * Mark order as synced
 */
export async function markOrderSynced(id: string): Promise<void> {
  const db = await getDB();
  const order = await db.get('orders', id);
  if (order) {
    await db.put('orders', {
      ...order,
      synced: true,
      updatedAt: new Date().toISOString(),
    });
  }
}

// ============================================================================
// RETURNS OPERATIONS
// ============================================================================

/**
 * Save return locally
 */
export async function saveLocalReturn(
  id: string,
  returnData: unknown,
  items: unknown[]
): Promise<void> {
  const db = await getDB();
  await db.put('returns', {
    id,
    return: returnData,
    items,
    synced: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Get all unsynced returns
 */
export async function getUnsyncedReturns(): Promise<unknown[]> {
  const db = await getDB();
  const index = db.transaction('returns').store.index('by-synced');
  const unsynced = await index.getAll(false);
  return unsynced.map(r => r.return);
}

/**
 * Mark return as synced
 */
export async function markReturnSynced(id: string): Promise<void> {
  const db = await getDB();
  const returnData = await db.get('returns', id);
  if (returnData) {
    await db.put('returns', {
      ...returnData,
      synced: true,
      updatedAt: new Date().toISOString(),
    });
  }
}

// ============================================================================
// INVENTORY OPERATIONS
// ============================================================================

/**
 * Save inventory snapshot
 */
export async function saveInventorySnapshot(productId: string, stock: number): Promise<void> {
  const db = await getDB();
  await db.put('inventory_snapshots', {
    productId,
    stock,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Get inventory snapshot
 */
export async function getInventorySnapshot(productId: string): Promise<number | null> {
  const db = await getDB();
  const snapshot = await db.get('inventory_snapshots', productId);
  return snapshot?.stock ?? null;
}

/**
 * Get all inventory snapshots
 */
export async function getAllInventorySnapshots(): Promise<Record<string, number>> {
  const db = await getDB();
  const snapshots = await db.getAll('inventory_snapshots');
  const result: Record<string, number> = {};
  snapshots.forEach(s => {
    result[s.productId] = s.stock;
  });
  return result;
}

// ============================================================================
// META OPERATIONS
// ============================================================================

/**
 * Set meta value
 */
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key, value });
}

/**
 * Get meta value
 */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const meta = await db.get('meta', key);
  return meta?.value ?? null;
}

/**
 * Clear all local data (for testing/reset)
 */
export async function clearAllLocalData(): Promise<void> {
  const db = await getDB();
  await db.clear('orders');
  await db.clear('returns');
  await db.clear('inventory_snapshots');
  await db.clear('outbox');
  await db.clear('meta');
}

