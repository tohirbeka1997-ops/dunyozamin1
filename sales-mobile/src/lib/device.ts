/**
 * Barqaror qurilma identifikatori. Refresh-token'lar serverda qurilma bo'yicha
 * kuzatiladi, shuning uchun har bir o'rnatish uchun bitta barqaror id kerak.
 * Birinchi marta generatsiya qilinadi va xavfsiz xotirada saqlanadi.
 */
import { Platform } from 'react-native';
import { getItem, setItem } from '@/lib/secureStorage';

const DEVICE_ID_KEY = 'dz_staff_device_id';

function randomId(): string {
  // RFC4122-ga yaqin, kriptografik bo'lishi shart emas — faqat barqaror unikal id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

export async function getOrCreateDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await getItem(DEVICE_ID_KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const id = `${Platform.OS}-${randomId()}`;
  await setItem(DEVICE_ID_KEY, id);
  cached = id;
  return id;
}
