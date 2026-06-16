import { cloudStorage } from './telegram';

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
  const json = JSON.stringify(next);
  localStorage.setItem(RECENT_SEARCHES_KEY, json);
  void cloudStorage.setItem(RECENT_SEARCHES_KEY, json);
  return next;
}

export async function hydrateRecentSearchesFromCloud(): Promise<void> {
  const remoteRaw = await cloudStorage.getItem(RECENT_SEARCHES_KEY);
  if (!remoteRaw) return;
  let remote: string[] = [];
  try {
    const parsed = JSON.parse(remoteRaw) as unknown;
    if (Array.isArray(parsed)) {
      remote = parsed.map((v) => normalizeQuery(String(v))).filter(Boolean);
    }
  } catch {
    return;
  }
  if (!remote.length) return;
  const local = loadRecentSearches();
  const seen = new Set(local.map((q) => q.toLowerCase()));
  const merged = [...local];
  for (const q of remote) {
    if (!seen.has(q.toLowerCase())) {
      merged.push(q);
      seen.add(q.toLowerCase());
    }
  }
  const trimmed = merged.slice(0, MAX_RECENT_SEARCHES);
  if (trimmed.length !== local.length) {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed));
    void cloudStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed));
  }
}

