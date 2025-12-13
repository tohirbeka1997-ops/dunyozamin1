/**
 * Offline mode types and interfaces
 */

export type SyncStatus = 'idle' | 'syncing' | 'failed' | 'success';

export type OutboxItemStatus = 'pending' | 'processing' | 'failed' | 'done';

export type OutboxItemType =
  | 'CREATE_ORDER'
  | 'UPDATE_ORDER'
  | 'CREATE_RETURN'
  | 'UPDATE_RETURN'
  | 'ADJUST_STOCK'
  | 'CREATE_EXPENSE'
  | 'UPDATE_EXPENSE'
  | 'DELETE_EXPENSE'
  | 'CREATE_PURCHASE_ORDER'
  | 'UPDATE_PURCHASE_ORDER'
  | 'RECEIVE_PURCHASE_ORDER'
  | 'CREATE_CUSTOMER'
  | 'UPDATE_CUSTOMER'
  | 'RECEIVE_CUSTOMER_PAYMENT'
  | 'RECEIVE_SUPPLIER_PAYMENT';

/**
 * Outbox item - represents a pending mutation that needs to sync
 */
export interface OutboxItem {
  id: string; // UUID
  type: OutboxItemType;
  payload: unknown; // Typed based on type
  createdAt: string; // ISO timestamp
  attempts: number;
  status: OutboxItemStatus;
  idempotencyKey: string; // UUID for idempotency
  entityId: string | null; // Local entity ID (order_id, return_id, etc.)
  serverId: string | null; // Server-assigned ID after sync
  error: string | null; // Error message if failed
  lastAttemptAt: string | null; // ISO timestamp
}

/**
 * Network status state
 */
export interface NetworkStatus {
  isOnline: boolean;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  syncError: string | null;
  pendingCount: number; // Number of items in outbox
}

/**
 * Typed payloads for each outbox item type
 */
export interface CreateOrderPayload {
  order: unknown; // Order type
  items: unknown[]; // OrderItem[]
  payments: unknown[]; // Payment[]
}

export interface CreateReturnPayload {
  return: unknown; // SalesReturn
  items: unknown[]; // SalesReturnItem[]
}

export interface AdjustStockPayload {
  productId: string;
  quantity: number;
  reason: string;
  movementType: string;
}

export interface CreateExpensePayload {
  expense: unknown; // Expense
}

export interface UpdateExpensePayload {
  id: string;
  updates: unknown; // Partial<Expense>
}

export interface DeleteExpensePayload {
  id: string;
}

export interface CreatePurchaseOrderPayload {
  purchaseOrder: unknown; // PurchaseOrder
  items: unknown[]; // PurchaseOrderItem[]
}

export interface ReceivePurchaseOrderPayload {
  purchaseOrderId: string;
  receivedItems: unknown[]; // ReceiveItem[]
}

export interface ReceiveCustomerPaymentPayload {
  customerId: string;
  amount: number;
  paymentMethod: string;
  note?: string | null;
}

export interface ReceiveSupplierPaymentPayload {
  supplierId: string;
  purchaseOrderId: string | null;
  amount: number;
  paymentMethod: string;
  paidAt: string;
  note?: string | null;
}

/**
 * Sync result
 */
export interface SyncResult {
  success: boolean;
  itemId: string;
  serverId?: string;
  error?: string;
}

