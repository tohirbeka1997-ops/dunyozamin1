import type { Category } from '@/types/database';

/** Tanlangan kategoriya + barcha bolalar ID lari (marketplace filtri). */
export function getSubtreeCategoryIds(
  categories: Category[],
  categoryId: string | null
): string[] | null {
  if (!categoryId) return null;
  const root = String(categoryId).trim();
  if (!root) return null;
  const ids = new Set<string>([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories) {
      const pid = c.parent_id ? String(c.parent_id) : '';
      const id = String(c.id);
      if (pid && ids.has(pid) && !ids.has(id)) {
        ids.add(id);
        changed = true;
      }
    }
  }
  return [...ids];
}

export function productMatchesCategoryFilter(
  productCategoryId: string | null | undefined,
  selectedCategoryId: string | null,
  categories: Category[]
): boolean {
  if (!selectedCategoryId) return true;
  if (!productCategoryId) return false;
  const allowed = getSubtreeCategoryIds(categories, selectedCategoryId);
  return allowed?.includes(String(productCategoryId)) ?? false;
}

/** Kategoriya va barcha bolalar ID lari (ota tanlashda tsikl oldini olish). */
export function getCategoryDescendantIds(
  categories: Category[],
  categoryId: string
): string[] {
  const root = String(categoryId || '').trim();
  if (!root) return [];
  const ids: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of categories) {
      if (String(c.parent_id || '') === id) {
        const childId = String(c.id);
        ids.push(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
}

/** Ildizdan beri to'liq yo'l (Santexnika › Fiting › Atvod). */
export function getCategoryPathSegments(
  categories: Category[],
  categoryId: string | null | undefined
): Category[] {
  if (!categoryId) return [];
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const path: Category[] = [];
  const seen = new Set<string>();
  let current: string | null = String(categoryId);
  while (current && byId.has(current) && !seen.has(current)) {
    seen.add(current);
    const cat = byId.get(current)!;
    path.unshift(cat);
    current = cat.parent_id ? String(cat.parent_id) : null;
  }
  return path;
}

export function formatCategoryPath(
  categories: Category[],
  categoryId: string | null | undefined,
  separator = ' › '
): string | null {
  const segments = getCategoryPathSegments(categories, categoryId);
  if (segments.length === 0) return null;
  return segments.map((s) => s.name).join(separator);
}

/** Marketplace pill ro'yxati: faol + katalogda ko'rinadigan. */
export function getMarketplaceCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => c.is_active !== false && c.show_in_marketplace !== false)
    .sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (so !== 0) return so;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}
