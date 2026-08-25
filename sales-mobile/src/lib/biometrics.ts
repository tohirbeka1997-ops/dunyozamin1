/**
 * Biometrik (Face ID / barmoq izi) tez-qulf.
 *
 * CRITICAL: never import expo-local-authentication at module top-level —
 * native module load failures must not blank the cold-start screen.
 */
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { deleteItem, getItem, setItem } from '@/lib/secureStorage';

const BIOMETRIC_ENABLED_KEY = 'dz_staff_biometric_enabled';
const LAST_ACTIVE_AT_KEY = 'dz_staff_last_active_at';
/** Background ≥ this duration before biometric re-prompt. */
export const BIOMETRIC_LOCK_GRACE_MS = 2 * 60 * 1000;

let activityTrackingStarted = false;
/** Set when leaving the foreground; cleared after successful unlock. */
let lastBackgroundAt: number | null = null;
let wasInForeground = AppState.currentState === 'active';

type ForegroundListener = () => void;
const foregroundListeners = new Set<ForegroundListener>();

type LocalAuthModule = typeof import('expo-local-authentication');

function loadLocalAuth(): LocalAuthModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-local-authentication') as LocalAuthModule;
  } catch {
    return null;
  }
}

export function subscribeBiometricForeground(listener: ForegroundListener): () => void {
  foregroundListeners.add(listener);
  return () => foregroundListeners.delete(listener);
}

function notifyForeground(): void {
  foregroundListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

/** Qurilma biometrikani qo'llab-quvvatlaydimi va ro'yxatdan o'tganmi? */
export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const LocalAuthentication = loadLocalAuth();
    if (!LocalAuthentication) return false;
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const available = await isBiometricAvailable();
  if (!available) return false;
  const v = await getItem(BIOMETRIC_ENABLED_KEY);
  return v === '1';
}

/** Call after successful unlock (or when lock is not required). */
export async function touchAppActive(): Promise<void> {
  lastBackgroundAt = null;
  await setItem(LAST_ACTIVE_AT_KEY, String(Date.now()));
}

async function readLastActiveAt(): Promise<number> {
  const raw = await getItem(LAST_ACTIVE_AT_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * True when biometric lock should be shown (enabled, available, grace elapsed).
 * Does NOT mutate timers — safe to call from resume gate.
 */
export async function shouldRequireBiometricLock(): Promise<boolean> {
  const enabledFlag = (await getItem(BIOMETRIC_ENABLED_KEY)) === '1';
  if (!enabledFlag) return false;
  const available = await isBiometricAvailable();
  if (!available) return false;

  const now = Date.now();

  if (lastBackgroundAt != null) {
    return now - lastBackgroundAt >= BIOMETRIC_LOCK_GRACE_MS;
  }

  const lastActive = await readLastActiveAt();
  if (lastActive > 0 && now - lastActive < BIOMETRIC_LOCK_GRACE_MS) {
    return false;
  }

  // No recent unlock mark (cold start after enable, or first open).
  return lastActive === 0 || now - lastActive >= BIOMETRIC_LOCK_GRACE_MS;
}

/**
 * Track background only. Foreground must NOT reset the grace clock —
 * BiometricLockGate / unlock success calls touchAppActive after check.
 */
export function initBiometricActivityTracking(): () => void {
  if (activityTrackingStarted) {
    return () => {};
  }
  activityTrackingStarted = true;
  wasInForeground = AppState.currentState === 'active';

  const onChange = (state: AppStateStatus) => {
    if (state === 'active') {
      wasInForeground = true;
      notifyForeground();
      return;
    }

    if (wasInForeground && (state === 'background' || state === 'inactive')) {
      wasInForeground = false;
      lastBackgroundAt = Date.now();
      void setItem(LAST_ACTIVE_AT_KEY, String(lastBackgroundAt));
    }
  };

  const sub = AppState.addEventListener('change', onChange);
  return () => {
    sub.remove();
    activityTrackingStarted = false;
  };
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await setItem(BIOMETRIC_ENABLED_KEY, '1');
  } else {
    await deleteItem(BIOMETRIC_ENABLED_KEY);
  }
}

/** Biometrik tasdiqlash. true — muvaffaqiyat yoki imkonsiz (bloklamaydi). */
export async function authenticateBiometric(promptMessage: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const LocalAuthentication = loadLocalAuth();
    if (!LocalAuthentication) return true;
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
