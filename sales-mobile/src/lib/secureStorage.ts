/**
 * Platform-aware secure storage.
 *
 * Native (iOS/Android): uses `expo-secure-store` (Keychain / Keystore).
 * Web: `expo-secure-store` is unavailable, so we fall back to `localStorage`.
 *
 * The async signatures are kept identical across platforms so callers behave
 * the same regardless of where they run.
 *
 * SECURITY (web only): on the web build this fallback persists values in
 * `localStorage`, including the staff JWTs written by `auth/session.ts`
 * (`dz_staff_access_token` / `dz_staff_refresh_token`). `localStorage` is
 * readable by any JS on the origin, so an XSS bug could exfiltrate these
 * tokens and take over the staff account.
 *
 * Why we keep `localStorage` here instead of `sessionStorage`:
 *   - This helper is shared with values that MUST survive a browser restart,
 *     e.g. the stable device id (`lib/device.ts`), the saved locale
 *     (`i18n/index.ts`) and the biometric-enabled flag (`lib/biometrics.ts`).
 *     Moving the whole web fallback to `sessionStorage` would regenerate the
 *     device id and drop preferences on every new tab.
 *   - The app is mobile-first; the native build keeps tokens in the OS keychain
 *     and relies on persistent login, so the web build matches that UX.
 *
 * `sessionStorage` would only marginally help (it does not stop same-tab XSS
 * reads). The correct fix is backend-owned and out of scope for the frontend:
 * issue the refresh token as an HttpOnly + Secure + SameSite cookie so it is
 * never reachable from JS. Tracked as a backend follow-up.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore (e.g. storage disabled / private mode)
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
