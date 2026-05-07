'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rankProductForQuery, expandQueryTokens } = require('./lib/searchRank.cjs');

test('expandQueryTokens adds typo-tolerant and synonym variants', () => {
  const tokens = expandQueryTokens('telefon');
  assert.ok(tokens.includes('telefon'));
  assert.ok(tokens.includes('telefo'));
  assert.ok(tokens.includes('tel'));
});

test('rankProductForQuery boosts close typo matches', () => {
  const product = { name: 'Avto moy 5W-40', sku: 'AM540', barcode: '99887766' };
  const typoScore = rankProductForQuery(product, 'avtod');
  const farScore = rankProductForQuery(product, 'banan');
  assert.ok(typoScore > 0);
  assert.ok(typoScore > farScore);
});
