import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { cn } from '@/lib/utils';

export type ProductLabelElementId = 'header' | 'name' | 'sku' | 'price' | 'barcode';
export type ProductLabelBarcodeType = 'EAN13' | 'CODE128' | 'QR';

export type ProductLabelElement = {
  id: ProductLabelElementId;
  kind: 'text' | 'barcode';
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSizePt?: number;
  fontWeight?: number;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
  letterSpacingPt?: number;
  uppercase?: boolean;
};

export function defaultProductLabelLayout(widthMm: number, heightMm: number): ProductLabelElement[] {
  const w = Math.max(10, Number(widthMm) || 39);
  const h = Math.max(10, Number(heightMm) || 20);

  const isSmall = w <= 45 && h <= 25;
  const pad = isSmall ? 0.6 : 1.0;
  const headerH = isSmall ? 3.8 : 5.2;
  const nameH = isSmall ? 3.0 : 4.2;
  const priceH = isSmall ? 3.2 : 4.6;
  const barcodeH = Math.max(6, h - (pad * 2 + headerH + nameH + priceH));

  return [
    {
      id: 'header',
      kind: 'text',
      xMm: pad,
      yMm: pad,
      wMm: Math.max(10, w * 0.65 - pad),
      hMm: headerH,
      fontSizePt: isSmall ? 10 : 12,
      fontWeight: 800,
      align: 'left',
    },
    {
      id: 'sku',
      kind: 'text',
      xMm: w * 0.65,
      yMm: pad,
      wMm: Math.max(8, w * 0.35 - pad),
      hMm: headerH,
      fontSizePt: isSmall ? 7 : 8,
      fontWeight: 600,
      align: 'right',
    },
    {
      id: 'name',
      kind: 'text',
      xMm: pad,
      yMm: pad + headerH,
      wMm: w - pad * 2,
      hMm: nameH,
      fontSizePt: isSmall ? 8 : 9,
      fontWeight: 500,
      align: 'left',
    },
    {
      id: 'barcode',
      kind: 'barcode',
      xMm: pad,
      yMm: pad + headerH + nameH,
      wMm: w - pad * 2,
      hMm: barcodeH,
    },
    {
      id: 'price',
      kind: 'text',
      xMm: pad,
      yMm: pad + headerH + nameH + barcodeH,
      wMm: w - pad * 2,
      hMm: priceH,
      fontSizePt: isSmall ? 10 : 12,
      fontWeight: 800,
      align: 'center',
    },
  ];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundToStep(n: number, step: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / step) * step;
}

function BarcodeVisual({
  type,
  value,
  showDigits,
  rotateDeg = 0,
  quietZonePx = 0,
  widthPx,
  heightPx,
}: {
  type: ProductLabelBarcodeType;
  value: string;
  showDigits: boolean;
  rotateDeg?: number;
  quietZonePx?: number;
  widthPx: number;
  heightPx: number;
}) {
  if (type === 'QR') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white">
        <QRCodeDataUrl text={value} width={160} />
      </div>
    );
  }

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      const format = type === 'EAN13' ? 'ean13' : 'code128';
      const safeW = Math.max(40, Math.floor(Number(widthPx) || 0));
      const safeH = Math.max(24, Math.floor(Number(heightPx) || 0));
      // Reserve some space for digits if requested.
      const digitsReserve = showDigits ? 18 : 0;
      const barHeight = Math.max(12, safeH - digitsReserve);

      JsBarcode(svgRef.current, value, {
        format,
        displayValue: showDigits,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
      // Tune module width for container width; keep within a safe range.
      width: Math.max(2, Math.min(4, Math.floor(safeW / 140))),
        height: barHeight,
        fontSize: 16,
        fontOptions: 'bold',
        textMargin: 0,
      });

      // Make the SVG scale to the element box reliably across printers/browsers.
      svgRef.current.setAttribute('width', '100%');
      svgRef.current.setAttribute('height', '100%');
      svgRef.current.setAttribute('preserveAspectRatio', 'none');
    } catch {
      // ignore render errors; the editor should still be usable
    }
  }, [type, value, showDigits, widthPx, heightPx]);

  return (
    <div className="w-full h-full bg-white flex items-center justify-center">
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: quietZonePx,
          boxSizing: 'border-box',
          transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', shapeRendering: 'crispEdges' }} />
      </div>
    </div>
  );
}

export default function ProductLabelLayoutEditor({
  widthMm,
  heightMm,
  barcodeType,
  barcodeValue,
  texts,
  showPrice,
  showBarcodeDigits = false,
  barcodeRotateDeg = 0,
  barcodeQuietZoneMm = 0,
  showGrid = false,
  gridSizeMm = 1,
  snapToGrid = false,
  showSafeArea = false,
  safePaddingMm = 0,
  lockedIds = [],
  pxPerMm = 6,
  value,
  onChange,
  selectedId,
  onSelect,
  className,
}: {
  widthMm: number;
  heightMm: number;
  barcodeType: ProductLabelBarcodeType;
  barcodeValue: string;
  texts: { header: string; name: string; sku: string; price: string };
  showPrice: boolean;
  showBarcodeDigits?: boolean;
  barcodeRotateDeg?: number;
  barcodeQuietZoneMm?: number;
  showGrid?: boolean;
  gridSizeMm?: number;
  snapToGrid?: boolean;
  showSafeArea?: boolean;
  safePaddingMm?: number;
  lockedIds?: ProductLabelElementId[];
  pxPerMm?: number;
  value: ProductLabelElement[];
  onChange: (next: ProductLabelElement[]) => void;
  selectedId: ProductLabelElementId | null;
  onSelect: (id: ProductLabelElementId | null) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<null | { id: ProductLabelElementId; mode: 'move' | 'resize'; startX: number; startY: number; startEl: ProductLabelElement }>(null);

  const stepMm = snapToGrid ? Math.max(0.1, Number(gridSizeMm) || 1) : 0.5;
  const safeW = Math.max(10, Number(widthMm) || 39);
  const safeH = Math.max(10, Number(heightMm) || 20);
  const pxW = safeW * pxPerMm;
  const pxH = safeH * pxPerMm;
  const quietZonePx = Math.max(0, Number(barcodeQuietZoneMm) || 0) * pxPerMm;
  const lockedSet = useMemo(() => new Set(lockedIds), [lockedIds]);
  const safePadPx = Math.max(0, Number(safePaddingMm) || 0) * pxPerMm;
  const gridSizePx = Math.max(2, (Number(gridSizeMm) || 1) * pxPerMm);

  const byId = useMemo(() => {
    const m = new Map<ProductLabelElementId, ProductLabelElement>();
    value.forEach((e) => m.set(e.id, e));
    return m;
  }, [value]);

  const updateEl = (id: ProductLabelElementId, patch: Partial<ProductLabelElement>) => {
    onChange(
      value.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  };

  const onPointerDownMove = (e: React.PointerEvent, id: ProductLabelElementId) => {
    e.preventDefault();
    e.stopPropagation();
    const el = byId.get(id);
    if (!el) return;
    if (lockedSet.has(id)) {
      onSelect(id);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(id);
    setDrag({ id, mode: 'move', startX: e.clientX, startY: e.clientY, startEl: el });
  };

  const onPointerDownResize = (e: React.PointerEvent, id: ProductLabelElementId) => {
    e.preventDefault();
    e.stopPropagation();
    const el = byId.get(id);
    if (!el) return;
    if (lockedSet.has(id)) {
      onSelect(id);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(id);
    setDrag({ id, mode: 'resize', startX: e.clientX, startY: e.clientY, startEl: el });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    const dxMm = roundToStep(dxPx / pxPerMm, stepMm);
    const dyMm = roundToStep(dyPx / pxPerMm, stepMm);

    if (drag.mode === 'move') {
      const nextX = clamp(drag.startEl.xMm + dxMm, 0, safeW - drag.startEl.wMm);
      const nextY = clamp(drag.startEl.yMm + dyMm, 0, safeH - drag.startEl.hMm);
      updateEl(drag.id, { xMm: nextX, yMm: nextY });
      return;
    }

    let nextW = clamp(drag.startEl.wMm + dxMm, 4, safeW - drag.startEl.xMm);
    let nextH = clamp(drag.startEl.hMm + dyMm, 3, safeH - drag.startEl.yMm);
    if (drag.startEl.kind === 'barcode') {
      const ratio = drag.startEl.wMm / Math.max(1, drag.startEl.hMm);
      if (Math.abs(dxMm) >= Math.abs(dyMm)) {
        nextH = clamp(nextW / ratio, 3, safeH - drag.startEl.yMm);
        nextW = clamp(nextH * ratio, 4, safeW - drag.startEl.xMm);
      } else {
        nextW = clamp(nextH * ratio, 4, safeW - drag.startEl.xMm);
        nextH = clamp(nextW / ratio, 3, safeH - drag.startEl.yMm);
      }
      updateEl(drag.id, { wMm: nextW, hMm: nextH });
      return;
    }
    if (drag.startEl.kind === 'text') {
      const nextFont = Math.max(6, Math.round(nextH * 2.6));
      updateEl(drag.id, { wMm: nextW, hMm: nextH, fontSizePt: nextFont });
      return;
    }
    updateEl(drag.id, { wMm: nextW, hMm: nextH });
  };

  const onPointerUp = () => setDrag(null);

  const nudgeSelected = (dxMm: number, dyMm: number) => {
    if (!selectedId) return;
    const el = byId.get(selectedId);
    if (!el) return;
    if (lockedSet.has(selectedId)) return;
    const nextX = clamp(roundToStep(el.xMm + dxMm, 0.1), 0, safeW - el.wMm);
    const nextY = clamp(roundToStep(el.yMm + dyMm, 0.1), 0, safeH - el.hMm);
    updateEl(selectedId, { xMm: nextX, yMm: nextY });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div className={cn('space-y-3', className)}>
      <div
        ref={containerRef}
        className="rounded border bg-white overflow-hidden select-none touch-none relative focus:outline-none focus:ring-2 focus:ring-primary/40"
        style={{
          width: pxW,
          height: pxH,
          backgroundImage: showGrid
            ? `linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.08) 1px, transparent 1px)`
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
        {value.map((el) => {
          const isSel = selectedId === el.id;
          const left = el.xMm * pxPerMm;
          const top = el.yMm * pxPerMm;
          const w = el.wMm * pxPerMm;
          const h = el.hMm * pxPerMm;

          const fontSizePt = el.fontSizePt ?? 10;
          const fontWeight = el.fontWeight ?? 600;
          const align = el.align ?? 'left';
          const justify =
            align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end';

          const textValue =
            el.id === 'header'
              ? texts.header
              : el.id === 'name'
                ? texts.name
                : el.id === 'sku'
                  ? texts.sku
                  : el.id === 'price'
                    ? texts.price
                    : '';

          return (
            <div
              key={el.id}
              className={cn(
                'absolute'
              )}
              style={{ left, top, width: w, height: h }}
            >
              <div
                className={cn(
                  'w-full h-full relative',
                  isSel ? 'outline outline-2 outline-primary' : 'outline outline-1 outline-transparent hover:outline-muted-foreground/50'
                )}
                onPointerDown={(ev) => onPointerDownMove(ev, el.id)}
              >
                {el.kind === 'barcode' ? (
                  <BarcodeVisual
                    type={barcodeType}
                    value={barcodeValue}
                    showDigits={showBarcodeDigits}
                    rotateDeg={barcodeRotateDeg}
                    quietZonePx={quietZonePx}
                    widthPx={w}
                    heightPx={h}
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center"
                    style={{
                      justifyContent: justify,
                      padding: '1px 2px',
                      fontSize: `${fontSizePt}pt`,
                      fontWeight,
                      fontFamily: el.fontFamily || 'Arial, sans-serif',
                      letterSpacing: el.letterSpacingPt ? `${el.letterSpacingPt}pt` : undefined,
                      lineHeight: 1.0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: '#000',
                      background: 'rgba(255,255,255,0.0)',
                      textAlign: align as any,
                    }}
                    title={textValue}
                  >
                    {el.uppercase ? textValue.toUpperCase() : textValue}
                  </div>
                )}

                {/* Resize handle */}
                <div
                  className={cn(
                    'absolute -right-2 -bottom-2 h-4 w-4 rounded-sm border bg-white shadow',
                    isSel ? 'border-primary' : 'border-muted-foreground/40'
                  )}
                  onPointerDown={(ev) => onPointerDownResize(ev, el.id)}
                  title="Resize"
                  style={{ display: lockedSet.has(el.id) ? 'none' : undefined }}
                />
              </div>
            </div>
          );
        })}
        {showSafeArea && safePadPx > 0 && (
          <div
            className="pointer-events-none absolute border border-dashed border-muted-foreground/40"
            style={{ inset: safePadPx }}
          />
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Drag: elementni ushlab suring. Resize: burchakchadan cho‘zing. Klaviatura: ←↑→↓ ({stepMm}mm), Shift=1mm, Alt=0.1mm.
      </div>
    </div>
  );
}

