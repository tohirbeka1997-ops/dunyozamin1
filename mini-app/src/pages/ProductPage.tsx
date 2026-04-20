import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { addToCart } from '../lib/cart';
import { Skeleton } from '../components/Skeleton';
import { Toast } from '../components/Toast';

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
};

export function ProductPage({ onCartChange }: { onCartChange: () => void }) {
  const { id } = useParams();
  const [p, setP] = useState<Product | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);

  const imageUrls = useMemo(() => {
    if (!p) return [];
    const fromTable = (p.images || []).map((x) => x.url).filter(Boolean);
    if (fromTable.length) return fromTable;
    return p.image_url ? [p.image_url] : [];
  }, [p]);

  useEffect(() => {
    setImgIdx(0);
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
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      }
    })();
    return () => {
      ok = false;
    };
  }, [id]);

  if (err) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">{err}</div>
        <Link
          to="/catalog"
          className="inline-flex text-sm font-medium text-[var(--tg-theme-link-color,#2481cc)]"
        >
          ← Katalogga qaytish
        </Link>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const mainImg = imageUrls[imgIdx] ?? imageUrls[0] ?? null;

  return (
    <div className="space-y-4">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <Link
        to="/catalog"
        className="inline-flex items-center gap-1 text-sm font-medium text-[var(--tg-theme-link-color,#2481cc)]"
      >
        ← Katalog
      </Link>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
        <div className="aspect-square w-full bg-[#f3f4f6]">
          {mainImg ? (
            <img src={mainImg} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-5xl text-black/15">📷</div>
          )}
        </div>
        {imageUrls.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-black/[0.06] p-2">
            {imageUrls.map((url, i) => (
              <button
                key={url + String(i)}
                type="button"
                onClick={() => setImgIdx(i)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 bg-[#f3f4f6] transition ${
                  i === imgIdx ? 'border-[var(--tg-theme-button-color,#2481cc)]' : 'border-transparent opacity-80'
                }`}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="space-y-3 p-4">
          <h1 className="text-xl font-bold leading-snug">{p.name}</h1>
          <p className="text-2xl font-bold tabular-nums text-[var(--tg-theme-button-color,#2481cc)]">
            {p.price_uzs.toLocaleString('uz-UZ')} so&apos;m
          </p>
          {p.track_stock ? (
            <p className="text-sm text-black/55">Omborda: {p.stock_quantity ?? 0} dona</p>
          ) : null}
          {p.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-black/75">{p.description}</p>
          ) : null}
        </div>
      </div>

      {!p.is_available ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-900">
          Hozir mavjud emas
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-sm">
            <span className="mb-1.5 block text-black/55">Miqdor</span>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-center text-lg font-semibold shadow-sm"
            />
          </label>
          <button
            type="button"
            className="w-full rounded-xl bg-[var(--tg-theme-button-color,#2481cc)] px-6 py-3.5 text-base font-semibold text-[var(--tg-theme-button-text-color,#fff)] shadow-md transition active:scale-[0.98] sm:w-auto sm:min-w-[160px]"
            onClick={() => {
              addToCart({
                product_id: p.id,
                name: p.name,
                price_uzs: p.price_uzs,
                quantity: qty,
              });
              onCartChange();
              setToast(
                qty > 1
                  ? `${qty} dona savatga qo‘shildi`
                  : 'Savatga qo‘shildi',
              );
            }}
          >
            Savatga qo&apos;shish
          </button>
        </div>
      )}
    </div>
  );
}
