import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { get } from '../lib/api';
import { money, shortDate } from '../lib/format';

type Customer = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  balance?: number;
  total_sales?: number;
  loyalty_points?: number;
  last_order_date?: string;
  created_at?: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      params.set('sortBy', 'total_sales');
      params.set('sortOrder', 'desc');
      const data = await get<Customer[]>(`/v1/admin/customers?${params.toString()}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error)?.message || 'Xatolik');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Layout title="Mijozlar">
      <div className="mb-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ism, telefon yoki email…"
          className="w-64 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-teal focus:outline-none"
        />
        <button onClick={load} className="rounded-xl bg-brand-teal px-3 py-2 text-sm font-semibold text-white">
          Qidirish
        </button>
      </div>

      {loading && <div className="text-gray-400">Yuklanmoqda…</div>}
      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-rose-600">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Mijoz</th>
                <th className="px-4 py-3">Telefon</th>
                <th className="px-4 py-3">Jami xaridlar</th>
                <th className="px-4 py-3">Balans</th>
                <th className="px-4 py-3">Loyalty</th>
                <th className="px-4 py-3">Oxirgi buyurtma</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Mijozlar topilmadi
                  </td>
                </tr>
              )}
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-primary">{c.name || '—'}</div>
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || '—'}</td>
                  <td className="px-4 py-3 font-medium">{money(c.total_sales ?? 0)}</td>
                  <td className={`px-4 py-3 ${Number(c.balance) < 0 ? 'text-rose-600' : 'text-gray-700'}`}>
                    {money(c.balance ?? 0)}
                  </td>
                  <td className="px-4 py-3">{c.loyalty_points ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{shortDate(c.last_order_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
