import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { useDebounce } from '../hooks/useDebounce';

type Product = {
  id: string;
  name: string;
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
        <p className="mt-0.5 text-sm text-black/50">Kategoriya va saralash</p>
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
          className="w-full rounded-xl border border-black/10 bg-white py-3 pl-10 pr-3 text-sm shadow-sm placeholder:text-black/40"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/catalog"
          className={`rounded-full px-4 py-2 text-sm font-medium shadow-sm transition ${
            !category
              ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
              : 'border border-black/10 bg-white text-black/70 hover:border-black/20'
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
                    : 'border border-black/10 bg-white text-black/70 hover:border-black/20'
                }`}
              >
                {c.name}
              </Link>
            ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-black/45">
          Saralash
        </span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-medium shadow-sm"
        >
          <option value="name">Nomi bo&apos;yicha</option>
          <option value="price_asc">Narx: arzondan</option>
          <option value="price_desc">Narx: qimmatdan</option>
        </select>
      </label>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/15 bg-white/80 px-4 py-10 text-center text-sm text-black/50">
          {debouncedQ
            ? 'Qidiruv bo‘yicha mahsulot topilmadi. Boshqa so‘z yoki filtrni sinab ko‘ring.'
            : 'Bu filtr bo‘yicha mahsulot topilmadi.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map((p) => (
            <Link
              key={p.id}
              to={`/product/${encodeURIComponent(p.id)}`}
              className="group overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm transition hover:border-[var(--tg-theme-button-color,#2481cc)]/25 hover:shadow-md"
            >
              <div className="aspect-square w-full bg-black/[0.04]">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-3xl text-black/15">📷</div>
                )}
              </div>
              <div className="p-3">
                <div className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</div>
                <div className="mt-1.5 text-sm font-medium tabular-nums text-black/85">
                  {p.price_uzs.toLocaleString('uz-UZ')} so&apos;m
                </div>
                {!p.is_available ? (
                  <span className="mt-1 inline-block text-xs font-medium text-red-600">Mavjud emas</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
