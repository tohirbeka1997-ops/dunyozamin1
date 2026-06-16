type Status = 'idle' | 'pulling' | 'ready' | 'refreshing';

/**
 * Drop-in pull-to-refresh visual. Place at the very top of a page that
 * uses `usePullToRefresh` and pass the same `status`/`distance`/`threshold`
 * values back to it. Renders nothing when idle.
 */
export function PullIndicator({
  status,
  distance,
  threshold,
}: {
  status: Status;
  distance: number;
  threshold: number;
}) {
  if (status === 'idle' && distance === 0) return null;
  const pct = Math.min(1, distance / threshold);
  const rotate = pct * 360;
  const opacity = Math.min(1, 0.3 + pct * 0.7);

  return (
    <div
      className="pointer-events-none -mb-2 flex items-center justify-center overflow-hidden transition-[height] duration-150"
      style={{ height: status === 'refreshing' ? threshold : Math.max(0, distance) }}
      aria-hidden
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 shadow-[var(--dz-card-shadow-soft)] backdrop-blur-md"
        style={{ opacity }}
      >
        {status === 'refreshing' ? (
          <span className="dz-spinner block h-4 w-4 rounded-full border-2 border-[var(--brand-cream-200)] border-t-[var(--brand-teal)]" />
        ) : (
          <span
            className="text-[15px] text-[var(--brand-teal)] transition-transform"
            style={{ transform: `rotate(${rotate}deg)` }}
          >
            {status === 'ready' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </div>
  );
}
