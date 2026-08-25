import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import LabelElementVisual from './LabelElementVisual';
import type {
  LabelElement,
  LabelPreviewData,
  LegacyProductLabelElement,
  ProductLabelElementId,
} from '@/lib/barcodes/labelModel';
import {
  defaultProductLabelLayout,
  DEMO_PREVIEW_DATA,
  migrateLegacyLayout,
  normalizeElements,
  roundMm,
  sortByZ,
} from '@/lib/barcodes/labelModel';

export type ProductLabelBarcodeType = 'EAN13' | 'CODE128' | 'QR';

/** @deprecated use LabelElement */
export type ProductLabelElement = LegacyProductLabelElement;

export { defaultProductLabelLayout, migrateLegacyLayout };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'bc' | 'ml' | 'mr';

export default function ProductLabelLayoutEditor({
  widthMm,
  heightMm,
  previewData = DEMO_PREVIEW_DATA,
  background,
  showGrid = false,
  gridSizeMm = 1,
  snapToGrid = false,
  showSafeArea = false,
  safePaddingMm = 1,
  pxPerMm = 6,
  value,
  onChange,
  selectedId,
  onSelect,
  className,
  showRulers = false,
}: {
  widthMm: number;
  heightMm: number;
  previewData?: LabelPreviewData;
  background?: string;
  showGrid?: boolean;
  gridSizeMm?: number;
  snapToGrid?: boolean;
  showSafeArea?: boolean;
  safePaddingMm?: number;
  pxPerMm?: number;
  value: LabelElement[] | LegacyProductLabelElement[];
  onChange: (next: LabelElement[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  showRulers?: boolean;
}) {
  const elements = useMemo(() => sortByZ(normalizeElements(value as LabelElement[])), [value]);
  const [drag, setDrag] = useState<null | {
    id: string;
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    startEl: LabelElement;
  }>(null);

  const stepMm = snapToGrid ? Math.max(0.1, Number(gridSizeMm) || 1) : 0.5;
  const safeW = Math.max(10, Number(widthMm) || 39);
  const safeH = Math.max(10, Number(heightMm) || 20);
  const pxW = safeW * pxPerMm;
  const pxH = safeH * pxPerMm;
  const safePadPx = Math.max(0, Number(safePaddingMm) || 0) * pxPerMm;
  const gridSizePx = Math.max(2, (Number(gridSizeMm) || 1) * pxPerMm);

  const byId = useMemo(() => {
    const m = new Map<string, LabelElement>();
    elements.forEach((e) => m.set(e.id, e));
    return m;
  }, [elements]);

  const updateEl = (id: string, patch: Partial<LabelElement>) => {
    onChange(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const applyResize = (el: LabelElement, handle: ResizeHandle, dxMm: number, dyMm: number): Partial<LabelElement> => {
    let { x, y, w, h } = el;
    if (handle.includes('l')) {
      const nx = roundMm(x + dxMm, stepMm);
      w = roundMm(w - (nx - x), stepMm);
      x = nx;
    }
    if (handle.includes('r')) {
      w = roundMm(w + dxMm, stepMm);
    }
    if (handle.includes('t')) {
      const ny = roundMm(y + dyMm, stepMm);
      h = roundMm(h - (ny - y), stepMm);
      y = ny;
    }
    if (handle.includes('b')) {
      h = roundMm(h + dyMm, stepMm);
    }
    w = clamp(w, 0.5, safeW);
    h = clamp(h, 0.3, safeH);
    x = clamp(x, 0, safeW - w);
    y = clamp(y, 0, safeH - h);
    const patch: Partial<LabelElement> = { x, y, w, h };
    if (el.kind === 'text' && (handle.includes('b') || handle.includes('t'))) {
      patch.fontSizePt = Math.max(6, Math.round(h * 2.4));
    }
    return patch;
  };

  const onPointerDownMove = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = byId.get(id);
    if (!el) return;
    if (el.locked) {
      onSelect(id);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(id);
    setDrag({ id, mode: 'move', startX: e.clientX, startY: e.clientY, startEl: el });
  };

  const onPointerDownResize = (e: React.PointerEvent, id: string, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = byId.get(id);
    if (!el || el.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(id);
    setDrag({
      id,
      mode: 'resize',
      handle: handle as ResizeHandle,
      startX: e.clientX,
      startY: e.clientY,
      startEl: el,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const dxMm = roundMm((e.clientX - drag.startX) / pxPerMm, stepMm);
    const dyMm = roundMm((e.clientY - drag.startY) / pxPerMm, stepMm);

    if (drag.mode === 'move') {
      const nextX = clamp(roundMm(drag.startEl.x + dxMm, stepMm), 0, safeW - drag.startEl.w);
      const nextY = clamp(roundMm(drag.startEl.y + dyMm, stepMm), 0, safeH - drag.startEl.h);
      updateEl(drag.id, { x: nextX, y: nextY });
      return;
    }

    if (drag.handle) {
      updateEl(drag.id, applyResize(drag.startEl, drag.handle, dxMm, dyMm));
    }
  };

  const onPointerUp = () => setDrag(null);

  const nudgeSelected = (dxMm: number, dyMm: number) => {
    if (!selectedId) return;
    const el = byId.get(selectedId);
    if (!el || el.locked) return;
    updateEl(selectedId, {
      x: clamp(roundMm(el.x + dxMm, 0.1), 0, safeW - el.w),
      y: clamp(roundMm(el.y + dyMm, 0.1), 0, safeH - el.h),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) {
        e.preventDefault();
        onChange(elements.filter((el) => el.id !== selectedId));
        onSelect(null);
      }
      return;
    }
    if (!selectedId) return;
    const base = e.altKey ? 0.1 : e.shiftKey ? 1 : 0.5;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeSelected(-base, 0);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeSelected(base, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudgeSelected(0, -base);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudgeSelected(0, base);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className={cn('relative', className)}>
      {showRulers && (
        <>
          <div className="absolute top-0 left-[18px] right-0 h-[18px] bg-white border-b border-border pointer-events-none z-10" />
          <div className="absolute top-0 left-0 bottom-0 w-[18px] bg-white border-r border-border pointer-events-none z-10" />
        </>
      )}
      <div
        ref={containerRef}
        className={cn(
          'relative rounded border overflow-hidden select-none touch-none focus:outline-none focus:ring-2 focus:ring-primary/40',
          showRulers && 'mt-[18px] ml-[18px]'
        )}
        style={{
          width: pxW,
          height: pxH,
          background: background || '#fff',
          backgroundImage: showGrid
            ? `linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)`
            : undefined,
          backgroundSize: showGrid ? `${gridSizePx}px ${gridSizePx}px` : undefined,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={() => onSelect(null)}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {elements.map((el) => (
          <LabelElementVisual
            key={el.id}
            el={el}
            previewData={previewData}
            pxPerMm={pxPerMm}
            selected={selectedId === el.id}
            onPointerDownMove={(ev) => onPointerDownMove(ev, el.id)}
            onPointerDownResize={(ev, handle) => onPointerDownResize(ev, el.id, handle)}
          />
        ))}
        {showSafeArea && safePadPx > 0 && (
          <div
            className="pointer-events-none absolute border border-dashed border-muted-foreground/40 rounded-sm"
            style={{ inset: safePadPx }}
          />
        )}
      </div>
    </div>
  );
}

/** Legacy locked ids helper */
export function legacyLockedIds(lockedIds: ProductLabelElementId[]): string[] {
  return lockedIds;
}
