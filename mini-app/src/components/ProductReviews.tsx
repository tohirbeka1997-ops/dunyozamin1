import { useEffect, useState } from 'react';
import { apiUrl, readJsonSafe } from '../lib/api';

type ReviewsResponse = {
  ok?: boolean;
  summary: {
    count: number;
    avg: number | null;
    distribution: Record<string, number>;
  };
  recent: {
    rating: number;
    feedback: string;
    created_at: string;
    author: string | null;
  }[];
};

function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'text-[12px]' : 'text-[14px]';
  return (
    <span className={`tracking-[0.05em] ${cls}`} aria-label={`${value} / 5`}>
      <span className="text-[var(--brand-accent-600)]">{'★'.repeat(Math.round(value))}</span>
      <span className="text-[var(--brand-cream-200)]">{'★'.repeat(Math.max(0, 5 - Math.round(value)))}</span>
    </span>
  );
}

/**
 * Aggregated rating + recent free-form reviews for a product. Renders
 * nothing until the API call resolves; if there are zero ratings,
 * shows a small "be the first to review" stub instead.
 */
export function ProductReviews({ productId }: { productId: string }) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [expand, setExpand] = useState(false);

  useEffect(() => {
    let ok = true;
    void (async () => {
      try {
        const r = await fetch(apiUrl(`/v1/products/${encodeURIComponent(productId)}/reviews?limit=10`));
        if (!r.ok) throw new Error('http');
        const j = await readJsonSafe<ReviewsResponse>(r);
        if (!ok) return;
        setData(j);
      } catch {
        if (ok) setData({ summary: { count: 0, avg: null, distribution: {} }, recent: [] });
      }
    })();
    return () => {
      ok = false;
    };
  }, [productId]);

  if (!data) return null;

  const { summary, recent } = data;
  const visible = expand ? recent : recent.slice(0, 2);
  const dist = summary.distribution || {};
  const maxBar = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(dist[n] || 0)));

  return (
    <section className="dz-card relative overflow-hidden p-4">
      <span className="dz-leak dz-leak-accent dz-leak-md" style={{ top: '-50%', right: '-20%', opacity: 0.2 }} />
      <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ bottom: '-40%', left: '-10%', opacity: 0.4 }} />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-bold text-[var(--brand-primary)]">⭐ Sharhlar va reyting</p>
          {summary.count > 0 ? (
            <p className="text-[10.5px] font-semibold text-[var(--brand-primary)]/55">
              {summary.count} ta sharh
            </p>
          ) : null}
        </div>

        {summary.count === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--brand-primary)]/60">
            Hali sharh yoʻq. Birinchi xaridingizdan keyin baho qoldiring 🙂
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-3">
              <div className="text-center">
                <p className="text-[28px] font-black tabular-nums leading-none text-[var(--brand-primary)]">
                  {summary.avg?.toFixed(1)}
                </p>
                <Stars value={summary.avg || 0} />
                <p className="mt-0.5 text-[10px] font-semibold text-[var(--brand-primary)]/55">
                  / 5.0
                </p>
              </div>
              <div className="flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((n) => {
                  const v = Number(dist[n] || 0);
                  const pct = (v / maxBar) * 100;
                  return (
                    <div key={n} className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-3 text-right font-bold text-[var(--brand-primary)]/70">{n}</span>
                      <span className="text-[var(--brand-accent-600)]">★</span>
                      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--brand-cream-200)]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand-accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-5 text-right tabular-nums text-[var(--brand-primary)]/60">
                        {v}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {visible.length > 0 ? (
              <ul className="mt-3 divide-y divide-[var(--brand-cream-200)]">
                {visible.map((rev, i) => {
                  const dt = new Date(rev.created_at);
                  const dateStr = Number.isFinite(dt.getTime())
                    ? dt.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' })
                    : rev.created_at;
                  return (
                    <li key={i} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Stars value={rev.rating} size="sm" />
                          <span className="text-[11px] font-bold text-[var(--brand-primary)]">
                            {rev.author || 'Anonim'}
                          </span>
                        </div>
                        <span className="text-[10px] text-[var(--brand-primary)]/45">{dateStr}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-[var(--brand-primary)]/85">
                        {rev.feedback}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {recent.length > 2 ? (
              <button
                type="button"
                onClick={() => setExpand((v) => !v)}
                className="mt-2 w-full rounded-xl bg-[var(--brand-cream-100)] py-2 text-[11.5px] font-bold text-[var(--brand-primary)]"
              >
                {expand ? '▲ Yopish' : `▼ Yana ${recent.length - 2} ta sharhni koʻrish`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
