import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';
import { useDebounce } from '../hooks/useDebounce';

type Product = {
  id: string;
  name: string;
  description?: string | null;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
};

type Cat = { id: string; name: string };

export function CatalogPage() {
  const [sp] = useSearchParams();
  const category = sp.get('category') || '';
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sort, setSort] = useState<'price_asc' | 'price_desc' | 'name'>('name');
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebounce(searchInput.trim(), 400);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const qParam = debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : '';
        const [c, p] = await Promise.all([
          fetch(apiUrl('/v1/categories')),
          fetch(
            apiUrl(
              `/v1/products?limit=50&sort=${encodeURIComponent(sort)}${category ? `&category=${encodeURIComponent(category)}` : ''}${qParam}`,
            ),
          ),
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
  }, [category, sort, debouncedQ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Katalog</h1>
        <p className="mt-0.5 text-sm text-[var(--dz-soft)]">Kategoriya va saralash</p>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
      ) : null}

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base opacity-45" aria-hidden>
          🔍
        </span>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Nomi, SKU yoki shtrix-kod bo‘yicha qidiring"
          enterKeyHint="search"
          autoComplete="off"
          className="w-full rounded-2xl border bg-[var(--dz-surface)] py-3 pl-10 pr-3 text-sm text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)] placeholder:text-[var(--dz-soft)]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/catalog"
          className={`rounded-full px-4 py-2 text-sm font-medium shadow-sm transition ${
            !category
              ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
              : 'border bg-[var(--dz-surface)] text-[var(--dz-muted)] hover:border-[var(--dz-border-strong)]'
          }`}
        >
          Hammasi
        </Link>
        {loading
          ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-full" />)
          : cats.map((c) => (
              <Link
                key={c.id}
                to={`/catalog?category=${encodeURIComponent(c.id)}`}
                className={`rounded-full px-4 py-2 text-sm font-medium shadow-sm transition ${
                  category === c.id
                    ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
                    : 'border bg-[var(--dz-surface)] text-[var(--dz-muted)] hover:border-[var(--dz-border-strong)]'
                }`}
              >
                {c.name}
              </Link>
            ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">
          Saralash
        </span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="w-full rounded-2xl border bg-[var(--dz-surface)] px-3 py-3 text-sm font-medium text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)]"
        >
          <option value="name">Nomi bo&apos;yicha</option>
          <option value="price_asc">Narx: arzondan</option>
          <option value="price_desc">Narx: qimmatdan</option>
        </select>
      </label>

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
        <p className="rounded-2xl border border-dashed bg-[var(--dz-surface)]/90 px-4 py-10 text-center text-sm text-[var(--dz-soft)]">
          {debouncedQ
            ? 'Qidiruv bo‘yicha mahsulot topilmadi. Boshqa so‘z yoki filtrni sinab ko‘ring.'
            : 'Bu filtr bo‘yicha mahsulot topilmadi.'}
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
    </div>
  );
}
