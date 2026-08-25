/**
 * Session-scoped camera permission cache.
 * Avoids re-prompting when the scan modal is closed and reopened.
 */
let sessionGranted = false;
let sessionRequestStarted = false;

export function isCameraGrantedInSession(): boolean {
  return sessionGranted;
}

export function markCameraGrantedInSession(): void {
  sessionGranted = true;
}

/** True after we already invoked the OS permission dialog this session. */
export function hasCameraPermissionRequestStarted(): boolean {
  return sessionRequestStarted;
}

export function markCameraPermissionRequestStarted(): void {
  sessionRequestStarted = true;
}

/** Web: probe Permissions API without opening the camera. */
export async function probeWebCameraPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unknown';
  }
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    if (status.state === 'granted') {
      markCameraGrantedInSession();
    }
    return status.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'unknown';
  }
}
