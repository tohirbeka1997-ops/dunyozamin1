import { useState } from 'react';
import { getTg, haptic, shareToTelegram, tgAlert } from '../lib/telegram';

const BOT_USERNAME = 'dunyozaminbot';
const REFERRAL_BONUS_POINTS = 50;

/**
 * Generates a deep-link of the form `https://t.me/<bot>?start=ref_<id>`
 * tied to the current Telegram user. When a friend taps it the bot can
 * read the `ref_<id>` start payload and credit the referrer on their
 * first paid order. The backend hook is intentionally TODO — this
 * component delivers the UX so the marketing flywheel can start now.
 */
export function ReferralCard() {
  const [copied, setCopied] = useState(false);
  const tg = getTg();
  const userId = tg?.initDataUnsafe?.user?.id;
  const link = userId
    ? `https://t.me/${BOT_USERNAME}?start=ref_${userId}`
    : `https://t.me/${BOT_USERNAME}`;

  const message = `🌿 DunyoZamin doʻkonida xarid qilamiz! Mening havolam orqali kirib roʻyxatdan oʻtsangiz, ikkalamizga ${REFERRAL_BONUS_POINTS} ball sovgʻa: ${link}`;

  async function copyLink() {
    haptic.selection();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      void tgAlert(`Havolani nusxalang: ${link}`);
    }
  }

  return (
    <section className="dz-card relative overflow-hidden p-4">
      <span className="dz-leak dz-leak-accent dz-leak-lg" style={{ top: '-50%', right: '-20%', opacity: 0.28 }} />
      <span className="dz-leak dz-leak-teal dz-leak-md" style={{ bottom: '-40%', left: '-15%', opacity: 0.22 }} />
      <div className="relative">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/65">
          <span aria-hidden>🎁</span> Doʻst chaqir
        </p>
        <h3 className="mt-1 text-[15px] font-extrabold text-[var(--brand-primary)]">
          Doʻstingiz birinchi xaridini qilsa <br />
          <span className="text-[var(--brand-teal)]">ikkalangizga {REFERRAL_BONUS_POINTS} ball sovgʻa</span>
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--brand-primary)]/65">
          Quyidagi havolani ulashing — doʻstingiz Telegram orqali botga ulansa va birinchi
          buyurtmasini berib bo'lsa — ikkala hisobingizga avtomatik qoʻshiladi.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-2xl bg-[var(--brand-cream-100)] p-2">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[15px]">
              🔗
            </span>
            <code className="flex-1 truncate text-[11px] font-mono text-[var(--brand-primary)]/85">{link}</code>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[var(--brand-primary)]"
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic.selection();
              void shareToTelegram(link, message);
            }}
            className="dz-btn-primary inline-flex items-center justify-center gap-1.5 text-[12.5px]"
          >
            <span aria-hidden>↗</span>
            Telegram orqali ulashish
          </button>
        </div>
      </div>
    </section>
  );
}
