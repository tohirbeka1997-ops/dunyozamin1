import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LazyImg } from './LazyImg';
import { clearRecentlyViewed, loadRecentlyViewed, type RecentItem } from '../lib/recentlyViewed';

/**
 * Horizontal carousel of products the user recently opened.
 * Listens for `recently-viewed:change` so it stays live as the user
 * navigates between product pages.
 */
export function RecentlyViewed() {
  const [items, setItems] = useState<RecentItem[]>(() => loadRecentlyViewed());

  useEffect(() => {
    const sync = () => setItems(loadRecentlyViewed());
    window.addEventListener('recently-viewed:change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('recently-viewed:change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="dz-card relative overflow-hidden p-3.5">
      <span className="dz-leak dz-leak-cream dz-leak-md" style={{ top: '-50%', right: '-20%', opacity: 0.42 }} />
      <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ bottom: '-40%', left: '-15%', opacity: 0.18 }} />
      <div className="relative mb-2.5 flex items-center justify-between">
        <p className="text-[12px] font-bold text-[var(--brand-primary)]">⏱ Yaqinda koʻrgansiz</p>
        <button
          type="button"
          onClick={() => clearRecentlyViewed()}
          className="text-[10.5px] font-bold text-[var(--brand-teal)] hover:underline"
        >
          Tozalash
        </button>
      </div>
      <div className="dz-scroll-x relative -mx-1 flex gap-2.5 px-1">
        {items.map((p) => (
          <Link
            key={p.id}
            to={`/product/${encodeURIComponent(p.id)}`}
            className="group block w-[110px] flex-shrink-0"
          >
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-[var(--brand-cream-50)]">
              <LazyImg
                src={p.image_url}
                alt={p.name}
                className="absolute inset-0"
                imgClassName="transition group-hover:scale-105"
              />
            </div>
            <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-[10.5px] font-semibold leading-snug text-[var(--brand-primary)]">
              {p.name}
            </p>
            <p className="mt-0.5 text-[11.5px] font-black tabular-nums text-[var(--brand-primary)]">
              {p.price_uzs.toLocaleString('uz-UZ')}
              <span className="ml-0.5 text-[8.5px] font-bold opacity-60">soʻm</span>
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
