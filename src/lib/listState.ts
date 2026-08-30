/**
 * Shared list URL / pagination helpers.
 * URL `page` is 1-based for users; API offsets stay 0-based via {@link pageToApiOffset}.
 */

export type ListSortDirection = 'asc' | 'desc';

export type ListStateSnapshot = {
  page: number;
  pageSize: number;
  search: string;
  filters: Record<string, string>;
  sortField: string;
  sortDirection: ListSortDirection;
  scrollTop: number;
  returnTo?: string;
};

/** Parse URL page (1-based). Legacy `page=0` → 1. Invalid → defaultPage. */
export function parseListPageParam(
  raw: string | null | undefined,
  defaultPage = 1,
): number {
  if (raw == null || raw === '') return defaultPage;
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultPage;
  // Legacy 0-based bookmarks: page=0 means first page
  if (n === 0) return 1;
  if (n < 1) return defaultPage;
  return Math.floor(n);
}

/** 1-based UI page → 0-based index for slicing / APIs. */
export function pageToApiOffset(page1Based: number, pageSize: number): number {
  const page = Math.max(1, Math.floor(Number(page1Based) || 1));
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  return (page - 1) * size;
}

export function pageToZeroBasedIndex(page1Based: number): number {
  return Math.max(0, Math.floor(Number(page1Based) || 1) - 1);
}

/**
 * Clamp page only after data is known. Never clamp while loading
 * (empty length would force page → 1 and wipe deep-links / back navigation).
 */
export function clampListPage(options: {
  page: number;
  totalItems: number;
  pageSize: number;
  loading?: boolean;
}): number {
  const { page, totalItems, pageSize, loading } = options;
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  if (loading) return safePage;
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  const total = Math.max(0, Math.floor(Number(totalItems) || 0));
  const maxPage = Math.max(1, Math.ceil(total / size) || 1);
  // Empty list: keep requested page (deep-link) until we have a definitive empty result
  // After load with 0 items, maxPage is 1 — stay on 1.
  if (safePage > maxPage) return maxPage;
  return safePage;
}

/** Same-origin relative path only; reject external / javascript: / protocol-relative. */
export function sanitizeReturnTo(
  candidate: unknown,
  fallback: string,
): string {
  if (typeof candidate !== 'string') return fallback;
  const value = candidate.trim();
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  const lower = value.toLowerCase();
  if (lower.startsWith('/\\') || lower.includes('javascript:')) return fallback;
  if (lower.includes(':') && !lower.startsWith('/')) return fallback;
  // Block scheme-like paths e.g. "/http:..."
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return fallback;
  return value;
}

export function buildReturnToQuery(
  listPathWithQuery: string,
): string {
  return sanitizeReturnTo(listPathWithQuery, '/');
}

export function listSessionStorageKey(
  routeKey: string,
  userId?: string | null,
  branchId?: string | null,
  organizationId?: string | null,
): string {
  const org = String(organizationId || 'default').slice(0, 64);
  const u = String(userId || 'anon').slice(0, 64);
  const b = String(branchId || 'default').slice(0, 64);
  return `listState:${routeKey}:${org}:${b}:${u}`;
}

/** Scroll persistence key: list-state:{org}:{branch}:{user}:{pathAndQuery} */
export function listScrollStorageKey(options: {
  organizationId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  pathAndQuery: string;
}): string {
  const org = String(options.organizationId || 'default').slice(0, 64);
  const branch = String(options.branchId || 'default').slice(0, 64);
  const user = String(options.userId || 'anon').slice(0, 64);
  const path = String(options.pathAndQuery || '/').replace(/\s+/g, '').slice(0, 512);
  return `list-state:${org}:${branch}:${user}:${path}`;
}

export function persistListScroll(storageKey: string, scrollTop: number): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const top = Math.max(0, Math.floor(Number(scrollTop) || 0));
    if (top <= 0) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, String(top));
  } catch {
    /* quota / private mode */
  }
}

export function readListScroll(storageKey: string): number {
  if (typeof sessionStorage === 'undefined') return 0;
  try {
    const raw = sessionStorage.getItem(storageKey);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Build list path+query without transient params (detail drawer, etc.). */
export function normalizeListPathAndQuery(
  pathname: string,
  searchParams: URLSearchParams,
  omitKeys: string[] = ['detail', 'returnTo'],
): string {
  const params = new URLSearchParams(searchParams);
  omitKeys.forEach((k) => params.delete(k));
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** Encode sort as `field.direction` for URL (e.g. name.asc). */
export function encodeSortParam(field: string, direction: ListSortDirection): string {
  const f = String(field || '').trim() || 'name';
  const d = direction === 'desc' ? 'desc' : 'asc';
  return `${f}.${d}`;
}

export function parseSortParam(raw: string | null | undefined): {
  field: string;
  direction: ListSortDirection;
} {
  const value = String(raw || '').trim();
  if (!value) return { field: 'name', direction: 'asc' };
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return { field: value, direction: 'asc' };
  const field = value.slice(0, dot);
  const dir = value.slice(dot + 1).toLowerCase();
  return { field, direction: dir === 'desc' ? 'desc' : 'asc' };
}

/** Append safe returnTo query to a detail path. */
export function withReturnToPath(
  detailPath: string,
  listPathWithQuery: string,
): string {
  const [pathOnly, existingQuery = ''] = String(detailPath || '/').split('?');
  const params = new URLSearchParams(existingQuery);
  params.set('returnTo', sanitizeReturnTo(listPathWithQuery, '/'));
  const q = params.toString();
  return q ? `${pathOnly}?${q}` : pathOnly;
}
