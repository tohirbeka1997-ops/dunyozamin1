// Settings domain. Split out of `api.ts`. Electron IPC passthrough with inert
// mock fallbacks.

import { requireElectron } from '@/utils/electron';
import { delay, hasPosApi, ipc } from './internal';

export const getSettingsByCategory = async (category: string) => {
  const cat = String(category || '').trim();
  if (!cat) return {} as Record<string, unknown>;

  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<any[]>(
      api.settings.getAll({
        category: cat,
      })
    ).catch(() => []);

    const out: Record<string, unknown> = {};
    for (const r of rows || []) {
      const key = String(r?.key ?? '').trim();
      if (!key) continue;
      // Convention: keys often stored as `${category}.${field}` (e.g. receipt.header_text)
      const prefix = `${cat}.`;
      const field = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      out[field] = r?.value;
    }
    return out;
  }

  // Mock mode
  await delay();
  return {} as Record<string, unknown>;
};

export const getSetting = async (category: string, key: string) => {
  const cat = String(category || '').trim();
  const k = String(key || '').trim();
  if (!cat || !k) return null;

  if (hasPosApi()) {
    const api = requireElectron();
    // Prefer category-prefixed key
    const fullKey = k.includes('.') ? k : `${cat}.${k}`;
    return ipc<any>(api.settings.get(fullKey)).catch(() => null);
  }

  await delay();
  return null;
};

export const updateSetting = async (
  category: string,
  key: string,
  value: unknown,
  updatedBy: string
) => {
  const cat = String(category || '').trim();
  const k = String(key || '').trim();
  if (!cat || !k) return false;

  if (hasPosApi()) {
    const api = requireElectron();
    const fullKey = k.includes('.') ? k : `${cat}.${k}`;
    const type =
      typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : value && typeof value === 'object'
            ? 'json'
            : 'string';
    await ipc<any>(api.settings.set(fullKey, value, type, updatedBy || null));
    return true;
  }

  await delay();
  return true;
};

export const bulkUpdateSettings = async (
  category: string,
  settings: Record<string, unknown>,
  updatedBy: string
) => {
  const cat = String(category || '').trim();
  if (!cat) return 0;

  if (hasPosApi()) {
    const api = requireElectron();
    const entries = Object.entries(settings || {});
    let n = 0;
    for (const [kRaw, v] of entries) {
      const k = String(kRaw || '').trim();
      if (!k) continue;
      const fullKey = k.includes('.') ? k : `${cat}.${k}`;
      const type =
        typeof v === 'boolean'
          ? 'boolean'
          : typeof v === 'number'
            ? 'number'
            : v && typeof v === 'object'
              ? 'json'
              : 'string';
      // eslint-disable-next-line no-await-in-loop
      await ipc<any>(api.settings.set(fullKey, v, type, updatedBy || null));
      n++;
    }
    return n;
  }

  await delay();
  return 0;
};
