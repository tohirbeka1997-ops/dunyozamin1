// Employees / users domain. Split out of `api.ts`. Mostly Electron IPC
// passthrough to the users service; mock paths are inert.

import { requireElectron } from '@/utils/electron';
import { delay, generateId, hasPosApi, ipc } from './internal';
import type {
  Profile,
  EmployeeSessionWithProfile,
  EmployeeActivityLogWithProfile,
} from '@/types/database';

export const getAllEmployees = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    // users.list returns rows shaped like Profile (RBAC role included via join)
    return ipc<Profile[]>(api.users.list({}));
  }
  await delay();
  return [] as Profile[];
};

export const getEmployeeById = async (_id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Profile>(api.users.get(_id));
  }
  await delay();
  return null;
};

export const createEmployee = async (_employeeData: {
  username: string;
  password: string;
  full_name: string;
  phone?: string;
  email?: string;
  role: 'admin' | 'manager' | 'cashier' | 'warehouse';
  is_active?: boolean;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Profile>(
      api.users.create({
        username: _employeeData.username,
        password: _employeeData.password,
        full_name: _employeeData.full_name,
        phone: _employeeData.phone || null,
        email: _employeeData.email || null,
        role: _employeeData.role,
        is_active: _employeeData.is_active === false ? 0 : 1,
      })
    );
  }
  await delay();
  // Mock mode: do nothing
  return {} as Profile;
};

export const updateEmployee = async (
  id: string,
  updates: Partial<Profile> & { password?: string }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects is_active as 0/1; accept boolean too
    const normalized: any = { ...updates };
    if (typeof (updates as any).is_active === 'boolean') {
      normalized.is_active = (updates as any).is_active ? 1 : 0;
    }
    return ipc<Profile>(api.users.update(id, normalized));
  }
  await delay();
  return { ...updates, id } as Profile;
};

export const deactivateEmployee = async (_id: string) => {
  await delay();
  return {} as Profile;
};

export const activateEmployee = async (_id: string) => {
  await delay();
  return {} as Profile;
};

export const deleteEmployee = async (_id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    await ipc<any>(api.users.delete(_id));
    return;
  }
  await delay();
};

export type GetEmployeeSessionsFilters = {
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
};

/**
 * Jurnal: `dateFrom` + `dateTo` (YYYY-MM-DD, Tashkent kuni) bilan.
 * Xodim kartochkasi: `employeeId` (oxirgi 500 ta).
 */
export const getEmployeeSessions = async (
  employeeIdOrFilters?: string | GetEmployeeSessionsFilters
): Promise<EmployeeSessionWithProfile[]> => {
  const filters: GetEmployeeSessionsFilters =
    typeof employeeIdOrFilters === 'string'
      ? { employeeId: employeeIdOrFilters }
      : employeeIdOrFilters || {};

  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<EmployeeSessionWithProfile[]>(
      api.users.listLoginSessions({
        employee_id: filters.employeeId,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      })
    );
  }
  await delay();
  return [] as EmployeeSessionWithProfile[];
};

export const startEmployeeSession = async (_employeeId: string, _ipAddress?: string) => {
  await delay();
  return generateId();
};

export const endEmployeeSession = async (_sessionId: string, _ipAddress?: string) => {
  await delay();
  return true;
};

export const getEmployeeActivityLogs = async (_employeeId?: string) => {
  await delay();
  return [] as EmployeeActivityLogWithProfile[];
};

export const logEmployeeActivity = async (
  _employeeId: string,
  _actionType: string,
  _description: string,
  _documentId?: string,
  _documentType?: string,
  _ipAddress?: string
) => {
  await delay();
  return generateId();
};

export const getEmployeePerformance = async (
  _employeeId: string,
  _startDate?: string,
  _endDate?: string
) => {
  await delay();
  return null;
};
