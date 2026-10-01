/**
 * Multi-token POS search matching (mirrors productSearchMatch.ts).
 * Run: node --test src/lib/__tests__/productSearchMatch.node.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function normalizeProductSearchValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function revisionSearchTokens(query) {
  const raw = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((part) => normalizeProductSearchValue(part))
    .filter((t) => t.length > 0);
}

function matchesRevisionProductSearch(product, query) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return true;
  if (trimmed.length < 2) return false;
  const tokens = revisionSearchTokens(trimmed);
  if (!tokens.length) return false;
  const hay = normalizeProductSearchValue(
    [product.name, product.sku, product.barcode, product.article, product.brand]
      .filter((v) => v != null && String(v).trim() !== '')
      .join(' '),
  );
  if (!hay) return false;
  return tokens.every((t) => hay.includes(t));
}

function isPunctuatedSpecQuery(raw) {
  const s = String(raw ?? '').trim();
  if (s.length < 3) return false;
  return /\d[^\p{L}\p{N}\s]+\d/u.test(s);
}

function expandPunctuatedSpecForms(raw) {
  const lower = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!lower) return [];
  const forms = new Set([lower]);
  for (const sep of ['*', 'x', '×', 'х', '-', '/', ' ']) {
    forms.add(lower.replace(/[*x×х\-/.\s]+/gi, sep));
  }
  forms.add(lower.replace(/\*/g, 'x'));
  forms.add(lower.replace(/\*/g, '×'));
  forms.add(lower.replace(/\*/g, '-'));
  forms.add(lower.replace(/\*/g, '/'));
  forms.add(lower.replace(/\*/g, ' '));
  return [...forms].filter((f) => f.length >= 2);
}

function productHasLiteralSpecMatch(product, rawQuery) {
  const forms = expandPunctuatedSpecForms(rawQuery);
  if (!forms.length) return false;
  const fields = [product.name, product.sku, product.barcode, product.article, product.brand];
  for (const field of fields) {
    const text = String(field ?? '').toLowerCase();
    if (!text) continue;
    for (const form of forms) {
      if (text.includes(form)) return true;
    }
  }
  return false;
}

function filterProductsBySearchTerm(products, rawTerm) {
  const term = String(rawTerm || '').trim();
  if (!term) return products;
  if (isPunctuatedSpecQuery(term)) {
    const literal = products.filter((p) => productHasLiteralSpecMatch(p, term));
    if (literal.length > 0) return literal;
  }
  return products.filter((p) => matchesRevisionProductSearch(p, term));
}

test('revision tokens strip spaces/punct', () => {
  assert.deepEqual(revisionSearchTokens('p oq'), ['p', 'oq']);
  assert.deepEqual(revisionSearchTokens('P-oq'), ['poq']);
  assert.equal(normalizeProductSearchValue('P oq 1004'), 'poq1004');
});

test('"p oq" matches P oq 1004 but not unrelated P… names', () => {
  assert.equal(matchesRevisionProductSearch({ name: 'P oq 1004' }, 'p oq'), true);
  assert.equal(matchesRevisionProductSearch({ name: 'Plastic bowl' }, 'p oq'), false);
  assert.equal(matchesRevisionProductSearch({ name: 'P oq 1006', sku: 'X' }, 'p oq'), true);
});

test('punctuated spec detects 2*4 / 2*2.5', () => {
  assert.equal(isPunctuatedSpecQuery('2*4'), true);
  assert.equal(isPunctuatedSpecQuery('2*2.5'), true);
  assert.equal(isPunctuatedSpecQuery('24'), false);
  assert.equal(isPunctuatedSpecQuery('kabel'), false);
});

test('"2*4" literal beats 24w stripped match', () => {
  const products = [
    { name: '24w N krug-Mizar' },
    { name: 'blok pitaniya diyod 24V 100W' },
    { name: 'Kabel APUNP 2*4 Kontakt' },
    { name: 'Kabel APUNP 2*4 Solid' },
  ];
  const filtered = filterProductsBySearchTerm(products, '2*4');
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((p) => String(p.name).includes('2*4')));
  assert.equal(productHasLiteralSpecMatch({ name: 'Kabel APUNP 2*4 Kontakt' }, '2*4'), true);
  assert.equal(productHasLiteralSpecMatch({ name: '24w N krug-Mizar' }, '2*4'), false);
});

test('"2*2.5" literal beats AR88-22/25 stripped 225', () => {
  const products = [
    { name: 'Aelifv PUSK/STOP AR88-22/25' },
    { name: 'Invertor svarka EPA MMA-250 FI-2 (250 A)' },
    { name: 'Kabel APUNP 2*2.5 Kontakt' },
    { name: 'Kabel APUNP 2*2.5 Solid' },
  ];
  const filtered = filterProductsBySearchTerm(products, '2*2.5');
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((p) => String(p.name).includes('2*2.5')));
});
