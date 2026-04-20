import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';

type Product = {
  id: string;
  name: string;
  description?: string | null;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
};

type Cat = { id: string; name: string };

export function HomePage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [c, p] = await Promise.all([
          fetch(apiUrl('/v1/categories')),
          fetch(apiUrl('/v1/products?limit=12&sort=name')),
        ]);
        if (!ok) return;
        const cj = (await c.json()) as { data?: Cat[] };
        const pj = (await p.json()) as { data?: Product[] };
        setCats(cj.data || []);
        setProducts(pj.data || []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--dz-accent)] to-[#1a5f96] p-5 text-white shadow-[var(--dz-card-shadow)]">
        <p className="text-sm font-medium opacity-90">Xush kelibsiz</p>
        <h1 className="mt-1 text-xl font-bold leading-tight">DunyoZamin onlayn do&apos;koni</h1>
        <p className="mt-2 text-sm opacity-90">
          Mahsulotlarni tanlang, savatga qo&apos;shing va buyurtma bering.
        </p>
        <Link
          to="/catalog"
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold backdrop-blur-sm transition hover:bg-white/25"
        >
          Katalogni ko&apos;rish →
        </Link>
      </section>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {err}
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--dz-muted)]">Kategoriyalar</h2>
        </div>
        {loading ? (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <Link
                key={c.id}
                to={`/catalog?category=${encodeURIComponent(c.id)}`}
                className="rounded-full border bg-[var(--dz-surface)] px-4 py-2 text-sm font-medium text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)] transition hover:border-[var(--dz-accent)]/40 hover:shadow-[var(--dz-card-shadow-soft)]"
              >
                {c.name}
              </Link>
            ))}
            {!cats.length ? <span className="text-sm text-[var(--dz-soft)]">Hozircha kategoriya yo&apos;q</span> : null}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--dz-muted)]">Tanlangan mahsulotlar</h2>
          <Link to="/catalog" className="text-sm font-medium text-[var(--dz-link)]">
            Hammasi
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl border bg-[var(--dz-surface)] shadow-[var(--dz-card-shadow-soft)]">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-[var(--dz-surface)]/90 px-4 py-8 text-center text-sm text-[var(--dz-soft)]">
            Hozircha katalogda mahsulot yo&apos;q.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                id={p.id}
                name={p.name}
                price_uzs={p.price_uzs}
                image_url={p.image_url}
                is_available={p.is_available}
                description={p.description}
              />
            ))}
          </div>
        )}
      </section>

      <p className="pb-2 text-center text-[11px] leading-relaxed text-[var(--dz-soft)]">
        Telegram Mini App — xavfsiz to&apos;lov va buyurtma holati.
      </p>
    </div>
  );
}
