// Auth: current user/profile, sign in/up/out, password reset.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  ALLOW_MOCK_API,
  delay,
  hasPosApi,
  ipc,
  unwrapServiceData,
} from './internal';
import type {
  Profile,
} from '@/types/database';

// ============================================================================
// AUTH FUNCTIONS (Mock)
// ============================================================================

export const getCurrentUser = async () => {
  await delay();
  return {
    id: 'mock-user-id',
    email: 'mock@example.com',
  } as any;
};

export const getCurrentProfile = async () => {
  await delay();
  return {
    id: 'mock-user-id',
    username: 'mockuser',
    full_name: 'Mock User',
    phone: null,
    email: 'mock@example.com',
    role: 'admin' as const,
    is_active: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Profile;
};

export const signIn = async (_username: string, _password: string) => {
  await delay(300);
  return { user: await getCurrentUser(), session: null };
};

export const signUp = async (_username: string, _password: string, _fullName?: string) => {
  await delay(300);
  return { user: await getCurrentUser(), session: null };
};

export const signOut = async () => {
  await delay();
};

// Password reset — real SQLite via posApi; mock only when VITE_ALLOW_MOCK_API=true.
export const requestPasswordReset = async (
  identifier: string,
  tenant?: string | null,
): Promise<{ token_id: string; code: string; expires_at: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (tenant) {
      try {
        const { setTenantSlug } = await import('@/lib/remotePosApi');
        setTenantSlug(tenant.trim().toLowerCase());
      } catch {
        // Electron desktop — tenant is implicit (single store).
      }
    }
    const raw = await ipc<unknown>(api.auth.requestPasswordReset(identifier.trim()));
    return unwrapServiceData<{ token_id: string; code: string; expires_at: string }>(raw);
  }
  if (!ALLOW_MOCK_API) {
    throw new Error('Parolni tiklash faqat POS ilovasi yoki api.dunyozamin.com orqali ishlaydi.');
  }
  await delay(300);
  const token_id = `mock-token-${Date.now()}`;
  const code = '123456';
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    localStorage.setItem(`pos:pwreset:${token_id}`, JSON.stringify({ identifier, code, expires_at }));
  } catch {
    // ignore storage errors in mock mode
  }
  return { token_id, code, expires_at };
};

export const confirmPasswordReset = async (
  payload: { token_id: string; code: string; new_password: string },
  tenant?: string | null,
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (tenant) {
      try {
        const { setTenantSlug } = await import('@/lib/remotePosApi');
        setTenantSlug(tenant.trim().toLowerCase());
      } catch {
        // Electron desktop
      }
    }
    const raw = await ipc<unknown>(api.auth.confirmPasswordReset(payload));
    return unwrapServiceData<{ success?: boolean }>(raw);
  }
  if (!ALLOW_MOCK_API) {
    throw new Error('Parolni tiklash faqat POS ilovasi yoki api.dunyozamin.com orqali ishlaydi.');
  }
  await delay(300);
  try {
    const raw = localStorage.getItem(`pos:pwreset:${payload.token_id}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (String(parsed?.code || '') !== String(payload.code || '').trim()) {
        throw new Error('Invalid reset code');
      }
      if (parsed?.expires_at && new Date(parsed.expires_at).getTime() < Date.now()) {
        throw new Error('Reset code expired');
      }
      localStorage.removeItem(`pos:pwreset:${payload.token_id}`);
    }
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('Failed to confirm password reset');
  }
  return { success: true };
};
