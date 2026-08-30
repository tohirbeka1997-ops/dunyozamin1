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
  return products.filter((p) => productMatchesSearchTermFuzzy(p, term));
}
