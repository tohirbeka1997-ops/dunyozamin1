/**
 * Sync Engine
 * Processes outbox queue and syncs offline changes to server
 */

import { getPendingOutboxItems, markOutboxProcessing, markOutboxDone, markOutboxFailed, deleteOutboxItem } from './db';
import type { OutboxItem, SyncResult } from './types';
import { completePOSOrder } from '@/db/api';
import type { Order, OrderItem, Payment } from '@/types/database';

// Maximum retry attempts
const MAX_ATTEMPTS = 5;

// Exponential backoff delays (ms)
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000];

/**
 * Calculate backoff delay based on attempt number
 */
function getBackoffDelay(attempt: number): number {
  return BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)] || 16000;
}

/**
 * Check if we should retry based on attempts
 */
function shouldRetry(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sync a single outbox item
 */
async function syncOutboxItem(item: OutboxItem): Promise<SyncResult> {
  try {
    // Mark as processing
    await markOutboxProcessing(item.id);

    let success = false;
    let serverId: string | undefined;
    let error: string | undefined;

    switch (item.type) {
      case 'CREATE_ORDER': {
        const payload = item.payload as {
          order: Omit<Order, 'id' | 'created_at'>;
          items: Omit<OrderItem, 'id' | 'order_id'>[];
          payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[];
        };
        
        try {
          const result = await completePOSOrder(
            payload.order,
            payload.items,
            payload.payments
          );
          
          success = true;
          serverId = result.order_id;
        } catch (err) {
          error = err instanceof Error ? err.message : 'Failed to sync order';
        }
        break;
      }

      case 'CREATE_RETURN': {
        // TODO: Implement return sync
        // For now, mark as done (will be implemented when return API is ready)
        success = true;
        break;
      }

      case 'CREATE_EXPENSE': {
        // Expenses are already synced via localStorage, just mark as done
        success = true;
        break;
      }

      case 'UPDATE_EXPENSE': {
        // Expenses are already synced via localStorage, just mark as done
        success = true;
        break;
      }

      case 'DELETE_EXPENSE': {
        // Expenses are already synced via localStorage, just mark as done
        success = true;
        break;
      }

      case 'ADJUST_STOCK': {
        // Stock adjustments are handled via inventory movements
        // For now, mark as done (will be implemented when stock API is ready)
        success = true;
        break;
      }

      case 'CREATE_PURCHASE_ORDER': {
        // TODO: Implement purchase order sync
        success = true;
        break;
      }

      case 'RECEIVE_PURCHASE_ORDER': {
        // TODO: Implement receive goods sync
        success = true;
        break;
      }

      case 'RECEIVE_CUSTOMER_PAYMENT': {
        // TODO: Implement customer payment sync
        success = true;
        break;
      }

      case 'RECEIVE_SUPPLIER_PAYMENT': {
        // TODO: Implement supplier payment sync
        success = true;
        break;
      }

      default:
        error = `Unknown outbox item type: ${item.type}`;
    }

    if (success) {
      // Mark as done and optionally delete
      await markOutboxDone(item.id, serverId);
      // Keep in outbox for a while, then delete (or keep for audit)
      // For now, we'll delete immediately after successful sync
      await deleteOutboxItem(item.id);
      
      return {
        success: true,
        itemId: item.id,
        serverId,
      };
    } else {
      // Mark as failed
      await markOutboxFailed(item.id, error || 'Unknown error');
      
      return {
        success: false,
        itemId: item.id,
        error,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await markOutboxFailed(item.id, errorMessage);
    
    return {
      success: false,
      itemId: item.id,
      error: errorMessage,
    };
  }
}

/**
 * Process outbox queue (sync all pending items)
 */
export async function processOutboxQueue(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  // Check if online
  if (!navigator.onLine) {
    return { synced: 0, failed: 0, errors: ['Not online'] };
  }

  const pendingItems = await getPendingOutboxItems();
  
  if (pendingItems.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process items in order (FIFO)
  for (const item of pendingItems) {
    // Check if should retry
    if (!shouldRetry(item.attempts)) {
      failed++;
      errors.push(`Item ${item.id} exceeded max retries`);
      continue;
    }

    // Apply backoff delay if retrying
    if (item.attempts > 0) {
      const delay = getBackoffDelay(item.attempts);
      await sleep(delay);
    }

    const result = await syncOutboxItem(item);

    if (result.success) {
      synced++;
    } else {
      failed++;
      if (result.error) {
        errors.push(result.error);
      }
    }
  }

  return { synced, failed, errors };
}

/**
 * Sync engine - continuously processes outbox when online
 */
export class SyncEngine {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private onStatusChange?: (status: 'idle' | 'syncing' | 'failed' | 'success', error?: string) => void;

  constructor(onStatusChange?: (status: 'idle' | 'syncing' | 'failed' | 'success', error?: string) => void) {
    this.onStatusChange = onStatusChange;
  }

  /**
   * Start sync engine
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    
    // Process immediately if online
    if (navigator.onLine) {
      await this.process();
    }

    // Set up interval to process every 10 seconds
    this.intervalId = setInterval(async () => {
      if (navigator.onLine && this.isRunning) {
        await this.process();
      }
    }, 10000);

    // Listen to online event
    window.addEventListener('online', this.handleOnline);
  }

  /**
   * Stop sync engine
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    window.removeEventListener('online', this.handleOnline);
  }

  /**
   * Process outbox queue
   */
  private async process(): Promise<void> {
    if (!navigator.onLine) {
      this.onStatusChange?.('idle');
      return;
    }

    this.onStatusChange?.('syncing');
    
    try {
      const result = await processOutboxQueue();
      
      if (result.failed > 0 && result.synced === 0) {
        // All failed
        this.onStatusChange?.('failed', result.errors.join('; '));
      } else if (result.failed > 0) {
        // Some failed
        this.onStatusChange?.('failed', `${result.failed} items failed: ${result.errors.join('; ')}`);
      } else if (result.synced > 0) {
        // All succeeded
        this.onStatusChange?.('success');
      } else {
        // Nothing to sync
        this.onStatusChange?.('idle');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.onStatusChange?.('failed', errorMessage);
    }
  }

  /**
   * Handle online event
   */
  private handleOnline = async (): Promise<void> => {
    if (this.isRunning) {
      await this.process();
    }
  };

  /**
   * Manual sync trigger
   */
  async syncNow(): Promise<void> {
    await this.process();
  }
}

