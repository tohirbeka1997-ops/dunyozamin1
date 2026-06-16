import { LANG_META, setLang, useLang, type Lang } from '../lib/i18n';
import { haptic } from '../lib/telegram';

const LANGS: Lang[] = ['uz', 'ru', 'en'];

/**
 * Compact one-row language picker.
 *
 * Renders as a single chip (globe + flag + native name + caret) with a
 * transparent native <select> overlaid for proper mobile UX. Native
 * selects open a system-level wheel/sheet on iOS and Android, which is
 * what we want for tiny scratch space inside the profile card stack.
 */
export function LanguageSwitcher() {
  const cur = useLang();
  const meta = LANG_META[cur];

  return (
    <label className="dz-card relative flex h-12 items-center gap-2 overflow-hidden px-3.5 py-0 active:scale-[0.99]">
      <span aria-hidden className="text-[16px]">🌐</span>
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-primary)]/55">
        Til
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <span aria-hidden className="text-[15px]">{meta.flag}</span>
        <span className="text-[13px] font-bold text-[var(--brand-primary)]">{meta.native}</span>
        <span aria-hidden className="text-[var(--brand-primary)]/45">▾</span>
      </span>
      <select
        value={cur}
        onChange={(e) => {
          setLang(e.target.value as Lang);
          haptic.selection();
        }}
        aria-label="Tilni tanlash"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LANGS.map((code) => (
          <option key={code} value={code}>
            {LANG_META[code].flag} {LANG_META[code].native}
          </option>
        ))}
      </select>
    </label>
  );
}
