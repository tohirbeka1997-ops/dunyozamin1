export interface OfflineOperation {
  id: string;
  type: 'order' | 'payment' | 'return';
  data: unknown;
  timestamp: string;
  retries: number;
}

interface OfflineQueue {
  operations: OfflineOperation[];
}

const STORAGE_KEY = 'pos_offline_queue';
const MAX_RETRIES = 3;

/**
 * Add operation to offline queue
 */
export const addToOfflineQueue = (operation: Omit<OfflineOperation, 'id' | 'timestamp' | 'retries'>): void => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const queue: OfflineQueue = stored ? JSON.parse(stored) : { operations: [] };
    
    const newOperation: OfflineOperation = {
      ...operation,
      id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      retries: 0,
    };
    
    queue.operations.push(newOperation);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to add to offline queue:', error);
  }
};

/**
 * Get all pending operations
 */
export const getOfflineQueue = (): OfflineOperation[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const queue: OfflineQueue = JSON.parse(stored);
    return queue.operations || [];
  } catch (error) {
    console.error('Failed to read offline queue:', error);
    return [];
  }
};

/**
 * Remove operation from queue
 */
export const removeFromOfflineQueue = (operationId: string): void => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    
    const queue: OfflineQueue = JSON.parse(stored);
    queue.operations = queue.operations.filter((op) => op.id !== operationId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to remove from offline queue:', error);
  }
};

/**
 * Increment retry count for operation
 */
export const incrementRetry = (operationId: string): boolean => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    
    const queue: OfflineQueue = JSON.parse(stored);
    const operation = queue.operations.find((op) => op.id === operationId);
    
    if (!operation) return false;
    
    operation.retries += 1;
    
    // Remove if max retries exceeded
    if (operation.retries >= MAX_RETRIES) {
      queue.operations = queue.operations.filter((op) => op.id !== operationId);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    return operation.retries < MAX_RETRIES;
  } catch (error) {
    console.error('Failed to increment retry:', error);
    return false;
  }
};

/**
 * Clear offline queue
 */
export const clearOfflineQueue = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear offline queue:', error);
  }
};

/**
 * Check if online
 */
export const isOnline = (): boolean => {
  return navigator.onLine;
};








