/**
 * List navigation + form return E2E-style unit tests.
 * Run: node src/lib/__tests__/listNavigation.node.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listScrollStorageKey,
  normalizeListPathAndQuery,
  persistListScroll,
  readListScroll,
  sanitizeReturnTo,
  withReturnToPath,
} from '../listState.ts';

function resolveBackTargetForTest(location, fallback) {
  const state = location.state;
  const fromState =
    (typeof state?.backTo === 'string' && state.backTo) ||
    (typeof state?.returnTo === 'string' && state.returnTo) ||
    null;
  let fromQuery = null;
  if (location.search) {
    const params = new URLSearchParams(
      location.search.startsWith('?') ? location.search.slice(1) : location.search,
    );
    fromQuery = params.get('returnTo');
  }
  return sanitizeReturnTo(fromState || fromQuery, fallback);
}

describe('list navigation helpers', () => {
  it('builds product edit URL with returnTo query', () => {
    const path = withReturnToPath(
      '/products/abc/edit',
      '/products?status=active&search=2188&page=1',
    );
    assert.match(path, /^\/products\/abc\/edit\?/);
    assert.ok(path.includes('returnTo='));
    const u = new URL(path, 'http://local.test');
    const back = decodeURIComponent(u.searchParams.get('returnTo') || '');
    assert.equal(back, '/products?status=active&search=2188&page=1');
  });

  it('resolveBackTarget prefers returnTo query on detail routes', () => {
    const loc = {
      pathname: '/products/p1/edit',
      search: '?returnTo=%2Fproducts%3Fsearch%3D2188',
      state: null,
    };
    assert.equal(resolveBackTargetForTest(loc, '/products'), '/products?search=2188');
  });

  it('normalizes list path by stripping transient keys', () => {
    const params = new URLSearchParams('search=2188&detail=xyz&status=active');
    assert.equal(
      normalizeListPathAndQuery('/products', params),
      '/products?search=2188&status=active',
    );
  });

  it('persists scroll per org/branch/user/path key', () => {
    const storage = new Map();
    const sessionStorage = {
      setItem(k, v) {
        storage.set(k, v);
      },
      getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
      removeItem(k) {
        storage.delete(k);
      },
    };
    const prev = globalThis.sessionStorage;
    globalThis.sessionStorage = sessionStorage;
    try {
      const key = listScrollStorageKey({
        organizationId: 'org1',
        branchId: 'br1',
        userId: 'u1',
        pathAndQuery: '/products?search=2188',
      });
      assert.match(key, /^list-state:org1:br1:u1:/);
      persistListScroll(key, 480);
      assert.equal(readListScroll(key), 480);
      persistListScroll(key, 0);
      assert.equal(readListScroll(key), 0);
    } finally {
      globalThis.sessionStorage = prev;
    }
  });

  it('rejects unsafe returnTo targets', () => {
    assert.equal(sanitizeReturnTo('https://evil.com', '/products'), '/products');
    assert.equal(
      sanitizeReturnTo('/products?search=test', '/products'),
      '/products?search=test',
    );
  });
});

describe('products cancel preserves list query (simulated)', () => {
  it('returnTo round-trip keeps search filter', () => {
    const listPath = '/products?status=active&search=2188&sortBy=name&sortOrder=asc';
    const editPath = withReturnToPath('/products/p-1/edit', listPath);
    const loc = { pathname: '/products/p-1/edit', search: editPath.split('?')[1] || '', state: null };
    const back = resolveBackTargetForTest(loc, '/products');
    assert.equal(back, listPath);
    const params = new URLSearchParams(back.split('?')[1] || '');
    assert.equal(params.get('search'), '2188');
    assert.equal(params.get('status'), 'active');
  });
});
