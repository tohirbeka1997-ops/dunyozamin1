/**
 * Local product catalog cache for offline barcode / search fallback.
 * Populated whenever online search succeeds; capped to avoid unbounded growth.
 */

import { getAppItem, setAppItem } from '@/lib/appStorage';
import { isExactCodeMatch, normalizeScannedCode } from '@/lib/barcodeLookup';
import type { PosProduct } from '@/types/sales';

const CACHE_KEY = 'dz_staff_catalog_cache_v1';
export const MAX_CACHED_PRODUCTS = 500;

export interface CatalogCache {
  updated_at: string;
  products: PosProduct[];
}

let memory: CatalogCache | null = null;
let loadPromise: Promise<CatalogCache> | null = null;

function emptyCache(): CatalogCache {
  return { updated_at: new Date(0).toISOString(), products: [] };
}

async function readCache(): Promise<CatalogCache> {
  if (memory) return memory;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const raw = await getAppItem(CACHE_KEY);
    if (!raw) {
      memory = emptyCache();
      return memory;
    }
    try {
      const parsed = JSON.parse(raw) as CatalogCache;
      if (!parsed || !Array.isArray(parsed.products)) {
        memory = emptyCache();
        return memory;
      }
      memory = {
        updated_at: String(parsed.updated_at || ''),
        products: parsed.products.filter((p) => p && p.id),
      };
      return memory;
    } catch {
      memory = emptyCache();
      return memory;
    }
  })().finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

async function writeCache(cache: CatalogCache): Promise<void> {
  memory = cache;
  await setAppItem(CACHE_KEY, JSON.stringify(cache));
}

/** Merge products into the cache (newest / upsert by id). */
export async function upsertCatalogProducts(products: PosProduct[]): Promise<void> {
  if (!Array.isArray(products) || products.length === 0) return;
  const cache = await readCache();
  const byId = new Map<string, PosProduct>();
  for (const p of cache.products) {
    if (p?.id) byId.set(String(p.id), p);
  }
  for (const p of products) {
    if (!p?.id) continue;
    byId.set(String(p.id), p);
  }
  // Keep most recently upserted near the front.
  const merged: PosProduct[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const id = String(p.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(byId.get(id)!);
  }
  for (const p of cache.products) {
    const id = String(p.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(p);
  }
  await writeCache({
    updated_at: new Date().toISOString(),
    products: merged.slice(0, MAX_CACHED_PRODUCTS),
  });
}

export async function lookupCachedProductByCode(code: string): Promise<PosProduct | null> {
  const trimmed = normalizeScannedCode(code);
  if (!trimmed) return null;
  const cache = await readCache();
  const exact = cache.products.find((p) => isExactCodeMatch(p, trimmed));
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  return (
    cache.products.find((p) => {
      const name = String(p.name || '').toLowerCase();
      const sku = String(p.sku || '').toLowerCase();
      const barcode = String(p.barcode || '').toLowerCase();
      return sku.includes(lower) || barcode.includes(lower) || name.includes(lower);
    }) ?? null
  );
}

export async function searchCachedProducts(q: string, limit = 20): Promise<PosProduct[]> {
  const cache = await readCache();
  const trimmed = String(q || '').trim().toLowerCase();
  if (!trimmed) {
    return cache.products.slice(0, Math.max(1, limit));
  }
  const scored: { p: PosProduct; score: number }[] = [];
  for (const p of cache.products) {
    const name = String(p.name || '').toLowerCase();
    const sku = String(p.sku || '').toLowerCase();
    const barcode = String(p.barcode || '').toLowerCase();
    let score = 0;
    if (sku === trimmed || barcode === trimmed) score = 100;
    else if (sku.startsWith(trimmed) || barcode.startsWith(trimmed)) score = 80;
    else if (name.startsWith(trimmed)) score = 60;
    else if (name.includes(trimmed) || sku.includes(trimmed) || barcode.includes(trimmed)) score = 40;
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((s) => s.p);
}

export async function getCatalogCacheStats(): Promise<{ count: number; updated_at: string }> {
  const cache = await readCache();
  return { count: cache.products.length, updated_at: cache.updated_at };
}

/** Test helper — reset in-memory cache between unit tests. */
export function _resetCatalogCacheMemory(): void {
  memory = null;
  loadPromise = null;
}
