/**
 * Local notification preference (MVP — no FCM required).
 * Full push requires Firebase + expo-notifications; this toggle is stored locally.
 */

import { getItem, setItem } from '@/lib/secureStorage';

const PREF_KEY = 'dz_staff_notifications_enabled';

export async function isNotificationsEnabled(): Promise<boolean> {
  const raw = await getItem(PREF_KEY);
  if (raw === null) return true;
  return raw === '1';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await setItem(PREF_KEY, enabled ? '1' : '0');
}
