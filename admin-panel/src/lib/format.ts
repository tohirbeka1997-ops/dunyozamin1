export function money(value: number | string | null | undefined, currency = 'UZS'): string {
  const n = typeof value === 'string' ? Number(value) : value || 0;
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0);
  return currency === 'USD' ? `$${formatted}` : `${formatted} so'm`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Yangi',
  paid: 'Kassaga tushdi',
  processing: 'Tayyorlanmoqda',
  ready: 'Tayyor',
  out_for_delivery: 'Yetkazilmoqda',
  delivered: 'Yetkazildi',
  cancelled: 'Bekor qilindi',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  paid: 'bg-indigo-100 text-indigo-700',
  processing: 'bg-amber-100 text-amber-700',
  ready: 'bg-teal-100 text-teal-700',
  out_for_delivery: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-rose-100 text-rose-700',
};

export function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] || status;
}

export function statusColor(status: string): string {
  return ORDER_STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
}
