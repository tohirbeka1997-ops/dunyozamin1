import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { resolveProductImageUrl } from '../lib/productImageUrl';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';
import { useDebounce } from '../hooks/useDebounce';
import { loadFavorites } from '../lib/favorites';
import { loadRecentSearches, saveRecentSearch } from '../lib/recentSearches';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullIndicator } from '../components/PullIndicator';
import { getTg, haptic } from '../lib/telegram';
import { t, useLang } from '../lib/i18n';

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

type Cat = {
  id: string;
  name: string;
  description?: string | null;
  parent_id?: string | null;
  icon?: string | null;
  color?: string | null;
  image_url?: string | null;
};
type QuickFilter = 'all' | 'in_stock' | 'favorites' | 'budget';
const QUICK_FILTERS: QuickFilter[] = ['all', 'in_stock', 'favorites', 'budget'];
type SortMode = 'price_asc' | 'price_desc' | 'name';
const SORT_MODES: SortMode[] = ['name', 'price_asc', 'price_desc'];

/**
 * Construction-themed icon set + colour tints for the category cards.
 * Mirrors HomePage's grid so the catalog landing feels consistent. The
 * icon is picked by index when a category has no own image/emoji.
 */
const CAT_VISUALS: { tint: string; icon: ReactNode }[] = [
  { tint: 'dz-t-amber dz-c-amber', icon: <path d="M13 2 3 14h7l-1 8 10-12h-7z" /> },
  { tint: 'dz-t-steel dz-c-steel', icon: <><path d="M14 7l5 5-9 9-5-5z" /><path d="m14 7 2-2a2.8 2.8 0 0 1 4 4l-2 2" /></> },
  { tint: 'dz-t-sky dz-c-sky', icon: <path d="M3 12h4l3-9 4 18 3-9h4" /> },
  { tint: 'dz-t-clay dz-c-clay', icon: <><path d="M19 3 5 17l-2 4 4-2L21 5z" /><path d="M14 6l4 4" /></> },
  { tint: 'dz-t-mint dz-c-mint', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" /></> },
  { tint: 'dz-t-sand dz-c-sand', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="8" /></> },
  { tint: 'dz-t-sky dz-c-sky', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></> },
  { tint: 'dz-t-amber dz-c-amber', icon: <><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /><path d="M9 21h6M10 17v4M14 17v4" /></> },
];

export function CatalogPage({ onCartChange }: { onCartChange?: () => void }) {
  useLang();
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category') || '';
  // `parent` tracks the category we've drilled INTO (its children are shown
  // as the chip row). `category` is the selected leaf used for product
  // filtering. The product list filters by the leaf if chosen, otherwise by
  // the drilled-in parent so its own products still show.
  const parent = sp.get('parent') || '';
  const effectiveCategory = category || parent;
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
  const [catsLoading, setCatsLoading] = useState(true);
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
  // Bumped by pull-to-refresh to force a re-fetch even when filters
  // haven't changed (effect dep below).
  const [refreshKey, setRefreshKey] = useState(0);

  // The catalog LANDING is a list of category cards. We only switch to the
  // product grid once the user has selected a leaf category (`category`) or
  // is actively searching (`debouncedQ`). Drilling into a parent (which sets
  // `parent`) keeps us on the cards view, now showing that parent's children.
  const showCategoryGrid = !debouncedQ && !category;

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
      } finally {
        if (ok) setCatsLoading(false);
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
  }, [effectiveCategory, sort, debouncedQ, refreshKey]);

  const pull = usePullToRefresh(async () => {
    setRefreshKey((k) => k + 1);
    // Wait one frame so the user sees the spinner finish animating
    // before the cards swap in.
    await new Promise((r) => setTimeout(r, 350));
  });

  useEffect(() => {
    // On the category-cards landing we don't fetch products at all — the
    // cards come from the already-loaded `/v1/categories` data.
    if (showCategoryGrid) {
      setLoading(false);
      inFlightRef.current = false;
      return;
    }
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
            `/v1/products?page=${page}&limit=${PAGE_SIZE}&sort=${encodeURIComponent(sort)}${effectiveCategory ? `&category=${encodeURIComponent(effectiveCategory)}` : ''}${qParam}`,
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
  }, [effectiveCategory, sort, debouncedQ, page, showCategoryGrid]);

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

  // Telegram BackButton drives up-navigation while drilled into a category.
  // We keep the handler in a ref so the button isn't re-registered on every
  // param change (the effect that wires it lives below, after the helpers).
  const goBackRef = useRef<() => void>(() => {});

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

  // --- Category hierarchy, built client-side from `parent_id` ---
  // `/v1/categories` returns every active category (children included), so
  // no extra API call is needed; we just group them by parent.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Cat[]>();
    for (const c of cats) {
      const key = c.parent_id || '';
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [cats]);

  const catById = useMemo(() => {
    const m = new Map<string, Cat>();
    for (const c of cats) m.set(c.id, c);
    return m;
  }, [cats]);

  const hasChildren = (id: string) => (childrenByParent.get(id)?.length || 0) > 0;

  // Small descriptor under a category card: prefer the category's own
  // description, otherwise list a few child names (e.g. "Kabel · Rozetka").
  // No product-count field is exposed by /v1/categories, so we never show a
  // fabricated count.
  const catDescriptor = (c: Cat): string => {
    const desc = (c.description || '').trim();
    if (desc) return desc;
    const kids = childrenByParent.get(c.id);
    if (kids && kids.length) {
      return kids.slice(0, 3).map((k) => k.name).join(' · ');
    }
    return '';
  };

  // Categories shown in the chip row at the current level: children of the
  // drilled-in parent, or the top-level set (parent_id == null) at the root.
  const levelCats = childrenByParent.get(parent) || [];

  // Breadcrumb chain root → current parent (drives the title + up nav).
  const breadcrumb = useMemo(() => {
    const chain: Cat[] = [];
    let cur = parent ? catById.get(parent) : undefined;
    let guard = 0;
    while (cur && guard < 20) {
      chain.unshift(cur);
      cur = cur.parent_id ? catById.get(cur.parent_id) : undefined;
      guard += 1;
    }
    return chain;
  }, [parent, catById]);

  const parentCat = parent ? catById.get(parent) : undefined;

  const mutateParams = (mut: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(sp);
    mut(next);
    setSp(next, { replace });
  };

  // Tap a category: drill into it if it has children, otherwise select it as
  // the leaf filter (the existing category→products behaviour).
  const enterCategory = (cat: Cat) => {
    haptic.selection();
    if (hasChildren(cat.id)) {
      mutateParams((next) => {
        next.set('parent', cat.id);
        next.delete('category');
      });
    } else {
      mutateParams((next) => {
        next.set('category', cat.id);
      });
    }
  };

  // Up one logical level: deselect the leaf first, then walk parents up.
  const goUpLevel = () => {
    mutateParams((next) => {
      if (category) {
        next.delete('category');
        return;
      }
      const grandparent = parentCat?.parent_id || '';
      if (grandparent) next.set('parent', grandparent);
      else next.delete('parent');
      next.delete('category');
    });
  };

  const isDrilled = Boolean(parent || category);
  goBackRef.current = goUpLevel;

  // Show/hide the Telegram BackButton based on drill state. Hidden at the
  // catalog root so the tab behaves normally.
  useEffect(() => {
    const bb = getTg()?.BackButton;
    if (!bb) return;
    if (!isDrilled) return;
    const handler = () => {
      try {
        haptic.selection();
      } catch {
        /* ignore */
      }
      goBackRef.current();
    };
    bb.onClick(handler);
    bb.show();
    return () => {
      try {
        bb.offClick(handler);
        bb.hide();
      } catch {
        /* ignore */
      }
    };
  }, [isDrilled]);

  const hasAnyFilter =
    Boolean(category) || Boolean(parent) || quickFilter !== 'all' || sort !== 'name' || Boolean(debouncedQ);
  const activeFilters: string[] = [];
  if (category) {
    const catName = catById.get(category)?.name || 'Kategoriya';
    activeFilters.push(catName);
  } else if (parent) {
    activeFilters.push(parentCat?.name || 'Kategoriya');
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

  const sortLabels: Record<SortMode, string> = {
    name: 'Nomi',
    price_asc: 'Arzondan',
    price_desc: 'Qimmatdan',
  };

  return (
    <div className="space-y-3 dz-animate-in">
      <PullIndicator status={pull.status} distance={pull.distance} threshold={pull.threshold} />
      {/* Title + glass search + inline sort */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h1 className="text-[22px] font-bold tracking-[-0.035em] text-[var(--ink)]">
            {showCategoryGrid ? t('catalog.categories.title') : t('nav.catalog')}
          </h1>
          <span className="dz-chip-teal dz-chip tabular-nums">
            {showCategoryGrid ? levelCats.length : visibleProducts.length}
          </span>
        </div>
        <div className="flex items-stretch gap-1.5">
          <label className="dz-search flex-1">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--brand-deep)" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('home.search.placeholder')}
              enterKeyHint="search"
              autoComplete="off"
            />
          </label>
          {/* Sort only applies to the product list, so it's hidden on the
              category-cards landing. */}
          {!showCategoryGrid ? (
            <div className="dz-search relative !px-0 !py-0">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Saralash"
                className="h-full appearance-none border-0 bg-transparent py-2.5 pl-3 pr-7 text-[12px] font-bold text-[var(--brand-deep)] focus:outline-none"
              >
                <option value="name">↕ {sortLabels.name}</option>
                <option value="price_asc">↑ {sortLabels.price_asc}</option>
                <option value="price_desc">↓ {sortLabels.price_desc}</option>
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]" aria-hidden>
                ▾
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</div>
      ) : null}

      {!searchInput.trim() && recentSearches.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--dz-soft)]">
            Oxirgi qidiruvlar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {recentSearches.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setSearchInput(q)}
                className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand-primary)] transition hover:bg-[var(--brand-cream-100)]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Drill-up header — shown whenever we're inside a category: either a
          drilled-in parent (cards of its children) or a selected leaf (its
          products). Tapping returns one logical level up. */}
      {parentCat || category ? (
        <div className="flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={goUpLevel}
            className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-bold text-[var(--brand-primary)] transition active:scale-95 hover:bg-[var(--brand-cream-100)]"
            aria-label={t('catalog.back')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            {t('catalog.back')}
          </button>
          <h2 className="min-w-0 truncate text-[14px] font-extrabold tracking-tight text-[var(--ink)]">
            {(category ? catById.get(category)?.name : parentCat?.name) || t('catalog.categories.title')}
          </h2>
        </div>
      ) : null}

      {showCategoryGrid ? (
        /* CATEGORY CARDS — the catalog landing. Renders top-level categories
           at the root, or the children of a drilled-in parent. Tapping a card
           drills into a parent (more cards) or opens a leaf's products. */
        catsLoading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-[68px] w-full rounded-[17px]" />
            ))}
          </div>
        ) : levelCats.length === 0 ? (
          <div className="dz-card-flat relative px-4 py-8 text-center">
            <p className="text-[12.5px] font-semibold text-[var(--soft-ink)]">{t('catalog.categories.empty')}</p>
          </div>
        ) : (
          <div className="dz-stagger flex flex-col gap-2.5">
            {/* "View all" — only when drilled into a parent that also has its
                own/descendant products. Sets category=<parent> so the product
                grid opens; the backend's getCategorySubtreeIds then returns
                the parent + every descendant product. */}
            {parent && !category ? (
              <button
                type="button"
                onClick={() => {
                  haptic.selection();
                  mutateParams((next) => {
                    next.set('category', parent);
                  });
                }}
                className="dz-crow w-full text-left active:scale-[0.99]"
              >
                <div className="dz-ci dz-brand-bg text-white">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] font-bold tracking-tight text-[var(--brand-primary)]">
                    {t('catalog.viewAll')}
                  </b>
                  <p className="mt-0.5 truncate text-[10.5px] font-medium text-[var(--soft-ink)]">{parentCat?.name}</p>
                </div>
                <svg
                  className="ml-auto flex-shrink-0 text-[var(--brand-primary)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            ) : null}
            {levelCats.map((c, i) => {
              const v = CAT_VISUALS[i % CAT_VISUALS.length];
              const descriptor = catDescriptor(c);
              const drillable = hasChildren(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => enterCategory(c)}
                  className="dz-crow w-full text-left active:scale-[0.99]"
                >
                  <div className={`dz-ci ${v.tint}`}>
                    {c.image_url ? (
                      <img src={resolveProductImageUrl(c.image_url) || ''} alt="" className="h-6 w-6 rounded-lg object-cover" />
                    ) : c.icon ? (
                      <span className="text-[20px] leading-none" aria-hidden>
                        {c.icon}
                      </span>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        {v.icon}
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px] font-bold tracking-tight text-[var(--ink)]">{c.name}</b>
                    {descriptor ? (
                      <p className="mt-0.5 truncate text-[10.5px] font-medium text-[var(--soft-ink)]">{descriptor}</p>
                    ) : null}
                  </div>
                  {drillable ? (
                    <span className="ml-auto flex-shrink-0 text-[16px] leading-none text-[var(--muted)]" aria-hidden>
                      ›
                    </span>
                  ) : (
                    <svg
                      className="ml-auto flex-shrink-0 text-[var(--muted)]"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )
      ) : (
        <>
      {/* Quick filters — single horizontal scroll row */}
      <div className="dz-scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
        {[
          { key: 'all' as const, label: 'Hammasi' },
          { key: 'in_stock' as const, label: '✓ Mavjud' },
          { key: 'favorites' as const, label: '♥ Sevimli' },
          { key: 'budget' as const, label: '💸 200k gacha' },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setQuickFilter(f.key)}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition active:scale-95 ${
              quickFilter === f.key
                ? 'bg-[var(--brand-accent)] text-[var(--brand-primary)]'
                : 'bg-white text-[var(--brand-primary)] hover:bg-[var(--brand-cream-100)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {hasAnyFilter ? (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--brand-teal-50)] px-2.5 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--brand-teal-600)]">
            {activeFilters.join(' · ')}
          </p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="flex-shrink-0 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-[var(--brand-teal-600)] transition active:scale-95"
          >
            ✕ Tozalash
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="dz-prod overflow-hidden">
              <Skeleton className="h-[100px] w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="dz-card-flat dz-cream-bg relative px-4 py-8 text-center">
          <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-30%', right: '-20%', opacity: 0.22 }} />
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ bottom: '-25%', left: '-15%', opacity: 0.22 }} />
          <div className="relative">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl dz-teal-bg text-xl text-white">
              🔎
            </div>
            <p className="text-[13px] font-semibold text-[var(--brand-primary)]">
              {debouncedQ
                ? 'Qidiruv boʻyicha mahsulot topilmadi.'
                : quickFilter !== 'all'
                  ? 'Tezkor filtr boʻyicha mahsulot topilmadi.'
                  : 'Bu filtr boʻyicha mahsulot topilmadi.'}
            </p>
            <p className="mt-0.5 text-[11.5px] text-[var(--soft-ink)]">Boshqa soʻz yoki kategoriyani sinab koʻring.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded-full bg-[var(--brand-primary)] px-3.5 py-1.5 text-[12px] font-bold text-white active:scale-95"
              >
                Filtrlarni tozalash
              </button>
              {levelCats.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => enterCategory(c)}
                  className="rounded-full bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[var(--brand-primary)] active:scale-95"
                >
                  {c.name}
                </button>
              ))}
            </div>
            {fallbackProducts.length > 0 ? (
              <div className="mt-5 text-left">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-ink)]">
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
                <div key={`more-${i}`} className="dz-prod overflow-hidden">
                  <Skeleton className="h-[100px] w-full rounded-none" />
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
        </>
      )}
    </div>
  );
}
