/**
 * Platform-aware secure storage.
 *
 * Native (iOS/Android): lazy-loads `expo-secure-store` (Keychain / Keystore).
 * Web: falls back to `localStorage`.
 *
 * CRITICAL: never import expo-secure-store at module top-level — a native
 * module load failure must not blank / crash the cold-start screen.
 */

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

type SecureStoreModule = typeof import('expo-secure-store');

function loadSecureStore(): SecureStoreModule | null {
  if (isWeb) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-secure-store') as SecureStoreModule;
  } catch {
    return null;
  }
}

/** In-memory fallback when SecureStore is unavailable (should be rare). */
const memory = new Map<string, string>();

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
    return;
  }
  const SecureStore = loadSecureStore();
  if (!SecureStore) {
    memory.set(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    memory.set(key, value);
  }
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  const SecureStore = loadSecureStore();
  if (!SecureStore) {
    return memory.get(key) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return memory.get(key) ?? null;
  }
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
  memory.delete(key);
  const SecureStore = loadSecureStore();
  if (!SecureStore) return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}
