import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { resolveProductImageUrl } from '../lib/productImageUrl';
import { addToCart } from '../lib/cart';
import { isFavorite, toggleFavorite } from '../lib/favorites';
import { Skeleton } from '../components/Skeleton';
import { Toast } from '../components/Toast';
import { useTgBackButton, useTgMainButton } from '../hooks/useTgButtons';
import { haptic, isTgEnv, shareToTelegram } from '../lib/telegram';
import {
  getBackInStock,
  subscribeBackInStock,
  unsubscribeBackInStock,
} from '../lib/loyalty';
import { loadTokens } from '../lib/api';
import { recordRecentlyViewed } from '../lib/recentlyViewed';
import { SimilarProducts } from '../components/SimilarProducts';
import { ProductReviews } from '../components/ProductReviews';
import { t, useLang } from '../lib/i18n';

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_uzs: number;
  stock_quantity: number | null;
  is_available: boolean;
  track_stock: boolean;
  image_url: string | null;
  images: { url: string }[];
  category_id?: string | null;
  options?: { name: string; value: string }[];
};

export function ProductPage({ onCartChange }: { onCartChange: () => void }) {
  useLang();
  const { id } = useParams();
  const [p, setP] = useState<Product | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [fav, setFav] = useState(false);
  const [backInStockSub, setBackInStockSub] = useState(false);
  const [backInStockBusy, setBackInStockBusy] = useState(false);

  const imageUrls = useMemo(() => {
    if (!p) return [];
    const fromTable = (p.images || [])
      .map((x) => resolveProductImageUrl(x.url))
      .filter((u): u is string => !!u);
    if (fromTable.length) return fromTable;
    const primary = resolveProductImageUrl(p.image_url);
    return primary ? [primary] : [];
  }, [p]);

  useEffect(() => {
    setImgIdx(0);
    if (!id) return;
    setFav(isFavorite(id));
    setBackInStockSub(false);
    if (loadTokens()) {
      void getBackInStock(id).then((sub) => setBackInStockSub(sub));
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let ok = true;
    void (async () => {
      setErr(null);
      setP(null);
      try {
        const r = await fetch(apiUrl(`/v1/products/${encodeURIComponent(id)}`));
        if (!r.ok) {
          setErr('Mahsulot topilmadi');
          return;
        }
        const j = (await r.json()) as Product;
        if (!ok) return;
        setP(j);
        // Track in "recently viewed" so we can surface it on the home
        // page later. Doesn't depend on auth — purely local.
        recordRecentlyViewed({
          id: j.id,
          name: j.name,
          price_uzs: j.price_uzs,
          image_url: j.image_url,
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      }
    })();
    return () => {
      ok = false;
    };
  }, [id]);

  // Telegram native buttons must be wired unconditionally (hook rules);
  // their visibility is driven by computed flags.
  useTgBackButton();

  const canBuyTg = !!p && p.is_available;
  const tgPriceTotal = p ? p.price_uzs * qty : 0;
  useTgMainButton({
    text: canBuyTg
      ? `Savatga · ${tgPriceTotal.toLocaleString('uz-UZ')} soʻm`
      : '',
    visible: canBuyTg,
    onClick: () => {
      if (!p) return;
      addToCart({
        product_id: p.id,
        name: p.name,
        price_uzs: p.price_uzs,
        quantity: qty,
      });
      onCartChange();
      haptic.notify('success');
      setToast(qty > 1 ? `${qty} dona savatga qoʻshildi` : 'Savatga qoʻshildi');
    },
  });

  if (err) {
    return (
      <div className="space-y-4 dz-animate-in">
        <div className="dz-card-flat dz-cream-bg relative px-6 py-10 text-center">
          <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-30%', right: '-20%', opacity: 0.22 }} />
          <div className="relative">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-xl">
              ⚠
            </div>
            <p className="mt-3 text-[14px] font-bold text-[var(--brand-primary)]">{err}</p>
            <Link
              to="/catalog"
              className="dz-btn-primary mt-4 inline-flex items-center gap-1 text-[12.5px]"
            >
              ← Katalogga qaytish
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="space-y-3 dz-animate-in">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <Skeleton className="aspect-square w-full rounded-3xl" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  const mainImg = imageUrls[imgIdx] ?? imageUrls[0] ?? null;
  const stockLow = p.track_stock && (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 3;
  const totalPrice = p.price_uzs * qty;
  const inTg = isTgEnv();

  return (
    <div className="space-y-3.5 dz-animate-in pb-2">
      <Toast message={toast} onDismiss={() => setToast(null)} />

      {/* Top bar — minimal */}
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/catalog"
          className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-cream-100)] px-3 py-1.5 text-[12px] font-semibold text-[var(--brand-primary)] transition active:scale-95 hover:bg-[var(--brand-cream-200)]"
        >
          ← Katalog
        </Link>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const url = window.location.href;
              const text = `${p.name} — ${p.price_uzs.toLocaleString('uz-UZ')} soʻm`;
              haptic.selection();
              // Inside Telegram open the native share sheet; outside fall
              // back to navigator.share / clipboard.
              if (shareToTelegram(url, text)) return;
              if (navigator.share) {
                void navigator.share({ title: p.name, text, url }).catch(() => {});
              } else if (navigator.clipboard) {
                void navigator.clipboard.writeText(url).then(
                  () => setToast('Havola nusxa olindi'),
                  () => setToast('Havola nusxa olinmadi'),
                );
              }
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-cream-100)] text-[13px] text-[var(--brand-primary)] transition active:scale-95 hover:bg-[var(--brand-cream-200)]"
            aria-label="Ulashish"
          >
            ↗
          </button>
          {id ? (
            <button
              type="button"
              onClick={() => {
                const next = toggleFavorite(id);
                setFav(next);
                setToast(next ? 'Sevimlilarga qoʻshildi' : 'Sevimlilardan olib tashlandi');
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold transition active:scale-95 ${
                fav
                  ? 'bg-[var(--brand-teal)] text-white shadow-[var(--dz-glow-teal)]'
                  : 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)] hover:bg-[var(--brand-cream-200)]'
              }`}
              aria-label={fav ? 'Sevimlidan olib tashlash' : 'Sevimliga qoʻshish'}
            >
              <span aria-hidden>{fav ? '♥' : '♡'}</span>
              {fav ? 'Sevimlida' : 'Sevimliga'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Image card — minimal with leaks */}
      <div className="dz-card relative overflow-hidden">
        <span className="dz-leak dz-leak-teal dz-leak-lg" style={{ top: '-25%', right: '-25%', opacity: 0.18 }} />
        <span className="dz-leak dz-leak-cream dz-leak-md" style={{ bottom: '-25%', left: '-15%', opacity: 0.4 }} />
        <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '40%', right: '20%', opacity: 0.12 }} />

        <div className={`relative ${mainImg ? 'aspect-square' : 'aspect-[4/3]'} w-full`}>
          {mainImg ? (
            <img
              src={mainImg}
              alt=""
              className={`h-full w-full object-cover transition ${
                !p.is_available ? 'opacity-65 grayscale' : ''
              }`}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/70 text-2xl text-[var(--brand-primary)]/45 backdrop-blur-md">
                📷
              </div>
              <p className="text-[11.5px] font-medium text-[var(--brand-primary)]/55">
                Rasm hali qoʻshilmagan
              </p>
            </div>
          )}

          {/* Top-left status badge */}
          {!p.is_available ? (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-[var(--brand-primary)] px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-white">
              Tugagan
            </span>
          ) : stockLow ? (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-[var(--brand-accent)] px-3 py-1 text-[10.5px] font-extrabold text-[var(--brand-primary)]">
              ⚡ Kam qoldi · {p.stock_quantity}
            </span>
          ) : null}
        </div>

        {/* Thumbnails */}
        {imageUrls.length > 1 ? (
          <div className="dz-scroll-x flex gap-2 bg-white/60 px-2 pb-2 pt-1.5 backdrop-blur-md">
            {imageUrls.map((url, i) => (
              <button
                key={url + String(i)}
                type="button"
                onClick={() => setImgIdx(i)}
                className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl transition ${
                  i === imgIdx
                    ? 'ring-2 ring-[var(--brand-primary)] ring-offset-2 ring-offset-white'
                    : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Title + brand + rating + specs + stock + price + delivery */}
      <div className="dz-card relative p-4">
        <span className="dz-leak dz-leak-cream dz-leak-md" style={{ top: '-50%', right: '-20%', opacity: 0.5 }} />
        <div className="relative flex flex-col gap-3">
          {p.options && p.options.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="dz-brtag">{p.options[0].value}</span>
            </div>
          ) : null}
          <h1 className="text-[20px] font-bold leading-[1.2] tracking-[-0.035em] text-[var(--ink)]">
            {p.name}
          </h1>
          {p.options && p.options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.options.slice(0, 4).map((o, i) => (
                <span key={`${p.id}-spec-${i}`} className="dz-spec">
                  {o.value}
                </span>
              ))}
            </div>
          ) : null}
          {p.track_stock ? (
            (p.stock_quantity ?? 0) > 0 ? (
              <span className="dz-stock">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {t('product.stockCount').replace('{n}', String(p.stock_quantity))}
              </span>
            ) : (
              <span className="dz-stock" style={{ background: '#fdecec', color: '#c0392b' }}>
                {t('product.outOfStock')}
              </span>
            )
          ) : null}
          <div className="flex items-baseline gap-2.5">
            <b className="text-[27px] font-extrabold tracking-[-0.035em] tabular-nums text-[var(--ink)]">
              {p.price_uzs.toLocaleString('uz-UZ')}
              <small className="ml-1 text-[12px] font-medium text-[var(--muted)]">{t('common.som')}</small>
            </b>
          </div>
          <div className="dz-deliv">
            <div className="dz-di">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="1" y="3" width="15" height="13" rx="1" />
                <path d="M16 8h4l3 3v5h-7" />
              </svg>
            </div>
            <div>
              <b className="block text-[11.5px] font-bold text-[var(--ink)]">{t('product.delivery.title')}</b>
              <p className="mt-0.5 text-[10px] font-medium text-[var(--muted)]">{t('product.delivery.sub')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Options */}
      {p.options && p.options.length > 0 ? (
        <div className="dz-card relative p-3.5">
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '-50%', right: '-15%', opacity: 0.2 }} />
          <p className="relative mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/60">
            Xususiyatlar
          </p>
          <dl className="relative grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {p.options.map((o, i) => (
              <div key={`${p.id}-opt-${i}`} className="contents">
                <dt className="font-medium text-[var(--dz-soft)]">{o.name}</dt>
                <dd className="text-right font-semibold text-[var(--brand-primary)]">{o.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {/* Description */}
      {p.description ? (
        <div className="dz-card relative p-4">
          <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ top: '-40%', right: '-15%', opacity: 0.18 }} />
          <p className="relative mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/60">
            Tavsif
          </p>
          <p className="relative whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--dz-muted)]">
            {p.description}
          </p>
        </div>
      ) : null}

      {/* Reviews — aggregated rating + recent feedback */}
      <ProductReviews productId={p.id} />

      {/* Trust / info row — small icons */}
      <div className="dz-card-flat grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-white/70 px-2 py-2.5 backdrop-blur-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--brand-teal-50)] text-[13px] text-[var(--brand-teal)]" aria-hidden>
            🚚
          </span>
          <span className="text-center text-[10px] font-semibold leading-tight text-[var(--brand-primary)]">
            Tezkor<br />yetkazib berish
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-white/70 px-2 py-2.5 backdrop-blur-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--brand-cream-100)] text-[13px]" aria-hidden>
            🔒
          </span>
          <span className="text-center text-[10px] font-semibold leading-tight text-[var(--brand-primary)]">
            Xavfsiz<br />toʻlov
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-white/70 px-2 py-2.5 backdrop-blur-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--brand-accent-100)] text-[13px]" aria-hidden>
            ✦
          </span>
          <span className="text-center text-[10px] font-semibold leading-tight text-[var(--brand-primary)]">
            Bonus<br />ball
          </span>
        </div>
      </div>

      {/* Out of stock — elegant cream card with back-in-stock subscribe */}
      {!p.is_available ? (
        <div className="dz-card-flat dz-cream-bg relative px-4 py-5 text-center">
          <span className="dz-leak dz-leak-primary dz-leak-md" style={{ top: '-50%', right: '-20%', opacity: 0.12 }} />
          <div className="relative">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-base">
              🌱
            </div>
            <p className="text-[13px] font-bold text-[var(--brand-primary)]">Hozir mavjud emas</p>
            <p className="mt-0.5 text-[11.5px] text-[var(--brand-primary)]/65">
              Mahsulot tez orada qaytadi. «Eslatib turing» tugmasini bossangiz, paydo boʻlishi bilan Telegram orqali xabar yuboramiz.
            </p>
            {id ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={backInStockBusy || !loadTokens()}
                  onClick={async () => {
                    if (!id || !loadTokens()) {
                      setToast('Telegram Mini App orqali kiring');
                      return;
                    }
                    setBackInStockBusy(true);
                    haptic.selection();
                    const next = backInStockSub
                      ? !(await unsubscribeBackInStock(id))
                      : await subscribeBackInStock(id);
                    setBackInStockSub(next);
                    setToast(
                      next
                        ? '🔔 Mavjud boʻlganda eslatamiz'
                        : 'Eslatma bekor qilindi',
                    );
                    haptic.notify('success');
                    setBackInStockBusy(false);
                  }}
                  className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-bold transition disabled:opacity-50 ${
                    backInStockSub
                      ? 'bg-[var(--brand-teal)] text-white shadow-[var(--dz-glow-teal)]'
                      : 'bg-[var(--brand-primary)] text-white'
                  }`}
                >
                  {backInStockBusy
                    ? '…'
                    : backInStockSub
                      ? '🔔 Eslatma yoqildi'
                      : '🔔 Eslatib turing'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = toggleFavorite(id);
                    setFav(next);
                    setToast(next ? 'Sevimlilarga qoʻshildi' : 'Sevimlilardan olib tashlandi');
                  }}
                  className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-[var(--brand-primary)]"
                >
                  {fav ? '♥ Sevimlida' : '♡ Sevimliga'}
                </button>
              </div>
            ) : null}
          </div>
          {/* Discovery: alternative similar products to keep them shopping */}
          <div className="mt-3">
            <SimilarProducts
              categoryId={p.category_id || null}
              excludeId={p.id}
              title="🔄 Shu kategoriyadan boshqalari"
            />
          </div>
        </div>
      ) : (
        <>
          {/* Discovery — similar products from the same category */}
          <SimilarProducts categoryId={p.category_id || null} excludeId={p.id} />
          <div className="h-2" />
          {/* Sticky bottom CTA. Inside Telegram only the quantity selector
              is shown; the native MainButton at the bottom handles the
              actual add-to-cart action (with live total in its label). */}
          <div className="dz-buybar sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-3 rounded-2xl p-2.5">
            <div className="dz-qty">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Kamaytirish"
              >
                −
              </button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                aria-label="Koʻpaytirish"
              >
                +
              </button>
            </div>
            {inTg ? (
              <div className="dz-buy h-[46px] flex-1 text-[13.5px]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="9" cy="21" r="1.5" />
                  <circle cx="19" cy="21" r="1.5" />
                  <path d="M2 2h3l2.6 13.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L23 6H6" />
                </svg>
                <span className="tabular-nums">{t('product.addToCart')} · {totalPrice.toLocaleString('uz-UZ')}</span>
              </div>
            ) : (
              <button
                type="button"
                className="dz-buy h-[46px] flex-1 text-[13.5px]"
                onClick={() => {
                  addToCart({
                    product_id: p.id,
                    name: p.name,
                    price_uzs: p.price_uzs,
                    quantity: qty,
                  });
                  onCartChange();
                  setToast(qty > 1 ? `${qty} dona savatga qoʻshildi` : 'Savatga qoʻshildi');
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="9" cy="21" r="1.5" />
                  <circle cx="19" cy="21" r="1.5" />
                  <path d="M2 2h3l2.6 13.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L23 6H6" />
                </svg>
                <span className="tabular-nums">{t('product.addToCart')} · {totalPrice.toLocaleString('uz-UZ')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
