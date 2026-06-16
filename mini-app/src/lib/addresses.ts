import { cloudStorage, getTg } from './telegram';

export type SavedAddress = {
  id: string;
  /** Short label like "Uy", "Ish", "Ota uyi" */
  label: string;
  /** Full free-form address line */
  address: string;
  /** Optional GPS pin */
  location?: { latitude: number; longitude: number } | null;
  /** Optional emoji prefix for the chip */
  icon?: string;
};

const KEY_PREFIX = 'dz_addresses_v1';

function getKey(): string {
  const tgId = getTg()?.initDataUnsafe?.user?.id;
  if (typeof tgId === 'number' && Number.isFinite(tgId)) {
    return `${KEY_PREFIX}::${tgId}`;
  }
  return `${KEY_PREFIX}::guest`;
}

function uid(): string {
  return `addr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadAddresses(): SavedAddress[] {
  try {
    const raw = localStorage.getItem(getKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is SavedAddress =>
        !!x && typeof (x as SavedAddress).id === 'string' && typeof (x as SavedAddress).address === 'string',
    );
  } catch {
    return [];
  }
}

function persist(rows: SavedAddress[]) {
  const json = JSON.stringify(rows);
  localStorage.setItem(getKey(), json);
  void cloudStorage.setItem(KEY_PREFIX, json);
  window.dispatchEvent(new Event('addresses:change'));
}

export function saveAddress(a: Omit<SavedAddress, 'id'> & { id?: string }): SavedAddress[] {
  const cur = loadAddresses();
  const id = a.id || uid();
  const i = cur.findIndex((x) => x.id === id);
  const row: SavedAddress = {
    id,
    label: a.label.trim() || 'Manzil',
    address: a.address.trim(),
    location: a.location || null,
    icon: a.icon || guessIcon(a.label),
  };
  if (i >= 0) cur[i] = row;
  else cur.push(row);
  persist(cur);
  return cur;
}

export function removeAddress(id: string): SavedAddress[] {
  const cur = loadAddresses().filter((x) => x.id !== id);
  persist(cur);
  return cur;
}

function guessIcon(label: string): string {
  const l = label.toLowerCase();
  if (/uy|home|dom/.test(l)) return '🏠';
  if (/ish|work|of|ofis/.test(l)) return '💼';
  if (/ota|ona|aka|opa|bolam|bolajon/.test(l)) return '👨‍👩‍👧';
  return '📍';
}

export async function hydrateAddressesFromCloud(): Promise<void> {
  const remoteRaw = await cloudStorage.getItem(KEY_PREFIX);
  if (!remoteRaw) return;
  let remote: SavedAddress[] = [];
  try {
    const parsed = JSON.parse(remoteRaw) as unknown;
    if (Array.isArray(parsed)) {
      remote = parsed.filter(
        (x): x is SavedAddress =>
          !!x && typeof (x as SavedAddress).id === 'string' && typeof (x as SavedAddress).address === 'string',
      );
    }
  } catch {
    return;
  }
  if (!remote.length) return;
  const local = loadAddresses();
  const seen = new Set(local.map((x) => x.id));
  const merged = [...local];
  for (const r of remote) {
    if (!seen.has(r.id)) {
      merged.push(r);
      seen.add(r.id);
    }
  }
  if (merged.length !== local.length) {
    localStorage.setItem(getKey(), JSON.stringify(merged));
    window.dispatchEvent(new Event('addresses:change'));
  }
}
