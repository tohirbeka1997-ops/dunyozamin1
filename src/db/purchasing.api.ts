// Purchasing: PO create/update/approve/cancel/receive, landed-cost expenses, receipts.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { deleteExpense } from './expenses.api';
import { productUpdateEmitter } from './products.api';
import { createOrder } from './orders.api';
import {
  delay,
  generateId,
  getStoredPurchaseOrderItems,
  getStoredPurchaseOrders,
  getStoredSupplierPayments,
  hasPosApi,
  ipc,
  mockDB,
  savePurchaseOrderItems,
  savePurchaseOrders,
} from './internal';
import type {
  Supplier,
  Product,
  InventoryMovement,
  PurchaseOrder,
  PurchaseOrderItem,
} from '@/types/database';

// ============================================================================
// PURCHASE ORDER EXPENSES (LANDED COST)
// ============================================================================

export const listPurchaseOrderExpenses = async (purchaseOrderId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.listExpenses(purchaseOrderId));
  }
  await delay();
  // Not supported in mock mode (yet)
  return [];
};

export const addPurchaseOrderExpense = async (
  purchaseOrderId: string,
  payload: { title: string; amount: number; allocation_method?: 'by_value' | 'by_qty'; notes?: string | null; created_by?: string | null }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.addExpense(purchaseOrderId, payload));
  }
  await delay();
  throw new Error('PO xarajatlari faqat desktop ilovada mavjud');
};

export const deletePurchaseOrderExpense = async (purchaseOrderId: string, expenseId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.deleteExpense(purchaseOrderId, expenseId));
  }
  await delay();
  throw new Error('PO xarajatlari faqat desktop ilovada mavjud');
};

export const deletePurchaseOrder = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.deleteOrder(id));
  }
  await delay();

  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex((po) => po.id === id);
  if (index === -1) {
    throw new Error('Purchase order not found');
  }

  const po = orders[index];
  if (po.status !== 'draft' && po.status !== 'cancelled') {
    throw new Error('Only draft or cancelled purchase orders can be deleted');
  }

  const payments = getStoredSupplierPayments();
  const hasPayments = payments.some((p) => p.purchase_order_id === id);
  if (hasPayments) {
    throw new Error('Cannot delete a purchase order with payments');
  }

  orders.splice(index, 1);
  savePurchaseOrders(orders);

  const items = getStoredPurchaseOrderItems();
  const filteredItems = items.filter((item) => item.purchase_order_id !== id);
  savePurchaseOrderItems(filteredItems);

  return { success: true };
};

export const generatePONumber = async () => {
  await delay();
  const year = new Date().getFullYear();
  const orders = getStoredPurchaseOrders();
  const yearPrefix = `PO-${year}-`;
  const yearOrders = orders.filter(po => po.po_number.startsWith(yearPrefix));
  const nextNum = yearOrders.length + 1;
  return `${yearPrefix}${String(nextNum).padStart(5, '0')}`;
};

export const createPurchaseOrder = async (
  purchaseOrder: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>,
  orderItems: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects a single payload with items[]
    return ipc<any>(
      api.purchases.createOrder({
        ...purchaseOrder,
        items: orderItems,
      })
    );
  }
  await delay();
  
  const poId = generateId();
  const createdAt = new Date().toISOString();
  
  // Create full purchase order
  const fullPO: PurchaseOrder = {
    ...purchaseOrder,
    id: poId,
    created_at: createdAt,
    updated_at: createdAt, // Set to created_at initially
  };
  
  // Create purchase order items
  const fullItems: PurchaseOrderItem[] = orderItems.map(item => ({
    ...item,
    id: generateId(),
    purchase_order_id: poId,
    received_qty: 0, // Initialize received_qty to 0
  }));
  
  // Save to storage
  const orders = getStoredPurchaseOrders();
  orders.push(fullPO);
  savePurchaseOrders(orders);
  
  const items = getStoredPurchaseOrderItems();
  items.push(...fullItems);
  savePurchaseOrderItems(items);
  
  console.log('Purchase order created:', poId, 'with', fullItems.length, 'items');
  
  return fullPO;
};

export const updatePurchaseOrder = async (
  id: string,
  purchaseOrder: Partial<PurchaseOrder>,
  orderItems?: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.updateOrder(id, purchaseOrder, orderItems));
  }
  await delay();
  
  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);
  
  if (index === -1) {
    throw new Error('Purchase order not found');
  }
  
  // Update purchase order
  const updated = {
    ...orders[index],
    ...purchaseOrder,
    id,
    updated_at: new Date().toISOString(),
  };
  orders[index] = updated;
  savePurchaseOrders(orders);
  
  // Update items if provided
  if (orderItems) {
    const items = getStoredPurchaseOrderItems();
    // Remove old items
    const filteredItems = items.filter(item => item.purchase_order_id !== id);
    // Add new items
    const newItems: PurchaseOrderItem[] = orderItems.map(item => ({
      ...item,
      id: generateId(),
      purchase_order_id: id,
      received_qty: 0, // Reset received_qty when updating items
    }));
    filteredItems.push(...newItems);
    savePurchaseOrderItems(filteredItems);
  }
  
  return updated;
};

export const approvePurchaseOrder = async (id: string, _approvedBy: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.approve(id, _approvedBy));
  }
  await delay();
  
  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);
  
  if (index === -1) {
    throw new Error('Purchase order not found');
  }
  
  if (orders[index].status !== 'draft') {
    throw new Error('Only draft purchase orders can be approved');
  }
  
  orders[index].status = 'approved';
  orders[index].updated_at = new Date().toISOString();
  savePurchaseOrders(orders);
  
  return orders[index];
};

export const cancelPurchaseOrder = async (id: string) => {
  await delay();
  
  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);
  
  if (index === -1) {
    throw new Error('Purchase order not found');
  }
  
  const po = orders[index];
  
  // If already cancelled, return early
  if (po.status === 'cancelled') {
    return po;
  }
  
  // If PO was received (or partially received), we need to reverse:
  // 1. Inventory stock (decrease by received quantities)
  // 2. Supplier debt (decrease by PO total_amount)
  if (po.status === 'received' || po.status === 'partially_received') {
    // Get purchase order items to reverse inventory
    const poItems = getStoredPurchaseOrderItems();
    const itemsForPO = poItems.filter(item => item.purchase_order_id === id);
    
    // Reverse inventory for each item that was received
    for (const item of itemsForPO) {
      if (item.received_qty > 0) {
        const product = mockDB.products.find(p => p.id === item.product_id);
        if (product) {
          // Reverse stock: decrease by received quantity
          const beforeStock = product.current_stock;
          const afterStock = Math.max(0, beforeStock - item.received_qty); // Prevent negative stock
          
          product.current_stock = afterStock;
          product.updated_at = new Date().toISOString();
          
          // Create reversal inventory movement
          const movement: InventoryMovement = {
            id: generateId(),
            product_id: item.product_id,
            movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
            movement_type: 'adjustment',
            quantity: -item.received_qty, // Negative for reversal
            before_quantity: beforeStock,
            after_quantity: afterStock,
            reference_type: 'purchase_order',
            reference_id: id,
            reason: 'Purchase order cancelled - reversing received goods',
            notes: `Reversed ${item.received_qty} units from cancelled PO ${po.po_number}`,
            created_by: 'mock-user-id',
            created_at: new Date().toISOString(),
          };
          mockDB.inventoryMovements.push(movement);
          
          console.log(`Reversed inventory for product ${item.product_id}: ${beforeStock} -> ${afterStock} (-${item.received_qty})`);
        }
      }
      
      // Reset received quantity
      item.received_qty = 0;
    }
    
    // Save updated items
    const allItems = getStoredPurchaseOrderItems();
    const otherItems = allItems.filter(item => item.purchase_order_id !== id);
    otherItems.push(...itemsForPO);
    savePurchaseOrderItems(otherItems);
    
    // NOTE: Supplier debt is automatically reversed because:
    // - Balance = SUM(received POs) - SUM(payments)
    // - When PO status changes from 'received' to 'cancelled', it's no longer counted in received POs
    // - So debt automatically decreases by PO.total_amount
    // - We do NOT need to manually adjust balance - it's calculated from transactions
  }
  
  // Update PO status to cancelled
  po.status = 'cancelled';
  po.updated_at = new Date().toISOString();
  savePurchaseOrders(orders);
  
  console.log(`Purchase order ${id} cancelled. Inventory and debt reversed if PO was received.`);
  
  return po;
};

export const receiveGoods = async (
  poId: string,
  items: Array<{
    item_id: string;
    received_qty: number;
    notes?: string;
    product_id?: string; // Optional: if provided, use it directly
  }>,
  receivedDate?: string
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects receiptData: { items: [...], received_by?, received_at? }
    return ipc<any>(
      api.purchases.receiveGoods(poId, {
        items,
        received_at: receivedDate || null,
        // received_by can be set by backend/UI; optional here
      })
    );
  }
  await delay();
  const createdAt = receivedDate ? new Date(receivedDate).toISOString() : new Date().toISOString();
  
  // Get purchase order to check status (idempotency check)
  const orders = getStoredPurchaseOrders();
  const po = orders.find(p => p.id === poId);
  
  if (!po) {
    throw new Error('Purchase order not found');
  }
  
  // IDEMPOTENCY CHECK: Prevent double receiving
  // IMPORTANT: Only check "already received" for EXISTING POs that are fully received
  // This check does NOT apply to NEW POs being created and received in one step
  // The check is based on:
  // 1. Status is 'received' (fully received)
  // 2. AND all items have received_qty >= ordered_qty (double-check)
  const poItems = getStoredPurchaseOrderItems();
  const poItemsForOrder = poItems.filter(item => item.purchase_order_id === poId);
  const allItemsFullyReceived = poItemsForOrder.length > 0 && 
    poItemsForOrder.every(item => item.received_qty >= item.ordered_qty);
  
  // Only block if PO is already fully received (status + all items received)
  // This prevents the error when creating NEW POs that are immediately received
  if (po.status === 'received' && allItemsFullyReceived) {
    throw new Error('Purchase order has already been fully received. Cannot receive again.');
  }
  
  if (po.status === 'cancelled') {
    throw new Error('Cannot receive goods for a cancelled purchase order');
  }
  
  // IDEMPOTENCY: Track previous status to detect if this is the first time receiving
  // This ensures we don't double-count inventory or debt
  // If PO was already received, the idempotency check above prevents processing
  
  // Note: poItemsForOrder was already fetched above for the idempotency check
  // Reuse it here to avoid duplicate filtering
  
  // Track which items were successfully processed
  const processedItems: string[] = [];
  const errors: string[] = [];
  
  // Process each received item
  for (const receiveItem of items) {
    // Find the purchase order item
    const poItem = poItemsForOrder.find(pi => pi.id === receiveItem.item_id);
    
    if (!poItem) {
      errors.push(`Purchase order item ${receiveItem.item_id} not found`);
      continue;
    }
    
    // Get product_id from purchase order item
    const productId = receiveItem.product_id || poItem.product_id;
    
    if (!productId) {
      errors.push(`Product ID not found for item ${receiveItem.item_id}`);
      continue;
    }
    
    // Validate received quantity doesn't exceed ordered quantity
    const newReceivedQty = poItem.received_qty + receiveItem.received_qty;
    if (newReceivedQty > poItem.ordered_qty) {
      errors.push(
        `Received quantity (${newReceivedQty}) exceeds ordered quantity (${poItem.ordered_qty}) for product ${poItem.product_name}`
      );
      continue;
    }
    
    // Find product and update stock
    // IMPORTANT: This updates the product's current_stock, which is what the Inventory page displays
    const product = mockDB.products.find(p => p.id === productId);
    if (!product) {
      errors.push(`Product ${productId} not found in inventory`);
      continue;
    }
    
    // Calculate stock values before update
    const beforeStock = product.current_stock;
    const afterStock = beforeStock + receiveItem.received_qty;
    
    // Update product stock (atomic operation in mock)
    // This is the critical update that increases inventory quantities
    product.current_stock = afterStock;
    product.updated_at = createdAt;
    
    // Update purchase order item received_qty
    poItem.received_qty = newReceivedQty;
    
    // Create inventory movement record
    const movement: InventoryMovement = {
      id: generateId(),
      product_id: productId,
      movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
      movement_type: 'purchase',
      quantity: receiveItem.received_qty, // Positive for purchases (stock increase)
      before_quantity: beforeStock,
      after_quantity: afterStock,
      reference_type: 'purchase_order',
      reference_id: poId,
      reason: 'Purchase order received',
      notes: receiveItem.notes || `Received ${receiveItem.received_qty} units from PO ${po.po_number}`,
      created_by: 'mock-user-id',
      created_at: createdAt,
    };
    mockDB.inventoryMovements.push(movement);
    
    processedItems.push(receiveItem.item_id);
    console.log(`Stock updated for product ${productId}: ${beforeStock} -> ${afterStock} (+${receiveItem.received_qty})`);
  }
  
  // If any errors occurred, throw (atomicity: all or nothing)
  if (errors.length > 0) {
    throw new Error(`Failed to receive goods: ${errors.join('; ')}`);
  }
  
  // Save updated purchase order items
  const allItems = getStoredPurchaseOrderItems();
  const otherItems = allItems.filter(item => item.purchase_order_id !== poId);
  otherItems.push(...poItemsForOrder);
  savePurchaseOrderItems(otherItems);
  
  // Update purchase order status based on received quantities
  const allReceived = poItemsForOrder.every(item => item.received_qty >= item.ordered_qty);
  const someReceived = poItemsForOrder.some(item => item.received_qty > 0);
  
  let newStatus: PurchaseOrder['status'] = po.status;
  if (allReceived) {
    newStatus = 'received';
  } else if (someReceived) {
    newStatus = 'partially_received';
  }
  
  // Update purchase order status
  po.status = newStatus;
  po.updated_at = createdAt;
  savePurchaseOrders(orders);
  
  // IMPORTANT: Supplier debt is created ONLY when PO status becomes 'received' or 'partially_received'
  // Debt = SUM of all received PO amounts
  // This happens automatically when we calculate balance from transactions
  // No manual debt creation needed - it's derived from PO status
  
  // IMPORTANT: Supplier debt is created when PO status becomes 'received' or 'partially_received'
  // Debt = SUM of all received PO amounts
  // Balance is calculated dynamically: balance = debt - payments
  // We do NOT store balance - it's always calculated from transactions
  // This ensures accounting accuracy and prevents inconsistencies
  
  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();
  
  console.log(`Purchase order ${poId} received. Status: ${newStatus}. Processed ${processedItems.length} items.`);
  
  return {
    success: true,
    message: 'Goods received successfully',
    new_status: newStatus,
    processed_items: processedItems.length,
  };
};

export const createPurchaseReceipt = async (payload: {
  purchase_order_id?: string | null;
  supplier_id?: string | null;
  warehouse_id?: string | null;
  currency?: 'USD' | 'UZS';
  exchange_rate?: number | null;
  status?: 'draft' | 'received';
  invoice_number?: string | null;
  received_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  items: Array<{
    purchase_order_item_id?: string | null;
    product_id: string;
    product_name?: string | null;
    received_qty: number;
    unit_cost?: number;
    line_total?: number;
    unit_cost_usd?: number | null;
    line_total_usd?: number | null;
  }>;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.createReceipt(payload));
  }
  await delay();
  throw new Error('Purchase receipts faqat desktop ilovada mavjud');
};
