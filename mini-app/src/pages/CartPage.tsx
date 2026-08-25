import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl } from '../lib/api';
import { cartTotal, clearCart, loadCart, setLineNote, setQuantity } from '../lib/cart';
import { useTgMainButton } from '../hooks/useTgButtons';
import { isTgEnv, tgConfirm } from '../lib/telegram';
import { EmptyState } from '../components/EmptyState';
import { t, useLang } from '../lib/i18n';

export function CartPage({ onCartChange }: { onCartChange: () => void }) {
  useLang();
  const nav = useNavigate();
  const [lines, setLines] = useState(() => loadCart());
  const [stockById, setStockById] = useState<Record<string, { track: boolean; qty: number | null }>>({});
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
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

  const total = cartTotal(lines);
  const itemsCount = lines.reduce((s, l) => s + l.quantity, 0);

  // Native TG MainButton: shows on cart with running total. Hidden when empty.
  useTgMainButton({
    text: lines.length ? `Buyurtma berish · ${total.toLocaleString('uz-UZ')} soʻm` : '',
    visible: lines.length > 0,
    onClick: () => nav('/checkout'),
  });
  const inTg = isTgEnv();

  const handleClearCart = async () => {
    // Lightweight confirm step (native in Telegram, window.confirm on web).
    const ok = await tgConfirm(t('cart.clear.confirm'));
    if (!ok) return;
    setLines(clearCart());
    onCartChangeRef.current();
  };

  return (
    <div className="space-y-4 dz-animate-in">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--brand-primary)]">🛒 Savat</h1>
          <p className="mt-0.5 text-[12px] font-medium text-[var(--soft-ink)]">
            {lines.length ? `${itemsCount} ta mahsulot` : "Savatingiz bo'sh"}
          </p>
        </div>
        {lines.length ? (
          <div className="flex items-center gap-1.5">
            <span className="dz-chip-accent dz-chip">{lines.length} pozitsiya</span>
            <button
              type="button"
              onClick={handleClearCart}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-cream-100)] px-2.5 py-1 text-[11px] font-bold text-red-500 transition active:scale-95 hover:bg-red-50"
              aria-label={t('cart.clear')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              {t('cart.clear')}
            </button>
          </div>
        ) : null}
      </div>

      {!lines.length ? (
        <EmptyState
          icon="🛒"
          title="Savat boʻsh"
          description="Katalogdan oʻzingizga yoqqan mahsulotni qoʻshing va tezkor yetkazib berishdan foydalaning"
          tone="teal"
          cta={{ to: '/catalog', label: '🧺 Katalogga oʻtish' }}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {lines.map((l) => {
              const st = stockById[l.product_id];
              const maxQty = st?.track && st.qty != null ? Math.max(0, Number(st.qty)) : null;
              const atMax = maxQty != null && l.quantity >= maxQty;
              const lineTotal = l.price_uzs * l.quantity;
              return (
                <li
                  key={l.product_id}
                  className="dz-citem relative p-2.5"
                >
                  <div className="relative flex items-center gap-3">
                    <div className="dz-img-mint flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] text-[var(--brand-deep)]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <path d="m3 16 5-5 4 4 3-3 6 6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-[12.5px] font-semibold leading-snug text-[var(--dz-text)]">
                        {l.name}
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-[13.5px] font-extrabold tabular-nums text-[var(--brand-primary)]">
                          {lineTotal.toLocaleString('uz-UZ')}
                        </span>
                        <span className="text-[10px] font-semibold text-[var(--dz-soft)]">soʻm</span>
                      </div>
                      {maxQty != null ? (
                        <div className="text-[9.5px] font-medium text-[var(--dz-soft)]">
                          Omborda {maxQty} dona
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-0.5 rounded-xl bg-[var(--brand-cream-100)] p-0.5">
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-base font-bold text-[var(--brand-primary)] transition hover:bg-white"
                        onClick={() => {
                          const next = setQuantity(l.product_id, l.quantity - 1);
                          setLines(next);
                          onCartChangeRef.current();
                        }}
                        aria-label="Kamaytirish"
                      >
                        −
                      </button>
                      <span className="min-w-[1.5rem] text-center text-[12.5px] font-bold tabular-nums text-[var(--brand-primary)]">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-base font-bold text-[var(--brand-primary)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={atMax}
                        onClick={() => {
                          if (atMax) return;
                          const next = setQuantity(l.product_id, l.quantity + 1);
                          setLines(next);
                          onCartChangeRef.current();
                        }}
                        aria-label="Koʻpaytirish"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Per-item note: minimal toggle, expands to a textarea */}
                  {editingNoteId === l.product_id ? (
                    <div className="relative mt-2 flex items-stretch gap-2">
                      <input
                        type="text"
                        value={noteDraft}
                        autoFocus
                        maxLength={200}
                        placeholder="Masalan: yumshoqroq, issiqroq…"
                        onChange={(e) => setNoteDraft(e.target.value)}
                        className="flex-1 rounded-xl border border-[var(--brand-cream-200)] bg-white px-3 py-1.5 text-[12px] text-[var(--brand-primary)] placeholder:text-[var(--brand-primary)]/40 focus:border-[var(--brand-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-teal)]/25"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setLines(setLineNote(l.product_id, noteDraft));
                          setEditingNoteId(null);
                        }}
                        className="rounded-xl bg-[var(--brand-primary)] px-3 py-1.5 text-[11.5px] font-bold text-white"
                      >
                        ✓
                      </button>
                    </div>
                  ) : l.note ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteId(l.product_id);
                        setNoteDraft(l.note || '');
                      }}
                      className="relative mt-2 flex w-full items-center gap-1.5 rounded-xl bg-[var(--brand-cream-100)] px-2.5 py-1.5 text-left text-[11px] text-[var(--brand-primary)]/85"
                    >
                      <span aria-hidden>💬</span>
                      <span className="line-clamp-1 flex-1">{l.note}</span>
                      <span className="text-[10px] text-[var(--brand-primary)]/50">tahrir</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteId(l.product_id);
                        setNoteDraft('');
                      }}
                      className="relative mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold text-[var(--brand-teal)]"
                    >
                      ＋ Mahsulotga izoh qoʻshish
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Promo code — dashed glass row (visual placeholder) */}
          <div className="dz-promo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
              <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
            </svg>
            {t('cart.promo')}
            <span className="ml-auto font-extrabold">{t('cart.promo.apply')}</span>
          </div>

          {/* Summary card */}
          <div className="dz-summary relative rounded-2xl p-4">
            <div className="relative space-y-2">
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-medium text-[var(--soft-ink)]">{t('cart.products')} · {itemsCount}</span>
                <span className="font-semibold tabular-nums text-[var(--ink)]">
                  {total.toLocaleString('uz-UZ')}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-medium text-[var(--soft-ink)]">{t('cart.delivery')}</span>
                <span className="text-[11px] font-semibold text-[var(--soft-ink)]">{t('cart.delivery.calc')}</span>
              </div>
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="font-medium text-[var(--soft-ink)]">{t('cart.bonus')}</span>
                <span className="font-bold tabular-nums text-[var(--amber-deep)]">
                  +{Math.floor(total / 1000).toLocaleString('uz-UZ')}
                </span>
              </div>
              <div className="my-1 h-px bg-[var(--line)]" />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-extrabold tracking-tight text-[var(--ink)]">{t('cart.total')}</span>
                <span className="text-[20px] font-extrabold tabular-nums tracking-[-0.03em] text-[var(--ink)]">
                  {total.toLocaleString('uz-UZ')}
                  <span className="ml-1 text-[11px] font-semibold text-[var(--soft-ink)]">{t('common.som')}</span>
                </span>
              </div>
            </div>
            {/* In Telegram, the native MainButton at the bottom handles
                checkout. Outside TG (web/dev), show the in-page CTA. */}
            {!inTg ? (
              <Link
                to="/checkout"
                className="dz-buy mt-4 flex h-[50px] w-full items-center justify-center gap-1.5 text-[14px]"
              >
                {t('action.checkout')} →
              </Link>
            ) : null}
            <Link
              to="/catalog"
              className={`relative ${inTg ? 'mt-4' : 'mt-2'} flex w-full items-center justify-center rounded-2xl bg-[var(--mint)] py-2 text-[12px] font-bold text-[var(--brand-deep)] transition active:scale-[0.98]`}
            >
              ＋ Yana mahsulot qoʻshish
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
