import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';
import { useDebounce } from '../hooks/useDebounce';
import { loadFavorites } from '../lib/favorites';
import { loadRecentSearches, saveRecentSearch } from '../lib/recentSearches';

/**
 * Pagination size for the catalog list. Matches the public API's
 * default and is small enough for one IntersectionObserver step on a
 * typical mobile screen (~6-8 cards above the fold).
 */
const PAGE_SIZE = 24;

type Product = {
  id: string;
  name: string;
  description?: string | null;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
  track_stock?: boolean;
  stock_quantity?: number | null;
  options?: { name: string; value: string }[];
};

type Cat = { id: string; name: string; icon?: string | null; color?: string | null; image_url?: string | null };
type QuickFilter = 'all' | 'in_stock' | 'favorites' | 'budget';
const QUICK_FILTERS: QuickFilter[] = ['all', 'in_stock', 'favorites', 'budget'];
type SortMode = 'price_asc' | 'price_desc' | 'name';
const SORT_MODES: SortMode[] = ['name', 'price_asc', 'price_desc'];

export function CatalogPage({ onCartChange }: { onCartChange?: () => void }) {
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category') || '';
  const qFromUrl = sp.get('q') || '';
  const quickFromUrl = sp.get('quick') || 'all';
  const sortFromUrl = sp.get('sort') || 'name';
  const initialQuickFilter: QuickFilter = QUICK_FILTERS.includes(quickFromUrl as QuickFilter)
    ? (quickFromUrl as QuickFilter)
    : 'all';
  const initialSortMode: SortMode = SORT_MODES.includes(sortFromUrl as SortMode)
    ? (sortFromUrl as SortMode)
    : 'name';
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [fallbackProducts, setFallbackProducts] = useState<Product[]>([]);
  const [sort, setSort] = useState<SortMode>(initialSortMode);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialQuickFilter);
  const [searchInput, setSearchInput] = useState(qFromUrl);
  const debouncedQ = useDebounce(searchInput.trim(), 400);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards the infinite-scroll observer from triggering a fetch while one
  // is already in flight. We can't rely solely on `loadingMore` because
  // React state updates are batched and the observer can fire multiple
  // times before the next render.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setSearchInput(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    setQuickFilter(initialQuickFilter);
  }, [initialQuickFilter]);

  useEffect(() => {
    setSort(initialSortMode);
  }, [initialSortMode]);

  useEffect(() => {
    const next = new URLSearchParams(sp);
    const normalizedQ = debouncedQ.trim();
    if (normalizedQ) {
      next.set('q', normalizedQ);
    } else {
      next.delete('q');
    }
    if (quickFilter === 'all') {
      next.delete('quick');
    } else {
      next.set('quick', quickFilter);
    }
    if (sort === 'name') {
      next.delete('sort');
    } else {
      next.set('sort', sort);
    }
    if (next.toString() !== sp.toString()) {
      setSp(next, { replace: true });
    }
  }, [debouncedQ, quickFilter, sort, sp, setSp]);

  useEffect(() => {
    const onFavoritesChanged = () => setFavoritesVersion((v) => v + 1);
    window.addEventListener('favorites:change', onFavoritesChanged);
    return () => window.removeEventListener('favorites:change', onFavoritesChanged);
  }, []);

  useEffect(() => {
    if (debouncedQ.length >= 2) {
      setRecentSearches(saveRecentSearch(debouncedQ));
    }
  }, [debouncedQ]);

  useEffect(() => {
    let ok = true;
    void (async () => {
      setErr(null);
      try {
        const c = await fetch(apiUrl('/v1/categories'));
        if (!ok) return;
        if (!c.ok) {
          throw new Error(`HTTP ${c.status}`);
        }
        const cj = await readJsonSafe<{ data?: Cat[] }>(c);
        setCats(cj.data || []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    // Filter changes always reset to page 1. The next effect handles the
    // initial fetch; we just clear state here.
    setPage(1);
    setProducts([]);
    setFallbackProducts([]);
    setHasMore(false);
  }, [category, sort, debouncedQ]);

  useEffect(() => {
    let ok = true;
    inFlightRef.current = true;
    void (async () => {
      const isFirstPage = page === 1;
      if (isFirstPage) setLoading(true);
      else setLoadingMore(true);
      setErr(null);
      try {
        const qParam = debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : '';
        const p = await fetch(
          apiUrl(
            `/v1/products?page=${page}&limit=${PAGE_SIZE}&sort=${encodeURIComponent(sort)}${category ? `&category=${encodeURIComponent(category)}` : ''}${qParam}`,
          ),
        );
        if (!ok) return;
        if (!p.ok) {
          throw new Error(`HTTP ${p.status}`);
        }
        const pj = await readJsonSafe<{
          data?: Product[];
          meta?: { page?: number; total_pages?: number; total?: number };
        }>(p);
        const incoming = pj.data || [];
        const meta = pj.meta || {};
        const totalPages = Number(meta.total_pages || 0) || 0;
        setHasMore(totalPages > 0 && page < totalPages);
        if (isFirstPage) {
          setProducts(incoming);
        } else {
          // De-duplicate by id in case the server returns the same row on
          // the boundary (which can happen if products mutate between
          // page fetches).
          setProducts((prev) => {
            const seen = new Set(prev.map((x) => x.id));
            const merged = prev.slice();
            for (const item of incoming) {
              if (!seen.has(item.id)) {
                merged.push(item);
                seen.add(item.id);
              }
            }
            return merged;
          });
        }
        if (isFirstPage && incoming.length === 0) {
          const fp = await fetch(apiUrl('/v1/products/trending?limit=6&days=30'));
          if (fp.ok) {
            const fpj = await readJsonSafe<{ data?: Product[] }>(fp);
            setFallbackProducts(fpj.data || []);
          } else {
            setFallbackProducts([]);
          }
        } else if (isFirstPage) {
          setFallbackProducts([]);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      } finally {
        if (ok) {
          if (isFirstPage) setLoading(false);
          else setLoadingMore(false);
        }
        inFlightRef.current = false;
      }
    })();
    return () => {
      ok = false;
    };
  }, [category, sort, debouncedQ, page]);

  // IntersectionObserver-based infinite scroll. Watches a sentinel
  // <div> rendered after the last product card; when it scrolls into
  // view we bump `page`, which the fetch effect picks up.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (inFlightRef.current) return;
        if (loadingMore || loading) return;
        setPage((p) => p + 1);
      },
      { rootMargin: '160px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore]);

  const visibleProducts = useMemo(() => {
    if (quickFilter === 'all') return products;
    if (quickFilter === 'in_stock') {
      return products.filter((p) => p.is_available);
    }
    if (quickFilter === 'budget') {
      return products.filter((p) => Number(p.price_uzs || 0) <= 200000);
    }
    const favoriteSet = new Set(loadFavorites());
    void favoritesVersion;
    return products.filter((p) => favoriteSet.has(p.id));
  }, [products, quickFilter, favoritesVersion]);

  const catalogHref = (nextCategory?: string) => {
    const next = new URLSearchParams(sp);
    if (nextCategory) next.set('category', nextCategory);
    else next.delete('category');
    return `/catalog${next.toString() ? `?${next.toString()}` : ''}`;
  };

  const hasAnyFilter = Boolean(category) || quickFilter !== 'all' || sort !== 'name' || Boolean(debouncedQ);
  const activeFilters: string[] = [];
  if (category) {
    const catName = cats.find((c) => c.id === category)?.name || 'Kategoriya';
    activeFilters.push(catName);
  }
  if (quickFilter === 'in_stock') activeFilters.push('Mavjud');
  if (quickFilter === 'favorites') activeFilters.push('Sevimlilar');
  if (quickFilter === 'budget') activeFilters.push('200k gacha');
  if (sort === 'price_asc') activeFilters.push('Narx: arzondan');
  if (sort === 'price_desc') activeFilters.push('Narx: qimmatdan');
  if (debouncedQ) activeFilters.push(`Qidiruv: "${debouncedQ}"`);

  const clearAllFilters = () => {
    setSearchInput('');
    setQuickFilter('all');
    setSort('name');
    setSp(new URLSearchParams(), { replace: true });
  };

  return (
    <div className="space-y-3.5">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Katalog</h1>
        <p className="mt-0.5 text-xs text-[var(--dz-soft)]">Kategoriya va saralash</p>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</div>
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
          className="w-full rounded-xl border bg-[var(--dz-surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)] placeholder:text-[var(--dz-soft)]"
        />
      </div>

      {!searchInput.trim() && recentSearches.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">Oxirgi qidiruvlar</p>
          <div className="flex flex-wrap gap-1.5">
            {recentSearches.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setSearchInput(q)}
                className="rounded-full border bg-[var(--dz-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--dz-muted)]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          to={catalogHref()}
          className={`rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition ${
            !category
              ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
              : 'border bg-[var(--dz-surface)] text-[var(--dz-muted)] hover:border-[var(--dz-border-strong)]'
          }`}
        >
          Hammasi
        </Link>
        {loading
          ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)
          : cats.map((c) => (
              <Link
                key={c.id}
                to={catalogHref(c.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition ${
                  category === c.id
                    ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
                    : 'border bg-[var(--dz-surface)] text-[var(--dz-muted)] hover:border-[var(--dz-border-strong)]'
                }`}
              >
                <span className="inline-flex max-w-[150px] items-center gap-1 truncate">
                  {c.image_url ? (
                    <img src={c.image_url} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                  ) : c.icon ? (
                    <span className="shrink-0 text-base leading-none" aria-hidden>
                      {c.icon}
                    </span>
                  ) : null}
                  <span className="truncate">{c.name}</span>
                </span>
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
          className="w-full rounded-xl border bg-[var(--dz-surface)] px-3 py-2 text-sm font-medium text-[var(--dz-text)] shadow-[var(--dz-card-shadow-soft)]"
        >
          <option value="name">Nomi bo&apos;yicha</option>
          <option value="price_asc">Narx: arzondan</option>
          <option value="price_desc">Narx: qimmatdan</option>
        </select>
      </label>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">Tezkor filtrlar</p>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'all', label: 'Hammasi' },
            { key: 'in_stock', label: '✅ Mavjud' },
            { key: 'favorites', label: '♥ Sevimlilar' },
            { key: 'budget', label: "💸 200k gacha" },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setQuickFilter(f.key as QuickFilter)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                quickFilter === f.key
                  ? 'bg-[var(--tg-theme-button-color,#2481cc)] text-[var(--tg-theme-button-text-color,#fff)]'
                  : 'border bg-[var(--dz-surface)] text-[var(--dz-muted)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {hasAnyFilter ? (
        <div className="rounded-xl border bg-[var(--dz-surface)]/90 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[var(--dz-soft)]">Aktiv filtrlar</p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs font-semibold text-[var(--dz-link)]"
            >
              Hammasini tozalash
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--dz-muted)]">{activeFilters.join(' · ')}</p>
        </div>
      ) : null}

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
      ) : visibleProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-[var(--dz-surface)]/90 px-4 py-8 text-center">
          <p className="text-sm text-[var(--dz-soft)]">
            {debouncedQ
              ? 'Qidiruv bo‘yicha mahsulot topilmadi. Boshqa so‘z yoki filtrni sinab ko‘ring.'
              : quickFilter !== 'all'
                ? 'Tezkor filtr bo‘yicha mahsulot topilmadi.'
                : 'Bu filtr bo‘yicha mahsulot topilmadi.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-full bg-[var(--tg-theme-button-color,#2481cc)] px-3 py-1.5 text-xs font-semibold text-[var(--tg-theme-button-text-color,#fff)]"
            >
              Filtrlarni tozalash
            </button>
            {cats.slice(0, 4).map((c) => (
              <Link
                key={c.id}
                to={catalogHref(c.id)}
                className="rounded-full border bg-[var(--dz-surface)] px-3 py-1.5 text-xs font-medium text-[var(--dz-muted)]"
              >
                {c.name}
              </Link>
            ))}
          </div>
          {fallbackProducts.length > 0 ? (
            <div className="mt-5 text-left">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--dz-soft)]">
                Tavsiya mahsulotlar
              </p>
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                {fallbackProducts.slice(0, 4).map((p) => (
                  <ProductCard
                    key={`fb-${p.id}`}
                    id={p.id}
                    name={p.name}
                    price_uzs={p.price_uzs}
                    image_url={p.image_url}
                    is_available={p.is_available}
                    description={p.description}
                    options={p.options}
                    track_stock={p.track_stock}
                    stock_quantity={p.stock_quantity}
                    onQuickAdd={onCartChange}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {visibleProducts.map((p) => (
              <ProductCard
                key={p.id}
                id={p.id}
                name={p.name}
                price_uzs={p.price_uzs}
                image_url={p.image_url}
                is_available={p.is_available}
                description={p.description}
                options={p.options}
                track_stock={p.track_stock}
                stock_quantity={p.stock_quantity}
                onQuickAdd={onCartChange}
              />
            ))}
          </div>
          {/* Sentinel for IntersectionObserver-driven infinite scroll.
              We only render it when there are more pages so the observer
              callback above doesn't churn after the list is exhausted. */}
          {hasMore ? (
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
          ) : null}
          {loadingMore ? (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={`more-${i}`} className="overflow-hidden rounded-2xl border bg-[var(--dz-surface)] shadow-[var(--dz-card-shadow-soft)]">
                  <Skeleton className="aspect-square w-full rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
