import { cloudStorage, getTg } from './telegram';

/**
 * localStorage key for favorites is namespaced by the active Telegram
 * user ID. Two accounts on the same physical device should NOT share a
 * favorites list — the previous shared key (`dz_favorites_v1`) leaked
 * Account A's favorites to Account B once they switched in Telegram.
 *
 * `getStorageKey()` returns the per-user key, falling back to a
 * "guest" key when no Telegram user is present (browser/dev mode).
 */
const FAVORITES_KEY_PREFIX = 'dz_favorites_v1';
const LEGACY_KEY = 'dz_favorites_v1';

function getStorageKey(): string {
  const tgId = getTg()?.initDataUnsafe?.user?.id;
  if (typeof tgId === 'number' && Number.isFinite(tgId)) {
    return `${FAVORITES_KEY_PREFIX}::${tgId}`;
  }
  return `${FAVORITES_KEY_PREFIX}::guest`;
}

function normalize(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function loadFavorites(): string[] {
  try {
    const key = getStorageKey();
    let raw = localStorage.getItem(key);
    // Migrate the legacy unscoped key the first time this user lands.
    // After migration the legacy entry is removed so a different
    // account on the same device starts from a clean slate.
    if (raw == null && key !== LEGACY_KEY) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy != null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalize(parsed.map((x) => String(x)));
  } catch {
    return [];
  }
}

export function isFavorite(productId: string): boolean {
  return loadFavorites().includes(productId);
}

const CLOUD_KEY = 'dz_favorites_v1';

export function toggleFavorite(productId: string): boolean {
  const current = loadFavorites();
  const next = current.includes(productId)
    ? current.filter((id) => id !== productId)
    : [...current, productId];
  const normalized = normalize(next);
  const json = JSON.stringify(normalized);
  localStorage.setItem(getStorageKey(), json);
  // Best-effort sync to Telegram CloudStorage so favorites follow the
  // user across devices. Fire-and-forget; failure is silent.
  void cloudStorage.setItem(CLOUD_KEY, json);
  window.dispatchEvent(new Event('favorites:change'));
  return next.includes(productId);
}

export function favoritesCount(): number {
  return loadFavorites().length;
}

/**
 * Pull favorites from Telegram CloudStorage and merge with the local list.
 * Should be called once on app boot, after authentication. Local additions
 * always win on conflict (CloudStorage acts as a backup, not source of truth).
 */
export async function hydrateFavoritesFromCloud(): Promise<void> {
  const remoteRaw = await cloudStorage.getItem(CLOUD_KEY);
  if (!remoteRaw) return;
  let remote: string[] = [];
  try {
    const parsed = JSON.parse(remoteRaw) as unknown;
    if (Array.isArray(parsed)) {
      remote = parsed.map((x) => String(x));
    }
  } catch {
    return;
  }
  if (!remote.length) return;
  const local = loadFavorites();
  const merged = normalize([...local, ...remote]);
  if (merged.length !== local.length) {
    localStorage.setItem(getStorageKey(), JSON.stringify(merged));
    // Push merged set back so all devices converge.
    void cloudStorage.setItem(CLOUD_KEY, JSON.stringify(merged));
    window.dispatchEvent(new Event('favorites:change'));
  }
}
