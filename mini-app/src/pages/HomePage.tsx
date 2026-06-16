import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { resolveProductImageUrl } from '../lib/productImageUrl';
import { Skeleton } from '../components/Skeleton';
import { ProductCard } from '../components/ProductCard';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullIndicator } from '../components/PullIndicator';
import { SearchSuggest } from '../components/SearchSuggest';
import { RecentlyViewed } from '../components/RecentlyViewed';
import { PromoCarousel } from '../components/PromoCarousel';
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

export function HomePage({ onCartChange }: { onCartChange?: () => void }) {
  useLang();
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchHome = useCallback(async (showSkeleton: boolean) => {
    if (showSkeleton) setLoading(true);
    setErr(null);
    try {
      const [c, p] = await Promise.all([
        fetch(apiUrl('/v1/categories')),
        fetch(apiUrl('/v1/products?limit=12&sort=name')),
      ]);
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
      if (showSkeleton) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHome(true);
  }, [fetchHome]);

  const pull = usePullToRefresh(() => fetchHome(false));

  return (
    <div className="space-y-4 pb-2 dz-animate-in">
      <PullIndicator status={pull.status} distance={pull.distance} threshold={pull.threshold} />
      {/* HERO — minimal brand gradient with multiple soft leaks */}
      <section className="relative overflow-hidden rounded-[1.75rem] dz-brand-bg p-5 text-white">
        <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-30%', right: '-25%', opacity: 0.32 }} />
        <span className="dz-leak dz-leak-teal dz-leak-md" style={{ bottom: '-30%', left: '-20%', opacity: 0.28 }} />
        <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ top: '20%', right: '40%', opacity: 0.18 }} />
        <div className="relative">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-[var(--brand-accent)]/95">
            {t('home.hero.kicker')}
          </p>
          <h1 className="mt-2 text-[22px] font-extrabold leading-[1.15]">
            {t('home.hero.title1')}
            <span className="block text-[var(--brand-accent)]">{t('home.hero.title2')}</span>
          </h1>
          <p className="mt-1.5 max-w-[20rem] text-[12px] leading-relaxed text-white/80">
            {t('home.hero.subtitle')}
          </p>

          <SearchSuggest className="mt-4" placeholder={t('home.search.placeholder')} />
        </div>
      </section>

      {/* QUICK ACTIONS — minimal cards with soft color leaks */}
      <section className="grid grid-cols-3 gap-2.5">
        <Link
          to="/catalog"
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.25 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-teal-50)] text-[15px] text-[var(--brand-teal)]" aria-hidden>
            ⚡
          </span>
          <span className="relative leading-tight">Tezkor<br />xarid</span>
        </Link>
        <Link
          to="/favorites"
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.3 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-accent-100)] text-[15px] text-[var(--brand-primary)]" aria-hidden>
            ♥
          </span>
          <span className="relative leading-tight">Sevimli<br />mahsulotlar</span>
        </Link>
        <Link
          to="/orders"
          className="dz-card-flat relative flex flex-col items-start justify-between gap-3 px-3 py-3 text-left text-[11.5px] font-semibold text-[var(--brand-primary)] transition active:scale-[0.97]"
        >
          <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ top: '-30%', right: '-30%', opacity: 0.55 }} />
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--brand-cream-100)] text-[15px] text-[var(--brand-primary)]" aria-hidden>
            📦
          </span>
          <span className="relative leading-tight">Mening<br />buyurtmalarim</span>
        </Link>
      </section>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {err}
        </div>
      ) : null}

      {/* CATEGORIES — horizontal pill scroll, minimal */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-[var(--brand-primary)]">Kategoriyalar</h2>
          <Link to="/catalog" className="text-[12px] font-semibold text-[var(--brand-teal)] hover:underline">
            Hammasi →
          </Link>
        </div>
        {loading ? (
          <div className="flex gap-2 overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-24 flex-shrink-0 rounded-full" />
            ))}
          </div>
        ) : !cats.length ? (
          <span className="text-sm text-[var(--dz-soft)]">Hozircha kategoriya yoʻq</span>
        ) : (
          <div className="dz-scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
            {cats.map((c) => (
              <Link
                key={c.id}
                to={`/catalog?category=${encodeURIComponent(c.id)}`}
                className="flex-shrink-0 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--brand-primary)] transition active:scale-95 hover:bg-[var(--brand-cream-100)]"
              >
                <span className="inline-flex max-w-[150px] items-center gap-1.5 truncate">
                  {c.image_url ? (
                    <img
                      src={resolveProductImageUrl(c.image_url) || ''}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  ) : c.icon ? (
                    <span className="shrink-0 text-[13px] leading-none" aria-hidden>
                      {c.icon}
                    </span>
                  ) : null}
                  <span className="truncate">{c.name}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Promo banner carousel — auto-rotates */}
      <PromoCarousel />

      {/* Daily deal — deterministic per-day pick */}
      <DailyDeal />

      {/* Recently viewed — opt-in, only renders when there's history */}
      <RecentlyViewed />

      {/* PROMO BANNER — minimal cream + teal leak */}
      <section className="dz-card-flat relative dz-cream-bg p-4 text-[var(--brand-primary)]">
        <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-40%', right: '-25%', opacity: 0.22 }} />
        <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ bottom: '-30%', left: '-15%', opacity: 0.25 }} />
        <div className="relative">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--brand-teal)]">
            ✦ Bonus
          </p>
          <h3 className="mt-1 text-[15px] font-extrabold leading-tight">
            Har xaridingizdan ball yigʻing
          </h3>
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--brand-primary)]/75">
            1000 soʻm = 1 ball. Keyingi xariddan foydalaning.
          </p>
          <Link
            to="/profile"
            className="mt-3 inline-flex items-center gap-1 rounded-xl dz-teal-bg px-3 py-1.5 text-[12px] font-bold text-white transition active:scale-95"
          >
            Mening kartam →
          </Link>
        </div>
      </section>

      {/* FEATURED PRODUCTS */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[var(--brand-primary)]">Tanlangan mahsulotlar</h2>
            <p className="text-[10.5px] font-medium text-[var(--dz-soft)]">Eng koʻp tanlangan tovarlar</p>
          </div>
          <Link
            to="/catalog"
            className="rounded-full bg-[var(--brand-teal-50)] px-3 py-1 text-[11.5px] font-semibold text-[var(--brand-teal-600)] transition active:scale-95"
          >
            Hammasi →
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="dz-card overflow-hidden">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-2.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-7 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="dz-card-flat dz-cream-bg relative px-4 py-8 text-center">
            <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ top: '-30%', right: '-15%', opacity: 0.2 }} />
            <p className="relative text-[12.5px] font-semibold text-[var(--brand-primary)]/70">
              Hozircha katalogda mahsulot yoʻq.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
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

      <p className="pt-2 text-center text-[10.5px] leading-relaxed text-[var(--dz-soft)]">
        🔒 Telegram Mini App — xavfsiz toʻlov va buyurtma holati
      </p>
    </div>
  );
}
