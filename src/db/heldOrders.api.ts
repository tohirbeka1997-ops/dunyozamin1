// Held orders (parked carts) domain API, split out of `api.ts`.
//
// Pure localStorage-backed mock domain — no Electron IPC path. Shared storage
// helpers live in `./internal`.

import { delay, generateId, loadHeldOrdersFromStorage, mockDB, saveHeldOrdersToStorage } from './internal';
import type { CartItem, HeldOrder } from '@/types/database';

export const generateHeldNumber = async (): Promise<string> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  // Find the highest number in existing held orders
  const existingNumbers = mockDB.heldOrders
    .filter(order => order.held_number.match(/^HOLD-\d+$/))
    .map(order => {
      const match = order.held_number.match(/^HOLD-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  
  const nextNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) + 1 
    : 1;
  
  return `HOLD-${String(nextNumber).padStart(3, '0')}`;
};

export const saveHeldOrder = async (heldOrderData: {
  held_number: string;
  cashier_id: string;
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  items: CartItem[];
  discount: { type: 'amount' | 'percent'; value: number } | null;
  note: string | null;
}): Promise<HeldOrder> => {
  await delay();
  
  const newHeldOrder: HeldOrder = {
    id: generateId(),
    held_number: heldOrderData.held_number,
    cashier_id: heldOrderData.cashier_id,
    shift_id: heldOrderData.shift_id,
    customer_id: heldOrderData.customer_id,
    customer_name: heldOrderData.customer_name,
    items: heldOrderData.items,
    discount: heldOrderData.discount,
    note: heldOrderData.note,
    status: 'HELD',
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  
  // Reload from storage before push - ensures we never overwrite existing held orders
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  mockDB.heldOrders.push(newHeldOrder);
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return newHeldOrder;
};

export const getHeldOrders = async (): Promise<HeldOrder[]> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  // Return only HELD orders, sorted by created_at DESC (newest first)
  return mockDB.heldOrders
    .filter(order => order.status === 'HELD')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

export const getHeldOrderById = async (id: string): Promise<HeldOrder | null> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const order = mockDB.heldOrders.find(order => order.id === id);
  return order || null;
};

export const updateHeldOrderStatus = async (
  id: string, 
  status: 'RESTORED' | 'CANCELLED'
): Promise<HeldOrder> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }
  
  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    status,
    updated_at: new Date().toISOString(),
  };
  
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return mockDB.heldOrders[index];
};

export const updateHeldOrderName = async (
  id: string, 
  customerName: string
): Promise<HeldOrder> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }
  
  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    customer_name: customerName || null,
    updated_at: new Date().toISOString(),
  };
  
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return mockDB.heldOrders[index];
};

export const deleteHeldOrder = async (id: string): Promise<void> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }
  
  // Actually delete the order (not just mark as CANCELLED)
  mockDB.heldOrders.splice(index, 1);
  saveHeldOrdersToStorage(mockDB.heldOrders);
};
