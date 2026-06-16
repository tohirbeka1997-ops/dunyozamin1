import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { get } from '../lib/api';
import { money } from '../lib/format';

type DashboardData = {
  stats?: Record<string, number>;
  analytics?: Record<string, unknown>;
  web_order_queues?: Record<string, number>;
};

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent || 'text-brand-primary'}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<DashboardData>('/v1/admin/dashboard/stats')
      .then(setData)
      .catch((e) => setError(e?.message || 'Xatolik'))
      .finally(() => setLoading(false));
  }, []);

  const stats = data?.stats || {};
  const queues = data?.web_order_queues || {};

  return (
    <Layout title="Boshqaruv paneli">
      {loading && <div className="text-gray-400">Yuklanmoqda…</div>}
      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-rose-600">{error}</div>}

      {!loading && !error && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Bugungi buyurtmalar" value={String(stats.today_orders ?? 0)} />
            <StatCard label="Bugungi savdo" value={money(stats.today_sales ?? 0)} accent="text-brand-teal" />
            <StatCard label="Bugungi tushum" value={money(stats.today_revenue ?? 0)} accent="text-green-600" />
            <StatCard label="Yangi web buyurtma" value={String(queues.new ?? queues.processing ?? 0)} accent="text-blue-600" />
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-brand-primary">Web buyurtma navbatlari</h2>
            {Object.keys(queues).length === 0 ? (
              <div className="text-sm text-gray-400">Ma'lumot yo'q</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(queues).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-brand-cream px-3 py-3 text-center">
                    <div className="text-xl font-bold text-brand-primary">{v}</div>
                    <div className="mt-1 text-xs capitalize text-gray-500">{k.replace(/_/g, ' ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
