/**
 * Auto-sync offline sales when the app returns online / foreground.
 */

import { AppState, type AppStateStatus, Platform } from 'react-native';
import { syncWithFeedback } from '@/lib/syncFeedback';

let started = false;

/** Start once from root layout. Safe to call multiple times. */
export function initOfflineAutoSync(): () => void {
  if (started) return () => {};
  started = true;

  const run = () => {
    void syncWithFeedback();
  };

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') run();
  };
  const sub = AppState.addEventListener('change', onAppState);

  let onOnline: (() => void) | null = null;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    onOnline = () => run();
    window.addEventListener('online', onOnline);
  }

  // Initial attempt shortly after boot (tokens may hydrate first).
  const t = setTimeout(run, 1500);

  return () => {
    clearTimeout(t);
    sub.remove();
    if (onOnline && typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
    started = false;
  };
}
