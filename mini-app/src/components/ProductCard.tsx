import { Link } from 'react-router-dom';

/** Marketplace (Uzum uslubi) — ikki ustunli grid uchun karta */
export type ProductCardProps = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
  description?: string | null;
};

export function ProductCard({
  id,
  name,
  price_uzs,
  image_url,
  is_available,
  description,
}: ProductCardProps) {
  const desc = description?.trim();

  return (
    <Link
      to={`/product/${encodeURIComponent(id)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-[var(--dz-surface)] shadow-[var(--dz-card-shadow-soft)] transition active:scale-[0.99] hover:shadow-[var(--dz-card-shadow)]"
    >
      <div className="relative aspect-square w-full bg-[color-mix(in_srgb,var(--dz-surface)_88%,#94a3b8_12%)]">
        {image_url ? (
          <img
            src={image_url}
            alt=""
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-[#dadce0]">🛒</div>
        )}
        {!is_available ? (
          <span className="absolute right-2 top-2 rounded-md bg-black/65 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Tugagan
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <div className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-snug text-[var(--dz-text)]">
          {name}
        </div>
        {desc ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--dz-muted)]">{desc}</p>
        ) : null}
        <div className="mt-auto pt-2">
          <span className="text-[15px] font-bold tabular-nums text-[var(--dz-text)]">
            {price_uzs.toLocaleString('uz-UZ')}
          </span>
          <span className="ml-0.5 text-[12px] font-medium text-[var(--dz-muted)]">so&apos;m</span>
        </div>
      </div>
    </Link>
  );
}
