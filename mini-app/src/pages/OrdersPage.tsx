import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { orderStatusUi } from '../lib/orderStatus';
import { Skeleton } from '../components/Skeleton';
import { getTg } from '../lib/telegram';

type OrderRow = {
  id: number;
  order_number: string;
  status: string;
  payment_method?: string | null;
  delivery_method?: string | null;
  rating?: number | null;
  feedback?: string | null;
  total_amount: number;
  created_at: string;
};

export function OrdersPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const done = sp.get('done');
  const pending = sp.get('pending');
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reorderBusyId, setReorderBusyId] = useState<number | null>(null);
  const [ratingBusyId, setRatingBusyId] = useState<number | null>(null);
  const [draftRatings, setDraftRatings] = useState<Record<number, { rating: number; feedback: string }>>({});

  const loadOrders = useCallback(async () => {
    if (!loadTokens()) {
      setErr('Telegram Mini App orqali kiring — avtomatik autentifikatsiya.');
      return;
    }
    setErr(null);
    const r = await apiFetch('/v1/orders?limit=50');
    const j = (await r.json()) as { data?: OrderRow[] };
    if (!r.ok) {
      throw new Error('Buyurtmalarni yuklab bo‘lmadi');
    }
    setRows(j.data || []);
  }, []);

  useEffect(() => {
    if (!loadTokens()) {
      setErr('Telegram Mini App orqali kiring — avtomatik autentifikatsiya.');
      return;
    }
    let ok = true;
    void (async () => {
      try {
        await loadOrders();
        if (!ok) return;
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      }
    })();
    return () => {
      ok = false;
    };
  }, [loadOrders, done, pending]);

  if (err) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          {err}
        </div>
        <button
          type="button"
          onClick={() => {
            void loadOrders().catch((e) => setErr(e instanceof Error ? e.message : 'Xato'));
          }}
          className="w-full rounded-xl border border-[var(--dz-border-strong)] bg-[var(--dz-surface)] px-3 py-2 text-sm font-semibold text-[var(--dz-text)]"
        >
          Yangilash
        </button>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  async function reorder(orderId: number) {
    setErr(null);
    setReorderBusyId(orderId);
    try {
      const r = await apiFetch(`/v1/orders/${orderId}/reorder`, { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        order_number?: string;
        payment_url?: string | null;
      };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        return;
      }
      const payUrl = j.payment_url && String(j.payment_url).trim();
      if (payUrl) {
        try {
          const tg = getTg();
          if (tg && typeof tg.openLink === 'function') {
            tg.openLink(payUrl);
          } else {
            window.open(payUrl, '_blank', 'noopener,noreferrer');
          }
        } catch {
          window.open(payUrl, '_blank', 'noopener,noreferrer');
        }
        nav(`/orders?pending=${encodeURIComponent(j.order_number || '')}`);
        return;
      }
      nav(`/orders?done=${encodeURIComponent(j.order_number || '')}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Qayta buyurtma qilib bo‘lmadi');
    } finally {
      setReorderBusyId(null);
    }
  }

  async function submitRating(orderId: number) {
    const draft = draftRatings[orderId];
    const rating = Number(draft?.rating || 0);
    if (rating < 1 || rating > 5) {
      setErr('Iltimos, 1 dan 5 gacha baho tanlang.');
      return;
    }
    setRatingBusyId(orderId);
    setErr(null);
    try {
      const r = await apiFetch(`/v1/orders/${orderId}/rating`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          feedback: String(draft?.feedback || '').trim() || undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; rated_at?: string };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        return;
      }
      setRows((cur) =>
        (cur || []).map((o) =>
          o.id === orderId
            ? { ...o, rating, feedback: String(draft?.feedback || '').trim() || null }
            : o,
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Bahoni yuborib bo‘lmadi');
    } finally {
      setRatingBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buyurtmalar</h1>
        <p className="mt-0.5 text-sm text-[var(--dz-soft)]">So&apos;nggi buyurtmalar</p>
      </div>

      <button
        type="button"
        onClick={() => {
          void loadOrders().catch((e) => setErr(e instanceof Error ? e.message : 'Xato'));
        }}
        className="w-full rounded-xl border border-[var(--dz-border-strong)] bg-[var(--dz-surface)] px-3 py-2 text-sm font-semibold text-[var(--dz-text)] transition hover:border-[var(--dz-link)]"
      >
        Yangilash
      </button>

      {done ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm">
          <span className="font-semibold">Qabul qilindi:</span> {done}
        </div>
      ) : null}
      {pending ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm">
          <span className="font-semibold">To&apos;lov kutilmoqda:</span> {pending}. To&apos;lovni yakunlang,
          keyin ro&apos;yxatni yangilang.
        </div>
      ) : null}

      {!rows.length ? (
        <p className="rounded-2xl border border-dashed bg-[var(--dz-surface)]/90 px-4 py-10 text-center text-sm text-[var(--dz-soft)]">
          Hozircha buyurtmalar yo&apos;q.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => {
            const st = orderStatusUi(o.status);
            return (
              <li
                key={o.id}
                className="rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-[var(--dz-text)]">{o.order_number}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.className}`}>
                    {st.label}
                  </span>
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums">
                  {Number(o.total_amount ?? 0).toLocaleString('uz-UZ')} so&apos;m
                </div>
                <div className="mt-1 text-xs text-[var(--dz-soft)]">
                  {o.created_at ? String(o.created_at).replace('T', ' ').slice(0, 16) : ''}
                  {o.delivery_method ? ` · ${o.delivery_method === 'pickup' ? "O'zi olib ketish" : 'Kuryer'}` : ''}
                </div>
                {String(o.status || '').toLowerCase() === 'delivered' ? (
                  <div className="mt-3 rounded-xl border bg-[var(--dz-bg)] p-3">
                    {o.rating ? (
                      <div className="text-sm">
                        <span className="font-semibold">Bahoyingiz:</span> {o.rating} / 5
                        {o.feedback ? <p className="mt-1 text-[var(--dz-soft)]">{o.feedback}</p> : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-[var(--dz-text)]">Xizmatni baholang</p>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() =>
                                setDraftRatings((cur) => ({
                                  ...cur,
                                  [o.id]: { rating: n, feedback: cur[o.id]?.feedback || '' },
                                }))
                              }
                              className={`h-9 w-9 rounded-full border text-sm font-bold ${
                                (draftRatings[o.id]?.rating || 0) >= n
                                  ? 'border-amber-400 bg-amber-100 text-amber-900'
                                  : 'bg-[var(--dz-surface)] text-[var(--dz-soft)]'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={draftRatings[o.id]?.feedback || ''}
                          onChange={(e) =>
                            setDraftRatings((cur) => ({
                              ...cur,
                              [o.id]: { rating: cur[o.id]?.rating || 0, feedback: e.target.value },
                            }))
                          }
                          rows={2}
                          className="w-full rounded-xl border bg-[var(--dz-surface)] px-3 py-2 text-sm text-[var(--dz-text)]"
                          placeholder="Izoh (ixtiyoriy)"
                        />
                        <button
                          type="button"
                          disabled={ratingBusyId === o.id}
                          onClick={() => void submitRating(o.id)}
                          className="w-full rounded-xl bg-[var(--dz-accent)] px-3 py-2 text-sm font-semibold text-[var(--dz-accent-text)] disabled:opacity-60"
                        >
                          {ratingBusyId === o.id ? 'Yuborilmoqda…' : 'Bahoni yuborish'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={reorderBusyId === o.id}
                    onClick={() => void reorder(o.id)}
                    className="w-full rounded-xl border border-[var(--dz-border-strong)] bg-[var(--dz-bg)] px-3 py-2 text-sm font-semibold text-[var(--dz-text)] transition hover:border-[var(--dz-link)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {reorderBusyId === o.id ? 'Qayta yaratilmoqda…' : 'Yana buyurtma berish'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
