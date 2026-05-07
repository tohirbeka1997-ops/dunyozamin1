import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { Skeleton } from '../components/Skeleton';
import { apiUrl } from '../lib/api';
import { loadFavorites } from '../lib/favorites';

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

export function FavoritesPage({ onCartChange }: { onCartChange?: () => void }) {
  const [rows, setRows] = useState<Product[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    void (async () => {
      setErr(null);
      const ids = loadFavorites();
      if (!ids.length) {
        setRows([]);
        return;
      }
      try {
        const responses = await Promise.all(
          ids.map((id) => fetch(apiUrl(`/v1/products/${encodeURIComponent(id)}`))),
        );
        const products = await Promise.all(
          responses
            .filter((r) => r.ok)
            .map(async (r) => (await r.json()) as Product),
        );
        if (!ok) return;
        setRows(products);
      } catch (e) {
        if (!ok) return;
        setErr(e instanceof Error ? e.message : 'Xato');
        setRows([]);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Sevimlilar</h1>
        <p className="mt-0.5 text-sm text-[var(--dz-soft)]">Saqlangan mahsulotlar ro&apos;yxati</p>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</div>
      ) : null}

      {!rows ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border bg-[var(--dz-surface)] shadow-[var(--dz-card-shadow-soft)]">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {rows.map((p) => (
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
      ) : (
        <div className="rounded-2xl border border-dashed bg-[var(--dz-surface)] px-6 py-10 text-center shadow-[var(--dz-card-shadow-soft)]">
          <p className="text-3xl" aria-hidden>
            ❤
          </p>
          <p className="mt-3 text-sm font-medium text-[var(--dz-muted)]">Sevimlilar bo&apos;sh</p>
          <p className="mt-1 text-xs text-[var(--dz-soft)]">Mahsulot sahifasida yurak tugmasi bilan saqlang</p>
          <Link
            to="/catalog"
            className="mt-5 inline-flex rounded-xl bg-[var(--dz-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--dz-accent-text)]"
          >
            Katalogga o&apos;tish
          </Link>
        </div>
      )}
    </div>
  );
}
