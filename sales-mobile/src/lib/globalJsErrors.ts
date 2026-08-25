/**
 * Install once at root. Surfaces fatals that bypass React error boundaries
 * (promise rejections, RN redbox path) into console for logcat / Metro.
 */
import { APP_VERSION_LABEL } from '@/lib/bootBanner';

let installed = false;

export function installGlobalJsErrorHandlers(): void {
  if (installed) return;
  installed = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const EU = (globalThis as any).ErrorUtils;
    if (EU && typeof EU.getGlobalHandler === 'function') {
      const prev = EU.getGlobalHandler();
      EU.setGlobalHandler((error: Error, isFatal?: boolean) => {
        console.error(
          `[DZ-FATAL ${APP_VERSION_LABEL}]`,
          isFatal ? 'FATAL' : 'non-fatal',
          error?.message,
          error?.stack,
        );
        if (typeof prev === 'function') prev(error, isFatal);
      });
    }
  } catch (e) {
    console.warn('[DZ] ErrorUtils hook failed', e);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.addEventListener === 'function') {
      g.addEventListener('unhandledrejection', (ev: { reason?: unknown }) => {
        console.error(`[DZ-REJECTION ${APP_VERSION_LABEL}]`, ev?.reason);
      });
    }
  } catch {
    // native may not support
  }
}
