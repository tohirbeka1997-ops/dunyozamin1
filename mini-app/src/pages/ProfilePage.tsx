import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, loadTokens } from '../lib/api';
import { cartCount, loadCart } from '../lib/cart';
import { favoritesCount } from '../lib/favorites';
import { getTg } from '../lib/telegram';
import { computeBadges, fetchLoyalty, type LoyaltyState } from '../lib/loyalty';
import { ReferralCard } from '../components/ReferralCard';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

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
  const [loyalty, setLoyalty] = useState<LoyaltyState | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    if (!loadTokens()) return;
    let ok = true;
    void (async () => {
      try {
        const r = await apiFetch('/v1/me');
        if (!r.ok) {
          if (!ok) return;
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
    void fetchLoyalty().then((res) => {
      if (ok && res) setLoyalty(res);
    });
    return () => {
      ok = false;
    };
  }, []);

  const fullName = useMemo(() => {
    const first = tgUser?.first_name || '';
    const last = tgUser?.last_name || '';
    return `${first} ${last}`.trim() || 'Telegram foydalanuvchisi';
  }, [tgUser?.first_name, tgUser?.last_name]);

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || 'TG';

  const menu: { to: string; icon: string; label: string; desc: string; tint: 'teal' | 'cream' | 'accent' | 'primary' }[] = [
    { to: '/orders', icon: '📦', label: 'Buyurtmalar tarixi', desc: 'Holat va qayta buyurtma', tint: 'teal' },
    { to: '/favorites', icon: '♥', label: 'Sevimli mahsulotlar', desc: 'Saqlanganlar roʻyxati', tint: 'accent' },
    { to: '/catalog', icon: '🧺', label: 'Katalog', desc: 'Barcha mahsulotlar', tint: 'cream' },
    { to: '/cart', icon: '🛒', label: 'Savat', desc: 'Buyurtma berishga oʻtish', tint: 'primary' },
    { to: '/help', icon: '✦', label: 'Yordam markazi', desc: 'FAQ, operator, qoʻngʻiroq', tint: 'teal' },
  ];
  const tintBg: Record<typeof menu[number]['tint'], string> = {
    teal: 'bg-[var(--brand-teal-50)] text-[var(--brand-teal)]',
    cream: 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]',
    accent: 'bg-[var(--brand-accent-100)] text-[var(--brand-primary)]',
    primary: 'bg-[var(--brand-primary-50)] text-[var(--brand-primary)]',
  };

  return (
    <div className="space-y-4 dz-animate-in">
      {/* HERO profile card — minimal with multi-leak */}
      <section className="relative overflow-hidden rounded-[1.75rem] dz-brand-bg p-5 text-white">
        <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-30%', right: '-25%', opacity: 0.3 }} />
        <span className="dz-leak dz-leak-teal dz-leak-md" style={{ bottom: '-30%', left: '-15%', opacity: 0.3 }} />
        <div className="relative flex items-center gap-3.5">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-accent)] text-[18px] font-black text-[var(--brand-primary)]">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--brand-accent)]/95">
              👤 Mening profilim
            </p>
            <h1 className="mt-0.5 truncate text-[17px] font-extrabold leading-tight">{fullName}</h1>
            <p className="mt-0.5 truncate text-[11.5px] text-white/80">
              {tgUser?.username ? `@${tgUser.username}` : tgUser?.id ? `ID: ${tgUser.id}` : 'telegram'}
              {me?.phone ? ` · ${me.phone}` : ''}
            </p>
          </div>
        </div>
      </section>

      {err ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{err}</div>
      ) : null}

      {/* Stats — minimal cards with leaks */}
      <section className="grid grid-cols-4 gap-2">
        <div className="dz-card relative p-2.5">
          <span className="dz-leak dz-leak-teal dz-leak-sm" style={{ top: '-50%', right: '-30%', opacity: 0.22 }} />
          <p className="relative text-[9px] font-bold uppercase tracking-wide text-[var(--brand-primary)]/55">
            Buyurtmalar
          </p>
          <p className="relative mt-0.5 text-[18px] font-black tabular-nums text-[var(--brand-primary)]">
            {loyalty?.stats.total_orders ?? 0}
          </p>
        </div>
        <div className="dz-card relative p-2.5">
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '-50%', right: '-30%', opacity: 0.28 }} />
          <p className="relative text-[9px] font-bold uppercase tracking-wide text-[var(--brand-primary)]/55">
            Sarflandi
          </p>
          <p className="relative mt-0.5 text-[12px] font-black tabular-nums leading-tight text-[var(--brand-primary)]">
            {loyalty?.stats.total_spent
              ? loyalty.stats.total_spent >= 1000
                ? `${Math.floor(loyalty.stats.total_spent / 1000)}K`
                : loyalty.stats.total_spent.toLocaleString('uz-UZ')
              : 0}
            <span className="ml-0.5 text-[8px] font-bold opacity-60">soʻm</span>
          </p>
        </div>
        <div className="dz-card relative p-2.5">
          <span className="dz-leak dz-leak-cream dz-leak-sm" style={{ top: '-50%', right: '-30%', opacity: 0.4 }} />
          <p className="relative text-[9px] font-bold uppercase tracking-wide text-[var(--brand-primary)]/55">
            Savatda
          </p>
          <p className="relative mt-0.5 text-[18px] font-black tabular-nums text-[var(--brand-primary)]">
            {cartCount(loadCart())}
          </p>
        </div>
        <div className="dz-card relative p-2.5">
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ top: '-50%', right: '-30%', opacity: 0.25 }} />
          <p className="relative text-[9px] font-bold uppercase tracking-wide text-[var(--brand-primary)]/55">
            Sevimli
          </p>
          <p className="relative mt-0.5 text-[18px] font-black tabular-nums text-[var(--brand-primary)]">
            {favoritesCount()}
          </p>
        </div>
      </section>

      {/* ACHIEVEMENT BADGES — six tiles, locked items are dimmed */}
      {loyalty ? (
        <section className="dz-card relative overflow-hidden p-3.5">
          <span className="dz-leak dz-leak-teal dz-leak-md" style={{ top: '-50%', left: '-25%', opacity: 0.18 }} />
          <span className="dz-leak dz-leak-accent dz-leak-sm" style={{ bottom: '-50%', right: '-15%', opacity: 0.22 }} />
          <div className="relative mb-2.5 flex items-end justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/65">
              🏅 Yutuqlar
            </p>
            <p className="text-[10.5px] font-semibold text-[var(--brand-primary)]/55">
              {computeBadges(loyalty).filter((b) => b.earned).length}/{computeBadges(loyalty).length}
            </p>
          </div>
          <div className="relative grid grid-cols-3 gap-2">
            {computeBadges(loyalty).map((badge) => (
              <div
                key={badge.key}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition ${
                  badge.earned
                    ? 'bg-[var(--brand-cream-100)] text-[var(--brand-primary)]'
                    : 'bg-[var(--brand-cream-50)] text-[var(--brand-primary)]/35 grayscale'
                }`}
                title={badge.hint}
              >
                <span className="text-[20px]" aria-hidden>{badge.emoji}</span>
                <span className="text-[9.5px] font-bold leading-tight">{badge.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* LOYALTY card — points balance + tier progress + ledger toggle */}
      {loyalty ? (
        <section className="dz-card relative overflow-hidden p-4">
          <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-50%', right: '-30%', opacity: 0.32 }} />
          <span className="dz-leak dz-leak-teal dz-leak-md" style={{ bottom: '-50%', left: '-15%', opacity: 0.22 }} />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/65">
                  <span aria-hidden>✦</span> Bonus ball
                </p>
                <p className="mt-1 flex items-baseline gap-1.5 text-[28px] font-black leading-none tabular-nums text-[var(--brand-primary)]">
                  {loyalty.points_balance.toLocaleString('uz-UZ')}
                  <span className="text-[12px] font-bold text-[var(--brand-primary)]/60">ball</span>
                </p>
                {loyalty.stats.earned_this_month > 0 ? (
                  <p className="mt-1 text-[11px] text-[var(--brand-teal)]">
                    +{loyalty.stats.earned_this_month.toLocaleString('uz-UZ')} bu oy
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-2xl text-[18px]"
                  style={{ background: `${loyalty.tier.current.color}1f`, color: loyalty.tier.current.color }}
                  aria-hidden
                >
                  {loyalty.tier.current.emoji}
                </span>
                <span className="text-[10.5px] font-bold text-[var(--brand-primary)]/75">
                  {loyalty.tier.current.name}
                </span>
              </div>
            </div>

            {/* Progress to next tier */}
            {loyalty.tier.next ? (
              <div className="mt-3.5">
                <div className="flex items-center justify-between text-[10.5px] font-semibold text-[var(--brand-primary)]/70">
                  <span>{loyalty.tier.current.name}</span>
                  <span>
                    {loyalty.tier.points_to_next > 0
                      ? `${loyalty.tier.points_to_next.toLocaleString('uz-UZ')} ball → ${loyalty.tier.next.name}`
                      : `${loyalty.tier.next.name}!`}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--brand-cream-200)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${loyalty.tier.progress_pct}%`,
                      background: `linear-gradient(90deg, ${loyalty.tier.current.color}, ${loyalty.tier.next.color})`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-[var(--brand-accent-100)] px-3 py-2 text-[11.5px] font-bold text-[var(--brand-primary)]">
                💎 Eng yuqori darajadasiz! Rahmat sizga.
              </div>
            )}

            {/* Loyalty card code */}
            {loyalty.card_code ? (
              <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl bg-[var(--brand-cream-100)] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--brand-primary)]/60">
                    Mening kartam
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11.5px] font-bold text-[var(--brand-primary)]">
                    {loyalty.card_code}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard) {
                      void navigator.clipboard.writeText(loyalty.card_code || '');
                    }
                  }}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[var(--brand-primary)] transition active:scale-95"
                >
                  📋
                </button>
              </div>
            ) : null}

            {/* Ledger toggle */}
            {loyalty.ledger.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowLedger((v) => !v)}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-[var(--brand-teal-50)] py-2 text-[11.5px] font-bold text-[var(--brand-teal)] transition active:scale-[0.98]"
              >
                {showLedger ? '▲ Tarixni yopish' : `▼ Ball tarixi (${loyalty.ledger.length})`}
              </button>
            ) : null}

            {showLedger ? (
              <ul className="relative mt-2 divide-y divide-[var(--brand-cream-200)]">
                {loyalty.ledger.map((row, i) => {
                  const positive = row.points_delta > 0;
                  const dt = new Date(row.created_at);
                  const dateStr = Number.isFinite(dt.getTime())
                    ? dt.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' })
                    : row.created_at;
                  return (
                    <li key={i} className="flex items-center justify-between py-2 text-[12px]">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-[var(--brand-primary)]">
                          {row.note || (row.type === 'earn_paid_order' ? 'Buyurtma toʻlandi' : row.type)}
                        </p>
                        <p className="text-[10.5px] text-[var(--brand-primary)]/55">
                          {dateStr}
                          {row.order_id ? ` · #${row.order_id}` : ''}
                        </p>
                      </div>
                      <span
                        className={`flex-shrink-0 font-black tabular-nums ${
                          positive ? 'text-[var(--brand-teal)]' : 'text-red-500'
                        }`}
                      >
                        {positive ? '+' : ''}
                        {row.points_delta.toLocaleString('uz-UZ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Language switcher */}
      <LanguageSwitcher />

      {/* Referral — invite a friend, share rewards */}
      <ReferralCard />

      {/* Menu — minimal flat with subtle leak */}
      <section className="dz-card relative overflow-hidden">
        <span className="dz-leak dz-leak-cream dz-leak-md" style={{ top: '-50%', right: '-30%', opacity: 0.4 }} />
        <div className="relative">
          {menu.map((item, i, arr) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3.5 py-3 transition active:bg-[var(--brand-cream-100)] ${
                i < arr.length - 1 ? 'border-b border-[var(--brand-cream-200)]' : ''
              }`}
            >
              <span
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-base ${tintBg[item.tint]}`}
                aria-hidden
              >
                {item.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[var(--brand-primary)]">{item.label}</p>
                <p className="truncate text-[11px] text-[var(--dz-soft)]">{item.desc}</p>
              </div>
              <span className="text-[var(--brand-primary)]/40" aria-hidden>›</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="pt-1 text-center text-[10.5px] leading-relaxed text-[var(--dz-soft)]">
        🌿 DunyoZamin — sifatli xizmat, har doim siz bilan
      </p>
    </div>
  );
}
