/**
 * Normalize product image URL for display.
 * - product-image://filename → use as-is (our custom protocol)
 * - file:///.../product-images/xxx.png → convert to product-image://xxx.png (legacy)
 * - http(s)://... → use as-is
 */
export function getProductImageDisplayUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const url = imageUrl.trim();
  if (!url) return null;
  if (url.startsWith('product-image://')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/product-images/')) {
    const filename = url.split('/').pop()?.split('?')[0];
    if (filename) return `product-image://${decodeURIComponent(filename)}`;
  }
  if (url.startsWith('file://')) {
    const filename = url.split('/').pop() || url.split('\\').pop();
    if (filename) return `product-image://${filename}`;
  }
  return url;
}

/** CSV import: only URLs safe for online catalog storage. */
export function normalizeImportImageUrl(raw: string | null | undefined): string | null {
  const u = String(raw ?? '').trim();
  if (!u) return null;
  if (/^data:image\//i.test(u)) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/product-images/')) return u;
  if (/^product-image:\/\//i.test(u)) {
    const fn = decodeURIComponent(u.replace(/^product-image:\/\//, ''))
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.\./g, '');
    return fn ? `/product-images/${fn}` : null;
  }
  return null;
}
