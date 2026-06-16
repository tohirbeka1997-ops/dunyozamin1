import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { canCancel, orderStatusUi } from '../lib/orderStatus';
import { Skeleton } from '../components/Skeleton';
import { getTg, haptic, tgConfirm } from '../lib/telegram';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullIndicator } from '../components/PullIndicator';
import { EmptyState } from '../components/EmptyState';
import { OrderTimeline } from '../components/OrderTimeline';

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
  const [cancelBusyId, setCancelBusyId] = useState<number | null>(null);
  const [draftRatings, setDraftRatings] = useState<Record<number, { rating: number; feedback: string }>>({});

  async function cancelOrder(id: number) {
    const ok = await tgConfirm('Buyurtmani bekor qilmoqchimisiz? Buni qaytarib boʻlmaydi.');
    if (!ok) return;
    setCancelBusyId(id);
    try {
      const r = await apiFetch(`/v1/orders/${id}/cancel`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        haptic.notify('error');
        setErr(j.message || j.error || 'Bekor qilib boʻlmadi');
        return;
      }
      haptic.notify('success');
      await loadOrders().catch(() => undefined);
    } catch (e) {
      haptic.notify('error');
      setErr(e instanceof Error ? e.message : 'Xato');
    } finally {
      setCancelBusyId(null);
    }
  }

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

  const pull = usePullToRefresh(async () => {
    try {
      await loadOrders();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Xato');
    }
  });

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
    <div className="space-y-4 dz-animate-in">
      <PullIndicator status={pull.status} distance={pull.distance} threshold={pull.threshold} />
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-[var(--brand-primary)]">📦 Buyurtmalar</h1>
          <p className="mt-0.5 text-[12px] font-medium text-[var(--dz-soft)]">Soʻnggi buyurtmalaringiz</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadOrders().catch((e) => setErr(e instanceof Error ? e.message : 'Xato'));
          }}
          className="rounded-full bg-[var(--brand-primary-50)] px-3 py-1.5 text-[12px] font-bold text-[var(--brand-primary)] transition active:scale-95 hover:bg-[var(--brand-primary-100)]"
        >
          ↻ Yangilash
        </button>
      </div>

      {done ? (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--brand-primary)_20%,transparent)] bg-[var(--brand-primary-50)] px-4 py-3 text-[13px] text-[var(--brand-primary)] shadow-[var(--dz-card-shadow-soft)]">
          <span className="font-bold">✅ Qabul qilindi:</span> {done}
        </div>
      ) : null}
      {pending ? (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--brand-accent)_45%,transparent)] bg-[var(--brand-accent-100)] px-4 py-3 text-[13px] text-[var(--brand-primary)] shadow-[var(--dz-card-shadow-soft)]">
          <span className="font-bold">⏳ Toʻlov kutilmoqda:</span> {pending}.
          <span className="mt-1 block text-[12px] text-[var(--dz-muted)]">
            Toʻlovni yakunlang, keyin roʻyxatni yangilang.
          </span>
        </div>
      ) : null}

      {!rows.length ? (
        <EmptyState
          icon="📦"
          title="Hozircha buyurtmalar yoʻq"
          description="Birinchi xaridingizni amalga oshiring va bonus ball yigʻishni boshlang"
          tone="teal"
          cta={{ to: '/catalog', label: '🧺 Xarid qilishni boshlash' }}
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((o, idx) => {
            const st = orderStatusUi(o.status);
            const leakChoices = ['dz-leak-teal', 'dz-leak-cream', 'dz-leak-accent'];
            const leakClass = leakChoices[idx % leakChoices.length];
            const lower = String(o.status || '').toLowerCase();
            const showTimeline = lower !== 'cancelled';
            return (
              <li key={o.id} className="dz-card relative p-3.5">
                <span
                  className={`dz-leak ${leakClass} dz-leak-sm`}
                  style={{ top: '-40%', right: '-20%', opacity: 0.22 }}
                />
                <div className="relative flex flex-wrap items-start justify-between gap-2">
                  <span className="rounded-lg bg-[var(--brand-cream-100)] px-2 py-0.5 font-mono text-[11.5px] font-bold text-[var(--brand-primary)]">
                    {o.order_number}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${st.className}`}>
                    {st.label}
                  </span>
                </div>
                <div className="relative mt-1.5 flex items-baseline gap-1">
                  <span className="text-[18px] font-black tabular-nums text-[var(--brand-primary)]">
                    {Number(o.total_amount ?? 0).toLocaleString('uz-UZ')}
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--dz-soft)]">soʻm</span>
                </div>
                <div className="relative mt-1 flex flex-wrap items-center gap-2 text-[10.5px] font-medium text-[var(--dz-soft)]">
                  {o.created_at ? <span>🕘 {String(o.created_at).replace('T', ' ').slice(0, 16)}</span> : null}
                  {o.delivery_method ? (
                    <span className="dz-chip-teal dz-chip">
                      {o.delivery_method === 'pickup' ? '🏪 Pickup' : '🚚 Kuryer'}
                    </span>
                  ) : null}
                </div>
                {showTimeline ? (
                  <div className="relative mt-3">
                    <OrderTimeline status={o.status} deliveryMethod={o.delivery_method} />
                  </div>
                ) : (
                  <div className="relative mt-3">
                    <OrderTimeline status="cancelled" deliveryMethod={o.delivery_method} />
                  </div>
                )}
                {String(o.status || '').toLowerCase() === 'delivered' ? (
                  <div className="mt-3 rounded-2xl border border-[color-mix(in_srgb,var(--brand-accent)_45%,transparent)] bg-[var(--brand-accent-50)] p-3">
                    {o.rating ? (
                      <div className="text-[13px]">
                        <p className="font-bold text-[var(--brand-primary)]">
                          ⭐ Bahoyingiz: {o.rating} / 5
                        </p>
                        {o.feedback ? (
                          <p className="mt-1 text-[12px] text-[var(--dz-muted)]">{o.feedback}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[13px] font-bold text-[var(--brand-primary)]">⭐ Xizmatni baholang</p>
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4, 5].map((n) => {
                            const isActive = (draftRatings[o.id]?.rating || 0) >= n;
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() =>
                                  setDraftRatings((cur) => ({
                                    ...cur,
                                    [o.id]: { rating: n, feedback: cur[o.id]?.feedback || '' },
                                  }))
                                }
                                className={`h-10 w-10 rounded-xl text-[16px] font-bold transition active:scale-95 ${
                                  isActive
                                    ? 'bg-[var(--brand-accent)] text-[var(--brand-primary)] shadow-[var(--dz-glow-accent)]'
                                    : 'bg-white text-[var(--dz-soft)]'
                                }`}
                              >
                                ★
                              </button>
                            );
                          })}
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
                          className="w-full rounded-xl border border-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] bg-white px-3 py-2 text-[13px] text-[var(--dz-text)] focus:border-[var(--brand-primary)] focus:outline-none"
                          placeholder="Izoh (ixtiyoriy)"
                        />
                        <button
                          type="button"
                          disabled={ratingBusyId === o.id}
                          onClick={() => void submitRating(o.id)}
                          className="dz-btn-primary w-full disabled:opacity-60"
                        >
                          {ratingBusyId === o.id ? 'Yuborilmoqda…' : 'Bahoni yuborish'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="relative mt-2.5 flex gap-2">
                  <button
                    type="button"
                    disabled={reorderBusyId === o.id}
                    onClick={() => void reorder(o.id)}
                    className="flex-1 rounded-xl bg-[var(--brand-cream-100)] px-3 py-2 text-[12px] font-bold text-[var(--brand-primary)] transition active:scale-[0.98] hover:bg-[var(--brand-cream-200)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {reorderBusyId === o.id ? 'Qayta yaratilmoqda…' : '↻ Yana buyurtma'}
                  </button>
                  {canCancel(o.status) ? (
                    <button
                      type="button"
                      disabled={cancelBusyId === o.id}
                      onClick={() => void cancelOrder(o.id)}
                      className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700 transition active:scale-[0.98] hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cancelBusyId === o.id ? '…' : '✖ Bekor qilish'}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
