import { uploadProductImage, readLocalImageFile } from '@/lib/uploadProductImage';

export { readLocalImageFile };

function categoryImageKey(categoryIdOrTempId: string): string {
  const raw = String(categoryIdOrTempId || '').trim() || `temp-${Date.now()}`;
  return raw.startsWith('cat-') ? raw : `cat-${raw}`;
}

/** Resize (if needed) and persist a category icon image (same storage as product images). */
export async function uploadCategoryImage(
  file: File,
  categoryIdOrTempId: string,
  sourcePath?: string | null,
): Promise<string | null> {
  return uploadProductImage(file, categoryImageKey(categoryIdOrTempId), 0, sourcePath);
}
