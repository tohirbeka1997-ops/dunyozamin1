const RECENT_SEARCHES_KEY = 'dz_recent_searches_v1';
const MAX_RECENT_SEARCHES = 5;

function normalizeQuery(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => normalizeQuery(String(v))).filter(Boolean).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): string[] {
  const normalized = normalizeQuery(query);
  if (normalized.length < 2) return loadRecentSearches();
  const prev = loadRecentSearches().filter((q) => q.toLowerCase() !== normalized.toLowerCase());
  const next = [normalized, ...prev].slice(0, MAX_RECENT_SEARCHES);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}

