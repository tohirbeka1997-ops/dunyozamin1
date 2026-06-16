import { apiUrl } from './api';

/**
 * Resolve product image URL for the mini-app (HTTP catalog paths, legacy product-image://).
 */
export function resolveProductImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const u = imageUrl.trim();
  if (!u) return null;
  if (u.startsWith('data:')) return null;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('product-image://')) {
    const name = decodeURIComponent(u.replace(/^product-image:\/\//, '')).replace(/^\/+/, '');
    const safe = name.split(/[/\\]/).pop()?.replace(/\.\./g, '');
    if (!safe) return null;
    return apiUrl(`/product-images/${encodeURIComponent(safe)}`);
  }
  if (u.startsWith('/product-images/')) {
    return apiUrl(u);
  }
  return null;
}
