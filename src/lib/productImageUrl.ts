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
  if (url.startsWith('file://')) {
    const filename = url.split('/').pop() || url.split('\\').pop();
    if (filename) return `product-image://${filename}`;
  }
  return url;
}
