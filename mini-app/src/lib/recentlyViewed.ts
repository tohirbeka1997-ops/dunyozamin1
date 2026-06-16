import { cloudStorage, getTg } from './telegram';

const KEY_PREFIX = 'dz_recent_viewed_v1';
const MAX = 12;

function getKey(): string {
  const tgId = getTg()?.initDataUnsafe?.user?.id;
  if (typeof tgId === 'number' && Number.isFinite(tgId)) {
    return `${KEY_PREFIX}::${tgId}`;
  }
  return `${KEY_PREFIX}::guest`;
}

export type RecentItem = {
  id: string;
  name: string;
  price_uzs: number;
  image_url: string | null;
  /** unix ms when the user last opened the product */
  ts: number;
};

export function loadRecentlyViewed(): RecentItem[] {
  try {
    const raw = localStorage.getItem(getKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentItem => !!x && typeof x === 'object' && typeof (x as RecentItem).id === 'string')
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(item: Omit<RecentItem, 'ts'>): RecentItem[] {
  const cur = loadRecentlyViewed().filter((x) => x.id !== item.id);
  const next: RecentItem[] = [{ ...item, ts: Date.now() }, ...cur].slice(0, MAX);
  const json = JSON.stringify(next);
  localStorage.setItem(getKey(), json);
  // Best-effort cross-device sync via Telegram CloudStorage.
  void cloudStorage.setItem(KEY_PREFIX, json);
  window.dispatchEvent(new Event('recently-viewed:change'));
  return next;
}

export function clearRecentlyViewed(): void {
  localStorage.removeItem(getKey());
  void cloudStorage.removeItem(KEY_PREFIX);
  window.dispatchEvent(new Event('recently-viewed:change'));
}

export async function hydrateRecentlyViewedFromCloud(): Promise<void> {
  const remoteRaw = await cloudStorage.getItem(KEY_PREFIX);
  if (!remoteRaw) return;
  let remote: RecentItem[] = [];
  try {
    const parsed = JSON.parse(remoteRaw) as unknown;
    if (Array.isArray(parsed)) {
      remote = parsed.filter((x): x is RecentItem => !!x && typeof (x as RecentItem).id === 'string');
    }
  } catch {
    return;
  }
  if (!remote.length) return;
  const local = loadRecentlyViewed();
  const seen = new Set(local.map((x) => x.id));
  const merged = [...local];
  for (const r of remote) {
    if (!seen.has(r.id)) {
      merged.push(r);
      seen.add(r.id);
    }
  }
  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const trimmed = merged.slice(0, MAX);
  if (trimmed.length !== local.length) {
    localStorage.setItem(getKey(), JSON.stringify(trimmed));
    window.dispatchEvent(new Event('recently-viewed:change'));
  }
}
