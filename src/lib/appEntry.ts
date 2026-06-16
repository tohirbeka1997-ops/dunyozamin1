export type AppEntryMode = 'full' | 'kassa';

const PREFERRED_ENTRY_KEY = 'pos_preferred_entry';

export function detectAppEntryMode(): AppEntryMode {
  if (typeof window === 'undefined') return 'full';
  const path = window.location.pathname || '';
  const href = window.location.href || '';
  if (/kassa\.html/i.test(path) || /kassa\.html/i.test(href)) return 'kassa';
  return 'full';
}

export function loadPreferredEntryMode(): AppEntryMode | null {
  try {
    const value = localStorage.getItem(PREFERRED_ENTRY_KEY);
    if (value === 'full' || value === 'kassa') return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function savePreferredEntryMode(mode: AppEntryMode): void {
  try {
    localStorage.setItem(PREFERRED_ENTRY_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Default post-login route for the selected entry mode. */
export function defaultRouteForEntry(mode: AppEntryMode): string {
  return mode === 'kassa' ? '/pos' : '/';
}

/** Full-page navigation to the other HTML entry (Electron file:// or multi-page dev). */
export function switchAppEntry(mode: AppEntryMode, route: string): void {
  if (typeof window === 'undefined') return;

  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const html = mode === 'kassa' ? 'kassa.html' : 'index.html';
  const { protocol, pathname, origin } = window.location;

  if (protocol === 'file:') {
    const base = pathname.replace(/[^/\\]+$/, '');
    window.location.replace(`${base}${html}#${normalizedRoute}`);
    return;
  }

  const dir = pathname.replace(/\/[^/]*$/, '') || '';
  const prefix = dir && dir !== '/' ? dir : '';

  if (mode === 'kassa') {
    window.location.replace(`${origin}${prefix}/${html}#${normalizedRoute}`);
    return;
  }

  window.location.replace(`${origin}${normalizedRoute}`);
}
