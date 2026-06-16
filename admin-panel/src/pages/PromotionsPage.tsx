import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Layout from '../components/Layout';
import { del, get, patch, post } from '../lib/api';
import { money, shortDate } from '../lib/format';

type Promotion = {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  usage_count?: number;
  total_discount?: number;
};

type Banner = {
  id: string;
  emoji?: string;
  title?: string;
  subtitle?: string;
  cta_text?: string;
  cta_link?: string;
  is_active?: number | boolean;
};

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newBanner, setNewBanner] = useState({ emoji: '🎉', title: '', subtitle: '', cta_text: '', cta_link: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, b] = await Promise.all([
        get<Promotion[]>('/v1/admin/promotions'),
        get<Banner[]>('/v1/admin/promotions/content/banners'),
      ]);
      setPromotions(Array.isArray(p) ? p : []);
      setBanners(Array.isArray(b) ? b : []);
    } catch (e) {
      setError((e as Error)?.message || 'Xatolik');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus(p: Promotion) {
    const next = p.status === 'active' ? 'inactive' : 'active';
    try {
      await patch(`/v1/admin/promotions/${p.id}/status`, { status: next });
      setPromotions((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    } catch (e) {
      alert((e as Error)?.message || 'O‘zgartirilmadi');
    }
  }

  async function removePromotion(p: Promotion) {
    if (!confirm(`"${p.name}" aksiyasini o‘chirasizmi?`)) return;
    try {
      await del(`/v1/admin/promotions/${p.id}`);
      setPromotions((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      alert((e as Error)?.message || 'O‘chirilmadi');
    }
  }

  async function addBanner(e: FormEvent) {
    e.preventDefault();
    if (!newBanner.title.trim()) return;
    try {
      await post('/v1/admin/promotions/content/banners', { ...newBanner, is_active: 1 });
      setNewBanner({ emoji: '🎉', title: '', subtitle: '', cta_text: '', cta_link: '' });
      await load();
    } catch (err) {
      alert((err as Error)?.message || 'Banner qo‘shilmadi');
    }
  }

  async function removeBanner(b: Banner) {
    if (!confirm('Bannerni o‘chirasizmi?')) return;
    try {
      await del(`/v1/admin/promotions/content/banners/${b.id}`);
      setBanners((prev) => prev.filter((x) => x.id !== b.id));
    } catch (e) {
      alert((e as Error)?.message || 'O‘chirilmadi');
    }
  }

  return (
    <Layout title="Aksiyalar va promo">
      {loading && <div className="text-gray-400">Yuklanmoqda…</div>}
      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-rose-600">{error}</div>}

      {!loading && !error && (
        <div className="space-y-6">
          <section className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <div className="px-4 pt-4 text-sm font-bold text-brand-primary">Aksiyalar / chegirmalar</div>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3">Nomi</th>
                  <th className="px-4 py-3">Turi</th>
                  <th className="px-4 py-3">Muddat</th>
                  <th className="px-4 py-3">Ishlatilgan</th>
                  <th className="px-4 py-3">Chegirma</th>
                  <th className="px-4 py-3">Holat</th>
                  <th className="px-4 py-3">Amal</th>
                </tr>
              </thead>
              <tbody>
                {promotions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      Aksiyalar yo'q
                    </td>
                  </tr>
                )}
                {promotions.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-brand-primary">{p.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{p.type || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {shortDate(p.start_date)} – {shortDate(p.end_date)}
                    </td>
                    <td className="px-4 py-3">{p.usage_count ?? 0}</td>
                    <td className="px-4 py-3">{money(p.total_discount ?? 0)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {p.status === 'active' ? 'Faol' : 'Nofaol'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleStatus(p)}
                          className="rounded-lg bg-brand-teal/10 px-2.5 py-1 text-xs font-semibold text-brand-teal hover:bg-brand-teal/20"
                        >
                          {p.status === 'active' ? 'O‘chirish' : 'Yoqish'}
                        </button>
                        <button
                          onClick={() => removePromotion(p)}
                          className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                        >
                          O‘chirish
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-brand-primary">Bosh sahifa bannerlari</h2>

            <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {banners.map((b) => (
                <div key={b.id} className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                  <span className="text-2xl">{b.emoji || '🎈'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-brand-primary">{b.title}</div>
                    <div className="truncate text-xs text-gray-400">{b.subtitle}</div>
                  </div>
                  <button onClick={() => removeBanner(b)} className="text-xs text-rose-500 hover:underline">
                    o‘chirish
                  </button>
                </div>
              ))}
              {banners.length === 0 && <div className="text-sm text-gray-400">Bannerlar yo'q</div>}
            </div>

            <form onSubmit={addBanner} className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
              <input
                value={newBanner.emoji}
                onChange={(e) => setNewBanner({ ...newBanner, emoji: e.target.value })}
                className="w-14 rounded-lg border border-gray-200 px-2 py-2 text-center text-sm"
                placeholder="🎉"
              />
              <input
                value={newBanner.title}
                onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Banner sarlavhasi"
                required
              />
              <input
                value={newBanner.subtitle}
                onChange={(e) => setNewBanner({ ...newBanner, subtitle: e.target.value })}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Tavsif (ixtiyoriy)"
              />
              <button type="submit" className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white">
                Qo‘shish
              </button>
            </form>
          </section>
        </div>
      )}
    </Layout>
  );
}
