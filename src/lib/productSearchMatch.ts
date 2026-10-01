/**
 * Product list search match helper — keeps UI from showing stale non-matches
 * while a debounced server request is in flight.
 *
 * Exact SKU/barcode wins: if any product matches the term exactly on SKU or
 * barcode, only those exact hits are kept (no fuzzy name/partial SKU noise).
 *
 * Normalization: trim, case-fold, strip spaces/dashes/underscores/specials —
 * but NEVER strip leading zeros (`00465` stays distinct from `465`).
 */

export type ProductSearchFields = {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  article?: string | null;
  brand?: string | null;
  product_name?: string | null;
  product_sku?: string | null;
  product_barcode?: string | null;
};

/** Normalize product codes for exact compare without dropping leading zeros. */
export function normalizeProductCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('uz-UZ')
    .replace(/[\s\-_./\\]+/g, '');
}

/**
 * Shared FE/BE revision search normalize:
 * lowercase + strip everything except letters/digits.
 */
export function normalizeProductSearchValue(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whitespace-split then normalize each token. */
export function revisionSearchTokens(query: unknown): string[] {
  const raw = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((part) => normalizeProductSearchValue(part))
    .filter((t) => t.length > 0);
}

export function buildRevisionSearchHaystack(product: ProductSearchFields): string {
  return normalizeProductSearchValue(
    [
      product.name,
      product.product_name,
      product.sku,
      product.product_sku,
      product.barcode,
      product.product_barcode,
      product.article,
      product.brand,
    ]
      .filter((v) => v != null && String(v).trim() !== '')
      .join(' '),
  );
}

/** Partial includes + multi-token AND across name/sku/barcode/article/brand. */
export function matchesRevisionProductSearch(
  product: ProductSearchFields,
  query: unknown,
): boolean {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return true;
  if (trimmed.length < 2) return false;
  const tokens = revisionSearchTokens(trimmed);
  if (!tokens.length) return false;
  const hay = buildRevisionSearchHaystack(product);
  if (!hay) return false;
  return tokens.every((t) => hay.includes(t));
}

/** Safe display/search normalize (null/number safe). */
export function normalizeSearchValue(value?: string | number | null): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('uz-UZ');
}

/**
 * Cable/spec style queries: digits separated by punctuation (`2*4`, `2*2.5`).
 * Stripped matching alone (`24` ⊂ `24w`) is too noisy for these.
 */
export function isPunctuatedSpecQuery(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (s.length < 3) return false;
  return /\d[^\p{L}\p{N}\s]+\d/u.test(s);
}

/** Literal / near-literal forms of a punctuated spec (`2*4` → `2x4`, `2-4`, …). */
export function expandPunctuatedSpecForms(raw: unknown): string[] {
  const lower = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!lower) return [];
  const forms = new Set<string>([lower]);
  for (const sep of ['*', 'x', '×', 'х', '-', '/', ' ']) {
    forms.add(lower.replace(/[*x×х\-/.\s]+/gi, sep));
  }
  // Keep decimal digits: 2*2.5 → 2x2.5 (do not strip the `.` between 2 and 5)
  forms.add(lower.replace(/\*/g, 'x'));
  forms.add(lower.replace(/\*/g, '×'));
  forms.add(lower.replace(/\*/g, '-'));
  forms.add(lower.replace(/\*/g, '/'));
  forms.add(lower.replace(/\*/g, ' '));
  return [...forms].filter((f) => f.length >= 2);
}

/** True if any name/sku/… field contains a literal (or near-literal) spec form. */
export function productHasLiteralSpecMatch(
  product: ProductSearchFields,
  rawQuery: unknown,
): boolean {
  const forms = expandPunctuatedSpecForms(rawQuery);
  if (!forms.length) return false;
  const fields = [
    product.name,
    product.product_name,
    product.sku,
    product.product_sku,
    product.barcode,
    product.product_barcode,
    product.article,
    product.brand,
  ];
  for (const field of fields) {
    const text = String(field ?? '').toLowerCase();
    if (!text) continue;
    for (const form of forms) {
      if (text.includes(form)) return true;
    }
  }
  return false;
}

export function productHasExactCodeMatch(
  product: ProductSearchFields,
  rawTerm: string | null | undefined,
): boolean {
  const termNorm = normalizeProductCode(rawTerm);
  if (!termNorm) return false;
  return (
    normalizeProductCode(product.sku) === termNorm ||
    normalizeProductCode(product.barcode) === termNorm
  );
}

/** Fuzzy match across name / SKU / article / barcode / brand (substring). */
export function productMatchesSearchTermFuzzy(
  product: ProductSearchFields,
  rawTerm: string | null | undefined,
): boolean {
  const term = String(rawTerm || '').trim();
  if (!term) return true;
  // Prefer punctuation-insensitive includes (same as revision search).
  if (matchesRevisionProductSearch(product, term)) return true;
  const lower = term.toLowerCase();
  const name = String(product.name || '').toLowerCase();
  const sku = String(product.sku || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const brand = String(product.brand || '').toLowerCase();
  return name.includes(lower) || sku.includes(lower) || barcode.includes(lower) || brand.includes(lower);
}

/**
 * Single-row match used while a list is already scoped.
 * Prefer {@link filterProductsBySearchTerm} when filtering a full list so
 * exact SKU/barcode can suppress unrelated substring hits.
 */
export function productMatchesSearchTerm(
  product: ProductSearchFields,
  rawTerm: string | null | undefined,
): boolean {
  const term = String(rawTerm || '').trim();
  if (!term) return true;
  if (productHasExactCodeMatch(product, term)) return true;
  // `2*4` must not keep every product that merely contains digits "24".
  if (isPunctuatedSpecQuery(term)) {
    return productHasLiteralSpecMatch(product, term);
  }
  return productMatchesSearchTermFuzzy(product, term);
}

/** Filter a product list with exact-SKU/barcode precedence. */
export function filterProductsBySearchTerm<T extends ProductSearchFields>(
  products: T[],
  rawTerm: string | null | undefined,
): T[] {
  const term = String(rawTerm || '').trim();
  if (!term) return products;
  const exact = products.filter((p) => productHasExactCodeMatch(p, term));
  if (exact.length > 0) return exact;
  if (isPunctuatedSpecQuery(term)) {
    const literal = products.filter((p) => productHasLiteralSpecMatch(p, term));
    if (literal.length > 0) return literal;
    // No literal cable/spec hit — fall back to fuzzy so typos still work.
  }
  return products.filter((p) => productMatchesSearchTermFuzzy(p, term));
}
