import { Link } from 'react-router-dom';
import { cartTotal, loadCart, setQuantity } from '../lib/cart';

export function CartPage({ onCartChange }: { onCartChange: () => void }) {
  const lines = loadCart();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Savat</h1>
        <p className="mt-0.5 text-sm text-black/50">Miqdorni o&apos;zgartiring yoki buyurtmaga o&apos;ting</p>
      </div>

      {!lines.length ? (
        <div className="rounded-2xl border border-dashed border-black/15 bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-4xl" aria-hidden>
            🛒
          </p>
          <p className="mt-3 text-sm font-medium text-black/70">Savat bo&apos;sh</p>
          <p className="mt-1 text-xs text-black/45">Katalogdan mahsulot qo&apos;shing</p>
          <Link
            to="/catalog"
            className="mt-5 inline-flex rounded-xl bg-[var(--tg-theme-button-color,#2481cc)] px-5 py-2.5 text-sm font-semibold text-[var(--tg-theme-button-text-color,#fff)]"
          >
            Katalogga o&apos;tish
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {lines.map((l) => (
              <li
                key={l.product_id}
                className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-black/90">{l.name}</div>
                  <div className="mt-0.5 text-sm tabular-nums text-black/55">
                    {l.price_uzs.toLocaleString('uz-UZ')} × {l.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 rounded-xl border border-black/10 bg-black/[0.03] p-1">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-medium text-black/80 transition hover:bg-black/5"
                    onClick={() => {
                      setQuantity(l.product_id, l.quantity - 1);
                      onCartChange();
                    }}
                    aria-label="Kamaytirish"
                  >
                    −
                  </button>
                  <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-lg font-medium text-black/80 transition hover:bg-black/5"
                    onClick={() => {
                      setQuantity(l.product_id, l.quantity + 1);
                      onCartChange();
                    }}
                    aria-label="Ko&apos;paytirish"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-black/55">Jami</span>
              <span className="text-xl font-bold tabular-nums">
                {cartTotal(lines).toLocaleString('uz-UZ')} so&apos;m
              </span>
            </div>
            <Link
              to="/checkout"
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-[var(--tg-theme-button-color,#2481cc)] py-3.5 text-center text-base font-semibold text-[var(--tg-theme-button-text-color,#fff)] shadow-md transition active:scale-[0.99]"
            >
              Buyurtma berish
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
