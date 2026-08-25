// SECURITY: on native these tokens live in the OS keychain (expo-secure-store).
// On the web build the `secureStorage` fallback uses `localStorage`, so the
// access/refresh JWTs below are JS-readable and at risk from XSS. We keep
// `localStorage` to preserve persistent staff login (and because the same
// fallback stores the device id / locale that must survive restarts — see
// `lib/secureStorage.ts`). Recommended backend follow-up: deliver the refresh
// token as an HttpOnly + Secure + SameSite cookie so it is never exposed to JS.
import { deleteItem, getItem, setItem } from '@/lib/secureStorage';
import { clearCart } from '@/store/cart';
import { router } from 'expo-router';
import type { StaffTokens, StaffUser } from '@/types/orders';

const KEYS = {
  access: 'dz_staff_access_token',
  refresh: 'dz_staff_refresh_token',
  user: 'dz_staff_user_json',
  tenant: 'dz_staff_tenant',
} as const;

export async function saveSession(tokens: StaffTokens, user: StaffUser): Promise<void> {
  await setItem(KEYS.access, tokens.access_token);
  await setItem(KEYS.refresh, tokens.refresh_token);
  await setItem(KEYS.user, JSON.stringify(user));
  await setItem(KEYS.tenant, user.tenant);
}

export async function loadAccessToken(): Promise<string | null> {
  return getItem(KEYS.access);
}

export async function loadRefreshToken(): Promise<string | null> {
  return getItem(KEYS.refresh);
}

export async function loadUser(): Promise<StaffUser | null> {
  const raw = await getItem(KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffUser;
  } catch {
    return null;
  }
}

export async function updateTokens(tokens: Pick<StaffTokens, 'access_token' | 'refresh_token'>): Promise<void> {
  await setItem(KEYS.access, tokens.access_token);
  await setItem(KEYS.refresh, tokens.refresh_token);
}

export async function clearSession(): Promise<void> {
  await deleteItem(KEYS.access);
  await deleteItem(KEYS.refresh);
  await deleteItem(KEYS.user);
  await deleteItem(KEYS.tenant);
}

/** Clear tokens and return to the password login screen. */
export async function clearSessionAndGoToLogin(): Promise<void> {
  clearCart();
  await clearSession();
  try {
    router.replace('/(auth)/login');
  } catch {
    // Router may not be mounted yet.
  }
}

export async function hasSession(): Promise<boolean> {
  const access = await loadAccessToken();
  if (access) return true;
  // Access may have expired while refresh is still valid — treat as logged in
  // so staffFetch can silently renew before the first protected API call.
  const refresh = await loadRefreshToken();
  return !!refresh;
}
