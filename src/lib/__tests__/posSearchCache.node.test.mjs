import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PosSearchCache } from '../posSearchCache.ts';

describe('stale search sequence', () => {
  it('ignores older async results when sequence advances', () => {
    let seq = 0;
    let displayed = [];
    const run = async (term) => {
      const mySeq = ++seq;
      await new Promise((r) => setTimeout(r, term === 'slow' ? 30 : 5));
      if (mySeq === seq) displayed = [term];
    };
    return Promise.all([run('slow'), run('fast')]).then(() => {
      assert.deepEqual(displayed, ['fast']);
    });
  });
});

describe('PosSearchCache', () => {
  it('stores and retrieves by composite key', () => {
    const cache = new PosSearchCache(10, 60_000);
    const key = cache.buildKey('2188', null, 'wh1');
    cache.set(key, [{ id: 'p1' }]);
    assert.deepEqual(cache.get(key), [{ id: 'p1' }]);
  });

  it('returns null for missing keys', () => {
    const cache = new PosSearchCache();
    assert.equal(cache.get('missing'), null);
  });

  it('evicts oldest when over maxEntries', () => {
    const cache = new PosSearchCache(2, 60_000);
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]);
    assert.equal(cache.get('a'), null);
    assert.deepEqual(cache.get('b'), [2]);
    assert.deepEqual(cache.get('c'), [3]);
  });
});
