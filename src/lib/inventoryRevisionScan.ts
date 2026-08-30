/**
 * Inventory revision scan / search helpers (client-side).
 */

import {
  matchesRevisionProductSearch,
  normalizeProductSearchValue,
  revisionSearchTokens,
} from '@/lib/productSearchMatch';

export {
  matchesRevisionProductSearch,
  normalizeProductSearchValue,
  revisionSearchTokens,
};

export function cleanRevisionScanCode(raw: unknown): string {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Full barcode (8–14 digits) — scanner path: exact match only, immediate debounce.
 * Short tokens like `evn` / `2188` are NOT exact — they use partial name/SKU search.
 */
export function isRevisionExactCodeQuery(raw: unknown): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  const compact = s.replace(/\s+/g, '');
  return /^\d{8,14}$/.test(compact);
}

/** @deprecated alias — use isRevisionExactCodeQuery */
export const isRevisionExactBarcodeQuery = isRevisionExactCodeQuery;

export function createScanEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type PendingRevisionScan = {
  scan_event_id: string;
  barcode: string;
  created_at: number;
};
