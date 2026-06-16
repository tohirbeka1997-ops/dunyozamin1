import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { get, patch, post } from '../lib/api';
import { dateTime, money, statusColor, statusLabel } from '../lib/format';

type Order = {
  id: string;
  order_number?: string;
  status: string;
  total_amount?: number;
  customer_name?: string;
  customer_phone?: string;
  delivery_method?: string;
  created_at?: string;
  allowed_next_statuses?: string[];
};

const QUEUES = [
  { id: '', label: 'Barchasi' },
  { id: 'new', label: 'Yangi' },
  { id: 'processing', label: 'Tayyorlanmoqda' },
  { id: 'ready', label: 'Tayyor' },
  { id: 'delivering', label: 'Yetkazilmoqda' },
  { id: 'done', label: 'Yakunlangan' },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [queue, setQueue] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (queue) params.set('queue', queue);
      if (q.trim().length >= 2) params.set('q', q.trim());
      const data = await get<Order[]>(`/v1/admin/orders?${params.toString()}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error)?.message || 'Xatolik');
    } finally {
      setLoading(false);
    }
  }, [queue, q]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(order: Order, status: string) {
    setBusyId(order.id);
    try {
      if (status === 'out_for_delivery' && order.delivery_method !== 'pickup') {
        await post(`/v1/admin/orders/${order.id}/dispatch-courier`);
      } else {
        await patch(`/v1/admin/orders/${order.id}/status`, { status });
      }
      await load();
    } catch (e) {
      alert((e as Error)?.message || 'Status o‘zgartirilmadi');
    } finally {
      setBusyId('');
    }
  }

  return (
    <Layout title="Buyurtmalar">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {QUEUES.map((Qz) => (
            <button
              key={Qz.id}
              onClick={() => setQueue(Qz.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                queue === Qz.id ? 'bg-brand-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {Qz.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Qidirish (raqam, telefon, ism)…"
          className="ml-auto w-56 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-teal focus:outline-none"
        />
        <button onClick={load} className="rounded-xl bg-brand-teal px-3 py-2 text-sm font-semibold text-white">
          Yangilash
        </button>
      </div>

      {loading && <div className="text-gray-400">Yuklanmoqda…</div>}
      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-rose-600">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Raqam</th>
                <th className="px-4 py-3">Mijoz</th>
                <th className="px-4 py-3">Summa</th>
                <th className="px-4 py-3">Yetkazish</th>
                <th className="px-4 py-3">Holat</th>
                <th className="px-4 py-3">Sana</th>
                <th className="px-4 py-3">Amal</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Buyurtmalar topilmadi
                  </td>
                </tr>
              )}
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-semibold text-brand-primary">#{o.order_number || o.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <div>{o.customer_name || '—'}</div>
                    <div className="text-xs text-gray-400">{o.customer_phone || ''}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{money(o.total_amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {o.delivery_method === 'pickup' ? 'Olib ketish' : 'Kuryer'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusColor(o.status)}`}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{dateTime(o.created_at)}</td>
                  <td className="px-4 py-3">
                    {o.allowed_next_statuses && o.allowed_next_statuses.length > 0 ? (
                      <select
                        disabled={busyId === o.id}
                        value=""
                        onChange={(e) => e.target.value && changeStatus(o, e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-brand-teal focus:outline-none"
                      >
                        <option value="">O‘zgartirish…</option>
                        {o.allowed_next_statuses.map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(s)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
