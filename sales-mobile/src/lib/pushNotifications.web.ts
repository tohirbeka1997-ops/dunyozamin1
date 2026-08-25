/**
 * Web stub — push disabled (same as native 1.1.2 boot-stability stub).
 */

export function isPushConfigured(): boolean {
  return false;
}

export async function syncPushRegistration(): Promise<{ ok: boolean; reason?: string }> {
  return { ok: false, reason: 'web' };
}

export function schedulePushRegistration(): void {
  // no-op
}
