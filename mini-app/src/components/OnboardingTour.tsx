import { useEffect, useState } from 'react';
import { cloudStorage, haptic } from '../lib/telegram';

const KEY = 'dz_onboarding_v1';

const STEPS: { emoji: string; title: string; body: string; tone: string }[] = [
  {
    emoji: '🌿',
    title: 'DunyoZaminga xush kelibsiz!',
    body: 'Mahsulotlarni qidiring, savatga qoʻshing va Telegram orqali tezkor buyurtma bering.',
    tone: 'dz-brand-bg',
  },
  {
    emoji: '✦',
    title: 'Har xaridda bonus ball',
    body: 'Buyurtma summasidan 1% ball oʻtadi. Ballarni keyingi xaridda chegirma sifatida ishlatasiz.',
    tone: 'dz-cream-bg',
  },
  {
    emoji: '🚚',
    title: 'Tezkor yetkazib berish',
    body: 'Toshkent boʻyicha 60 daqiqa ichida. Vaqt slotini xaridda tanlay olasiz.',
    tone: 'dz-teal-bg',
  },
];

function readSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* noop */
  }
  void cloudStorage.setItem(KEY, '1');
}

/**
 * Three-step welcome tour shown on the user's first visit. We hydrate
 * "seen" from CloudStorage in the background so a returning user on a
 * new device doesn't see it twice.
 */
export function OnboardingTour() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (readSeen()) return;
    // Check cloud first — if it's been seen elsewhere, skip silently.
    let cancelled = false;
    void (async () => {
      const remote = await cloudStorage.getItem(KEY);
      if (cancelled) return;
      if (remote === '1') {
        try {
          localStorage.setItem(KEY, '1');
        } catch {
          /* noop */
        }
        return;
      }
      // Small delay so the page mounts first and the tour feels like an entrance.
      setTimeout(() => {
        if (!cancelled) setShow(true);
      }, 500);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;
  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function close() {
    markSeen();
    setShow(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-4 pb-6 pt-10 backdrop-blur-sm">
      <div className="dz-card relative w-full max-w-md overflow-hidden">
        <div className={`relative px-6 pt-8 pb-6 text-center ${cur.tone} text-white`}>
          <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-40%', right: '-25%', opacity: 0.32 }} />
          <span className="dz-leak dz-leak-cream dz-leak-md" style={{ bottom: '-40%', left: '-15%', opacity: 0.28 }} />
          <button
            type="button"
            onClick={() => {
              haptic.selection();
              close();
            }}
            className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[12px] font-bold text-white"
            aria-label="Yopish"
          >
            ✕
          </button>
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-[34px]">
            {cur.emoji}
          </div>
          <h2 className="relative mt-3 text-[18px] font-extrabold leading-tight">{cur.title}</h2>
          <p className="relative mx-auto mt-1.5 max-w-[18rem] text-[12px] leading-relaxed opacity-85">
            {cur.body}
          </p>
        </div>
        <div className="bg-white p-4">
          <div className="mb-3 flex items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-5 bg-[var(--brand-primary)]' : 'w-1.5 bg-[var(--brand-primary)]/25'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                haptic.selection();
                close();
              }}
              className="flex-1 rounded-xl bg-[var(--brand-cream-100)] py-2.5 text-[12px] font-bold text-[var(--brand-primary)]"
            >
              Tashlab oʻtish
            </button>
            <button
              type="button"
              onClick={() => {
                haptic.selection();
                if (isLast) close();
                else setStep((s) => s + 1);
              }}
              className="flex-1 rounded-xl bg-[var(--brand-primary)] py-2.5 text-[12px] font-bold text-white"
            >
              {isLast ? 'Boshlash' : 'Keyingi →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
