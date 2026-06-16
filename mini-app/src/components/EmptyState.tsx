import { Link } from 'react-router-dom';

type Tone = 'cream' | 'teal' | 'accent' | 'primary';

const TONE_LEAKS: Record<Tone, { primary: string; secondary: string }> = {
  cream: { primary: 'dz-leak-teal', secondary: 'dz-leak-accent' },
  teal: { primary: 'dz-leak-teal', secondary: 'dz-leak-cream' },
  accent: { primary: 'dz-leak-accent', secondary: 'dz-leak-cream' },
  primary: { primary: 'dz-leak-primary', secondary: 'dz-leak-teal' },
};

const TONE_ICON_BG: Record<Tone, string> = {
  cream: 'bg-[var(--brand-cream-200)] text-[var(--brand-primary)]',
  teal: 'dz-teal-bg text-white shadow-[var(--dz-glow-teal)]',
  accent: 'bg-[var(--brand-accent)] text-[var(--brand-primary)] shadow-[var(--dz-glow-accent)]',
  primary: 'dz-brand-bg text-white',
};

/**
 * Reusable "empty state" card. Renders an illustrated icon, title,
 * optional sub-text and primary CTA. The decorative leaks pull from
 * the brand palette so it feels native to every page.
 */
export function EmptyState({
  icon,
  title,
  description,
  cta,
  tone = 'cream',
  size = 'md',
}: {
  icon: string;
  title: string;
  description?: string;
  cta?: { to?: string; href?: string; label: string; onClick?: () => void };
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
}) {
  const leaks = TONE_LEAKS[tone];
  const iconBg = TONE_ICON_BG[tone];
  const padding = size === 'sm' ? 'py-7 px-4' : size === 'lg' ? 'py-14 px-6' : 'py-10 px-5';
  const iconSize = size === 'sm' ? 'h-12 w-12 text-[20px]' : 'h-16 w-16 text-[26px]';

  const ctaEl = cta ? (
    cta.to ? (
      <Link to={cta.to} onClick={cta.onClick} className="dz-btn-primary mt-4 inline-flex items-center gap-1 text-[12.5px]">
        {cta.label}
      </Link>
    ) : cta.href ? (
      <a href={cta.href} className="dz-btn-primary mt-4 inline-flex items-center gap-1 text-[12.5px]">
        {cta.label}
      </a>
    ) : (
      <button
        type="button"
        onClick={cta.onClick}
        className="dz-btn-primary mt-4 inline-flex items-center gap-1 text-[12.5px]"
      >
        {cta.label}
      </button>
    )
  ) : null;

  return (
    <div className={`dz-card-flat dz-cream-bg relative text-center ${padding}`}>
      <span
        className={`dz-leak ${leaks.primary} dz-leak-lg`}
        style={{ top: '-40%', right: '-25%', opacity: 0.28 }}
      />
      <span
        className={`dz-leak ${leaks.secondary} dz-leak-md`}
        style={{ bottom: '-40%', left: '-15%', opacity: 0.22 }}
      />
      <div className="relative">
        <div
          className={`mx-auto flex items-center justify-center rounded-2xl ${iconSize} ${iconBg}`}
          aria-hidden
        >
          {icon}
        </div>
        <p className="mt-4 text-[15px] font-extrabold text-[var(--brand-primary)]">{title}</p>
        {description ? (
          <p className="mx-auto mt-1.5 max-w-[18rem] text-[12px] leading-relaxed text-[var(--brand-primary)]/65">
            {description}
          </p>
        ) : null}
        {ctaEl}
      </div>
    </div>
  );
}
