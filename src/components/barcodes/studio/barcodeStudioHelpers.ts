import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataField, ElementKind, LabelElement, LabelPreviewData, LabelSheetLayout, LabelTemplate } from '@/lib/barcodes/labelModel';
import { createPaletteElement, DEMO_PREVIEW_DATA, LABEL_SIZE_PRESETS, labelsPerSheet, newElementId, normalizeElements, sortByZ } from '@/lib/barcodes/labelModel';
import { BUILTIN_LABEL_TEMPLATES, cloneTemplate, getTemplatesBySize } from '@/lib/barcodes/builtinTemplates';

export type StudioView = 'designer' | 'gallery';

export function useUndoRedo<T>(initial: T) {
  const [history, setHistory] = useState<T[]>([initial]);
  const [index, setIndex] = useState(0);

  const present = history[index];

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setHistory((h) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(h[index]) : next;
        const trimmed = h.slice(0, index + 1);
        return [...trimmed, value];
      });
      setIndex((i) => i + 1);
    },
    [index]
  );

  const undo = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const redo = useCallback(() => setIndex((i) => Math.min(history.length - 1, i + 1)), [history.length]);

  return { present, set, undo, redo, canUndo: index > 0, canRedo: index < history.length - 1 };
}

export const PALETTE_ITEMS: Array<{ kind: ElementKind; data?: DataField; label: string }> = [
  { kind: 'text', data: 'product_name', label: 'Mahsulot nomi' },
  { kind: 'text', data: 'price', label: 'Narx' },
  { kind: 'text', data: 'old_price', label: 'Eski narx' },
  { kind: 'text', data: 'discount_pct', label: 'Chegirma %' },
  { kind: 'barcode', label: 'Barkod' },
  { kind: 'qr', label: 'QR kod' },
  { kind: 'text', data: 'sku', label: 'SKU' },
  { kind: 'text', data: 'date', label: 'Sana' },
  { kind: 'text', data: 'store_name', label: "Do'kon nomi" },
  { kind: 'image', label: 'Logo' },
  { kind: 'text', data: 'static_text', label: 'Matn' },
  { kind: 'text', data: 'unit', label: 'Birlik' },
  { kind: 'line', label: 'Chiziq' },
];

export function defaultSheetLayout(): LabelSheetLayout {
  return { paper: 'A4', cols: 4, rows: 6, gapMm: 2, marginMm: 5 };
}

export function loadTemplateIntoState(template: LabelTemplate) {
  return {
    templateId: template.id,
    templateName: template.name,
    widthMm: template.widthMm,
    heightMm: template.heightMm,
    background: template.background,
    elements: normalizeElements(template.elements),
    isBuiltin: Boolean(template.builtin),
  };
}

export function quickTemplatesForSize(w: number, h: number): LabelTemplate[] {
  return getTemplatesBySize(w, h).slice(0, 4);
}

export function addPaletteElement(elements: LabelElement[], item: (typeof PALETTE_ITEMS)[number], widthMm: number, heightMm: number): LabelElement[] {
  const el = createPaletteElement(item.kind, item.data, {
    x: Math.max(1, widthMm / 2 - 10),
    y: Math.max(1, heightMm / 2 - 5),
    z: elements.length,
  });
  if (item.kind === 'text' && item.data === 'static_text') {
    el.text = 'Matn';
  }
  return sortByZ([...elements, el]);
}

export function duplicateTemplate(template: LabelTemplate): LabelTemplate {
  return cloneTemplate(template, `${template.name} (nusxa)`);
}

export { BUILTIN_LABEL_TEMPLATES, DEMO_PREVIEW_DATA, LABEL_SIZE_PRESETS, labelsPerSheet };
