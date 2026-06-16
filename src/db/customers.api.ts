// Customer domain: CRUD, search, stats, order/payment/return history.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  delay,
  generateId,
  getStoredCustomers,
  hasPosApi,
  ipc,
  saveCustomers,
} from './internal';
import type {
  Customer,
} from '@/types/database';

// NOTE: Customer/order/payment/sales-return localStorage helpers moved to ./internal.

const customersListInFlight = new Map<string, Promise<Customer[]>>();

function customersListCacheKey(filters?: {
  searchTerm?: string;
  type?: string;
  status?: string;
  hasDebt?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  return JSON.stringify(filters || {});
}

export const getCustomers = async (filters?: {
  searchTerm?: string;
  type?: string;
  status?: string;
  hasDebt?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  if (hasPosApi()) {
    const cacheKey = customersListCacheKey(filters);
    const pending = customersListInFlight.get(cacheKey);
    if (pending) return pending;

    const api = requireElectron();
    const f: any = {};
    if (filters?.searchTerm) f.search = filters.searchTerm;
    if (filters?.status) f.status = filters.status;
    if (filters?.type) f.type = filters.type;
    if (filters?.sortBy) f.sortBy = filters.sortBy;
    if (filters?.sortOrder) f.sortOrder = filters.sortOrder;
    const request = ipc<Customer[]>(api.customers.list(f)).finally(() => {
      if (customersListInFlight.get(cacheKey) === request) {
        customersListInFlight.delete(cacheKey);
      }
    });
    customersListInFlight.set(cacheKey, request);
    return request;
  }
  await delay();
  
  let customers = getStoredCustomers();
  
  // Apply filters
  if (filters) {
    if (filters.searchTerm) {
      const search = filters.searchTerm.toLowerCase();
      customers = customers.filter(c => 
        c.name.toLowerCase().includes(search) ||
        (c.phone && c.phone.toLowerCase().includes(search)) ||
        (c.email && c.email.toLowerCase().includes(search)) ||
        (c.company_name && c.company_name.toLowerCase().includes(search))
      );
    }
    
    if (filters.type && filters.type !== 'all') {
      customers = customers.filter(c => c.type === filters.type);
    }
    
    if (filters.status && filters.status !== 'all') {
      customers = customers.filter(c => c.status === filters.status);
    }
    
    if (filters.hasDebt !== undefined) {
      if (filters.hasDebt) {
        customers = customers.filter(c => (c.balance || 0) < 0);
      } else {
        customers = customers.filter(c => (c.balance || 0) >= 0);
      }
    }
    
    // Apply sorting
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';
    customers.sort((a, b) => {
      let aVal: any = a[sortBy as keyof Customer];
      let bVal: any = b[sortBy as keyof Customer];
      
      // Handle null/undefined values
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';
      
      // Handle numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      
      if (sortOrder === 'asc') {
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
      } else {
        return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
      }
    });
  }
  
  return customers;
};

export const getCustomerById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    try {
      return await ipc<Customer>(api.customers.get(id));
    } catch {
      // Fallback for environments where single-customer endpoint is unstable.
      // Use list endpoint and resolve on client.
      const list = await ipc<Customer[]>(api.customers.list({}));
      const found = list.find((c) => String((c as any).id) === String(id));
      if (found) return found;
      throw new Error('Customer not found');
    }
  }
  await delay();
  const customers = getStoredCustomers();
  const customer = customers.find(c => String((c as any).id) === String(id));
  if (!customer) {
    throw new Error('Customer not found');
  }
  return customer;
};

export const getCustomerWithStats = async (_id: string) => {
  await delay();
  return null;
};

export const searchCustomers = async (searchTerm: string) => {
  await delay();
  const customers = getStoredCustomers();
  if (!searchTerm) return customers;
  
  const search = searchTerm.toLowerCase();
  return customers.filter(c => 
    c.name.toLowerCase().includes(search) ||
    (c.phone && c.phone.toLowerCase().includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search))
  );
};

export const findCustomerByPhone = async (phone: string) => {
  if (!phone?.trim()) return null;
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer | null>(api.customers.findByPhone(phone));
  }
  await delay();
  const digits = phone.replace(/\D/g, '');
  const customers = getStoredCustomers();
  return (
    customers.find((c) => {
      const stored = String(c.phone || '').replace(/\D/g, '');
      if (!stored || !digits) return false;
      if (stored === digits) return true;
      if (stored.length === 9 && digits.endsWith(stored)) return true;
      if (digits.length === 9 && stored.endsWith(digits)) return true;
      return false;
    }) || null
  );
};

export const createCustomer = async (customer: {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  type?: 'individual' | 'company';
  pricing_tier?: 'retail' | 'master';
  company_name?: string | null;
  tax_number?: string | null;
  credit_limit?: number;
  allow_debt?: boolean;
  notes?: string | null;
  status?: 'active' | 'inactive';
  bonus_points?: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.create(customer));
  }
  await delay();
  
  // Read existing customers
  const customers = getStoredCustomers();
  
  // Create new customer object
  const newCustomer: Customer = {
    ...customer,
    id: generateId(),
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    address: customer.address ?? null,
    company_name: customer.company_name ?? null,
    tax_number: customer.tax_number ?? null,
    notes: customer.notes ?? null,
    balance: 0,
    total_sales: 0,
    total_orders: 0,
    last_order_date: null,
    bonus_points: customer.bonus_points ?? 0,
    credit_limit: customer.credit_limit || 0,
    allow_debt: customer.allow_debt ?? false,
    status: customer.status || 'active',
    type: customer.type || 'individual',
    pricing_tier: customer.pricing_tier || 'retail',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  // Append to array and save
  customers.push(newCustomer);
  saveCustomers(customers);
  
  return newCustomer;
};

export const updateCustomer = async (id: string, updates: Partial<Customer>): Promise<Customer> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.update(id, updates));
  }
  await delay();
  
  const customers = getStoredCustomers();
  const index = customers.findIndex(c => c.id === id);
  
  if (index === -1) {
    throw new Error('Customer not found');
  }
  
  // Update customer
  const updatedCustomer: Customer = {
    ...customers[index],
    ...updates,
    id,
    updated_at: new Date().toISOString(),
  };
  
  customers[index] = updatedCustomer;
  saveCustomers(customers);
  
  return updatedCustomer;
};

export const deleteCustomer = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ success: boolean }>(api.customers.delete(id));
  }
  await delay();
  
  const customers = getStoredCustomers();
  const filtered = customers.filter(c => c.id !== id);
  
  if (filtered.length === customers.length) {
    throw new Error('Customer not found');
  }
  
  saveCustomers(filtered);
};

export const getCustomerOrders = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

export const getCustomerOrderPayments = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

export const getCustomerReturns = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

