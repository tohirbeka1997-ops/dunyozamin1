/**
 * 1.1.4 release stub — push disabled on ALL platforms.
 * expo-notifications removed from plugins/deps to avoid native FCM crash
 * on Android 15/16 (white screen / boot hang when google-services missing).
 */

export function isPushConfigured(): boolean {
  return false;
}

export async function syncPushRegistration(): Promise<{ ok: boolean; reason?: string }> {
  return { ok: false, reason: 'disabled_for_boot_stability' };
}

export function schedulePushRegistration(): void {
  // no-op — push re-enabled in a later release with real FCM config
}
