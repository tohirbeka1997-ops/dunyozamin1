import React from 'react';
import type { Product } from '@/types/database';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { formatMoneyUZS } from '@/lib/format';

interface BarcodeLabelProps {
  product?: {
    name: string;
    sku: string;
    barcode?: string;
    sale_price: number;
  };
  type: 'CODE128' | 'EAN13' | 'QR';
  value: string;
  copies: number;
  showPrice?: boolean;
}

// Barcode visual component
// Note: For CODE128/EAN13, install react-barcode: npm install react-barcode
// Then replace this placeholder with: import Barcode from 'react-barcode';
function BarcodeVisual({ type, value }: { type: 'CODE128' | 'EAN13' | 'QR'; value: string }) {
  // For QR codes, use the existing QRCodeDataUrl component
  if (type === 'QR') {
    return (
      <div className="flex items-center justify-center w-full bg-white">
        <QRCodeDataUrl text={value} width={100} />
      </div>
    );
  }

  // For CODE128/EAN13, create visual placeholder
  // TODO: Replace with react-barcode when installed:
  // import Barcode from 'react-barcode';
  // return <Barcode value={value} format={type} width={2} height={50} displayValue={true} />;
  return (
    <div className="flex flex-col items-center justify-center w-full h-20 bg-white">
      <div className="flex items-center gap-0.5 mb-1">
        {Array.from({ length: 40 }, (_, i) => (
          <div
            key={i}
            className={`bg-black ${i % 3 === 0 ? 'w-1 h-16' : i % 3 === 1 ? 'w-0.5 h-14' : 'w-1.5 h-12'}`}
          />
        ))}
      </div>
      <div className="font-mono text-xs font-semibold">{value}</div>
    </div>
  );
}

export default function BarcodeLabel({
  product,
  type,
  value,
  copies,
  showPrice = false,
}: BarcodeLabelProps) {
  if (!value || value.trim() === '') {
    return (
      <div className="w-full p-8 bg-gray-50 border border-gray-300 rounded text-center text-gray-500">
        Shtrix-kod qiymatini kiriting
      </div>
    );
  }

  return (
    <div className="barcode-label-container">
      <style>{`
        @media print {
          @page {
            margin: 5mm;
            size: A4;
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
        }
      `}</style>

      <div className="grid grid-cols-2 gap-3 print:grid-cols-4">
        {Array.from({ length: copies }, (_, index) => (
          <div
            key={index}
            className="label-item border border-gray-400 rounded p-2 bg-white"
            style={{
              width: '70mm',
              minHeight: '35mm',
              maxWidth: '70mm',
            }}
          >
            {/* Product Name */}
            {product && (
              <div className="font-bold text-xs mb-2 truncate" title={product.name}>
                {product.name}
              </div>
            )}

            {/* Barcode */}
            <div className="mb-2 flex items-center justify-center">
              <BarcodeVisual type={type} value={value} />
            </div>

            {/* SKU / Code */}
            <div className="text-center mb-1">
              <div className="text-xs text-gray-700 font-mono">
                {product?.sku ? `SKU: ${product.sku}` : value}
              </div>
            </div>

            {/* Price (optional) */}
            {showPrice && product && (
              <div className="text-center">
                <div className="text-sm font-bold">
                  {formatMoneyUZS(product.sale_price)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
