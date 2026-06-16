import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/telegram';

type Status = 'idle' | 'pulling' | 'ready' | 'refreshing';

/**
 * Mobile-friendly pull-to-refresh.
 *
 * Watches touch gestures on the *window* (so it works inside Telegram
 * WebApp where the body itself is the scroll container). Only fires
 * when the page is scrolled to the very top, the user pulls down past
 * the threshold, then releases.
 *
 * Returns:
 *   - status: 'idle' | 'pulling' | 'ready' | 'refreshing'
 *   - distance: pixels pulled (clamped to 1.5 × threshold)
 *   - threshold: distance the user must pass to trigger
 */
export function usePullToRefresh(
  onRefresh: () => Promise<unknown> | unknown,
  opts: { threshold?: number; enabled?: boolean } = {},
): { status: Status; distance: number; threshold: number } {
  const threshold = opts.threshold ?? 70;
  const enabled = opts.enabled !== false;
  const [status, setStatus] = useState<Status>('idle');
  const [distance, setDistance] = useState(0);
  const startYRef = useRef<number | null>(null);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    function getScrollTop(): number {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function onTouchStart(e: TouchEvent) {
      if (status === 'refreshing') return;
      // Start tracking only when we're already at the top — otherwise a
      // normal upward scroll near the top would trigger a phantom pull.
      if (getScrollTop() > 2) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0]?.clientY ?? null;
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current == null || status === 'refreshing') return;
      const y = e.touches[0]?.clientY ?? 0;
      const delta = y - startYRef.current;
      if (delta <= 0) {
        if (status !== 'idle') {
          setStatus('idle');
          setDistance(0);
        }
        return;
      }
      // Resistance curve: harder to pull the further you go.
      const damped = Math.min(threshold * 1.5, delta * 0.5);
      setDistance(damped);
      const reached = damped >= threshold;
      setStatus((prev) => {
        if (reached && prev !== 'ready') {
          haptic.impact('light');
          return 'ready';
        }
        if (!reached && prev !== 'pulling') return 'pulling';
        return prev;
      });
    }

    async function onTouchEnd() {
      if (startYRef.current == null) return;
      const wasReady = status === 'ready' || distance >= threshold;
      startYRef.current = null;
      if (!wasReady) {
        setStatus('idle');
        setDistance(0);
        return;
      }
      setStatus('refreshing');
      setDistance(threshold);
      haptic.notify('success');
      try {
        await cbRef.current();
      } catch {
        haptic.notify('error');
      } finally {
        setStatus('idle');
        setDistance(0);
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, threshold, status, distance]);

  return { status, distance, threshold };
}
