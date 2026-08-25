import { useEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { cn } from '@/lib/utils';
import type { BarcodeFormat, LabelElement, LabelPreviewData } from '@/lib/barcodes/labelModel';
import {
  elementBarcodeType,
  isBarcodeKind,
  resolveBarcodeValue,
  resolveElementText,
} from '@/lib/barcodes/labelDataResolver';
import { validateProductBarcode } from '@/lib/barcodes/productBarcode';

function BarcodeSvgVisual({
  type,
  value,
  showDigits,
  moduleWidth,
  widthPx,
  heightPx,
  rotateDeg = 0,
}: {
  type: BarcodeFormat;
  value: string;
  showDigits: boolean;
  moduleWidth?: number;
  widthPx: number;
  heightPx: number;
  rotateDeg?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const validation = useMemo(() => {
    if (type === 'QR') return { ok: true, value };
    return validateProductBarcode({ type: type === 'EAN13' ? 'EAN13' : 'CODE128', value });
  }, [type, value]);

  useEffect(() => {
    if (!svgRef.current || type === 'QR') return;
    try {
      const format = type === 'EAN13' ? 'ean13' : 'code128';
      const safeW = Math.max(40, Math.floor(widthPx));
      const safeH = Math.max(24, Math.floor(heightPx));
      const digitsReserve = showDigits ? 18 : 0;
      const barHeight = Math.max(12, safeH - digitsReserve);
      const mw = moduleWidth ?? Math.max(2, Math.min(4, Math.floor(safeW / 140)));

      JsBarcode(svgRef.current, validation.ok ? (validation as { normalizedValue?: string }).normalizedValue || value : value, {
        format,
        displayValue: showDigits,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
        width: mw,
        height: barHeight,
        fontSize: 14,
        fontOptions: 'bold',
        textMargin: 0,
      });
      svgRef.current.setAttribute('width', '100%');
      svgRef.current.setAttribute('height', '100%');
      svgRef.current.setAttribute('preserveAspectRatio', 'none');
    } catch {
      // placeholder handled below
    }
  }, [type, value, showDigits, widthPx, heightPx, moduleWidth, validation]);

  if (type === 'QR') {
    const px = Math.max(48, Math.min(widthPx, heightPx));
    return (
      <div className="w-full h-full flex items-center justify-center bg-white">
        <QRCodeDataUrl text={value || 'placeholder'} width={px} />
      </div>
    );
  }

  if (!validation.ok) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-amber-50 text-amber-800 text-[9px] px-1 text-center border border-dashed border-amber-300">
        <span>Barkod xato</span>
        <span className="opacity-70 truncate max-w-full">{value || '—'}</span>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full bg-white flex items-center justify-center"
      style={{
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transformOrigin: 'center',
      }}
    >
      <svg ref={svgRef} className="w-full h-full block" style={{ shapeRendering: 'crispEdges' }} />
    </div>
  );
}

export function PrintBarcodeMarkup({
  type,
  value,
  showDigits,
  moduleWidth,
  widthMm,
  heightMm,
  rotateDeg = 0,
}: {
  type: BarcodeFormat;
  value: string;
  showDigits: boolean;
  moduleWidth?: number;
  widthMm: number;
  heightMm: number;
  rotateDeg?: number;
}) {
  if (type === 'QR') {
    const px = Math.max(80, Math.round(Math.min(widthMm, heightMm) * 8));
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <QRCodeDataUrl text={value || 'placeholder'} width={px} />
      </div>
    );
  }

  const svgMarkup = useMemo(() => {
    try {
      const validation = validateProductBarcode({
        type: type === 'EAN13' ? 'EAN13' : 'CODE128',
        value,
      });
      if (!validation.ok) {
        return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff8e6;color:#92400e;font-size:8px;text-align:center;border:1px dashed #f59e0b">Barkod xato</div>`;
      }
      const format = type === 'EAN13' ? 'ean13' : 'code128';
      const safeW = Math.max(10, widthMm);
      const safeH = Math.max(6, heightMm);
      const digitsReserveMm = showDigits ? 3.5 : 0;
      const barHeightMm = Math.max(3, safeH - digitsReserveMm);
      const barHeightPx = Math.round(barHeightMm * 8);
      const mw = moduleWidth ?? Math.max(2, Math.min(4, Math.floor((safeW * 8) / 140)));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, validation.normalizedValue || value, {
        format,
        displayValue: showDigits,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
        width: mw,
        height: Math.max(24, barHeightPx),
        fontSize: 14,
        fontOptions: 'bold',
        textMargin: 0,
      });
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.shapeRendering = 'crispEdges';
      return svg.outerHTML;
    } catch {
      return '';
    }
  }, [type, value, showDigits, widthMm, heightMm, moduleWidth]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transformOrigin: 'center',
      }}
    >
      <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svgMarkup }} />
    </div>
  );
}

export function LabelElementVisual({
  el,
  previewData,
  pxPerMm,
  selected,
  onPointerDownMove,
  onPointerDownResize,
  handle,
  className,
}: {
  el: LabelElement;
  previewData: LabelPreviewData;
  pxPerMm: number;
  selected?: boolean;
  onPointerDownMove?: (e: React.PointerEvent) => void;
  onPointerDownResize?: (e: React.PointerEvent, handle: string) => void;
  handle?: string;
  className?: string;
}) {
  if (el.visible === false) return null;

  const left = el.x * pxPerMm;
  const top = el.y * pxPerMm;
  const w = el.w * pxPerMm;
  const h = el.h * pxPerMm;
  const rotation = el.rotation ?? 0;

  const textValue = resolveElementText(el, previewData);
  const justify =
    el.align === 'left' ? 'flex-start' : el.align === 'center' ? 'center' : 'flex-end';

  const isOldPrice = el.data === 'old_price';
  const isDiscount = el.data === 'discount_pct';

  const handles = ['tl', 'tr', 'bl', 'br', 'tc', 'bc', 'ml', 'mr'] as const;
  const handlePos: Record<string, React.CSSProperties> = {
    tl: { top: -5, left: -5 },
    tr: { top: -5, right: -5 },
    bl: { bottom: -5, left: -5 },
    br: { bottom: -5, right: -5 },
    tc: { top: -5, left: '50%', marginLeft: -4 },
    bc: { bottom: -5, left: '50%', marginLeft: -4 },
    ml: { top: '50%', left: -5, marginTop: -4 },
    mr: { top: '50%', right: -5, marginTop: -4 },
  };

  return (
    <div
      className={cn('absolute', className)}
      style={{ left, top, width: w, height: h, zIndex: el.z ?? 1 }}
    >
      <div
        className={cn(
          'w-full h-full relative',
          selected ? 'outline outline-2 outline-[#2f86ff] outline-offset-[2px]' : 'hover:outline hover:outline-1 hover:outline-muted-foreground/40'
        )}
        onPointerDown={onPointerDownMove}
        style={{
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        {el.kind === 'line' ? (
          <div className="w-full h-full" style={{ background: el.color || '#16201b' }} />
        ) : isBarcodeKind(el) ? (
          <BarcodeSvgVisual
            type={elementBarcodeType(el)}
            value={resolveBarcodeValue(el, previewData)}
            showDigits={Boolean(el.showValue)}
            moduleWidth={el.moduleWidth}
            widthPx={w}
            heightPx={h}
            rotateDeg={rotation}
          />
        ) : el.kind === 'image' ? (
          <div className="w-full h-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground border border-dashed">
            Logo
          </div>
        ) : (
          <div
            className="w-full h-full flex items-center overflow-hidden"
            style={{
              justifyContent: justify,
              padding: '1px 2px',
              fontSize: `${el.fontSizePt ?? 10}pt`,
              fontWeight: el.fontWeight ?? 600,
              fontFamily: el.fontFamily || 'Inter, Arial, sans-serif',
              letterSpacing: el.letterSpacingPt ? `${el.letterSpacingPt}pt` : undefined,
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              color: el.color || '#16201b',
              textAlign: el.align ?? 'left',
              textDecoration: isOldPrice ? 'line-through' : undefined,
              background: isDiscount ? '#d92d20' : undefined,
              borderRadius: isDiscount ? 4 : undefined,
            }}
            title={textValue}
          >
            {el.uppercase ? textValue.toUpperCase() : textValue}
          </div>
        )}

        {selected &&
          !el.locked &&
          handles.map((h) => (
            <div
              key={h}
              className="absolute h-[9px] w-[9px] rounded-[2px] border-[1.5px] border-[#2f86ff] bg-white"
              style={handlePos[h]}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                onPointerDownResize?.(ev, h);
              }}
            />
          ))}
      </div>
      {selected && (
        <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#16201b] px-2 py-0.5 text-[10px] font-bold text-white">
          X {el.x.toFixed(1)} · Y {el.y.toFixed(1)} · {el.w.toFixed(1)}×{el.h.toFixed(1)} mm
        </div>
      )}
    </div>
  );
}

export default LabelElementVisual;
