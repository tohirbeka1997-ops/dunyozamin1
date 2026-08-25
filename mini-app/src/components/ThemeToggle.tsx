import { useEffect, useState } from 'react';
import { effectiveTheme, onThemeChange, toggleTheme, type ThemeMode } from '../theme';
import { haptic } from '../lib/telegram';
import { t, useLang } from '../lib/i18n';

/**
 * Manual light/dark switch for the Profile settings. Mirrors the
 * mockup's pill toggle. The default still follows Telegram's
 * colorScheme until the user flips this — at which point the choice is
 * persisted to localStorage and wins.
 */
export function ThemeToggle() {
  useLang();
  const [mode, setMode] = useState<ThemeMode>(() => effectiveTheme());

  useEffect(() => onThemeChange(() => setMode(effectiveTheme())), []);

  const dark = mode === 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        setMode(toggleTheme());
        haptic.selection();
      }}
      className="dz-card relative flex h-12 w-full items-center gap-2 overflow-hidden px-3.5 active:scale-[0.99]"
      aria-label={t('profile.theme')}
      aria-pressed={dark}
    >
      <span aria-hidden className="text-[16px]">
        {dark ? '🌙' : '☀️'}
      </span>
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--soft-ink)]">
        {t('profile.theme')}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[12px] font-bold text-[var(--brand-deep)]">
          {dark ? t('profile.theme.dark') : t('profile.theme.light')}
        </span>
        <span
          className="relative h-6 w-11 rounded-full transition-colors"
          style={{ background: dark ? 'var(--brand)' : '#dfe5df' }}
          aria-hidden
        >
          <span
            className="absolute top-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[10px] shadow-[0_2px_5px_rgba(0,0,0,0.18)] transition-[left]"
            style={{ left: dark ? '23px' : '3px' }}
          >
            {dark ? '🌙' : '☀️'}
          </span>
        </span>
      </span>
    </button>
  );
}
