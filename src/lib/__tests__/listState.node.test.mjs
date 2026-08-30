import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampListPage,
  pageToApiOffset,
  pageToZeroBasedIndex,
  parseListPageParam,
  sanitizeReturnTo,
  withReturnToPath,
} from '../listState.ts';
import { filterProductsBySearchTerm } from '../productSearchMatch.ts';
import { computePurchaseRemainder } from '../purchase/purchaseHardening.ts';

describe('listState page helpers', () => {
  it('parses 1-based page and maps legacy page=0 to 1', () => {
    assert.equal(parseListPageParam(null), 1);
    assert.equal(parseListPageParam('0'), 1);
    assert.equal(parseListPageParam('1'), 1);
    assert.equal(parseListPageParam('2'), 2);
    assert.equal(pageToZeroBasedIndex(2), 1);
    assert.equal(pageToApiOffset(2, 50), 50);
  });

  it('does not clamp page while loading (deep-link / back-nav safe)', () => {
    assert.equal(
      clampListPage({ page: 2, totalItems: 0, pageSize: 50, loading: true }),
      2,
    );
  });

  it('clamps only after load when page exceeds max', () => {
    assert.equal(
      clampListPage({ page: 9, totalItems: 60, pageSize: 50, loading: false }),
      2,
    );
    assert.equal(
      clampListPage({ page: 1, totalItems: 0, pageSize: 50, loading: false }),
      1,
    );
  });

  it('sanitizes returnTo', () => {
    assert.equal(sanitizeReturnTo('/customers?page=2', '/customers'), '/customers?page=2');
    assert.equal(sanitizeReturnTo('https://evil.com', '/customers'), '/customers');
    assert.equal(sanitizeReturnTo('javascript:alert(1)', '/customers'), '/customers');
    assert.equal(sanitizeReturnTo('//evil.com', '/customers'), '/customers');
  });

  it('builds detail path with encoded returnTo', () => {
    const path = withReturnToPath('/customers/abc', '/customers?page=2&search=test');
    assert.match(path, /^\/customers\/abc\?returnTo=/);
    assert.ok(path.includes(encodeURIComponent('/customers?page=2&search=test')));
  });
});

describe('SKU exact search + PO remainder display', () => {
  it('SKU 2188 returns only exact match', () => {
    const rows = [
      { id: '1', sku: '2188', name: 'Exact' },
      { id: '2', sku: '21880', name: 'Partial sku' },
      { id: '3', sku: '1000', name: 'Has 2188 in name? no' },
      { id: '4', sku: '999', name: 'Cable 2188mm' },
    ];
    const filtered = filterProductsBySearchTerm(rows, '2188');
    assert.deepEqual(
      filtered.map((r) => r.id),
      ['1'],
    );
  });

  it('overpay shows debt 0 and excess advance, never negative remaining', () => {
    const rem = computePurchaseRemainder(15000, 10000);
    assert.equal(rem.debt, 0);
    assert.equal(rem.excess, 5000);
    assert.ok(rem.remainder < 0); // raw math
    assert.equal(Math.max(0, rem.remainder), 0); // display debt
  });
});
