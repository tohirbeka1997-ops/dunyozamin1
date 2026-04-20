import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { orderStatusUi } from '../lib/orderStatus';
import { Skeleton } from '../components/Skeleton';

type OrderRow = {
  id: number;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
};

export function OrdersPage() {
  const [sp] = useSearchParams();
  const done = sp.get('done');
  const pending = sp.get('pending');
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loadTokens()) {
      setErr('Telegram Mini App orqali kiring — avtomatik autentifikatsiya.');
      return;
    }
    let ok = true;
    void (async () => {
      try {
        const r = await apiFetch('/v1/orders?limit=50');
        const j = (await r.json()) as { data?: OrderRow[] };
        if (!r.ok) {
          setErr('Buyurtmalarni yuklab bo‘lmadi');
          return;
        }
        if (!ok) return;
        setRows(j.data || []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xato');
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  if (err) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
        {err}
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buyurtmalar</h1>
        <p className="mt-0.5 text-sm text-[var(--dz-soft)]">So&apos;nggi buyurtmalar</p>
      </div>

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
                  {Number(o.total_amount).toLocaleString('uz-UZ')} so&apos;m
                </div>
                <div className="mt-1 text-xs text-[var(--dz-soft)]">
                  {o.created_at ? String(o.created_at).replace('T', ' ').slice(0, 16) : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
