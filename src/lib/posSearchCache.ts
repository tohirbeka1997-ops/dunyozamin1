/** Small LRU cache for POS catalog search results (in-memory, per session). */

type CacheEntry = {
  results: unknown[];
  at: number;
};

export class PosSearchCache<T = unknown> {
  private map = new Map<string, CacheEntry>();
  private order: string[] = [];
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 64, ttlMs = 5 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  private touch(key: string) {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(key);
  }

  get(key: string): T[] | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > this.ttlMs) {
      this.map.delete(key);
      const idx = this.order.indexOf(key);
      if (idx >= 0) this.order.splice(idx, 1);
      return null;
    }
    this.touch(key);
    return entry.results as T[];
  }

  set(key: string, results: T[]) {
    this.map.set(key, { results, at: Date.now() });
    this.touch(key);
    while (this.order.length > this.maxEntries) {
      const drop = this.order.shift();
      if (drop) this.map.delete(drop);
    }
  }

  buildKey(term: string, categoryId: string | null | undefined, warehouseId?: string | null) {
    const cat = categoryId || 'all';
    const wh = warehouseId || 'default';
    return `${wh}|${cat}|${String(term || '').trim().toLowerCase()}`;
  }
}

export const posSearchCache = new PosSearchCache();
