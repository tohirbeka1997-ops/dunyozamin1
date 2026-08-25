/**
 * Bulk app storage (cart, catalog cache).
 * Uses AsyncStorage on all platforms — SecureStore is too small for catalogs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export async function setAppItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // quota / private mode — ignore
  }
}

export async function getAppItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function deleteAppItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}
