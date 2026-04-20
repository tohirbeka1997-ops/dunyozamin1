/** Web order status → label + subtle badge class */
export function orderStatusUi(status: string): { label: string; className: string } {
  const s = String(status || '').toLowerCase();
  const map: Record<string, { label: string; className: string }> = {
    new: { label: 'Yangi', className: 'bg-sky-100 text-sky-900' },
    paid: { label: "To'langan", className: 'bg-emerald-100 text-emerald-900' },
    processing: { label: 'Jarayonda', className: 'bg-amber-100 text-amber-900' },
    ready: { label: 'Tayyor', className: 'bg-violet-100 text-violet-900' },
    delivered: { label: 'Yetkazildi', className: 'bg-slate-100 text-slate-800' },
    cancelled: { label: 'Bekor', className: 'bg-red-100 text-red-900' },
  };
  return map[s] || { label: status || '—', className: 'bg-black/5 text-black/70' };
}
