import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { get, patch } from '../lib/api';
import { money } from '../lib/format';

type Product = {
  id: string;
  name: string;
  sku?: string;
  sale_price?: number;
  price?: number;
  stock_quantity?: number;
  available_quantity?: number;
  show_in_marketplace?: boolean;
  category_name?: string;
};

type Category = { id: string; name: string };

function priceOf(p: Product): number {
  return Number(p.sale_price ?? p.price ?? 0);
}
function stockOf(p: Product): number {
  return Number(p.stock_quantity ?? p.available_quantity ?? 0);
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [marketplace, setMarketplace] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      if (marketplace) params.set('marketplace', marketplace);
      const data = await get<Product[]>(`/v1/admin/products?${params.toString()}`);
      setProducts(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error)?.message || 'Xatolik');
    } finally {
      setLoading(false);
    }
  }, [q, category, marketplace]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    get<Category[]>('/v1/admin/products/meta/categories')
      .then((d) => setCategories(Array.isArray(d) ? d : []))
      .catch(() => undefined);
  }, []);

  async function toggleVisibility(p: Product) {
    setBusyId(p.id);
    try {
      await patch(`/v1/admin/products/${p.id}/visibility`, { visible: !p.show_in_marketplace });
      setProducts((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, show_in_marketplace: !p.show_in_marketplace } : x)),
      );
    } catch (e) {
      alert((e as Error)?.message || 'O‘zgartirilmadi');
    } finally {
      setBusyId('');
    }
  }

  return (
    <Layout title="Mahsulotlar">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mahsulot nomi yoki SKU…"
          className="w-56 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-teal focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-teal focus:outline-none"
        >
          <option value="">Barcha kategoriyalar</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-brand-teal focus:outline-none"
        >
          <option value="">Mini-app: barchasi</option>
          <option value="visible">Ko'rinadigan</option>
          <option value="hidden">Yashirilgan</option>
        </select>
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
                <th className="px-4 py-3">Mahsulot</th>
                <th className="px-4 py-3">Kategoriya</th>
                <th className="px-4 py-3">Narx</th>
                <th className="px-4 py-3">Qoldiq</th>
                <th className="px-4 py-3">Mini-appda</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Mahsulotlar topilmadi
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-primary">{p.name}</div>
                    {p.sku && <div className="text-xs text-gray-400">{p.sku}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.category_name || '—'}</td>
                  <td className="px-4 py-3 font-medium">{money(priceOf(p))}</td>
                  <td className="px-4 py-3">{stockOf(p)}</td>
                  <td className="px-4 py-3">
                    <button
                      disabled={busyId === p.id}
                      onClick={() => toggleVisibility(p)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                        p.show_in_marketplace
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {p.show_in_marketplace ? 'Ko‘rinadi' : 'Yashirilgan'}
                    </button>
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
