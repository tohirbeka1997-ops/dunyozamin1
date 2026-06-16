export const WEB_ORDER_STATUSES = [
  'new',
  'paid',
  'processing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;

export type WebOrderStatus = (typeof WEB_ORDER_STATUSES)[number];
export type DeliveryMethod = 'courier' | 'pickup';

export function normalizeDeliveryMethod(raw?: string | null): DeliveryMethod {
  return raw === 'pickup' ? 'pickup' : 'courier';
}

export function normalizeWebOrderStatus(raw?: string | null): WebOrderStatus {
  const status = String(raw || 'new').toLowerCase();
  return WEB_ORDER_STATUSES.includes(status as WebOrderStatus) ? (status as WebOrderStatus) : 'new';
}

export function allowedNextStatuses(
  status: string | undefined,
  deliveryMethod: DeliveryMethod,
): WebOrderStatus[] {
  const s = String(status || '').toLowerCase();
  if (s === 'new' || s === 'paid') return ['processing', 'cancelled'];
  if (s === 'processing') return ['ready', 'cancelled'];
  if (s === 'ready') {
    return deliveryMethod === 'pickup' ? ['delivered', 'cancelled'] : ['out_for_delivery', 'cancelled'];
  }
  if (s === 'out_for_delivery') return ['delivered', 'cancelled'];
  return [];
}

/** One-click advance for queue list rows */
export function suggestedAdvanceStatus(
  status: string | undefined,
  deliveryMethod: DeliveryMethod,
): WebOrderStatus | null {
  const next = allowedNextStatuses(status, deliveryMethod);
  if (!next.length) return null;
  const preferred: WebOrderStatus[] = ['processing', 'ready', 'out_for_delivery', 'delivered'];
  for (const p of preferred) {
    if (next.includes(p)) return p;
  }
  return next[0] ?? null;
}
