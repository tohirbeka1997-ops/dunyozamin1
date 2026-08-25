import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addToCart, loadCart } from '../lib/cart';
import { isFavorite, toggleFavorite } from '../lib/favorites';
import { t, useLang } from '../lib/i18n';
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

const IMG_TINTS = ['dz-img-mint', 'dz-img-sky', 'dz-img-sand', 'dz-img-clay'];

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
  useLang();
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

  // Amber "brand"-style label: the first product option value when present
  // (e.g. material/brand). Purely a display of existing data — no new fetch.
  const brandLabel = options && options.length > 0 ? options[0].value : '';
  const stockLimit = track_stock ? Math.max(0, Number(stock_quantity ?? 0)) : null;
  const cartQty = useMemo(() => loadCart().find((x) => x.product_id === id)?.quantity || 0, [id]);
  const canAdd = is_available && (stockLimit == null || cartQty < stockLimit);

  // Deterministic tint per product for visual variety
  const tint = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return IMG_TINTS[h % IMG_TINTS.length];
  }, [id]);

  // Truthful meta line: stock count when tracked, else availability.
  const metaText = stockLimit != null
    ? `${t('product.inStock')} ${stockLimit.toLocaleString('uz-UZ')}`
    : is_available
      ? ''
      : t('product.outOfStock');

  const handleAdd = () => {
    if (!canAdd) return;
    addToCart({ product_id: id, name, price_uzs, quantity: 1 });
    onQuickAdd?.();
    setBumping(true);
    setTimeout(() => setBumping(false), 220);
  };

  return (
    <article className="dz-prod flex flex-col">
      <Link to={`/product/${encodeURIComponent(id)}`} className="block">
        <div className={`dz-pimg ${tint}`}>
          {is_available && stockLimit !== null && stockLimit <= 3 && stockLimit > 0 ? (
            <span className="dz-pbadge" style={{ color: 'var(--amber-deep)' }}>
              {t('product.lowStock')}
            </span>
          ) : null}
          {!is_available ? (
            <span className="dz-pbadge" style={{ left: '9px' }}>
              {t('product.outOfStock')}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={favorite ? 'Sevimlidan olib tashlash' : 'Sevimliga qoʻshish'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFavorite(toggleFavorite(id));
            }}
            className="dz-heart"
            style={favorite ? { color: '#e3859e' } : undefined}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill={favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </svg>
          </button>
          <LazyImg
            src={image_url}
            alt={name}
            className="absolute inset-0"
            imgClassName={`object-cover transition duration-300 ${!is_available ? 'opacity-60 grayscale' : ''}`}
            fallback={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="m3 16 5-5 4 4 3-3 6 6" />
                <circle cx="8.5" cy="8.5" r="1.5" />
              </svg>
            }
          />
        </div>
        <div className="px-3 pb-1 pt-2.5">
          {brandLabel ? (
            <div className="truncate text-[9px] font-extrabold uppercase tracking-[0.05em] text-[var(--amber-deep)]">
              {brandLabel}
            </div>
          ) : null}
          <div className="mt-0.5 line-clamp-2 h-[2rem] text-[12.5px] font-semibold leading-[1.3] tracking-tight text-[var(--ink)]">
            {name}
          </div>
          {metaText ? (
            <div className="mt-1.5 flex items-center gap-1 text-[9.5px] font-semibold text-[var(--muted)]">
              <span className="text-[var(--amber)]" aria-hidden>★</span>
              {metaText}
            </div>
          ) : (
            <div className="mt-1.5 h-[14px]" />
          )}
        </div>
      </Link>
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <b className="text-[14.5px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">
          {price_uzs.toLocaleString('uz-UZ')}
          <small className="ml-0.5 text-[9.5px] font-medium text-[var(--muted)]">{t('common.som')}</small>
        </b>
        <button
          type="button"
          disabled={!canAdd}
          onClick={handleAdd}
          aria-label={t('product.addToCart')}
          className={`dz-add ${bumping ? 'dz-pulse' : ''}`}
          style={cartQty > 0 ? { background: 'linear-gradient(135deg, var(--amber), var(--amber-deep))' } : undefined}
        >
          {cartQty > 0 ? <span className="text-[11px] font-extrabold">{cartQty}</span> : '+'}
        </button>
      </div>
    </article>
  );
}
