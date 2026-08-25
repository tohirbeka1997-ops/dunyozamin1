import { getTg } from './lib/telegram';

/**
 * UI theme controller (purely presentational — no business logic).
 *
 * Precedence:
 *   1. Manual override saved in localStorage ('dz-theme' = light|dark)
 *   2. Telegram WebApp.colorScheme (light|dark)
 *   3. OS prefers-color-scheme
 *   4. light
 *
 * Applies the `dark` class + data-theme attribute on <html> so the
 * dark-mode tokens in index.css take effect.
 */
export type ThemeMode = 'light' | 'dark';

const KEY = 'dz-theme';
const EVENT = 'dz:theme-change';

export function getManualTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeMode {
  const scheme = getTg()?.colorScheme;
  if (scheme === 'dark' || scheme === 'light') return scheme;
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* noop */
  }
  return 'light';
}

export function effectiveTheme(): ThemeMode {
  return getManualTheme() ?? systemTheme();
}

export function applyTheme(mode: ThemeMode = effectiveTheme()): void {
  const el = document.documentElement;
  el.classList.toggle('dark', mode === 'dark');
  el.setAttribute('data-theme', mode);
}

/** Persist a manual override and re-apply. Pass null to clear the override. */
export function setManualTheme(mode: ThemeMode | null): void {
  try {
    if (mode) localStorage.setItem(KEY, mode);
    else localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  applyTheme();
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* noop */
  }
}

/** Flip between light/dark, storing the result as a manual override. */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = effectiveTheme() === 'dark' ? 'light' : 'dark';
  setManualTheme(next);
  return next;
}

/**
 * Wire up theme application + listeners. Returns a cleanup fn. Safe to
 * call once on app mount.
 */
export function initTheme(): () => void {
  applyTheme();

  const onManualChange = () => applyTheme();
  window.addEventListener(EVENT, onManualChange);

  // Re-evaluate when Telegram's colorScheme changes — only when the user
  // hasn't pinned a manual override.
  const tg = getTg() as unknown as {
    onEvent?: (e: string, cb: () => void) => void;
    offEvent?: (e: string, cb: () => void) => void;
  } | undefined;
  const onTgTheme = () => {
    if (!getManualTheme()) applyTheme();
  };
  try {
    tg?.onEvent?.('themeChanged', onTgTheme);
  } catch {
    /* noop */
  }

  let mq: MediaQueryList | null = null;
  const onMq = () => {
    if (!getManualTheme()) applyTheme();
  };
  try {
    mq = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    mq?.addEventListener?.('change', onMq);
  } catch {
    /* noop */
  }

  return () => {
    window.removeEventListener(EVENT, onManualChange);
    try {
      tg?.offEvent?.('themeChanged', onTgTheme);
    } catch {
      /* noop */
    }
    try {
      mq?.removeEventListener?.('change', onMq);
    } catch {
      /* noop */
    }
  };
}

/** React-less subscription used by the toggle UI to stay in sync. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
