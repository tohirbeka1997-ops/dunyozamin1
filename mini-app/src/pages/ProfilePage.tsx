import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartCount, loadCart } from '../lib/cart';
import { favoritesCount } from '../lib/favorites';
import { getTg } from '../lib/telegram';

type MeResponse = {
  id: number;
  tg_user_id: string;
  phone: string | null;
  created_at?: string;
};

export function ProfilePage() {
  const tgUser = getTg()?.initDataUnsafe?.user;
  const [me, setMe] = useState<MeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loadTokens()) return;
    let ok = true;
    void (async () => {
      try {
        const r = await apiFetch('/v1/me');
        if (!r.ok) {
          if (!ok) return;
          // Surface server errors instead of silently returning. The
          // previous `if (!r.ok) return;` left the user on a half-loaded
          // profile screen with no signal that anything went wrong, even
          // though phone/loyalty info silently disappeared.
          let detail = '';
          try {
            const body = await r.json();
            detail = String(body?.error || body?.message || '');
          } catch {
            // body not JSON — fall through with empty detail
          }
          setErr(
            detail
              ? `Profilni yuklab bo'lmadi (${r.status}): ${detail}`
              : `Profilni yuklab bo'lmadi (${r.status})`
          );
          return;
        }
        const j = (await r.json()) as MeResponse;
        if (!ok) return;
        setMe(j);
      } catch (e) {
        if (!ok) return;
        setErr(e instanceof Error ? e.message : 'Profilni yuklab bo\'lmadi');
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const fullName = useMemo(() => {
    const first = tgUser?.first_name || '';
    const last = tgUser?.last_name || '';
    return `${first} ${last}`.trim() || 'Telegram foydalanuvchisi';
  }, [tgUser?.first_name, tgUser?.last_name]);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 text-white shadow-[var(--dz-card-shadow)]">
        <p className="text-xs uppercase tracking-[0.14em] text-white/70">Profil</p>
        <h1 className="mt-1 text-xl font-bold">{fullName}</h1>
        <p className="mt-1 text-sm text-white/80">
          @{tgUser?.id ? `id_${tgUser.id}` : 'telegram'} {me?.phone ? `• ${me.phone}` : ''}
        </p>
      </section>

      {err ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{err}</div>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
          <p className="text-xs text-[var(--dz-soft)]">Savatchadagi</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{cartCount(loadCart())}</p>
        </div>
        <div className="rounded-2xl border bg-[var(--dz-surface)] p-4 shadow-[var(--dz-card-shadow-soft)]">
          <p className="text-xs text-[var(--dz-soft)]">Sevimlilar</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{favoritesCount()}</p>
        </div>
      </section>

      <section className="space-y-3">
        <Link
          to="/orders"
          className="flex items-center justify-between rounded-2xl border bg-[var(--dz-surface)] px-4 py-3 text-sm font-medium shadow-[var(--dz-card-shadow-soft)]"
        >
          Buyurtmalar tarixi <span aria-hidden>→</span>
        </Link>
        <Link
          to="/favorites"
          className="flex items-center justify-between rounded-2xl border bg-[var(--dz-surface)] px-4 py-3 text-sm font-medium shadow-[var(--dz-card-shadow-soft)]"
        >
          Sevimli mahsulotlar <span aria-hidden>→</span>
        </Link>
        <Link
          to="/catalog"
          className="flex items-center justify-between rounded-2xl border bg-[var(--dz-surface)] px-4 py-3 text-sm font-medium shadow-[var(--dz-card-shadow-soft)]"
        >
          Katalogga qaytish <span aria-hidden>→</span>
        </Link>
      </section>
    </div>
  );
}
