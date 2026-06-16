import { useEffect, useRef } from 'react';
import { usePosTerminalSettings } from './usePosTerminalSettings';

type IdleLogoutOptions = {
  /** Whether to arm the idle timer at all (typically: only when authenticated). */
  enabled: boolean;
  /** Called when the user has been idle longer than the configured timeout. */
  onIdle: () => void;
};

/**
 * Watches user activity (pointer / keyboard / scroll / touch) and calls
 * `onIdle` after `pos.auto_logout_minutes` of inactivity.
 *
 * Reads the timeout reactively from `usePosTerminalSettings` so changes in
 * Settings → POS terminal take effect immediately.
 */
export function useIdleLogout({ enabled, onIdle }: IdleLogoutOptions) {
  const settings = usePosTerminalSettings();
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    const minutes = Math.max(0, Math.min(480, Math.floor(settings.auto_logout_minutes ?? 0)));
    // 0 = disabled (default for POS terminals — cashiers stay logged in during shift).
    if (minutes <= 0) return;
    const timeoutMs = minutes * 60 * 1000;

    let timer: number | null = null;
    const reset = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          onIdleRef.current?.();
        } catch {
          // ignore
        }
      }, timeoutMs);
    };

    const events: string[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'touchstart',
      'touchmove',
      'scroll',
      'visibilitychange',
    ];

    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    reset();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [enabled, settings.auto_logout_minutes]);
}
