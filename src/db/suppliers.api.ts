// Suppliers domain API (functions, payments/ledger and returns) split out of
// `api.ts`. Behaviour is unchanged; shared localStorage accessors and IPC
// helpers come from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  delay,
  generateId,
  getStoredPurchaseOrders,
  getStoredSupplierPayments,
  getStoredSuppliers,
  hasPosApi,
  ipc,
  saveSupplierPayments,
  saveSuppliers,
} from './internal';
import type {
  Supplier,
  SupplierWithBalance,
  SupplierPayment,
  SupplierLedgerEntry,
  PurchaseOrder,
} from '@/types/database';

// ============================================================================
// SUPPLIER FUNCTIONS (Mock)
// ============================================================================

export const getSuppliers = async (includeInactive = false): Promise<SupplierWithBalance[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance[]>(api.suppliers.list({ includeInactive }));
  }
  await delay();
  const suppliers = getStoredSuppliers();
  
  // Calculate balance for each supplier
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();
  
  // Filter by status if needed
  let filtered = suppliers;
  if (!includeInactive) {
    filtered = suppliers.filter(s => s.status === 'active');
  }
  
  // Calculate balance: sum of received PO amounts - sum of payments
  // IMPORTANT: Balance is ALWAYS calculated from transactions, never stored
  const suppliersWithBalance = filtered.map(supplier => {
    // Get all received POs for this supplier (ONLY when status is received/partially_received)
    const receivedPOs = purchaseOrders.filter(
      po => po.supplier_id === supplier.id && 
      (po.status === 'received' || po.status === 'partially_received')
    );
    const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
    
    // Get all payments for this supplier
    const supplierPayments = payments.filter(p => p.supplier_id === supplier.id);
    const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);
    
    // Balance = debt - paid (positive = we owe, negative = they owe us)
    // This is the ONLY source of truth - calculated from transactions
    const balance = totalDebt - totalPaid;
    
    return {
      ...supplier,
      balance, // Always calculated, never stored
    };
  });
  
  // Always sort alphabetically by name for consistent results
  return suppliersWithBalance.sort((a, b) => a.name.localeCompare(b.name));
};

export const getSupplierById = async (id: string): Promise<SupplierWithBalance> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.get(id));
  }
  await delay();
  const suppliers = getStoredSuppliers();
  const supplier = suppliers.find(s => s.id === id);
  
  if (!supplier) {
    throw new Error('Supplier not found');
  }
  
  // Calculate balance dynamically
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();
  
  // Get all received POs for this supplier
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === supplier.id && 
    (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
  
  // Get all payments for this supplier
  const supplierPayments = payments.filter(p => p.supplier_id === supplier.id);
  const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);
  
  // Balance = debt - paid (positive = we owe, negative = they owe us)
  const balance = totalDebt - totalPaid;
  
  return {
    ...supplier,
    balance, // Always calculated from transactions, never stored
  };
};

export const searchSuppliers = async (searchTerm: string, includeInactive = false) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance[]>(api.suppliers.list({ search: searchTerm, includeInactive, limit: 10 }));
  }
  await delay();
  const suppliers = getStoredSuppliers();
  const term = searchTerm.toLowerCase().trim();
  
  if (!term) {
    return includeInactive ? suppliers : suppliers.filter(s => s.status === 'active');
  }
  
  // Search by name, phone, or email (case-insensitive)
  const filtered = suppliers.filter(supplier => {
    const matchesSearch =
      supplier.name.toLowerCase().includes(term) ||
      (supplier.phone && supplier.phone.toLowerCase().includes(term)) ||
      (supplier.email && supplier.email.toLowerCase().includes(term));
    
    const matchesStatus = includeInactive || supplier.status === 'active';
    
    return matchesSearch && matchesStatus;
  });
  
  // Return up to 10 results, sorted by name
  return filtered.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
};

export const createSupplier = async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>): Promise<SupplierWithBalance> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.create(supplier));
  }
  await delay();
  
  // Validate required fields
  if (!supplier.name || !supplier.name.trim()) {
    throw new Error('Supplier name is required');
  }
  
  // Validate email format if provided
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    throw new Error('Invalid email format');
  }
  
  // Check for duplicate email (if email is provided)
  if (supplier.email) {
    const existing = getStoredSuppliers();
    const duplicate = existing.find(s => s.email && s.email.toLowerCase() === supplier.email!.toLowerCase());
    if (duplicate) {
      throw new Error('Supplier with this email already exists');
    }
  }
  
  // Create new supplier
  // NOTE: balance is NOT stored - it's calculated dynamically from transactions
  const newSupplier: Supplier = {
    settlement_currency: (supplier as any).settlement_currency || 'USD',
    ...supplier,
    id: generateId(),
    created_at: new Date().toISOString(),
    updated_at: null,
  };
  
  // Save to storage
  const suppliers = getStoredSuppliers();
  suppliers.push(newSupplier);
  
  try {
    saveSuppliers(suppliers);
    
    // Verify the supplier was saved by reading it back immediately
    const verifySuppliers = getStoredSuppliers();
    const savedSupplier = verifySuppliers.find(s => s.id === newSupplier.id);
    
    if (!savedSupplier) {
      console.error('createSupplier error: Supplier was not saved correctly', {
        expectedId: newSupplier.id,
        totalSuppliers: verifySuppliers.length,
        supplierNames: verifySuppliers.map(s => s.name)
      });
      throw new Error('Failed to save supplier - verification failed');
    }
    
    // Balance is not stored - it's calculated dynamically from transactions
    // No need to check or set balance field
    
    console.log('createSupplier success: Supplier saved to localStorage', {
      id: savedSupplier.id,
      name: savedSupplier.name,
      status: savedSupplier.status,
      // Note: balance is calculated dynamically, not stored
    });
    
    // Return supplier with calculated balance (always 0 for new supplier)
    const supplierWithBalance: SupplierWithBalance = {
      ...savedSupplier,
      balance: 0, // New supplier has no transactions, balance is 0
    };
    return supplierWithBalance;
  } catch (error) {
    console.error('createSupplier error: Error saving supplier to localStorage', error);
    throw error instanceof Error ? error : new Error('Failed to save supplier data');
  }
};

export const updateSupplier = async (id: string, updates: Partial<Supplier>): Promise<SupplierWithBalance> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.update(id, updates));
  }
  await delay();
  
  const suppliers = getStoredSuppliers();
  const index = suppliers.findIndex(s => s.id === id);
  
  if (index === -1) {
    throw new Error('Supplier not found');
  }
  
  // Validate email format if being updated
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    throw new Error('Invalid email format');
  }
  
  // Check for duplicate email (if email is being updated)
  if (updates.email) {
    const duplicate = suppliers.find(s => s.id !== id && s.email && s.email.toLowerCase() === updates.email!.toLowerCase());
    if (duplicate) {
      throw new Error('Supplier with this email already exists');
    }
  }
  
  // Update supplier
  const updatedSupplier: Supplier = {
    ...suppliers[index],
    ...updates,
    id, // Ensure ID doesn't change
    updated_at: new Date().toISOString(),
  };
  
  suppliers[index] = updatedSupplier;
  saveSuppliers(suppliers);
  
  // Calculate balance dynamically (balance is never stored)
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();
  
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === updatedSupplier.id && 
    (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
  const supplierPayments = payments.filter(p => p.supplier_id === updatedSupplier.id);
  const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);
  const balance = totalDebt - totalPaid;
  
  return {
    ...updatedSupplier,
    balance, // Always calculated from transactions
  };
};

export const deleteSupplier = async (
  id: string
): Promise<{ success: boolean; softDeleted?: boolean; message?: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ success: boolean; softDeleted?: boolean; message?: string }>(api.suppliers.delete(id));
  }
  await delay();
  
  const suppliers = getStoredSuppliers();
  const index = suppliers.findIndex(s => s.id === id);
  
  if (index === -1) {
    throw new Error('Supplier not found');
  }
  
  // Mock behavior aligns with real DB:
  // - if supplier has purchase orders, soft-delete (inactive) to preserve history
  try {
    const storedPOs = localStorage.getItem('pos_purchase_orders');
    if (storedPOs) {
      const purchaseOrders = JSON.parse(storedPOs) as PurchaseOrder[];
      const hasPurchaseOrders = purchaseOrders.some(po => po.supplier_id === id);
      if (hasPurchaseOrders) {
        suppliers[index] = {
          ...suppliers[index],
          status: 'inactive',
          updated_at: new Date().toISOString(),
        };
        saveSuppliers(suppliers);
        return { success: true, softDeleted: true };
      }
    }
  } catch (error) {
    console.warn('Could not check purchase orders for supplier deletion:', error);
    // Fall through to hard delete (best-effort)
  }
  
  // Remove supplier
  suppliers.splice(index, 1);
  saveSuppliers(suppliers);
  return { success: true, softDeleted: false };
};

// ============================================================================
// SUPPLIER PAYMENTS & LEDGER
// ============================================================================

/**
 * Generate unique payment number
 */
const generateSupplierPaymentNumber = (): string => {
  const today = new Date();
  const datePart = today.toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `SPAY-${datePart}-${timestamp}`;
};

/**
 * Create a supplier payment
 */
export const createSupplierPayment = async (paymentData: {
  supplier_id: string;
  purchase_order_id?: string | null;
  amount: number;
  amount_usd?: number | null;
  currency?: 'UZS' | 'USD';
  fx_rate?: number | null;
  payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';
  paid_at?: string;
  note?: string | null;
  created_by?: string | null;
}): Promise<{ success: boolean; payment?: SupplierPayment; new_balance?: number; error?: string }> => {
  // Real implementation (Electron SQLite)
  if (hasPosApi()) {
    try {
      const api = requireElectron();
      const payment = await ipc<SupplierPayment>(api.suppliers.createPayment(paymentData));
      // Refresh supplier to get updated computed balance (source of truth: supplier_payments + received POs)
      let new_balance: number | undefined = undefined;
      try {
        const supplier = await ipc<any>(api.suppliers.get(paymentData.supplier_id));
        if (supplier && typeof supplier.balance === 'number') new_balance = supplier.balance;
      } catch {
        // ignore
      }
      return { success: true, payment, new_balance };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  await delay();
  
  // Validate amount
  const amountValue = paymentData.currency === 'USD' ? Number(paymentData.amount_usd || 0) : Number(paymentData.amount);
  if (!amountValue || amountValue <= 0) {
    return {
      success: false,
      error: 'Payment amount must be greater than zero',
    };
  }
  
  // Validate supplier exists
  const suppliers = getStoredSuppliers();
  const supplier = suppliers.find(s => s.id === paymentData.supplier_id);
  if (!supplier) {
    return {
      success: false,
      error: 'Supplier not found',
    };
  }
  
  // If purchase_order_id is provided, validate PO exists and is not cancelled
  if (paymentData.purchase_order_id) {
    const orders = getStoredPurchaseOrders();
    const po = orders.find(p => p.id === paymentData.purchase_order_id);
    if (!po) {
      return {
        success: false,
        error: 'Purchase order not found',
      };
    }
    if (po.status === 'cancelled') {
      return {
        success: false,
        error: 'Cannot pay for a cancelled purchase order',
      };
    }
  }
  
  // Create payment record
  const payment: SupplierPayment = {
    id: generateId(),
    payment_number: generateSupplierPaymentNumber(),
    supplier_id: paymentData.supplier_id,
    purchase_order_id: paymentData.purchase_order_id || null,
    amount: paymentData.currency === 'USD' ? 0 : paymentData.amount,
    currency: paymentData.currency || 'UZS',
    amount_usd: paymentData.currency === 'USD' ? Number(paymentData.amount_usd || 0) : null,
    payment_method: paymentData.payment_method,
    paid_at: paymentData.paid_at || new Date().toISOString(),
    note: paymentData.note || null,
    created_by: paymentData.created_by || null,
    created_at: new Date().toISOString(),
  };
  
  // Save payment
  const payments = getStoredSupplierPayments();
  payments.push(payment);
  saveSupplierPayments(payments);
  
  // Calculate new supplier balance from transactions
  // IMPORTANT: Balance is NEVER stored - always calculated from transactions
  const purchaseOrders = getStoredPurchaseOrders();
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === paymentData.supplier_id && 
    (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
  const allPayments = payments.filter(p => p.supplier_id === paymentData.supplier_id);
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
  const newBalance = totalDebt - totalPaid;
  
  // Do NOT store balance - it's calculated dynamically
  // Balance is the source of truth from transactions only
  
  console.log(`Supplier payment created: ${payment.payment_number} for supplier ${paymentData.supplier_id}, amount: ${paymentData.amount}`);
  
  return {
    success: true,
    payment,
    new_balance: newBalance,
  };
};

/**
 * Get supplier payments
 */
export const getSupplierPayments = async (supplierId: string): Promise<SupplierPayment[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierPayment[]>(api.suppliers.getPayments(supplierId));
  }
  await delay();
  const payments = getStoredSupplierPayments();
  return payments
    .filter(p => p.supplier_id === supplierId)
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
};

export const deleteSupplierPayment = async (paymentId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (!api?.suppliers?.deletePayment) {
      throw new Error('Ilovani qayta ishga tushiring (deletePayment handler yangilandi)');
    }
    return ipc<{ success: boolean }>(api.suppliers.deletePayment(paymentId));
  }
  await delay();
  const payments = getStoredSupplierPayments();
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) throw new Error('Payment not found');
  payments.splice(index, 1);
  saveSupplierPayments(payments);
  return { success: true };
};

/**
 * Get supplier ledger (transaction history)
 */
export const getSupplierLedger = async (
  supplierId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<SupplierLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierLedgerEntry[]>(
      api.suppliers.getLedger(supplierId, { date_from: dateFrom, date_to: dateTo })
    );
  }
  await delay();
  
  const purchaseOrders = getStoredPurchaseOrders();
  const payments = getStoredSupplierPayments();
  
  const ledger: SupplierLedgerEntry[] = [];
  let runningBalance = 0;
  
  // Get all received POs for this supplier
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === supplierId && 
    (po.status === 'received' || po.status === 'partially_received')
  );
  
  // Add PO entries (DEBIT - increases debt)
  for (const po of receivedPOs) {
    if (dateFrom && po.order_date < dateFrom) continue;
    if (dateTo && po.order_date > dateTo) continue;
    
    runningBalance += po.total_amount;
    ledger.push({
      date: po.order_date,
      type: 'PURCHASE',
      reference: po.po_number,
      debit: po.total_amount,
      credit: 0,
      balance: runningBalance,
      purchase_order_id: po.id,
    });
  }
  
  // Get all payments for this supplier
  const supplierPayments = payments.filter(p => p.supplier_id === supplierId);
  
  // Add payment entries (CREDIT - decreases debt)
  for (const payment of supplierPayments) {
    const paymentDate = payment.paid_at.split('T')[0];
    if (dateFrom && paymentDate < dateFrom) continue;
    if (dateTo && paymentDate > dateTo) continue;
    
    runningBalance -= payment.amount;
    ledger.push({
      date: paymentDate,
      type: 'PAYMENT',
      reference: payment.payment_number,
      debit: 0,
      credit: payment.amount,
      balance: runningBalance,
      payment_id: payment.id,
      purchase_order_id: payment.purchase_order_id,
    });
  }
  
  // Sort by date (oldest first)
  ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Recalculate running balance in correct order
  let recalculatedBalance = 0;
  for (const entry of ledger) {
    recalculatedBalance += entry.debit - entry.credit;
    entry.balance = recalculatedBalance;
  }
  
  return ledger;
};

// ============================================================================
// SUPPLIER RETURNS (CREDIT NOTES)
// ============================================================================

export const createSupplierReturn = async (payload: {
  supplier_id: string;
  purchase_order_id?: string | null;
  warehouse_id?: string;
  status?: 'draft' | 'completed' | 'cancelled';
  return_reason?: string | null;
  notes?: string | null;
  created_by?: string | null;
  return_date?: string;
  items: { product_id: string; quantity: number; unit_cost?: number; reason?: string | null }[];
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.suppliers.createReturn(payload));
  }
  await delay();
  throw new Error('Supplier return faqat desktop ilovada mavjud');
};

export const getSupplierReturn = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.suppliers.getReturn(id));
  }
  await delay();
  throw new Error('Supplier return faqat desktop ilovada mavjud');
};

export const listSupplierReturns = async (filters?: {
  supplier_id?: string;
  purchase_order_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.suppliers.listReturns(filters || {}));
  }
  await delay();
  return [];
};

export const getSupplierPurchaseSummary = async (
  supplierId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<any[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.suppliers.getPurchaseSummary(supplierId, { date_from: dateFrom, date_to: dateTo }));
  }
  await delay();
  return [];
};
