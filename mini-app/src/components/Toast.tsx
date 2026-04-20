import { useEffect, useRef } from 'react';

type Props = {
  message: string | null;
  onDismiss: () => void;
  /** ms, default 2600 */
  durationMs?: number;
};

/**
 * Mini App pastki qismida (BottomNav ustida) vaqtinchalik xabar.
 */
export function Toast({ message, onDismiss, durationMs = 2600 }: Props) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs]);

  if (!message) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-1/2 z-[100] max-w-[min(100%-2rem,24rem)] -translate-x-1/2"
      role="status"
    >
      <div className="pointer-events-auto rounded-2xl border bg-[var(--dz-surface)] px-4 py-3 text-center text-sm font-medium text-[var(--dz-text)] shadow-[var(--dz-card-shadow)]">
        {message}
      </div>
    </div>
  );
}
