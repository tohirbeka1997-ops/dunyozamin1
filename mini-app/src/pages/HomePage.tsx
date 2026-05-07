import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';

type Product = {
  id: string;
  name: string;
  description?: string | null;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
  track_stock?: boolean;
  stock_quantity?: number | null;
};

type Cat = { id: string; name: string };

export function HomePage({ onCartChange }: { onCartChange?: () => void }) {
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
        if (!c.ok || !p.ok) {
          throw new Error(`HTTP ${!c.ok ? c.status : p.status}`);
        }
        const cj = await readJsonSafe<{ data?: Cat[] }>(c);
        const pj = await readJsonSafe<{ data?: Product[] }>(p);
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
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#5b6cff] via-[#6b63ff] to-[#8f59ff] p-4 text-white shadow-[var(--dz-card-shadow)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-20 w-20 rounded-full bg-cyan-200/30 blur-xl" />
        <p className="text-xs font-medium opacity-90">Xush kelibsiz</p>
        <h1 className="mt-1 text-lg font-bold leading-tight">DunyoZamin onlayn do&apos;koni</h1>
        <p className="mt-1.5 text-xs opacity-90">
          Mahsulotlarni tanlang, savatga qo&apos;shing va buyurtma bering.
        </p>
        <Link
          to="/catalog"
          className="mt-3 inline-flex items-center justify-center rounded-lg bg-white/20 px-3.5 py-2 text-xs font-semibold backdrop-blur-sm transition hover:bg-white/30"
        >
          Katalogni ko&apos;rish →
        </Link>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Link
          to="/catalog"
          className="rounded-2xl border border-white/45 bg-gradient-to-br from-[#edf2ff] to-[#e4ebff] px-3 py-3 text-center text-xs font-semibold text-[#2f3f7a] shadow-[var(--dz-card-shadow-soft)]"
        >
          ⚡ Tezkor xarid
        </Link>
        <Link
          to="/favorites"
          className="rounded-2xl border border-white/45 bg-gradient-to-br from-[#ffe9f4] to-[#ffe1f3] px-3 py-3 text-center text-xs font-semibold text-[#7a2f68] shadow-[var(--dz-card-shadow-soft)]"
        >
          ❤ Sevimlilar
        </Link>
        <Link
          to="/profile"
          className="rounded-2xl border border-white/45 bg-gradient-to-br from-[#e6fbff] to-[#def6ff] px-3 py-3 text-center text-xs font-semibold text-[#215c77] shadow-[var(--dz-card-shadow-soft)]"
        >
          👤 Profil
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
                track_stock={p.track_stock}
                stock_quantity={p.stock_quantity}
                onQuickAdd={onCartChange}
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
