import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { resolveProductImageUrl } from '../lib/productImageUrl';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullIndicator } from '../components/PullIndicator';
import { SearchSuggest } from '../components/SearchSuggest';
import { RecentlyViewed } from '../components/RecentlyViewed';
import { DailyDeal } from '../components/DailyDeal';
import { t, useLang } from '../lib/i18n';

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

type Cat = { id: string; name: string; image_url?: string | null; icon?: string | null };

/** Construction-themed icon set + colour tints for the category grid. */
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

const TRUST_CHIPS: { key: string; labelKey: 'trust.delivery' | 'trust.warranty' | 'trust.installment'; icon: ReactNode }[] = [
  {
    key: 'delivery',
    labelKey: 'trust.delivery',
    icon: <><rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7M5.5 18.5a2 2 0 1 0 0 .01M18.5 18.5a2 2 0 1 0 0 .01" /></>,
  },
  {
    key: 'warranty',
    labelKey: 'trust.warranty',
    icon: <><path d="M12 2 4 5v6c0 5 8 11 8 11s8-6 8-11V5z" /><path d="m9 12 2 2 4-4" /></>,
  },
  {
    key: 'installment',
    labelKey: 'trust.installment',
    icon: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  },
];

const BRANDS: { name: string; letter: string; color: string }[] = [
  { name: 'Akfix', letter: 'A', color: '#0c7d43' },
  { name: 'CHINT', letter: 'C', color: '#d98a05' },
  { name: 'Dusel', letter: 'D', color: '#4d86bd' },
  { name: 'Epa', letter: 'E', color: '#c9714a' },
];

const IMG_TINTS = ['dz-img-mint', 'dz-img-sky', 'dz-img-sand', 'dz-img-clay'];

/** Live countdown to the next midnight (visual scarcity — local clock only). */
function useMidnightTimer() {
  const calc = () => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);
    const s = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const [label, setLabel] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLabel(calc()), 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export function HomePage({ onCartChange }: { onCartChange?: () => void }) {
  useLang();
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [catsErr, setCatsErr] = useState<string | null>(null);
  const [productsErr, setProductsErr] = useState<string | null>(null);
  const timer = useMidnightTimer();

  // Each section fetches independently so a single failing request
  // (network/CORS/rate-limit) can't blank the whole page. Categories and
  // products each surface their own retry affordance.
  const fetchCats = useCallback(async () => {
    setCatsErr(null);
    try {
      const c = await fetch(apiUrl('/v1/categories'));
      if (!c.ok) throw new Error(`HTTP ${c.status}`);
      const cj = await readJsonSafe<{ data?: Cat[] }>(c);
      setCats(cj.data || []);
    } catch (e) {
      setCatsErr(e instanceof Error ? e.message : 'Xato');
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setProductsErr(null);
    try {
      const p = await fetch(apiUrl('/v1/products?limit=12&sort=name'));
      if (!p.ok) throw new Error(`HTTP ${p.status}`);
      const pj = await readJsonSafe<{ data?: Product[] }>(p);
      setProducts(pj.data || []);
    } catch (e) {
      setProductsErr(e instanceof Error ? e.message : 'Xato');
    }
  }, []);

  const fetchHome = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) setLoading(true);
      await Promise.allSettled([fetchCats(), fetchProducts()]);
      if (showSkeleton) setLoading(false);
    },
    [fetchCats, fetchProducts],
  );

  useEffect(() => {
    void fetchHome(true);
  }, [fetchHome]);

  const pull = usePullToRefresh(() => fetchHome(false));

  const dealProducts = products.slice(0, 6);
  const popularProducts = products;

  return (
    <div className="space-y-3 pb-2 dz-animate-in">
      <PullIndicator status={pull.status} distance={pull.distance} threshold={pull.threshold} />

      {/* Search with QR / scanner */}
      <SearchSuggest placeholder={t('home.search.placeholder')} />

      <div className="dz-stagger flex flex-col gap-3">
        {/* HERO promo */}
        <section className="dz-hero">
          <div className="dz-hero-sheen" />
          <svg className="dz-cog" width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9.4l.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 3.6V4a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 19 6l.06-.06" />
          </svg>
          <span className="dz-hero-tag">{t('home.hero.tag')}</span>
          <h2 className="relative mt-3 text-[21px] font-bold leading-[1.08] tracking-[-0.03em]">
            {t('home.hero.season1')}
            <br />
            <i className="not-italic text-[#ffd98a]">{t('home.hero.season2')}</i>
          </h2>
          <p className="relative mt-1.5 text-[11.5px] font-normal opacity-80">{t('home.hero.season.sub')}</p>
          <Link
            to="/catalog"
            className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[11.5px] font-bold text-[var(--brand-deep)] active:scale-95"
          >
            {t('home.hero.cta')}
          </Link>
          <div className="dz-hdots absolute bottom-3.5 right-[18px]">
            <i className="on" />
            <i />
            <i />
          </div>
        </section>

        {/* Trust chips */}
        <div className="dz-scroll-x -mx-1 flex gap-1.5 px-1">
          {TRUST_CHIPS.map((c) => (
            <div key={c.key} className="dz-trust">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                {c.icon}
              </svg>
              {t(c.labelKey)}
            </div>
          ))}
        </div>

        {/* Categories 4×2 */}
        <div>
          <div className="dz-row mb-2.5">
            <h3>{t('section.categories')}</h3>
            <Link to="/catalog">{t('common.all')}</Link>
          </div>
          {loading ? (
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-[78px] w-full rounded-2xl" />
              ))}
            </div>
          ) : catsErr ? (
            <button
              type="button"
              onClick={() => void fetchCats()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--line)] px-4 py-4 text-[12px] font-semibold text-[var(--brand-deep)] active:scale-[0.98]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {t('common.retry')}
            </button>
          ) : cats.length === 0 ? (
            <span className="text-[12px] text-[var(--muted)]">{t('common.empty')}</span>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {cats.slice(0, 8).map((c, i) => {
                const v = CAT_VISUALS[i % CAT_VISUALS.length];
                return (
                  <Link key={c.id} to={`/catalog?category=${encodeURIComponent(c.id)}`} className="dz-cat">
                    <div className={`dz-ci ${v.tint}`}>
                      {c.image_url ? (
                        <img src={resolveProductImageUrl(c.image_url) || ''} alt="" className="h-5 w-5 rounded-md object-cover" />
                      ) : c.icon ? (
                        <span className="text-[17px] leading-none" aria-hidden>{c.icon}</span>
                      ) : (
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                          {v.icon}
                        </svg>
                      )}
                    </div>
                    <span className="line-clamp-2">{c.name}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Brands */}
        <div>
          <div className="dz-row mb-2.5">
            <h3>{t('section.brands')}</h3>
            <Link to="/catalog">{t('common.all')}</Link>
          </div>
          <div className="dz-scroll-x -mx-1 flex gap-1.5 px-1">
            {BRANDS.map((b) => (
              <Link key={b.name} to={`/catalog?q=${encodeURIComponent(b.name)}`} className="dz-brand-chip">
                <span className="dz-bl" style={{ background: b.color }}>{b.letter}</span>
                {b.name}
              </Link>
            ))}
          </div>
        </div>

        {/* Flash deals — live timer + horizontal cards + stock progress */}
        {loading || dealProducts.length > 0 ? (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.025em] text-[var(--ink)]">
                <span aria-hidden>🔥</span> {t('section.deals')}
              </div>
              <div className="dz-timer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <b className="tabular-nums">{timer}</b>
              </div>
            </div>
            {loading ? (
              <div className="flex gap-3 overflow-hidden">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[150px] w-[132px] flex-shrink-0 rounded-[18px]" />
                ))}
              </div>
            ) : (
              <div className="dz-scroll-x -mx-1 flex gap-3 px-1 pb-1">
                {dealProducts.map((p, i) => {
                  const stock = p.track_stock ? Math.max(0, Number(p.stock_quantity ?? 0)) : null;
                  // Progress reflects real remaining stock vs a soft cap of 30.
                  const cap = 30;
                  const remaining = stock == null ? null : Math.min(stock, cap);
                  const soldPct = remaining == null ? 60 : Math.max(8, Math.round(((cap - remaining) / cap) * 100));
                  return (
                    <Link key={p.id} to={`/product/${encodeURIComponent(p.id)}`} className="dz-deal flex-shrink-0">
                      <div className={`dz-dimg ${IMG_TINTS[i % IMG_TINTS.length]}`}>
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
                          <rect x="3" y="3" width="18" height="18" rx="3" />
                          <path d="m3 16 5-5 4 4 3-3 6 6" />
                        </svg>
                      </div>
                      <div className="px-3 pb-3 pt-2.5">
                        <div className="line-clamp-2 h-[29px] text-[11.5px] font-semibold leading-[1.25] tracking-tight text-[var(--ink)]">
                          {p.name}
                        </div>
                        <div className="mt-1.5 flex items-baseline gap-1.5">
                          <span className="text-[14px] font-extrabold tracking-tight text-[var(--brand-deep)]">
                            {p.price_uzs.toLocaleString('uz-UZ')}
                          </span>
                        </div>
                        <div className="dz-bar">
                          <i style={{ width: `${soldPct}%` }} />
                        </div>
                        {remaining != null ? (
                          <div className="mt-1 text-[9px] font-semibold text-[var(--muted)]">
                            {t('deals.sold')} {(cap - remaining).toLocaleString('uz-UZ')}/{cap}
                          </div>
                        ) : (
                          <div className="mt-1 h-[11px]" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* Daily deal — deterministic per-day pick */}
        <DailyDeal />

        {/* Recently viewed — only renders when there's history */}
        <RecentlyViewed />

        {/* Popular products */}
        <div>
          <div className="dz-row mb-2.5">
            <div>
              <h3>{t('section.popular')}</h3>
            </div>
            <Link to="/catalog">{t('common.all')}</Link>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="dz-prod overflow-hidden">
                  <Skeleton className="h-[100px] w-full rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-7 w-full rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : productsErr ? (
            <button
              type="button"
              onClick={() => void fetchProducts()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-[12.5px] font-semibold text-[var(--brand-deep)] active:scale-[0.98]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {t('common.retry')}
            </button>
          ) : popularProducts.length === 0 ? (
            <div className="dz-card-flat relative px-4 py-8 text-center">
              <p className="text-[12.5px] font-semibold text-[var(--soft-ink)]">{t('common.empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {popularProducts.map((p) => (
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
        </div>

        {/* Bonus banner */}
        <Link to="/profile" className="dz-loyal">
          <div className="dz-bi">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <polygon points="12 2 15 9 22 9.5 17 14 18.5 21 12 17.5 5.5 21 7 14 2 9.5 9 9" />
            </svg>
          </div>
          <div className="relative">
            <b className="block text-[13px] font-bold tracking-tight text-[var(--ink)]">{t('bonus.title')}</b>
            <p className="mt-0.5 text-[10.5px] font-medium text-[var(--soft-ink)]">{t('bonus.rule')}</p>
          </div>
        </Link>
      </div>

      <p className="pt-2 text-center text-[10.5px] leading-relaxed text-[var(--soft-ink)]">
        🔒 Telegram Mini App — xavfsiz toʻlov va buyurtma holati
      </p>
    </div>
  );
}
