import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addToCart, loadCart } from '../lib/cart';
import { isFavorite, toggleFavorite } from '../lib/favorites';

/** Marketplace (Uzum uslubi) — ikki ustunli grid uchun karta */
export type ProductCardProps = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
  description?: string | null;
  options?: { name: string; value: string }[];
  track_stock?: boolean;
  stock_quantity?: number | null;
  onQuickAdd?: () => void;
};

export function ProductCard({
  id,
  name,
  price_uzs,
  image_url,
  is_available,
  description,
  options,
  track_stock,
  stock_quantity,
  onQuickAdd,
}: ProductCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [favorite, setFavorite] = useState(() => isFavorite(id));

  useEffect(() => {
    setFavorite(isFavorite(id));
  }, [id]);

  useEffect(() => {
    const onFavChanged = () => setFavorite(isFavorite(id));
    window.addEventListener('favorites:change', onFavChanged);
    return () => window.removeEventListener('favorites:change', onFavChanged);
  }, [id]);

  const desc = description?.trim();
  const optLine = useMemo(() => {
    if (!options || options.length === 0) return '';
    return options
      .slice(0, 2)
      .map((o) => `${o.name}: ${o.value}`)
      .join(' · ');
  }, [options]);
  const stockLimit = track_stock ? Math.max(0, Number(stock_quantity ?? 0)) : null;
  const cartQty = useMemo(() => loadCart().find((x) => x.product_id === id)?.quantity || 0, [id]);
  const canAdd = is_available && (stockLimit == null || cartQty < stockLimit);
  const stockLabel =
    !is_available
      ? 'Tugagan'
      : stockLimit == null
        ? null
        : stockLimit <= 3
          ? `Kam qoldi: ${stockLimit}`
          : `Ombor: ${stockLimit}`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border border-[var(--dz-border-strong)] bg-[var(--dz-surface)] shadow-[var(--dz-card-shadow-soft)] transition hover:-translate-y-0.5 hover:shadow-[var(--dz-card-shadow)]">
      <Link to={`/product/${encodeURIComponent(id)}`} className="block">
        <div className="relative aspect-square w-full bg-[color-mix(in_srgb,var(--dz-surface)_88%,#94a3b8_12%)]">
          {image_url && !imgFailed ? (
            <img
              src={image_url}
              alt=""
              className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-4xl text-[#dadce0]">🛒</div>
          )}
          <button
            type="button"
            aria-label={favorite ? 'Sevimlidan olib tashlash' : 'Sevimliga qo‘shish'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFavorite(toggleFavorite(id));
            }}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/40 bg-black/35 text-sm text-white backdrop-blur-sm transition hover:bg-black/45"
          >
            {favorite ? '♥' : '♡'}
          </button>
          {stockLabel ? (
            <span
              className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                !is_available
                  ? 'bg-black/65 uppercase tracking-wide text-white'
                  : stockLimit != null && stockLimit <= 3
                    ? 'bg-amber-100/95 text-amber-900'
                    : 'bg-[var(--dz-surface)]/90 text-[var(--dz-muted)]'
              }`}
            >
              {stockLabel}
            </span>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-snug text-[var(--dz-text)]">
            {name}
          </div>
          {optLine ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] font-medium leading-snug text-[var(--dz-muted)]">
              {optLine}
            </p>
          ) : null}
          {desc ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--dz-muted)]">{desc}</p>
          ) : null}
          <div className="mt-auto pt-2">
            <span className="text-[15px] font-bold tabular-nums text-[var(--dz-accent)]">
              {price_uzs.toLocaleString('uz-UZ')}
            </span>
            <span className="ml-0.5 text-[12px] font-medium text-[var(--dz-muted)]">so&apos;m</span>
            {cartQty > 0 ? (
              <p className="mt-1 text-[10px] font-semibold text-[var(--dz-link)]">
                Savatda: {cartQty}
              </p>
            ) : null}
          </div>
        </div>
      </Link>
      <div className="p-3 pt-0">
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => {
            addToCart({ product_id: id, name, price_uzs, quantity: 1 });
            onQuickAdd?.();
          }}
          className="w-full rounded-xl bg-[var(--dz-accent)] px-3 py-2 text-xs font-semibold text-[var(--dz-accent-text)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {canAdd ? "Savatga qo'shish" : stockLimit === 0 ? 'Tugagan' : 'Maksimal miqdor'}
        </button>
      </div>
    </article>
  );
}
