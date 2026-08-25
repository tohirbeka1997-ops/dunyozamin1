import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchQueueCounts } from '@/api/client';
import { loadUser } from '@/auth/session';
import { canAccessWebOrders } from '@/lib/staffAccess';
import { isNotificationsEnabled } from '@/lib/notificationsPref';

const POLL_MS = 60_000;

/**
 * Poll incoming web-order queue count for tab badge (MVP — no FCM).
 * Pauses when app is backgrounded; respects local notifications toggle.
 * Cashier roles never see the badge (no web-order access).
 */
export function useQueueBadge(): number {
  const [badge, setBadge] = useState(0);
  const appState = useRef(AppState.currentState);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const user = await loadUser();
      if (!canAccessWebOrders(user?.role)) {
        setBadge(0);
        return;
      }
      const enabled = await isNotificationsEnabled();
      if (!enabled) {
        setBadge(0);
        return;
      }
      const counts = await fetchQueueCounts();
      setBadge(Math.max(0, Number(counts.incoming) || 0));
    } catch {
      // keep last badge on transient errors
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onAppState = (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        void refresh();
      }
      appState.current = next;
    };

    const sub = AppState.addEventListener('change', onAppState);
    timerRef.current = setInterval(() => {
      if (appState.current === 'active') void refresh();
    }, POLL_MS);

    return () => {
      sub.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  return badge;
}
