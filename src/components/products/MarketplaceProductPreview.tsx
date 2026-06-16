import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import type { ProductVariantOption } from '@/types/database';
import { Package } from 'lucide-react';

type Props = {
  name: string;
  salePrice: number;
  imageUrl: string | null;
  description?: string;
  isAvailable: boolean;
  showInMarketplace: boolean;
  trackStock?: boolean;
  stockQuantity?: number | null;
  options?: ProductVariantOption[];
};

export function MarketplaceProductPreview({
  name,
  salePrice,
  imageUrl,
  description,
  isAvailable,
  showInMarketplace,
  trackStock = true,
  stockQuantity = null,
  options = [],
}: Props) {
  const displayUrl = getProductImageDisplayUrl(imageUrl);
  const optLine = options
    .slice(0, 2)
    .map((o) => `${o.name}: ${o.value}`)
    .join(' · ');
  const desc = description?.trim();
  const stockLow =
    trackStock && (stockQuantity ?? 0) > 0 && (stockQuantity ?? 0) <= 3;
  const priceRounded = Math.round(Number(salePrice) || 0);

  return (
    <div className="max-w-[168px]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/70 mb-2">
        Mini-app ko‘rinishi
      </p>
      <article className="flex flex-col overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-sm">
        <div className="relative aspect-square w-full overflow-hidden bg-[#f7f4ef]">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt=""
              className={`h-full w-full object-cover ${!isAvailable ? 'opacity-60 grayscale' : ''}`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-emerald-800/25">
              <Package className="h-10 w-10" />
            </div>
          )}
          {!showInMarketplace ? (
            <span className="absolute left-2 top-2 rounded-full bg-slate-800/85 px-2 py-0.5 text-[9px] font-bold text-white">
              Faqat POS
            </span>
          ) : null}
          {!isAvailable ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-900 backdrop-blur-sm">
              Tugagan
            </span>
          ) : stockLow ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-amber-300/95 px-2 py-0.5 text-[9px] font-bold text-emerald-950">
              Kam · {stockQuantity}
            </span>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-2 pb-1.5">
          <div className="line-clamp-2 min-h-[2.25rem] text-[12.5px] font-semibold leading-snug text-emerald-950">
            {name || 'Mahsulot nomi'}
          </div>
          {optLine ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] font-medium text-emerald-900/55">{optLine}</p>
          ) : desc ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] text-emerald-900/55">{desc}</p>
          ) : null}
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-[14.5px] font-extrabold tabular-nums text-emerald-800">
              {priceRounded.toLocaleString('uz-UZ')}
            </span>
            <span className="text-[10px] font-semibold text-emerald-900/55">soʻm</span>
          </div>
        </div>
        <div className="px-2.5 pb-2.5">
          <div
            className={`flex w-full items-center justify-center rounded-xl py-2 text-[11.5px] font-bold ${
              !isAvailable
                ? 'bg-emerald-900/20 text-emerald-900/45'
                : 'bg-emerald-800 text-white'
            }`}
          >
            {!isAvailable ? 'Tugagan' : '＋ Savatga'}
          </div>
        </div>
      </article>
    </div>
  );
}
