import React from 'react';

interface ShelfLabelPrintProps {
  name: string;
  sku: string;
  priceText: string;
  copies: number;
  labelWidthMm: number;
  labelHeightMm: number;
}

export default function ShelfLabelPrint({
  name,
  sku,
  priceText,
  copies,
  labelWidthMm,
  labelHeightMm,
}: ShelfLabelPrintProps) {
  const safeCopies = Number.isFinite(Number(copies)) && Number(copies) > 0 ? Number(copies) : 1;
  const isLabelPrinterSize = labelWidthMm <= 60 && labelHeightMm <= 60;
  const isTightLabel = isLabelPrinterSize && labelHeightMm <= 25;
  const safeName = String(name || '').trim();
  const safeSku = String(sku || '').trim();
  const safePrice = String(priceText || '').trim();

  return (
    <div className={`shelf-label-container${isLabelPrinterSize ? ' small-label' : ''}`}>
      <style>{`
        @media print {
          @page { margin: 0; }
          body { margin: 0; }
          .shelf-label-container { width: 100%; }
          .shelf-label-item { page-break-inside: avoid; }
          .shelf-label-container.small-label .shelf-label-item {
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
          }
          .shelf-label-container.small-label .shelf-label-item:not(:last-child) {
            break-after: page;
            page-break-after: always;
          }
          .shelf-label-container.small-label .shelf-label-item:last-child {
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
        {Array.from({ length: safeCopies }, (_, index) => (
          <div
            key={index}
            className="shelf-label-item"
            style={{
              width: `${labelWidthMm}mm`,
              height: `${labelHeightMm}mm`,
              minHeight: `${labelHeightMm}mm`,
              maxWidth: `${labelWidthMm}mm`,
              border: '1px dashed #999',
              borderRadius: '2mm',
              padding: isLabelPrinterSize ? '0.8mm' : '2mm',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              fontFamily: 'Arial, sans-serif',
              background: '#fff',
              color: '#000',
            }}
          >
            <div
              style={{
                fontSize: isTightLabel ? '8pt' : '10pt',
                fontWeight: 600,
                lineHeight: 1.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {safeName || '—'}
            </div>
            <div
              style={{
                fontSize: isTightLabel ? '7pt' : '8pt',
                color: '#444',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {safeSku ? `SKU: ${safeSku}` : ''}
            </div>
            <div
              style={{
                fontSize: isTightLabel ? '9pt' : '12pt',
                fontWeight: 700,
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {safePrice || ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
