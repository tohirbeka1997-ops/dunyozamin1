const MAX_RECENT = 8;
const PREFIX = 'recent_search_';

export function getRecentSearches(context: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + context);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(context: string, term: string): void {
  const trimmed = term.trim();
  if (!trimmed || trimmed.length < 2) return;
  try {
    const existing = getRecentSearches(context);
    const filtered = existing.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(PREFIX + context, JSON.stringify(updated));
  } catch {
    // localStorage may be unavailable in some contexts — fail silently
  }
}

export function removeRecentSearch(context: string, term: string): void {
  try {
    const existing = getRecentSearches(context);
    const updated = existing.filter((s) => s !== term);
    localStorage.setItem(PREFIX + context, JSON.stringify(updated));
  } catch {}
}

export function clearRecentSearches(context: string): void {
  try {
    localStorage.removeItem(PREFIX + context);
  } catch {}
}
