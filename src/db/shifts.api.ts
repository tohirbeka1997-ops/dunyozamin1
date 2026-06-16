// Shift domain: shifts, cash in/out, summaries.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  delay,
  generateId,
  hasPosApi,
  ipc,
} from './internal';
import type {
  Shift,
  ShiftWithCashier,
} from '@/types/database';

export const getShifts = async (
  arg?: number | {
    limit?: number;
    offset?: number;
    user_id?: string;
    warehouse_id?: string;
    status?: 'all' | 'open' | 'closed';
    date_from?: string;
    date_to?: string;
  }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (api?.shifts?.list) {
      const filters: any = {};
      if (typeof arg === 'number') {
        filters.limit = arg;
      } else if (arg && typeof arg === 'object') {
        if (arg.limit != null) filters.limit = arg.limit;
        if (arg.offset != null) filters.offset = arg.offset;
        if (arg.user_id) filters.user_id = arg.user_id;
        if (arg.warehouse_id) filters.warehouse_id = arg.warehouse_id;
        // Backend treats falsy/'all' as "no filter"
        if (arg.status && arg.status !== 'all') filters.status = arg.status;
        if (arg.date_from) filters.date_from = arg.date_from;
        if (arg.date_to) filters.date_to = arg.date_to;
      } else {
        filters.limit = 50;
      }
      return ipc<ShiftWithCashier[]>(api.shifts.list(filters));
    }
    console.warn('[API] shifts.list handler is missing');
    return [] as ShiftWithCashier[];
  }
  await delay();
  return [] as ShiftWithCashier[];
};

export const getActiveShift = async (cashierId?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (cashierId) {
      return ipc<Shift | null>(api.shifts.getActive(cashierId));
    }
    // If no cashierId provided, return null (don't call backend with invalid params)
    console.warn('[API] getActiveShift called without cashierId, returning null');
    return null;
  }
  await delay();
  return null;
};

// Back-compat alias used by some UI code.
/** Joriy ochiq smena — kassir bo‘yicha (getOpenShiftForCashier), getActive dan torroq */
export const getCurrentShift = async (cashierId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Shift | null>(api.shifts.getCurrent(cashierId));
  }
  await delay();
  return null;
};

export const generateShiftNumber = async () => {
  await delay();
  return `SHIFT-${Date.now()}`;
};

export const createShift = async (shift: Omit<Shift, 'id' | 'closed_at' | 'closing_cash' | 'expected_cash' | 'cash_difference'>) => {
  await delay();
  return { ...shift, id: generateId() } as Shift;
};

export const closeShift = async (shiftId: string, closingCash: number, notes?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Shift>(api.shifts.close(shiftId, { closing_cash: closingCash, notes }));
  }
  await delay();
  return {} as Shift;
};

export const getShiftSummary = async (shiftId: string) => {
  const sid = String(shiftId ?? '').trim();
  if (!sid) {
    throw new Error('Smena ID kiritilmagan. Sahifani yangilang yoki smenani qayta sinxronlang.');
  }
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.shifts.getSummary({ shiftId: sid }));
  }
  await delay();
  return {
    shiftId: sid,
    openedAt: null,
    closedAt: null,
    status: 'open',
    openingCash: 0,
    totalSales: 0,
    cashSales: 0,
    creditDebtIssued: 0,
    debtRepaidTotal: 0,
    debtRepaidCash: 0,
    customerDrawerCashNet: 0,
    orders: 0,
    totalRefunds: 0,
    expectedCash: 0,
  };
};

/** Smenaga qo‘l bilan naqd kirim qo‘shish (kassani to‘ldirish). */
export const shiftCashIn = async (payload: {
  shiftId: string;
  amount: number;
  reason?: string;
  createdBy?: string;
}) => {
  if (!payload?.shiftId) throw new Error('shiftId kerak');
  if (!payload?.amount || payload.amount <= 0) throw new Error('amount > 0 bo‘lishi kerak');
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.shifts.cashIn(payload));
  }
  await delay();
  return { success: true, ...payload };
};

/** Smenadan qo‘l bilan naqd chiqim (inkassatsiya / chiqim). */
export const shiftCashOut = async (payload: {
  shiftId: string;
  amount: number;
  reason?: string;
  createdBy?: string;
}) => {
  if (!payload?.shiftId) throw new Error('shiftId kerak');
  if (!payload?.amount || payload.amount <= 0) throw new Error('amount > 0 bo‘lishi kerak');
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.shifts.cashOut(payload));
  }
  await delay();
  return { success: true, ...payload };
};

/** Smena bo'yicha qo'l bilan qilingan naqd harakatlar ro'yxati. */
export const listShiftCashMovements = async (payload: {
  shiftId: string;
  type?: 'deposit' | 'withdrawal' | 'manual' | 'all';
  limit?: number;
}) => {
  if (!payload?.shiftId) return [] as any[];
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.shifts.listCashMovements(payload));
  }
  await delay();
  return [] as any[];
};

