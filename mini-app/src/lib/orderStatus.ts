export function orderStatusUi(status: string): { label: string; className: string } {
  const s = String(status || '').toLowerCase();
  const map: Record<string, { label: string; className: string }> = {
    new: { label: 'Yangi', className: 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]' },
    paid: { label: 'Toʻlandi', className: 'bg-[var(--brand-teal-50)] text-[var(--brand-teal-600)]' },
    processing: { label: 'Tayyorlanmoqda', className: 'bg-[var(--brand-accent-100)] text-[var(--brand-primary)]' },
    ready: { label: 'Tayyor', className: 'bg-[var(--brand-accent)] text-[var(--brand-primary)]' },
    out_for_delivery: { label: 'Yoʻlda', className: 'bg-[var(--brand-teal)] text-white' },
    delivered: { label: '✓ Yetkazildi', className: 'bg-[var(--brand-primary)] text-white' },
    cancelled: { label: '✖ Bekor', className: 'bg-red-50 text-red-700' },
  };
  return map[s] || { label: status || '—', className: 'bg-[var(--brand-cream-100)] text-[var(--dz-muted)]' };
}

/**
 * Ordered list of milestone statuses for the visual timeline.
 * `cancelled` is *not* on the path — when an order is cancelled we
 * render a separate state.
 */
export type TimelineStep = {
  key: string;
  label: string;
  emoji: string;
  short: string;
};

export const TIMELINE_STEPS: TimelineStep[] = [
  { key: 'new', label: 'Yangi buyurtma', emoji: '📝', short: 'Yangi' },
  { key: 'paid', label: 'Toʻlov tasdiqlandi', emoji: '💳', short: 'Toʻlandi' },
  { key: 'processing', label: 'Tayyorlanmoqda', emoji: '🔧', short: 'Tayyorlanmoqda' },
  { key: 'ready', label: 'Yetkazishga tayyor', emoji: '📦', short: 'Tayyor' },
  { key: 'out_for_delivery', label: 'Yoʻlda', emoji: '🚚', short: 'Yoʻlda' },
  { key: 'delivered', label: 'Yetkazildi', emoji: '✅', short: 'Yetkazildi' },
];

/** Timeline steps adjusted for pickup orders (skip the delivery hop). */
export const TIMELINE_STEPS_PICKUP: TimelineStep[] = [
  { key: 'new', label: 'Yangi buyurtma', emoji: '📝', short: 'Yangi' },
  { key: 'paid', label: 'Toʻlov tasdiqlandi', emoji: '💳', short: 'Toʻlandi' },
  { key: 'processing', label: 'Tayyorlanmoqda', emoji: '🔧', short: 'Tayyorlanmoqda' },
  { key: 'ready', label: 'Olib ketishga tayyor', emoji: '🛍', short: 'Tayyor' },
  { key: 'delivered', label: 'Olib ketildi', emoji: '✅', short: 'Olib ketildi' },
];

/**
 * Returns 0-based index of the active step. -1 if the status is not
 * on the timeline (e.g. cancelled or unknown).
 */
export function activeStepIndex(status: string, deliveryMethod?: string | null): number {
  const steps = deliveryMethod === 'pickup' ? TIMELINE_STEPS_PICKUP : TIMELINE_STEPS;
  const s = String(status || '').toLowerCase();
  return steps.findIndex((step) => step.key === s);
}

/**
 * Statuses where the buyer is allowed to cancel from the WebApp.
 * Aligned with `public-api/routes/orders.cjs` which only allows
 * `new` (so the server doesn't have to issue a refund).
 */
export function canCancel(status: string): boolean {
  return String(status || '').toLowerCase() === 'new';
}
