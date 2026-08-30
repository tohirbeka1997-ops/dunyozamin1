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
};

/** Normalize product codes for exact compare without dropping leading zeros. */
export function normalizeProductCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
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
  const term = String(rawTerm || '').trim().toLowerCase();
  if (!term) return true;
  const termNorm = normalizeProductCode(term);
  const name = String(product.name || '').toLowerCase();
  const sku = String(product.sku || '').toLowerCase();
  const barcode = String(product.barcode || '').toLowerCase();
  const article = normalizeProductCode(product.article);
  const brand = String(product.brand || '').toLowerCase();
  return (
    name.includes(term) ||
    sku.includes(term) ||
    barcode.includes(term) ||
    (termNorm.length > 0 && article.includes(termNorm)) ||
    brand.includes(term) ||
    (termNorm.length > 0 && normalizeProductCode(product.sku).includes(termNorm)) ||
    (termNorm.length > 0 && normalizeProductCode(product.barcode).includes(termNorm))
  );
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
