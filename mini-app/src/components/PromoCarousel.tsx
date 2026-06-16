import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, readJsonSafe } from '../lib/api';
import { haptic } from '../lib/telegram';

type Slide = {
  key: string;
  emoji: string;
  title: string;
  subtitle: string;
  cta: string;
  to: string;
  bg: string;
  fg: string;
  leakA: string;
  leakB: string;
};

type RemoteBanner = {
  id: number | string;
  emoji?: string | null;
  title: string;
  subtitle: string;
  cta_text?: string | null;
  cta_link?: string | null;
  theme?: 'primary' | 'cream' | 'teal' | string;
};

const FALLBACK_SLIDES: Slide[] = [
  {
    key: 'free-delivery',
    emoji: '🚚',
    title: '300K dan ortiq xaridga',
    subtitle: 'BEPUL yetkazib berish',
    cta: 'Hoziroq xarid →',
    to: '/catalog',
    bg: 'dz-brand-bg text-white',
    fg: 'text-[var(--brand-accent)]',
    leakA: 'dz-leak-accent',
    leakB: 'dz-leak-teal',
  },
  {
    key: 'loyalty',
    emoji: '✦',
    title: 'Har xaridda',
    subtitle: '1% bonus ball',
    cta: 'Profilim →',
    to: '/profile',
    bg: 'dz-cream-bg text-[var(--brand-primary)]',
    fg: 'text-[var(--brand-teal)]',
    leakA: 'dz-leak-teal',
    leakB: 'dz-leak-accent',
  },
];

/**
 * Map admin theme tokens to brand background classes + complementary
 * leak colours. Centralised so the admin UI only needs to ship a small
 * enum.
 */
function themeToVisual(theme: string | undefined): Pick<Slide, 'bg' | 'fg' | 'leakA' | 'leakB'> {
  switch ((theme || 'primary').toLowerCase()) {
    case 'cream':
      return {
        bg: 'dz-cream-bg text-[var(--brand-primary)]',
        fg: 'text-[var(--brand-teal)]',
        leakA: 'dz-leak-teal',
        leakB: 'dz-leak-accent',
      };
    case 'teal':
      return {
        bg: 'dz-teal-bg text-white',
        fg: 'text-[var(--brand-accent)]',
        leakA: 'dz-leak-cream',
        leakB: 'dz-leak-accent',
      };
    case 'primary':
    default:
      return {
        bg: 'dz-brand-bg text-white',
        fg: 'text-[var(--brand-accent)]',
        leakA: 'dz-leak-accent',
        leakB: 'dz-leak-teal',
      };
  }
}

function adaptRemote(rows: RemoteBanner[]): Slide[] {
  return rows
    .filter((r) => r.title && r.subtitle)
    .map((r) => {
      const visual = themeToVisual(r.theme);
      return {
        key: `srv-${r.id}`,
        emoji: r.emoji || '✦',
        title: r.title,
        subtitle: r.subtitle,
        cta: r.cta_text || 'Davom etish →',
        to: r.cta_link || '/catalog',
        ...visual,
      };
    });
}

const ROTATE_MS = 4500;

/**
 * Auto-rotating promo banner. Pauses when the document is hidden so we
 * don't waste battery on rotation while in a background tab.
 */
export function PromoCarousel() {
  const [slides, setSlides] = useState<Slide[]>(FALLBACK_SLIDES);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pull admin-managed banners. Falls back to the bundled defaults if
  // the endpoint isn't reachable or hasn't been seeded yet.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(apiUrl('/v1/promo-banners'));
        if (!r.ok) return;
        const j = await readJsonSafe<{ data?: RemoteBanner[] }>(r);
        const adapted = adaptRemote(j.data || []);
        if (alive && adapted.length > 0) {
          setSlides(adapted);
          setIdx(0);
        }
      } catch {
        // network failure — keep fallback
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function start() {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        if (document.hidden) return;
        setIdx((i) => (i + 1) % slides.length);
      }, ROTATE_MS);
    }
    if (slides.length > 1) start();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [slides.length]);

  return (
    <section className="relative">
      <div className="relative h-[125px] overflow-hidden rounded-[1.5rem]">
        {slides.map((s, i) => {
          const active = i === idx;
          return (
            <Link
              key={s.key}
              to={s.to}
              tabIndex={active ? 0 : -1}
              aria-hidden={!active}
              onClick={() => haptic.selection()}
              className={`absolute inset-0 flex flex-col justify-between overflow-hidden p-4 transition-opacity duration-500 ${s.bg} ${
                active ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <span className={`dz-leak ${s.leakA} dz-leak-lg`} style={{ top: '-40%', right: '-25%', opacity: 0.3 }} />
              <span className={`dz-leak ${s.leakB} dz-leak-md`} style={{ bottom: '-40%', left: '-15%', opacity: 0.22 }} />
              <div className="relative">
                <span className={`text-[10.5px] font-bold uppercase tracking-[0.2em] ${s.fg}`}>
                  {s.emoji} Promo
                </span>
                <p className="mt-1 text-[14px] font-semibold leading-tight opacity-85">{s.title}</p>
                <p className="mt-0.5 text-[18px] font-extrabold leading-tight">{s.subtitle}</p>
              </div>
              <div className="relative flex items-center justify-between">
                <span className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-bold text-[var(--brand-primary)]">
                  {s.cta}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      {/* Dots */}
      <div className="mt-2 flex justify-center gap-1.5">
        {slides.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setIdx(i);
              haptic.selection();
            }}
            aria-label={`Slayd ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? 'w-5 bg-[var(--brand-primary)]' : 'w-1.5 bg-[var(--brand-primary)]/25'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
