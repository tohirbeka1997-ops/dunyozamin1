import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addToCart, loadCart } from '../lib/cart';
import { isFavorite, toggleFavorite } from '../lib/favorites';
import { LazyImg } from './LazyImg';

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
  const [favorite, setFavorite] = useState(() => isFavorite(id));
  const [bumping, setBumping] = useState(false);

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

  // Pick a leak hue based on id-hash for visual variety
  const leakHue = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 3;
  }, [id]);
  const leakClass = ['dz-leak-teal', 'dz-leak-cream', 'dz-leak-accent'][leakHue];

  const handleAdd = () => {
    addToCart({ product_id: id, name, price_uzs, quantity: 1 });
    onQuickAdd?.();
    setBumping(true);
    setTimeout(() => setBumping(false), 220);
  };

  return (
    <article className="dz-card group flex flex-col">
      <Link to={`/product/${encodeURIComponent(id)}`} className="block">
        {/* Image area with soft leak */}
        <div className="relative aspect-square w-full overflow-hidden bg-[var(--brand-cream-50)]">
          {/* Color leak */}
          <span
            className={`dz-leak ${leakClass} dz-leak-md`}
            style={{ top: '-30%', right: '-20%', opacity: 0.32 }}
          />
          <span
            className="dz-leak dz-leak-cream dz-leak-sm"
            style={{ bottom: '-20%', left: '-10%', opacity: 0.5 }}
          />

          <LazyImg
            src={image_url}
            alt={name}
            className="absolute inset-0"
            imgClassName={`transition duration-300 group-hover:scale-[1.03] ${
              !is_available ? 'opacity-60 grayscale' : ''
            }`}
            fallback={<span className="text-4xl text-[color-mix(in_srgb,var(--brand-primary)_18%,transparent)]">🛒</span>}
          />

          {/* Favorite — minimal */}
          <button
            type="button"
            aria-label={favorite ? 'Sevimlidan olib tashlash' : 'Sevimliga qoʻshish'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFavorite(toggleFavorite(id));
            }}
            className={`absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition ${
              favorite
                ? 'bg-[var(--brand-teal)] text-white shadow-[var(--dz-glow-teal)]'
                : 'bg-white/80 text-[var(--brand-primary)] backdrop-blur-md hover:bg-white'
            }`}
          >
            {favorite ? '♥' : '♡'}
          </button>

          {/* Out of stock — minimal pill at bottom */}
          {!is_available ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/85 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--brand-primary)] backdrop-blur-md">
              Tugagan
            </span>
          ) : stockLimit != null && stockLimit <= 3 ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-[var(--brand-accent)]/95 px-2 py-0.5 text-[9.5px] font-bold text-[var(--brand-primary)] backdrop-blur-md">
              Kam · {stockLimit}
            </span>
          ) : null}
        </div>

        {/* Body — minimal padding & text */}
        <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-2 pb-1.5">
          <div className="line-clamp-2 min-h-[2.25rem] text-[12.5px] font-semibold leading-snug text-[var(--dz-text)]">
            {name}
          </div>
          {optLine ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] font-medium leading-snug text-[var(--dz-soft)]">
              {optLine}
            </p>
          ) : desc ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-[var(--dz-soft)]">{desc}</p>
          ) : null}
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-[14.5px] font-extrabold tabular-nums text-[var(--brand-primary)]">
              {price_uzs.toLocaleString('uz-UZ')}
            </span>
            <span className="text-[10px] font-semibold text-[var(--dz-soft)]">soʻm</span>
          </div>
        </div>
      </Link>

      {/* CTA — minimal, no shadow */}
      <div className="px-2.5 pb-2.5">
        <button
          type="button"
          disabled={!canAdd}
          onClick={handleAdd}
          className={`flex w-full items-center justify-center gap-1 rounded-xl py-2 text-[11.5px] font-bold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${
            cartQty > 0
              ? 'bg-[var(--brand-accent)] text-[var(--brand-primary)]'
              : 'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-600)]'
          } ${bumping ? 'animate-pulse' : ''}`}
        >
          {!canAdd
            ? stockLimit === 0
              ? 'Tugagan'
              : 'Maks.'
            : cartQty > 0
              ? `✓ ${cartQty} ta · yana`
              : '＋ Savatga'}
        </button>
      </div>
    </article>
  );
}
