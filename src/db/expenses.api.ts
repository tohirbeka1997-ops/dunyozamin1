// Expenses domain API (split out of the legacy `api.ts` facade).
//
// Behaviour is identical to the previous inline implementation; only the
// location changed. Shared infrastructure (IPC helpers, mock storage, id
// helpers, profile stubs) is imported from `./internal`.

import { requireElectron } from '@/utils/electron';
import { formatDateYMD } from '@/lib/datetime';
import {
  delay,
  generateId,
  getProfiles,
  hasPosApi,
  ipc,
  loadExpensesFromStorage,
  mockDB,
  saveExpensesToStorage,
} from './internal';
import type {
  Expense,
  ExpenseWithDetails,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseStatus,
} from '@/types/database';

/**
 * Generate expense number
 */
const generateExpenseNumber = (): string => {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const year = today.substring(0, 4);
  const yearPrefix = `EXP-${year}-`;
  
  // Get existing expenses with same prefix from storage
  const storedExpenses = loadExpensesFromStorage();
  const existingExpenses = storedExpenses.filter(e => e.expense_number.startsWith(yearPrefix));
  const nextNum = existingExpenses.length > 0
    ? Math.max(...existingExpenses.map(e => {
        const numStr = e.expense_number.replace(yearPrefix, '');
        return parseInt(numStr, 10) || 0;
      })) + 1
    : 1;
  
  return `${yearPrefix}${String(nextNum).padStart(5, '0')}`;
};

/**
 * Get all expenses
 */
export const getExpenses = async (filters?: {
  dateFrom?: string;
  dateTo?: string;
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  employeeId?: string;
  status?: ExpenseStatus;
  search?: string;
}): Promise<ExpenseWithDetails[]> => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {};
    if (filters?.dateFrom) payload.date_from = filters.dateFrom;
    if (filters?.dateTo) payload.date_to = filters.dateTo;
    if (filters?.status) payload.status = filters.status;
    // Backend filters by category_id/status only; we filter by category/payment/search client-side.
    const rows = await ipc<any[]>(api.expenses.list(payload));
    const profiles = await getProfiles();

    let mapped: any[] = (rows || []).map((e: any) => {
      const categoryName = e?.category_name ?? e?.categoryName ?? e?.category ?? '';
      const createdBy = e?.created_by ?? e?.createdBy ?? null;
      return {
        ...e,
        // normalize to UI shape
        category: categoryName || 'Boshqa',
        currency:
          String(e?.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : ('UZS' as const),
        fx_rate: e?.fx_rate != null ? Number(e.fx_rate) : null,
        note: e?.note ?? e?.description ?? e?.notes ?? null,
        employee_id: e?.employee_id ?? createdBy ?? null,
        created_by: createdBy ?? null,
      };
    });

    if (filters?.category) mapped = mapped.filter((e) => String(e.category) === String(filters.category));
    if (filters?.paymentMethod) mapped = mapped.filter((e) => String(e.payment_method) === String(filters.paymentMethod));
    if (filters?.employeeId) mapped = mapped.filter((e) => String(e.employee_id || '') === String(filters.employeeId));
    if (filters?.status) mapped = mapped.filter((e) => String(e.status || '').toLowerCase() === String(filters.status).toLowerCase());
    if (filters?.search) {
      const s = String(filters.search).toLowerCase();
      mapped = mapped.filter((e) =>
        String(e.expense_number || '').toLowerCase().includes(s) ||
        String(e.note || '').toLowerCase().includes(s) ||
        String(e.category || '').toLowerCase().includes(s)
      );
    }

    // Enrich with profile data (same as mock)
    return mapped.map((expense) => ({
      ...expense,
      employee: expense.employee_id ? profiles.find((p) => p.id === expense.employee_id) : undefined,
      created_by_profile: expense.created_by ? profiles.find((p) => p.id === expense.created_by) : undefined,
    })) as any;
  }

  await delay();
  
  // Load from storage instead of mockDB
  let expenses = [...loadExpensesFromStorage()];
  
  // Apply filters
  if (filters?.dateFrom) {
    expenses = expenses.filter(e => e.expense_date >= filters.dateFrom!);
  }
  if (filters?.dateTo) {
    expenses = expenses.filter(e => e.expense_date <= filters.dateTo!);
  }
  if (filters?.category) {
    expenses = expenses.filter(e => e.category === filters.category);
  }
  if (filters?.paymentMethod) {
    expenses = expenses.filter(e => e.payment_method === filters.paymentMethod);
  }
  if (filters?.employeeId) {
    expenses = expenses.filter(e => e.employee_id === filters.employeeId);
  }
  if (filters?.status) {
    expenses = expenses.filter(e => String(e.status || '').toLowerCase() === String(filters.status).toLowerCase());
  }
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    expenses = expenses.filter(e =>
      e.expense_number.toLowerCase().includes(searchLower) ||
      e.note?.toLowerCase().includes(searchLower) ||
      e.category.toLowerCase().includes(searchLower)
    );
  }
  
  // Sort by date (newest first)
  expenses.sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime());
  
  // Enrich with profile data
  const profiles = await getProfiles();
  return expenses.map(expense => ({
    ...expense,
    employee: expense.employee_id ? profiles.find(p => p.id === expense.employee_id) : undefined,
    created_by_profile: expense.created_by ? profiles.find(p => p.id === expense.created_by) : undefined,
  }));
};

/**
 * Get expense by ID
 */
export const getExpenseById = async (id: string): Promise<ExpenseWithDetails | null> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<any[]>(api.expenses.list({})).catch(() => []);
    const found = (rows || []).find((e: any) => String(e?.id) === String(id));
    if (!found) return null;
    const profiles = await getProfiles();
    const categoryName = found?.category_name ?? found?.categoryName ?? found?.category ?? '';
    const createdBy = found?.created_by ?? found?.createdBy ?? null;
    const normalized: any = {
      ...found,
      category: categoryName || 'Boshqa',
      note: found?.note ?? found?.description ?? found?.notes ?? null,
      employee_id: found?.employee_id ?? createdBy ?? null,
      created_by: createdBy ?? null,
    };
    return {
      ...normalized,
      employee: normalized.employee_id ? profiles.find((p) => p.id === normalized.employee_id) : undefined,
      created_by_profile: normalized.created_by ? profiles.find((p) => p.id === normalized.created_by) : undefined,
    } as any;
  }

  await delay();
  const expenses = loadExpensesFromStorage();
  const expense = expenses.find(e => e.id === id);
  if (!expense) return null;
  
  const profiles = await getProfiles();
  return {
    ...expense,
    employee: expense.employee_id ? profiles.find(p => p.id === expense.employee_id) : undefined,
    created_by_profile: expense.created_by ? profiles.find(p => p.id === expense.created_by) : undefined,
  };
};

/**
 * Create expense
 */
export const createExpense = async (expenseData: {
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: ExpensePaymentMethod;
  currency?: 'UZS' | 'USD';
  fx_rate?: number | null;
  note?: string | null;
  employee_id?: string | null;
  created_by?: string | null;
  status?: ExpenseStatus;
}): Promise<Expense> => {
  if (hasPosApi()) {
    const api = requireElectron();
    // Ensure category exists (by name). If not, create it.
    const name = String(expenseData.category || 'Boshqa').trim() || 'Boshqa';
    const categories = await ipc<any[]>(api.expenses.listCategories({})).catch(() => []);
    let cat = (categories || []).find((c: any) => String(c?.name || '').trim() === name);
    if (!cat?.id) {
      const codeBase = name
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w]/g, '')
        .slice(0, 16);
      const code = codeBase || `CAT_${Date.now()}`;
      cat = await ipc<any>(api.expenses.createCategory({ code, name, description: null, is_active: 1 }));
    }

    // `expenses` table stores only `created_by`, so map selected employee first.
    const createdBy = expenseData.employee_id || expenseData.created_by || null;
    const description = String(expenseData.note ?? '').trim() || name;
    const row = await ipc<any>(
      api.expenses.create({
        category_id: cat.id,
        amount: expenseData.amount,
        payment_method: expenseData.payment_method,
        expense_date: expenseData.expense_date,
        description,
        receipt_url: null,
        vendor: null,
        status: expenseData.status || 'approved',
        notes: null,
        created_by: createdBy,
        currency: expenseData.currency || 'UZS',
        fx_rate: expenseData.currency === 'USD' ? expenseData.fx_rate ?? null : null,
      })
    );

    // Normalize to UI Expense shape
    return {
      ...row,
      category: row?.category_name ?? name,
      note: row?.description ?? null,
      employee_id: createdBy,
      created_by: createdBy,
      currency: row?.currency ?? expenseData.currency ?? 'UZS',
      fx_rate: row?.fx_rate ?? expenseData.fx_rate ?? null,
    } as any;
  }

  await delay();
  
  const expense: Expense = {
    id: generateId(),
    expense_number: generateExpenseNumber(),
    expense_date: expenseData.expense_date,
    category: expenseData.category,
    amount: expenseData.amount,
    payment_method: expenseData.payment_method,
    note: expenseData.note || null,
    employee_id: expenseData.employee_id || null,
    created_by: expenseData.created_by || null,
    status: expenseData.status || 'approved',
    currency: expenseData.currency || 'UZS',
    fx_rate: expenseData.currency === 'USD' ? expenseData.fx_rate ?? null : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  // Save to storage
  const expenses = loadExpensesFromStorage();
  expenses.push(expense);
  saveExpensesToStorage(expenses);
  
  // Also update mockDB for consistency
  mockDB.expenses = expenses;
  
  return expense;
};

/**
 * Update expense
 */
export const updateExpense = async (
  id: string,
  updates: {
    expense_date?: string;
    category?: ExpenseCategory;
    amount?: number;
    payment_method?: ExpensePaymentMethod;
    note?: string | null;
    employee_id?: string | null;
    status?: ExpenseStatus;
    currency?: 'UZS' | 'USD';
    fx_rate?: number | null;
  }
): Promise<Expense> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {};
    if (updates.amount !== undefined) payload.amount = updates.amount;
    if (updates.currency !== undefined) payload.currency = updates.currency;
    if (updates.fx_rate !== undefined) payload.fx_rate = updates.fx_rate;
    if (updates.payment_method !== undefined) payload.payment_method = updates.payment_method;
    if (updates.expense_date !== undefined) payload.expense_date = updates.expense_date;
    if (updates.note !== undefined) payload.description = String(updates.note ?? '').trim() || null;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.employee_id !== undefined) payload.created_by = updates.employee_id || null;

    // Category change: ensure category exists and pass category_id
    if (updates.category !== undefined) {
      const name = String(updates.category || 'Boshqa').trim() || 'Boshqa';
      const categories = await ipc<any[]>(api.expenses.listCategories({})).catch(() => []);
      let cat = (categories || []).find((c: any) => String(c?.name || '').trim() === name);
      if (!cat?.id) {
        const codeBase = name
          .toUpperCase()
          .replace(/\s+/g, '_')
          .replace(/[^\w]/g, '')
          .slice(0, 16);
        const code = codeBase || `CAT_${Date.now()}`;
        cat = await ipc<any>(api.expenses.createCategory({ code, name, description: null, is_active: 1 }));
      }
      payload.category_id = cat.id;
    }

    const row = await ipc<any>(api.expenses.update(id, payload));
    const categoryName = row?.category_name ?? row?.categoryName ?? row?.category ?? updates.category ?? 'Boshqa';
    return {
      ...row,
      category: categoryName,
      note: row?.description ?? null,
      employee_id: row?.employee_id ?? row?.created_by ?? null,
      created_by: row?.created_by ?? null,
      currency: row?.currency ?? updates.currency ?? 'UZS',
      fx_rate: row?.fx_rate ?? updates.fx_rate ?? null,
    } as any;
  }

  await delay();
  
  const expenses = loadExpensesFromStorage();
  const expenseIndex = expenses.findIndex(e => e.id === id);
  if (expenseIndex === -1) {
    throw new Error('Expense not found');
  }
  
  const expense = expenses[expenseIndex];
  const updated: Expense = {
    ...expense,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  
  expenses[expenseIndex] = updated;
  saveExpensesToStorage(expenses);
  
  // Also update mockDB for consistency
  mockDB.expenses = expenses;
  
  return updated;
};

/**
 * Delete expense
 */
export const deleteExpense = async (id: string): Promise<void> => {
  if (hasPosApi()) {
    const api = requireElectron();
    await ipc<any>(api.expenses.delete(id));
    return;
  }

  await delay();
  
  const expenses = loadExpensesFromStorage();
  const expenseIndex = expenses.findIndex(e => e.id === id);
  if (expenseIndex === -1) {
    throw new Error('Expense not found');
  }
  
  expenses.splice(expenseIndex, 1);
  saveExpensesToStorage(expenses);
  
  // Also update mockDB for consistency
  mockDB.expenses = expenses;
};

/**
 * Get expense statistics
 */
export const getExpenseStats = async (filters?: {
  dateFrom?: string;
  dateTo?: string;
  status?: ExpenseStatus;
}): Promise<{
  totalUzs: number;
  totalUsd: number;
  todayUzs: number;
  todayUsd: number;
  monthlyUzs: number;
  monthlyUsd: number;
  topCategory: { category: ExpenseCategory; amount: number; currency?: 'UZS' | 'USD' } | null;
}> => {
  const sumBuckets = (list: any[]) => {
    let totalUzs = 0;
    let totalUsd = 0;
    for (const e of list) {
      const amt = Number(e?.amount || 0) || 0;
      const cur = String(e?.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      if (cur === 'USD') totalUsd += amt;
      else totalUzs += amt;
    }
    return { totalUzs, totalUsd };
  };

  if (hasPosApi()) {
    // Compute stats client-side from DB list (backend doesn't expose a stats endpoint)
    const all = await getExpenses({});
    const today = formatDateYMD(new Date());
    const now = new Date();
    const monthStart = formatDateYMD(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatDateYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    // Apply status/date filters for totals and keep consistent semantics with reports.
    let filtered = [...all] as any[];
    if (filters?.status) filtered = filtered.filter((e) => String(e.status || '').toLowerCase() === String(filters.status).toLowerCase());
    if (filters?.dateFrom) filtered = filtered.filter((e) => String(e.expense_date) >= String(filters.dateFrom));
    if (filters?.dateTo) filtered = filtered.filter((e) => String(e.expense_date) <= String(filters.dateTo));

    const { totalUzs, totalUsd } = sumBuckets(filtered);
    const todayFiltered = filtered.filter((e) => e.expense_date === today);
    const { totalUzs: todayUzs, totalUsd: todayUsd } = sumBuckets(todayFiltered);
    const monthlyFiltered = filtered.filter(
      (e) => e.expense_date >= monthStart && e.expense_date <= monthEnd
    );
    const { totalUzs: monthlyUzs, totalUsd: monthlyUsd } = sumBuckets(monthlyFiltered);

    const categoryTotals = new Map<string, { amount: number; currency: 'UZS' | 'USD' }>();
    for (const e of filtered) {
      const c = String((e as any).category || 'Boshqa');
      const cur = String((e as any).currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      const amt = Number((e as any).amount || 0) || 0;
      const prev = categoryTotals.get(c);
      if (!prev || amt > prev.amount) {
        categoryTotals.set(c, { amount: amt, currency: cur });
      }
    }
    let topCategory: { category: ExpenseCategory; amount: number; currency?: 'UZS' | 'USD' } | null =
      null;
    for (const [c, meta] of categoryTotals.entries()) {
      if (!topCategory || meta.amount > topCategory.amount) {
        topCategory = { category: c as ExpenseCategory, amount: meta.amount, currency: meta.currency };
      }
    }

    return { totalUzs, totalUsd, todayUzs, todayUsd, monthlyUzs, monthlyUsd, topCategory };
  }

  await delay();
  
  // Load ALL expenses from storage (for today/monthly calculations)
  const allExpenses = [...loadExpensesFromStorage()];
  
  // Apply status/date filters and keep consistent semantics with reports.
  let filteredExpenses = [...allExpenses];
  if (filters?.status) {
    filteredExpenses = filteredExpenses.filter(e => String(e.status || '').toLowerCase() === String(filters.status).toLowerCase());
  }
  if (filters?.dateFrom) {
    filteredExpenses = filteredExpenses.filter(e => e.expense_date >= filters.dateFrom!);
  }
  if (filters?.dateTo) {
    filteredExpenses = filteredExpenses.filter(e => e.expense_date <= filters.dateTo!);
  }
  
  const today = formatDateYMD(new Date());
  const now = new Date();
  const monthStart = formatDateYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = formatDateYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const { totalUzs, totalUsd } = sumBuckets(filteredExpenses);
  const { totalUzs: todayUzs, totalUsd: todayUsd } = sumBuckets(
    filteredExpenses.filter((e) => e.expense_date === today)
  );
  const { totalUzs: monthlyUzs, totalUsd: monthlyUsd } = sumBuckets(
    filteredExpenses.filter((e) => e.expense_date >= monthStart && e.expense_date <= monthEnd)
  );

  const categoryTotals = new Map<ExpenseCategory, { amount: number; currency: 'UZS' | 'USD' }>();
  filteredExpenses.forEach((e) => {
    const cur = String(e.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
    const prev = categoryTotals.get(e.category);
    if (!prev || e.amount > prev.amount) {
      categoryTotals.set(e.category, { amount: e.amount, currency: cur });
    }
  });

  let topCategory: { category: ExpenseCategory; amount: number; currency?: 'UZS' | 'USD' } | null =
    null;
  categoryTotals.forEach((meta, category) => {
    if (!topCategory || meta.amount > topCategory.amount) {
      topCategory = { category, amount: meta.amount, currency: meta.currency };
    }
  });

  return { totalUzs, totalUsd, todayUzs, todayUsd, monthlyUzs, monthlyUsd, topCategory };
};
