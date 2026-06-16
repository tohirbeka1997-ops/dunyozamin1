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
