import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import type { ProductLabelBarcodeType, ProductLabelElement, ProductLabelElementId } from './ProductLabelLayoutEditor';

function PrintBarcodeVisual({
  type,
  value,
  showDigits,
  widthMm,
  heightMm,
  rotateDeg = 0,
  quietZoneMm = 0,
}: {
  type: ProductLabelBarcodeType;
  value: string;
  showDigits: boolean;
  widthMm: number;
  heightMm: number;
  rotateDeg?: number;
  quietZoneMm?: number;
}) {
  if (type === 'QR') {
    // QR uses an <img> data-url, safe for print cloning
    const px = Math.max(80, Math.round(Math.min(widthMm, heightMm) * 8));
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <QRCodeDataUrl text={value} width={px} />
      </div>
    );
  }

  // IMPORTANT: Don't rely on effects for printing.
  // react-to-print can clone/print before effects run in the print iframe, causing blank output.
  // So we generate the SVG markup synchronously (in the main tree) and let it be cloned as static markup.
  const svgMarkup = useMemo(() => {
    try {
      const format = type === 'EAN13' ? 'ean13' : 'code128';
      const safeW = Math.max(10, Number(widthMm) || 10);
      const safeH = Math.max(6, Number(heightMm) || 6);
      const digitsReserveMm = showDigits ? 3.5 : 0;
      const barHeightMm = Math.max(3, safeH - digitsReserveMm);
      const barHeightPx = Math.round(barHeightMm * 8);
      const moduleWidth = Math.max(2, Math.min(4, Math.floor((safeW * 8) / 140)));

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, value, {
        format,
        displayValue: showDigits,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
        width: moduleWidth,
        height: Math.max(24, barHeightPx),
        fontSize: 16,
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
  }, [type, value, showDigits, widthMm, heightMm]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: `${Math.max(0, Number(quietZoneMm) || 0)}mm`,
          boxSizing: 'border-box',
          transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
          transformOrigin: 'center',
        }}
      >
        <div
          style={{ width: '100%', height: '100%' }}
          dangerouslySetInnerHTML={{ __html: svgMarkup || '' }}
        />
      </div>
    </div>
  );
}

export default function ProductLabelLayoutPrint({
  widthMm,
  heightMm,
  copies,
  barcodeType,
  barcodeValue,
  showBarcodeDigits,
  barcodeRotateDeg = 0,
  barcodeQuietZoneMm = 0,
  texts,
  showPrice,
  layout,
}: {
  widthMm: number;
  heightMm: number;
  copies: number;
  barcodeType: ProductLabelBarcodeType;
  barcodeValue: string;
  showBarcodeDigits: boolean;
  barcodeRotateDeg?: number;
  barcodeQuietZoneMm?: number;
  texts: { header: string; name: string; sku: string; price: string };
  showPrice: boolean;
  layout: ProductLabelElement[];
}) {
  const safeW = Math.max(10, Number(widthMm) || 39);
  const safeH = Math.max(10, Number(heightMm) || 20);
  const safeCopies = Math.max(1, Math.min(100, Number(copies) || 1));

  const textForId = (id: ProductLabelElementId) => {
    if (id === 'header') return texts.header;
    if (id === 'name') return texts.name;
    if (id === 'sku') return texts.sku;
    if (id === 'price') return showPrice ? texts.price : '';
    return '';
  };

  const justifyFor = (align?: 'left' | 'center' | 'right') =>
    align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

  return (
    <div>
      {Array.from({ length: safeCopies }, (_, idx) => (
        <div
          key={idx}
          style={{
            width: `${safeW}mm`,
            height: `${safeH}mm`,
            position: 'relative',
            background: '#fff',
            overflow: 'hidden',
            pageBreakInside: 'avoid',
            breakInside: 'avoid',
            // label printers: one label per page
            pageBreakAfter: idx === safeCopies - 1 ? 'auto' : 'always',
            breakAfter: idx === safeCopies - 1 ? 'auto' : 'page',
          }}
        >
          {layout.map((el) => {
            const isPriceHidden = el.id === 'price' && !showPrice;
            if (isPriceHidden) return null;

            const left = `${el.xMm}mm`;
            const top = `${el.yMm}mm`;
            const w = `${el.wMm}mm`;
            const h = `${el.hMm}mm`;

            return (
              <div
                key={el.id}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: w,
                  height: h,
                  overflow: 'hidden',
                }}
              >
                {el.kind === 'barcode' ? (
                  <PrintBarcodeVisual
                    type={barcodeType}
                    value={barcodeValue}
                    showDigits={showBarcodeDigits}
                    widthMm={el.wMm}
                    heightMm={el.hMm}
                    rotateDeg={barcodeRotateDeg}
                    quietZoneMm={barcodeQuietZoneMm}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: justifyFor(el.align),
                      padding: '0.4mm',
                      boxSizing: 'border-box',
                      fontSize: `${el.fontSizePt ?? 10}pt`,
                      fontWeight: el.fontWeight ?? 600,
                      fontFamily: el.fontFamily || 'Arial, sans-serif',
                      letterSpacing: el.letterSpacingPt ? `${el.letterSpacingPt}pt` : undefined,
                      lineHeight: 1.0,
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      color: '#000',
                      textAlign: el.align ?? 'left',
                    }}
                    title={textForId(el.id as any)}
                  >
                    {el.uppercase ? textForId(el.id as any).toUpperCase() : textForId(el.id as any)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

