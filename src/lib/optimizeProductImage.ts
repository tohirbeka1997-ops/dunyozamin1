/**
 * Product catalog images are shown at ~400px in mini-app/POS; 1200px covers 2x retina.
 * Raw picks may be up to 8 MB — compress in the renderer before IPC/HTTP upload.
 */
export const PRODUCT_IMAGE_MAX_WIDTH = 1200;
export const PRODUCT_IMAGE_MAX_HEIGHT = 1200;
export const PRODUCT_IMAGE_JPEG_QUALITY = 0.82;
/** Skip recompress when already small enough for catalog display. */
export const PRODUCT_IMAGE_SKIP_BYTES = 200 * 1024;

export type OptimizedProductImage = {
  file: File;
  skipped: boolean;
  originalBytes: number;
  optimizedBytes: number;
};

let webpSupported: boolean | null = null;

function detectWebpSupport(): boolean {
  if (webpSupported != null) return webpSupported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpSupported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupported = false;
  }
  return webpSupported;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Rasmni o‘qib bo‘lmadi'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Rasmni siqib bo‘lmadi'))),
      type,
      quality,
    );
  });
}

function outputName(originalName: string, ext: '.webp' | '.jpg'): string {
  const base = String(originalName || 'product-image')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.[^.]+$/, '');
  return `${base || 'product-image'}${ext}`;
}

/**
 * Resize and compress a picked image before upload. GIFs and already-small JPEGs/WebPs are left as-is.
 */
export async function optimizeProductImageFile(file: File): Promise<OptimizedProductImage> {
  if (!/^image\//.test(file.type || '')) {
    throw new Error('Faqat rasm fayllarini yuklash mumkin');
  }

  const originalBytes = file.size;
  if (file.type === 'image/gif') {
    return { file, skipped: true, originalBytes, optimizedBytes: originalBytes };
  }

  const { width, height } = await readImageDimensions(file);
  const withinDims =
    width <= PRODUCT_IMAGE_MAX_WIDTH && height <= PRODUCT_IMAGE_MAX_HEIGHT;
  if (originalBytes <= PRODUCT_IMAGE_SKIP_BYTES && withinDims) {
    return { file, skipped: true, originalBytes, optimizedBytes: originalBytes };
  }

  const scale = Math.min(1, PRODUCT_IMAGE_MAX_WIDTH / width, PRODUCT_IMAGE_MAX_HEIGHT / height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Rasmni o‘qib bo‘lmadi'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Rasmni qayta ishlash mumkin emas');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const useWebp = detectWebpSupport();
    const mime = useWebp ? 'image/webp' : 'image/jpeg';
    const ext = useWebp ? '.webp' : '.jpg';
    const blob = await canvasToBlob(canvas, mime, PRODUCT_IMAGE_JPEG_QUALITY);
    const optimized = new File([blob], outputName(file.name, ext), { type: mime });

    return {
      file: optimized,
      skipped: false,
      originalBytes,
      optimizedBytes: optimized.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
