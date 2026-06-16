import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { LazyImg } from './LazyImg';
import { Skeleton } from './Skeleton';

type Suggestion = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
};

/**
 * Horizontal carousel of "siz ham yoqtirgan" / "shu kategoriyadan" picks.
 *
 * - When `categoryId` is given we pull from that category, excluding the
 *   currently-viewed product.
 * - Otherwise falls back to /v1/products/trending so we always have
 *   something to recommend.
 */
export function SimilarProducts({
  categoryId,
  excludeId,
  title = '🛍 Shunga oʻxshash',
}: {
  categoryId?: string | null;
  excludeId?: string | null;
  title?: string;
}) {
  const [items, setItems] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    let ok = true;
    void (async () => {
      try {
        const url = categoryId
          ? apiUrl(`/v1/products?category=${encodeURIComponent(categoryId)}&limit=8&sort=name`)
          : apiUrl(`/v1/products/trending?limit=8&days=30`);
        const r = await fetch(url);
        if (!r.ok) throw new Error('http');
        const j = await readJsonSafe<{ data?: Suggestion[] }>(r);
        const filtered = (j.data || []).filter((p) => p.id !== excludeId);
        if (!ok) return;
        setItems(filtered.slice(0, 6));
      } catch {
        if (ok) setItems([]);
      }
    })();
    return () => {
      ok = false;
    };
  }, [categoryId, excludeId]);

  if (items && items.length === 0) return null;

  return (
    <section className="dz-card relative overflow-hidden p-3.5">
      <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-50%', right: '-25%', opacity: 0.18 }} />
      <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ bottom: '-40%', left: '-15%', opacity: 0.4 }} />
      <p className="relative mb-2.5 text-[12px] font-bold text-[var(--brand-primary)]">{title}</p>
      <div className="dz-scroll-x relative -mx-1 flex gap-2.5 px-1">
        {items
          ? items.map((p) => (
              <Link
                key={p.id}
                to={`/product/${encodeURIComponent(p.id)}`}
                className="group block w-[120px] flex-shrink-0"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-[var(--brand-cream-50)]">
                  <LazyImg
                    src={p.image_url}
                    alt={p.name}
                    className="absolute inset-0"
                    imgClassName={`transition group-hover:scale-105 ${
                      !p.is_available ? 'opacity-60 grayscale' : ''
                    }`}
                  />
                  {!p.is_available ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-[var(--brand-primary)]">
                      Tugagan
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-[11px] font-semibold leading-snug text-[var(--brand-primary)]">
                  {p.name}
                </p>
                <p className="mt-0.5 text-[12px] font-black tabular-nums text-[var(--brand-primary)]">
                  {p.price_uzs.toLocaleString('uz-UZ')}
                  <span className="ml-0.5 text-[9px] font-bold opacity-60">soʻm</span>
                </p>
              </Link>
            ))
          : [1, 2, 3, 4].map((i) => (
              <div key={i} className="w-[120px] flex-shrink-0">
                <Skeleton className="aspect-square w-full rounded-2xl" />
                <Skeleton className="mt-1.5 h-3 w-full" />
                <Skeleton className="mt-1 h-3 w-1/2" />
              </div>
            ))}
      </div>
    </section>
  );
}
