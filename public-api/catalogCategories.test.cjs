'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pruneOrphanCategories } = require('./routes/catalog.cjs');

test('keeps a fully-visible hierarchy intact', () => {
  const rows = [
    { id: 'san', parent_id: null },
    { id: 'fit', parent_id: 'san' },
    { id: 'kran', parent_id: 'fit' },
    { id: 'shar', parent_id: 'kran' },
    { id: 'ibar', parent_id: 'kran' },
  ];
  const kept = pruneOrphanCategories(rows).map((r) => r.id);
  assert.deepEqual(kept.sort(), ['fit', 'ibar', 'kran', 'san', 'shar']);
});

test('cascades removal: a hidden parent drops its visible descendants', () => {
  // `hidden` was filtered out by the marketplace WHERE clause before this
  // function runs, so it is simply absent from the input. Its visible child
  // `orphan` and grandchild `deep` must not survive as unreachable orphans.
  const rows = [
    { id: 'san', parent_id: null },
    { id: 'fit', parent_id: 'san' },
    { id: 'orphan', parent_id: 'hidden' },
    { id: 'deep', parent_id: 'orphan' },
  ];
  const kept = pruneOrphanCategories(rows).map((r) => r.id);
  assert.deepEqual(kept.sort(), ['fit', 'san']);
});

test('treats numeric ids and string parent ids consistently', () => {
  const rows = [
    { id: 1, parent_id: null },
    { id: 2, parent_id: 1 },
    { id: 3, parent_id: 99 },
  ];
  const kept = pruneOrphanCategories(rows).map((r) => String(r.id));
  assert.deepEqual(kept.sort(), ['1', '2']);
});

test('root-only list is unchanged', () => {
  const rows = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: null },
  ];
  assert.equal(pruneOrphanCategories(rows).length, 2);
});
