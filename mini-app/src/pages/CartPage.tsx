import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { cartTotal, loadCart, setQuantity } from '../lib/cart';

export function CartPage({ onCartChange }: { onCartChange: () => void }) {
  const [lines, setLines] = useState(() => loadCart());
  const [stockById, setStockById] = useState<Record<string, { track: boolean; qty: number | null }>>({});
  const onCartChangeRef = useRef(onCartChange);

  useEffect(() => {
    onCartChangeRef.current = onCartChange;
  }, [onCartChange]);

  useEffect(() => {
    const sync = () => setLines(loadCart());
    window.addEventListener('cart:change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('cart:change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    let ok = true;
    const ids = lines.map((l) => l.product_id);
    if (!ids.length) {
      setStockById({});
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await fetch(apiUrl(`/v1/products/${encodeURIComponent(id)}`));
            if (!r.ok) return [id, { track: false, qty: null }] as const;
            const p = (await r.json()) as { track_stock?: boolean; stock_quantity?: number | null };
            return [id, { track: !!p.track_stock, qty: p.stock_quantity ?? null }] as const;
          } catch {
            return [id, { track: false, qty: null }] as const;
          }
        }),
      );
      if (!ok) return;
      const next = Object.fromEntries(entries);
      setStockById(next);

      let changed = false;
      for (const l of lines) {
        const st = next[l.product_id];
        if (st?.track && st.qty != null) {
          const max = Math.max(0, Number(st.qty));
          if (l.quantity > max) {
            setQuantity(l.product_id, max);
            changed = true;
          }
        }
      }
      if (changed) {
        setLines(loadCart());
        onCartChangeRef.current();
      }
    })();
    return () => {
      ok = false;
    };
  }, [lines]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Savat</h1>
        <p className="mt-0.5 text-sm text-[var(--dz-soft)]">Miqdorni o&apos;zgartiring yoki buyurtmaga o&apos;ting</p>
      </div>

      {!lines.length ? (
        <div className="rounded-2xl border border-dashed bg-[var(--dz-surface)] px-6 py-12 text-center shadow-[var(--dz-card-shadow-soft)]">
          <p className="text-4xl" aria-hidden>
            🛒
          </p>
          <p className="mt-3 text-sm font-medium text-[var(--dz-muted)]">Savat bo&apos;sh</p>
          <p className="mt-1 text-xs text-[var(--dz-soft)]">Katalogdan mahsulot qo&apos;shing</p>
          <Link
            to="/catalog"
            className="mt-5 inline-flex rounded-xl bg-[var(--dz-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--dz-accent-text)]"
          >
            Katalogga o&apos;tish
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {lines.map((l) => {
              const st = stockById[l.product_id];
              const maxQty = st?.track && st.qty != null ? Math.max(0, Number(st.qty)) : null;
              const atMax = maxQty != null && l.quantity >= maxQty;
              return (
              <li
                key={l.product_id}
                className="flex items-center gap-3 rounded-2xl border bg-[var(--dz-surface)] p-3 shadow-[var(--dz-card-shadow-soft)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--dz-text)]">{l.name}</div>
                  <div className="mt-0.5 text-sm tabular-nums text-[var(--dz-muted)]">
                    {l.price_uzs.toLocaleString('uz-UZ')} × {l.quantity}
                  </div>
                  {maxQty != null ? (
                    <div className="mt-0.5 text-xs text-[var(--dz-soft)]">Omborda: {maxQty} dona</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-0.5 rounded-xl border bg-[var(--dz-bg)] p-1">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-medium text-[var(--dz-muted)] transition hover:bg-black/5"
                    onClick={() => {
                      const next = setQuantity(l.product_id, l.quantity - 1);
                      setLines(next);
                      onCartChangeRef.current();
                    }}
                    aria-label="Kamaytirish"
                  >
                    −
                  </button>
                  <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-medium text-[var(--dz-muted)] transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={atMax}
                    onClick={() => {
                      if (atMax) return;
                      const next = setQuantity(l.product_id, l.quantity + 1);
                      setLines(next);
                      onCartChangeRef.current();
                    }}
                    aria-label="Ko&apos;paytirish"
                  >
                    +
                  </button>
                </div>
              </li>
              );
            })}
          </ul>

          <div className="rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-[var(--dz-muted)]">Jami</span>
              <span className="text-xl font-bold tabular-nums">
                {cartTotal(lines).toLocaleString('uz-UZ')} so&apos;m
              </span>
            </div>
            <Link
              to="/checkout"
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-[var(--dz-accent)] py-3.5 text-center text-base font-semibold text-[var(--dz-accent-text)] shadow-md transition active:scale-[0.99]"
            >
              Buyurtma berish
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
