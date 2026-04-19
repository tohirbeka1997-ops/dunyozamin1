import React, { useEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { formatMoneyUZS } from '@/lib/format';

interface BarcodeLabelProps {
  product?: {
    name: string;
    sku: string;
    barcode?: string;
    sale_price: number;
  };
  /** Optional manual override texts for compact label layouts */
  headerText?: string;
  subText?: string;
  skuText?: string;
  priceText?: string;
  type: 'CODE128' | 'EAN13' | 'QR';
  value: string;
  copies: number;
  showPrice?: boolean;
  /** Label width in millimeters (default: 70) */
  labelWidthMm?: number;
  /** Label height in millimeters (default: 35) */
  labelHeightMm?: number;
}

// Barcode visual component
// Note: For CODE128/EAN13, install react-barcode: npm install react-barcode
// Then replace this placeholder with: import Barcode from 'react-barcode';
function BarcodeVisual({
  type,
  value,
  displayValue = false,
  barHeight = 60,
  fontSize = 12,
  textMargin = 0,
}: {
  type: 'CODE128' | 'EAN13' | 'QR';
  value: string;
  displayValue?: boolean;
  barHeight?: number;
  fontSize?: number;
  textMargin?: number;
}) {
  // For QR codes, use the existing QRCodeDataUrl component
  if (type === 'QR') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', background: '#fff' }}>
        <QRCodeDataUrl text={value} width={100} />
      </div>
    );
  }

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      // jsbarcode expects lowercase format names
      const format = type === 'EAN13' ? 'ean13' : 'code128';
      JsBarcode(svgRef.current, value, {
        format,
        displayValue,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
        // These are "baseline" dimensions; CSS controls the final printed size.
        width: 1,
        height: barHeight,
        fontSize,
        textMargin,
      });
    } catch (e) {
      // If value is invalid for the given format, we still render a readable fallback
      // (e.g., EAN13 requires 12/13 digits).
      // eslint-disable-next-line no-console
      console.warn('Failed to render barcode:', e);
    }
  }, [type, value, displayValue, barHeight, fontSize, textMargin]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#fff' }}>
      <svg
        ref={svgRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          // Helps scanners by avoiding anti-aliased edges when the SVG is rasterized by the printer driver.
          shapeRendering: 'crispEdges',
        }}
      />
    </div>
  );
}

function truncateToMaxChars(text: string, maxChars: number): string {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

function guessBrandFromName(name: string): string {
  const n = String(name || '').trim();
  if (!n) return '';
  // Use first token as "brand-like" label (matches the screenshot style).
  const first = n.split(/\s+/)[0] || n;
  return truncateToMaxChars(first.toUpperCase(), 10);
}

export default function BarcodeLabel({
  product,
  headerText,
  subText,
  skuText,
  priceText,
  type,
  value,
  copies,
  showPrice = false,
  labelWidthMm = 70,
  labelHeightMm = 35,
}: BarcodeLabelProps) {
  if (!value || value.trim() === '') {
    return (
      <div className="w-full p-8 bg-gray-50 border border-gray-300 rounded text-center text-gray-500">
        Shtrix-kod qiymatini kiriting
      </div>
    );
  }

  const isLabelPrinterSize = labelWidthMm <= 60 && labelHeightMm <= 60;
  // "Tight" labels like 39x20mm (small height) must use a compact layout; otherwise content will overflow and get clipped.
  const isTightLabel = isLabelPrinterSize && labelHeightMm <= 25;
  const isCompact = labelWidthMm <= 35 && labelHeightMm <= 30;
  const is39x20ish = isLabelPrinterSize && labelWidthMm <= 40 && labelHeightMm <= 22;
  const productName = useMemo(() => {
    if (!product?.name) return '';
    // Requirement: 15–18 chars max
    return truncateToMaxChars(product.name, 18);
  }, [product?.name]);
  const brandText = useMemo(() => (product?.name ? guessBrandFromName(product.name) : ''), [product?.name]);
  const headerLeft = headerText || brandText || productName || value;
  const skuRight = skuText || (product?.sku ? `sku ${product.sku}` : '');
  const subLine = subText || (product?.name ? truncateToMaxChars(product.name, 18) : value);
  const resolvedPriceText =
    priceText ||
    (product && showPrice ? formatMoneyUZS(product.sale_price).replace(' so‘m', ' uzs') : '');

  return (
    <div className={`barcode-label-container${isLabelPrinterSize ? ' small-label' : ''}`}>
      <style>{`
        @media print {
          @page {
            /* Page size is controlled by the print window (A4/thermal/label). */
            margin: 0;
          }
          body {
            margin: 0;
          }
          .barcode-label-container {
            width: 100%;
          }
          .label-item {
            page-break-inside: avoid;
          }
          .barcode-label-container.small-label {
            width: 100%;
          }
          /* On real labels, borders/padding steal precious mm and reduce barcode quiet-zone => scanning becomes unreliable */
          .barcode-label-container.small-label .label-item {
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }
          /* For label printers: print exactly ONE label per page, without a trailing blank page */
          .barcode-label-container.small-label .label-item {
            break-inside: avoid;
          }
          .barcode-label-container.small-label .label-item:not(:last-child) {
            break-after: page;
            page-break-after: always;
          }
          .barcode-label-container.small-label .label-item:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        }
      `}</style>

      <div
        style={
          isLabelPrinterSize
            ? { display: 'block' }
            : { display: 'flex', flexWrap: 'wrap', gap: '3mm' }
        }
      >
        {Array.from({ length: copies }, (_, index) => (
          <div
            key={index}
            className="label-item"
            style={{
              width: `${labelWidthMm}mm`,
              height: `${labelHeightMm}mm`,
              minHeight: `${labelHeightMm}mm`,
              maxWidth: `${labelWidthMm}mm`,
              // On-screen preview needs a little padding; print mode overrides padding to 0 (see @media print above).
              padding: isLabelPrinterSize ? '0.8mm' : '1mm',
              boxSizing: 'border-box',
              overflow: 'hidden',
              background: '#fff',
              border: '1px solid #9ca3af',
              borderRadius: '2mm',
              marginBottom: isLabelPrinterSize && index < copies - 1 ? '0' : undefined,
            }}
          >
            {isCompact || isTightLabel ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isTightLabel ? '0.4mm' : '0.6mm',
                }}
              >
                {/* Header row: brand (left, big) + sku (right) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1mm' }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: isTightLabel ? '11pt' : '12pt',
                      lineHeight: 1.0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '70%',
                    }}
                    title={product?.name || ''}
                  >
                    {headerLeft}
                  </div>
                  <div
                    style={{
                      fontSize: '8pt',
                      lineHeight: 1.0,
                      whiteSpace: 'nowrap',
                      color: '#111',
                    }}
                  >
                    {skuRight}
                  </div>
                </div>

                {/* Second line: product name */}
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: isTightLabel ? '8pt' : '9pt',
                    lineHeight: 1.05,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={product?.name || ''}
                >
                  {subLine}
                </div>

                {/* Middle: Barcode (bars + digits under it, like screenshot) */}
                <div
                  style={{
                    flex: '1 1 auto',
                    minHeight: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      // Quiet zone (blank area) improves scanner reliability a lot on tiny labels.
                      // We keep it as padding so the barcode itself never touches the label edge.
                      paddingLeft: is39x20ish ? '2mm' : '1.5mm',
                      paddingRight: is39x20ish ? '2mm' : '1.5mm',
                      boxSizing: 'border-box',
                    }}
                  >
                    <BarcodeVisual
                      type={type}
                      value={value}
                      // On very small labels (e.g. 39x20), digits steal height from bars and reduce scan rate.
                      displayValue={!is39x20ish}
                      // barHeight is "baseline" px; actual sizing is dominated by container height,
                      // but having a sane value improves JSBarcode layout.
                      barHeight={isTightLabel ? 70 : 80}
                      fontSize={isTightLabel ? 9 : 14}
                      textMargin={0}
                    />
                  </div>
                </div>

                {/* Bottom: Price centered (like screenshot) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    gap: '1mm',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.05,
                  }}
                >
                  {resolvedPriceText ? (
                    <div style={{ fontSize: '12pt', fontWeight: 500 }}>
                      <span style={{ fontWeight: 500 }}>Narxi</span>{' '}
                      <span style={{ fontWeight: 800 }}>{resolvedPriceText.replace(/^Narxi:\s*/i, '')}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {/* Product Name */}
                {product && (
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '12px',
                      marginBottom: '2mm',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={product.name}
                  >
                    {product.name}
                  </div>
                )}

                {/* Barcode */}
                <div
                  style={{
                    marginBottom: '2mm',
                    // Don't force a barcode block taller than the label itself (prevents clipping on 39x20mm etc.)
                    height: `${Math.min(20, Math.max(8, labelHeightMm * 0.55))}mm`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ width: '100%', height: '100%' }}>
                    <BarcodeVisual type={type} value={value} displayValue={false} />
                  </div>
                </div>

                {/* SKU / Code */}
                <div style={{ textAlign: 'center', marginBottom: '1mm' }}>
                  <div style={{ fontSize: '12px', color: '#374151', fontFamily: 'monospace' }}>
                    {product?.sku ? `SKU: ${product.sku}` : value}
                  </div>
                </div>

                {/* Price (optional) */}
                {showPrice && product && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>
                      {formatMoneyUZS(product.sale_price)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
