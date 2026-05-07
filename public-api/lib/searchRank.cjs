'use strict';

const SYNONYM_GROUPS = [
  ['tel', 'telefon', 'raqam', 'nomer', 'number'],
  ['ichimlik', 'suv', 'cola', 'fanta', 'pepsi'],
  ['non', 'bread', 'lepeshka'],
  ['sut', 'milk'],
  ['shakar', 'sugar'],
];

const SYNONYM_INDEX = new Map();
for (const group of SYNONYM_GROUPS) {
  const normalizedGroup = group.map((s) => normalizeToken(s));
  for (const key of normalizedGroup) {
    SYNONYM_INDEX.set(key, normalizedGroup.filter((x) => x !== key));
  }
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[`'’‘ʻʼ]/g, '')
    .replace(/[^a-z0-9а-яёқғҳў\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(input) {
  return normalizeText(input).replace(/\s+/g, '');
}

function tokenize(input) {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function boundedEditDistance(a, b, maxDistance = 1) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  if (Math.abs(a.length - b.length) > maxDistance) return Number.MAX_SAFE_INTEGER;
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let left = i;
    let diag = i - 1;
    let minRow = left;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        prev[j] + 1,
        left + 1,
        diag + cost,
      );
      prev[j] = left;
      left = val;
      diag = up;
      if (val < minRow) minRow = val;
    }
    prev[b.length] = left;
    if (minRow > maxDistance) return Number.MAX_SAFE_INTEGER;
  }
  return prev[b.length];
}

function expandQueryTokens(query) {
  const base = tokenize(query);
  const expanded = new Set(base);
  for (const token of base) {
    if (token.length > 3) expanded.add(token.slice(0, -1));
    const syn = SYNONYM_INDEX.get(normalizeToken(token)) || [];
    for (const s of syn) expanded.add(s);
  }
  return Array.from(expanded).filter(Boolean);
}

function rankProductForQuery(product, query) {
  const qText = normalizeText(query);
  if (!qText) return 0;
  const name = normalizeText(product?.name || '');
  const sku = normalizeText(product?.sku || '');
  const barcode = normalizeText(product?.barcode || '');
  const haystack = [name, sku, barcode].filter(Boolean).join(' ');
  if (!haystack) return 0;

  let score = 0;
  if (name === qText || sku === qText || barcode === qText) score += 220;
  if (name.startsWith(qText) || sku.startsWith(qText)) score += 130;
  if (haystack.includes(qText)) score += 80;

  const queryTokens = expandQueryTokens(qText);
  const productTokens = new Set(tokenize(haystack));
  for (const qt of queryTokens) {
    if (productTokens.has(qt)) {
      score += 36;
      continue;
    }
    if (name.includes(qt) || sku.includes(qt) || barcode.includes(qt)) {
      score += 15;
      continue;
    }
    let fuzzyHit = false;
    for (const pt of productTokens) {
      if (boundedEditDistance(qt, pt, 1) <= 1) {
        fuzzyHit = true;
        break;
      }
    }
    if (fuzzyHit) score += 8;
  }
  return score;
}

module.exports = {
  normalizeText,
  tokenize,
  expandQueryTokens,
  rankProductForQuery,
};
