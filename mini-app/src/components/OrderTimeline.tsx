import {
  TIMELINE_STEPS,
  TIMELINE_STEPS_PICKUP,
  activeStepIndex,
  type TimelineStep,
} from '../lib/orderStatus';

/**
 * Visual progress timeline for an order.
 *
 * - Steps before/at the active status are highlighted (filled circle,
 *   green connector).
 * - The active step pulses softly to draw the eye.
 * - `cancelled` short-circuits to a destructive banner.
 */
export function OrderTimeline({
  status,
  deliveryMethod,
  compact = false,
}: {
  status: string;
  deliveryMethod?: string | null;
  compact?: boolean;
}) {
  const lower = String(status || '').toLowerCase();
  if (lower === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] font-bold text-red-700">
        <span className="text-base" aria-hidden>✖</span>
        Buyurtma bekor qilingan
      </div>
    );
  }

  const steps: TimelineStep[] =
    deliveryMethod === 'pickup' ? TIMELINE_STEPS_PICKUP : TIMELINE_STEPS;
  const active = activeStepIndex(lower, deliveryMethod);

  return (
    <ol
      className={`relative flex items-start ${compact ? 'gap-1.5' : 'gap-2'}`}
      aria-label="Buyurtma holati"
    >
      {steps.map((step, idx) => {
        const isDone = active >= 0 && idx < active;
        const isActive = active === idx;
        const isPending = active < 0 || idx > active;
        return (
          <li key={step.key} className="relative flex flex-1 flex-col items-center text-center">
            {idx < steps.length - 1 ? (
              <span
                className={`absolute top-3.5 left-1/2 z-0 h-0.5 w-full ${
                  isDone || isActive ? 'bg-[var(--brand-teal)]' : 'bg-[var(--brand-cream-200)]'
                }`}
                aria-hidden
              />
            ) : null}
            <span
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-[12px] transition ${
                isDone
                  ? 'bg-[var(--brand-teal)] text-white shadow-[var(--dz-glow-teal)]'
                  : isActive
                    ? 'bg-[var(--brand-accent)] text-[var(--brand-primary)] shadow-[var(--dz-glow-accent)] dz-pulse'
                    : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]/40'
              }`}
              aria-current={isActive ? 'step' : undefined}
            >
              {isDone ? '✓' : step.emoji}
            </span>
            {!compact ? (
              <span
                className={`mt-1 text-[9.5px] font-semibold leading-tight ${
                  isActive
                    ? 'text-[var(--brand-primary)]'
                    : isDone
                      ? 'text-[var(--brand-teal)]'
                      : 'text-[var(--brand-primary)]/40'
                } ${isPending && !isActive ? '' : ''}`}
              >
                {step.short}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
