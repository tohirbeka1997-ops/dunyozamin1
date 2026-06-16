// Purchase order read domain: list and get-by-id.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  delay,
  getStoredPurchaseOrderItems,
  getStoredPurchaseOrders,
  getStoredSupplierPayments,
  getStoredSuppliers,
  hasPosApi,
  ipc,
} from './internal';
import type {
  PurchaseOrderWithDetails,
} from '@/types/database';

// Get purchase orders from localStorage
export const getPurchaseOrders = async (filters?: {
  status?: string;
  supplier_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  include_items?: boolean;
  warehouse_id?: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.list(filters || {}));
  }
  await delay();
  const orders = getStoredPurchaseOrders();
  const items = getStoredPurchaseOrderItems();
  const suppliers = getStoredSuppliers();
  
  let filtered = orders;
  
  // Apply filters
  if (filters?.status) {
    filtered = filtered.filter(po => po.status === filters.status);
  }
  if (filters?.supplier_id) {
    filtered = filtered.filter(po => po.supplier_id === filters.supplier_id);
  }
  if (filters?.date_from) {
    filtered = filtered.filter(po => po.order_date >= filters.date_from!);
  }
  if (filters?.date_to) {
    filtered = filtered.filter(po => po.order_date <= filters.date_to!);
  }
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(po => 
      po.po_number.toLowerCase().includes(searchLower) ||
      (po.supplier_name && po.supplier_name.toLowerCase().includes(searchLower))
    );
  }
  
  // Get supplier payments to calculate paid_amount
  const payments = getStoredSupplierPayments();
  
  // Build PurchaseOrderWithDetails with payment info
  return filtered.map(po => {
    // Calculate paid amount for this PO
    const poPayments = payments.filter(p => p.purchase_order_id === po.id);
    const paidAmount = poPayments.reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = po.total_amount - paidAmount;
    
    // Determine payment status
    let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
    if (paidAmount >= po.total_amount) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0) {
      paymentStatus = 'PARTIALLY_PAID';
    }
    
    return {
      ...po,
      items: items.filter(item => item.purchase_order_id === po.id),
      supplier: po.supplier_id ? suppliers.find(s => s.id === po.supplier_id) : undefined,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus,
    };
  }) as PurchaseOrderWithDetails[];
};

export const getPurchaseOrderById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.get(id));
  }
  await delay();
  const orders = getStoredPurchaseOrders();
  const items = getStoredPurchaseOrderItems();
  const suppliers = getStoredSuppliers();
  const payments = getStoredSupplierPayments();
  
  const order = orders.find(po => po.id === id);
  if (!order) {
    throw new Error('Purchase order not found');
  }
  
  // Calculate paid amount for this PO
  const poPayments = payments.filter(p => p.purchase_order_id === id);
  const paidAmount = poPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = order.total_amount - paidAmount;
  
  // Determine payment status
  let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (paidAmount >= order.total_amount) {
    paymentStatus = 'PAID';
  } else if (paidAmount > 0) {
    paymentStatus = 'PARTIALLY_PAID';
  }
  
  return {
    ...order,
    items: items.filter(item => item.purchase_order_id === id),
    supplier: order.supplier_id ? suppliers.find(s => s.id === order.supplier_id) : undefined,
    paid_amount: paidAmount,
    remaining_amount: remainingAmount,
    payment_status: paymentStatus,
  } as PurchaseOrderWithDetails;
};

