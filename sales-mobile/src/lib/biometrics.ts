/**
 * Biometrik (Face ID / barmoq izi) tez-qulf.
 *
 * Bu — ixtiyoriy QO'SHIMCHA himoya qatlami: foydalanuvchi sessiyasi saqlanib
 * qoladi, lekin ilova ochilganda biometrik tasdiqlash so'raladi. Qurilmada
 * biometrika bo'lmasa yoki sozlanmagan bo'lsa, qulf jimgina o'chiriladi —
 * hech qachon foydalanuvchini bloklab qo'ymaydi.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { deleteItem, getItem, setItem } from '@/lib/secureStorage';

const BIOMETRIC_ENABLED_KEY = 'dz_staff_biometric_enabled';

/** Qurilma biometrikani qo'llab-quvvatlaydimi va ro'yxatdan o'tganmi? */
export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const v = await getItem(BIOMETRIC_ENABLED_KEY);
  return v === '1';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await setItem(BIOMETRIC_ENABLED_KEY, '1');
  } else {
    await deleteItem(BIOMETRIC_ENABLED_KEY);
  }
}

/** Biometrik tasdiqlashni so'raydi. true — muvaffaqiyatli yoki imkonsiz (bloklamaydi). */
export async function authenticateBiometric(promptMessage: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const available = await isBiometricAvailable();
    if (!available) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: undefined,
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
