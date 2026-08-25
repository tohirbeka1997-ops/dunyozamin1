import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { optimizeProductImageFile } from '@/lib/optimizeProductImage';

function extFromFileName(name: string): string {
  const match = String(name || '').match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '.jpg';
}

function mimeFromFileName(name: string): string {
  const ext = extFromFileName(name);
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/jpeg';
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Read a dialog-picked image via IPC (avoids blocked file:// fetch from http:// dev server). */
export async function readLocalImageFile(filePath: string): Promise<File> {
  const api = getElectronAPI();
  if (!api?.files?.readFileBuffer) {
    throw new Error('Rasmni o‘qib bo‘lmadi');
  }
  const raw = await handleIpcResponse<ArrayBuffer | ArrayBufferView>(api.files.readFileBuffer(filePath));
  const name = filePath.replace(/^.*[/\\]/, '') || 'image.jpg';
  return new File([toArrayBuffer(raw)], name, { type: mimeFromFileName(name) });
}

type UploadTarget =
  | { kind: 'remoteApi' }
  | { kind: 'http'; baseUrl: string; bearer: string }
  | { kind: 'local' };

async function resolveUploadTarget(): Promise<UploadTarget> {
  const api = getElectronAPI();
  if (!api) return { kind: 'local' };

  if (typeof api.files?.uploadProductImage === 'function' && api._session) {
    return { kind: 'remoteApi' };
  }

  if (typeof api.appConfig?.get === 'function') {
    try {
      const cfg = await handleIpcResponse<{
        mode?: string;
        client?: { hostUrl?: string; secret?: string };
      }>(api.appConfig.get());
      if (cfg?.mode === 'client') {
        const baseUrl = String(cfg?.client?.hostUrl || '').trim();
        const bearer = String(cfg?.client?.secret || '').trim();
        if (baseUrl && bearer) {
          return { kind: 'http', baseUrl, bearer };
        }
      }
    } catch {
      // fall back to local IPC
    }
  }

  return { kind: 'local' };
}

async function uploadProductImageOverHttp(
  baseUrl: string,
  bearer: string,
  file: File,
  productIdOrTempId: string,
  index: number,
): Promise<string | null> {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/uploads/product-images`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': file.name || 'product-image',
      'X-Product-Id': productIdOrTempId,
      'X-Image-Index': String(index),
    },
    body: file,
  });
  const payload = await res.json().catch(() => null);
  if (!payload || payload.ok !== true) {
    const msg = payload?.error?.message || `Upload failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return payload.data?.fileUrl || payload.data?.url || null;
}

/**
 * Resize (if needed) and persist a product image.
 * HOST desktop → local userData/product-images.
 * CLIENT desktop → HTTP upload to HOST (shared catalog).
 * Web RPC → remotePosApi HTTP upload.
 */
export async function uploadProductImage(
  file: File,
  productIdOrTempId: string,
  index: number,
  sourcePath?: string | null,
): Promise<string | null> {
  const api = getElectronAPI();
  if (!api?.files) throw new Error('Rasmni saqlab bo‘lmadi');

  const target = await resolveUploadTarget();
  const optimized = await optimizeProductImageFile(file);
  const uploadFile = optimized.file;

  if (target.kind === 'remoteApi' && typeof api.files.uploadProductImage === 'function') {
    const saved = await handleIpcResponse<{ fileUrl?: string }>(
      api.files.uploadProductImage(uploadFile, productIdOrTempId, index),
    );
    return saved?.fileUrl || null;
  }

  if (target.kind === 'http') {
    return uploadProductImageOverHttp(
      target.baseUrl,
      target.bearer,
      uploadFile,
      productIdOrTempId,
      index,
    );
  }

  if (optimized.skipped && sourcePath && typeof api.files.saveProductImage === 'function') {
    const saved = await handleIpcResponse<{ fileUrl?: string }>(
      api.files.saveProductImage(sourcePath, productIdOrTempId, index),
    );
    if (saved?.fileUrl) return saved.fileUrl;
  }

  if (typeof api.files.saveProductImageBuffer === 'function') {
    const buf = await uploadFile.arrayBuffer();
    const saved = await handleIpcResponse<{ fileUrl?: string }>(
      api.files.saveProductImageBuffer(buf, productIdOrTempId, index, extFromFileName(uploadFile.name)),
    );
    return saved?.fileUrl || null;
  }

  if (sourcePath && typeof api.files.saveProductImage === 'function') {
    const saved = await handleIpcResponse<{ fileUrl?: string }>(
      api.files.saveProductImage(sourcePath, productIdOrTempId, index),
    );
    return saved?.fileUrl || null;
  }

  throw new Error('Rasmni saqlab bo‘lmadi');
}
