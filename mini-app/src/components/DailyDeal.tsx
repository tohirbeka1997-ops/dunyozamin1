import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { LazyImg } from './LazyImg';

type Product = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
  is_available: boolean;
};

type AdminPick = {
  data: {
    featured_date: string;
    badge_text: string | null;
    product: Product | null;
  } | null;
};

function pickDailyProduct(items: Product[]): Product | null {
  if (!items.length) return null;
  // Deterministic pick per calendar day: same product all day, rotates daily.
  const today = new Date();
  const dayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  let h = 0;
  for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) >>> 0;
  return items[h % items.length] || null;
}

function nextMidnightDelta(): { h: number; m: number; s: number } {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const ms = tomorrow.getTime() - now.getTime();
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return {
    h: Math.floor(totalSec / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
  };
}

/**
 * "Kun mahsuloti" — promotes a deterministic-per-day pick from the
 * trending feed. Includes a live countdown to midnight so the user
 * sees scarcity. Renders nothing if the feed is empty.
 */
export function DailyDeal() {
  const [item, setItem] = useState<Product | null>(null);
  const [badge, setBadge] = useState<string>('✦ Bugun tanlangan');
  const [tick, setTick] = useState(() => nextMidnightDelta());

  useEffect(() => {
    let ok = true;
    void (async () => {
      // 1) Try the admin override first. If set, use it verbatim.
      try {
        const adminR = await fetch(apiUrl('/v1/products/daily-deal'));
        if (adminR.ok) {
          const adminJ = await readJsonSafe<AdminPick>(adminR);
          if (ok && adminJ?.data?.product) {
            setItem(adminJ.data.product);
            if (adminJ.data.badge_text) setBadge(adminJ.data.badge_text);
            return;
          }
        }
      } catch {
        // Fall through to deterministic pick from trending
      }
      // 2) Fallback: deterministic per-day pick from trending feed.
      try {
        const r = await fetch(apiUrl('/v1/products/trending?limit=12&days=14'));
        if (!r.ok) throw new Error('http');
        const j = await readJsonSafe<{ data?: Product[] }>(r);
        if (!ok) return;
        const available = (j.data || []).filter((p) => p.is_available);
        setItem(pickDailyProduct(available.length ? available : j.data || []));
      } catch {
        if (ok) setItem(null);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(nextMidnightDelta()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!item) return null;

  return (
    <section className="dz-card relative overflow-hidden p-3.5">
      <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-50%', right: '-20%', opacity: 0.28 }} />
      <span className="dz-leak dz-leak-teal dz-leak-md" style={{ bottom: '-40%', left: '-15%', opacity: 0.18 }} />
      <div className="relative mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/65">
          <span aria-hidden>🔥</span> Kun mahsuloti
        </p>
        <div className="flex items-center gap-1 rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-white">
          <span aria-hidden>⏰</span>
          {String(tick.h).padStart(2, '0')}:{String(tick.m).padStart(2, '0')}:
          {String(tick.s).padStart(2, '0')}
        </div>
      </div>
      <Link
        to={`/product/${encodeURIComponent(item.id)}`}
        className="relative flex items-center gap-3 transition active:scale-[0.99]"
      >
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl bg-[var(--brand-cream-100)]">
          <LazyImg src={item.image_url} alt={item.name} className="absolute inset-0" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-bold leading-snug text-[var(--brand-primary)]">
            {item.name}
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-[18px] font-black tabular-nums text-[var(--brand-primary)]">
              {item.price_uzs.toLocaleString('uz-UZ')}
            </span>
            <span className="text-[10px] font-bold text-[var(--brand-primary)]/60">soʻm</span>
          </div>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--brand-accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-primary)]">
            {badge}
          </span>
        </div>
        <span className="text-[var(--brand-primary)]/40" aria-hidden>›</span>
      </Link>
    </section>
  );
}
