export type TierPricePayload = {
  product_id: string;
  tier_code?: string;
  tier_id?: number;
  currency?: string;
  unit: string;
};

const memoryCache = new Map<string, number>();
const inFlight = new Map<string, Promise<number | null>>();

function tierPart(payload: TierPricePayload): string {
  if (payload.tier_code) return String(payload.tier_code);
  if (payload.tier_id != null) return `id:${payload.tier_id}`;
  return 'retail';
}

export function buildTierPriceCacheKey(payload: TierPricePayload): string {
  const currency = String(payload.currency || 'UZS').toUpperCase();
  return `${payload.product_id}::${tierPart(payload)}::${payload.unit}::${currency}`;
}

export function isTierPriceRateLimited(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: { status?: number } };
  if (e.code === 'RATE_LIMITED') return true;
  if (e.details?.status === 429) return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('too many requests') || msg.includes('rate limit');
}

export function clearTierPriceCache(): void {
  memoryCache.clear();
}

export function invalidateTierPriceCache(payload: TierPricePayload): void {
  memoryCache.delete(buildTierPriceCacheKey(payload));
}

export function peekTierPriceCache(payload: TierPricePayload): number | null | undefined {
  return memoryCache.get(buildTierPriceCacheKey(payload));
}

export async function fetchCachedProductTierPrice(
  payload: TierPricePayload,
  fetcher: () => Promise<number | null>
): Promise<number | null> {
  const key = buildTierPriceCacheKey(payload);
  const cached = memoryCache.get(key);
  if (cached != null) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const price = await fetcher();
      if (price == null) return null;
      const n = Number(price);
      if (!Number.isFinite(n)) return null;
      memoryCache.set(key, n);
      return n;
    } catch (err) {
      if (isTierPriceRateLimited(err)) {
        const stale = memoryCache.get(key);
        return stale != null ? stale : null;
      }
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
