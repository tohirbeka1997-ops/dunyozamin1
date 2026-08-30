/**
 * PII masking helpers for CRM / employee reports.
 */

export type PiiRole = 'admin' | 'manager' | 'cashier' | string;

export function canViewFullCustomerPhone(role: PiiRole | null | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'manager';
}

/** Mask phone: +998901234567 → +998** *** **67 */
export function maskPhone(phone: string | null | undefined): string {
  const raw = String(phone || '').trim();
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  const tail = digits.slice(-2);
  const prefix = digits.slice(0, Math.min(5, digits.length - 2));
  return `${prefix}** *** **${tail}`;
}

export function formatCustomerPhone(
  phone: string | null | undefined,
  role: PiiRole | null | undefined,
): string {
  const raw = String(phone || '').trim();
  if (!raw) return '—';
  return canViewFullCustomerPhone(role) ? raw : maskPhone(raw);
}
