/**
 * Print utility functions for receipts
 */

/**
 * Generic function to print HTML content
 */
export function printHtml(title: string, htmlContent: string, pageSize: '58mm' | '78mm' | '80mm' | 'A4' = '78mm'): void {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  
  if (!printWindow) {
    throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
  }

  const isA4 = pageSize === 'A4';
  const is58 = pageSize === '58mm';
  const is78 = pageSize === '78mm';
  const pageWidthMm = is58 ? 58 : is78 ? 78 : 80;
  const pageSizeCss = isA4 ? 'A4' : `${pageWidthMm}mm 200mm`;
  const marginMm = isA4 ? 20 : 0;
  const margin = `${marginMm}mm`;
  // Thermal printers often print too light with monospace; use a heavier sans-serif baseline.
  const fontFamily = isA4 ? 'Arial, sans-serif' : 'Arial, sans-serif';
  const fontSize = isA4 ? '14px' : '13px';
  const lineHeight = isA4 ? '1.6' : '1.35';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <meta charset="utf-8">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          /* Dynamic page size override for thermal receipts */
          #__receipt-page-style { display: none; }
          @media print {
            @page {
              size: ${pageSizeCss};
              margin: ${margin};
            }
            html, body {
              width: ${isA4 ? '210mm' : `${pageWidthMm}mm`};
              margin: 0;
              padding: 0;
              font-family: ${fontFamily};
              font-size: ${fontSize};
              line-height: ${lineHeight};
              color: #000;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              height: auto;
            }
            .no-print {
              display: none;
            }
            .receipt-thermal,
            .return-receipt-thermal {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
          @media screen {
            body {
              font-family: ${fontFamily};
              font-size: ${fontSize};
              padding: ${isA4 ? '20px' : '0'};
              max-width: ${isA4 ? '210mm' : is58 ? '58mm' : is78 ? '78mm' : '80mm'};
              margin: 0 auto;
              background: ${isA4 ? '#f5f5f5' : '#fff'};
            }
          }
          .return-receipt-thermal,
          .return-receipt-a4 {
            width: 100%;
          }
          .return-receipt-thermal h2 {
            font-size: 14px;
            margin-bottom: 4px;
          }
          .return-receipt-thermal .text-xs {
            font-size: 10px;
          }
          .return-receipt-thermal .text-center {
            text-align: center;
          }
          .return-receipt-thermal .flex {
            display: flex;
          }
          .return-receipt-thermal .justify-between {
            justify-content: space-between;
          }
          .return-receipt-thermal .font-bold {
            font-weight: bold;
          }
          .return-receipt-thermal .font-semibold {
            font-weight: 600;
          }
          .return-receipt-thermal .font-medium {
            font-weight: 500;
          }
          .return-receipt-thermal .border-t,
          .return-receipt-thermal .border-b {
            border-top: 1px dashed #999;
            border-bottom: 1px dashed #999;
          }
          .return-receipt-thermal .border-gray-400 {
            border-color: #999;
          }
          .return-receipt-thermal .text-gray-600 {
            color: #666;
          }
          .return-receipt-thermal .text-yellow-800 {
            color: #854d0e;
          }
          .return-receipt-thermal .mb-2 {
            margin-bottom: 8px;
          }
          .return-receipt-thermal .mb-3 {
            margin-bottom: 12px;
          }
          .return-receipt-thermal .mb-4 {
            margin-bottom: 16px;
          }
          .return-receipt-thermal .mt-1 {
            margin-top: 4px;
          }
          .return-receipt-thermal .mt-4 {
            margin-top: 16px;
          }
          .return-receipt-thermal .py-2 {
            padding-top: 8px;
            padding-bottom: 8px;
          }
          .return-receipt-thermal .pt-1 {
            padding-top: 4px;
          }
          .return-receipt-thermal .pt-2 {
            padding-top: 8px;
          }
          .return-receipt-thermal .space-y-1 > * + * {
            margin-top: 4px;
          }
          .return-receipt-a4 table {
            width: 100%;
            border-collapse: collapse;
          }
          .return-receipt-a4 th,
          .return-receipt-a4 td {
            padding: 8px;
            text-align: left;
          }
          .return-receipt-a4 .text-center {
            text-align: center;
          }
          .return-receipt-a4 .flex {
            display: flex;
          }
          .return-receipt-a4 .justify-between {
            justify-content: space-between;
          }
          .return-receipt-a4 .font-bold {
            font-weight: bold;
          }
          .return-receipt-a4 .font-semibold {
            font-weight: 600;
          }
          .return-receipt-a4 .grid {
            display: grid;
          }
          .return-receipt-a4 .grid-cols-2 {
            grid-template-columns: repeat(2, 1fr);
          }
          .return-receipt-a4 .gap-4 {
            gap: 16px;
          }
          .return-receipt-a4 .mb-6 {
            margin-bottom: 24px;
          }
          .return-receipt-a4 .mb-2 {
            margin-bottom: 8px;
          }
          .return-receipt-a4 .mb-4 {
            margin-bottom: 16px;
          }
          .return-receipt-a4 .mt-8 {
            margin-top: 32px;
          }
          .return-receipt-a4 .pt-4 {
            padding-top: 16px;
          }
          .return-receipt-a4 .space-y-2 > * + * {
            margin-top: 8px;
          }
          .return-receipt-a4 .text-sm {
            font-size: 14px;
          }
          .return-receipt-a4 .text-lg {
            font-size: 18px;
          }
          .return-receipt-a4 .text-2xl {
            font-size: 24px;
          }
          .return-receipt-a4 .text-muted-foreground {
            color: #666;
          }
          .return-receipt-a4 .border-t-2 {
            border-top: 2px solid #999;
          }
          .return-receipt-a4 .border-t {
            border-top: 1px solid #999;
          }
          .return-receipt-a4 .border-gray-300 {
            border-color: #d1d5db;
          }
          .return-receipt-a4 .border-gray-200 {
            border-color: #e5e7eb;
          }
          .return-receipt-a4 .font-mono {
            font-family: monospace;
          }
          .return-receipt-a4 .bg-yellow-100 {
            background-color: #fef3c7;
          }
          .return-receipt-a4 .border-yellow-400 {
            border-color: #facc15;
          }
          .return-receipt-a4 .text-yellow-800 {
            color: #854d0e;
          }
          .receipt-thermal,
          .receipt-a4 {
            width: 100%;
          }
          .receipt-thermal { font-weight: 700; }
          .receipt-thermal h2 { font-size: 16px; margin-bottom: 4px; }
          .receipt-thermal .text-xs {
            font-size: 12px;
          }
          .receipt-thermal .text-center {
            text-align: center;
          }
          .receipt-thermal .flex {
            display: flex;
          }
          .receipt-thermal .justify-between {
            justify-content: space-between;
          }
          .receipt-thermal .font-bold {
            font-weight: bold;
          }
          .receipt-thermal .font-semibold {
            font-weight: 600;
          }
          .receipt-thermal .font-medium {
            font-weight: 500;
          }
          .receipt-thermal .border-t,
          .receipt-thermal .border-b {
            border-top: 1px dashed #999;
            border-bottom: 1px dashed #999;
          }
          .receipt-thermal .border-gray-400 {
            border-color: #999;
          }
          /* Avoid light gray on thermal printers */
          .receipt-thermal .text-gray-600 { color: #000; }
          .receipt-thermal .text-muted-foreground { color: #000; }
          .receipt-thermal .mb-2 {
            margin-bottom: 8px;
          }
          .receipt-thermal .mb-3 {
            margin-bottom: 12px;
          }
          .receipt-thermal .mt-1 {
            margin-top: 4px;
          }
          .receipt-thermal .mt-4 {
            margin-top: 16px;
          }
          .receipt-thermal .pt-1 {
            padding-top: 4px;
          }
          .receipt-thermal .py-2 {
            padding-top: 8px;
            padding-bottom: 8px;
          }
          .receipt-thermal .pt-2 {
            padding-top: 8px;
          }
          .receipt-thermal .space-y-1 > * + * {
            margin-top: 4px;
          }
          .receipt-thermal .whitespace-pre-wrap {
            white-space: pre-wrap;
          }
          .receipt-thermal .font-mono {
            font-family: monospace;
          }
          .receipt-a4 table {
            width: 100%;
            border-collapse: collapse;
          }
          .receipt-a4 th,
          .receipt-a4 td {
            padding: 8px;
            text-align: left;
          }
          .receipt-a4 .text-center {
            text-align: center;
          }
          .receipt-a4 .flex {
            display: flex;
          }
          .receipt-a4 .justify-between {
            justify-content: space-between;
          }
          .receipt-a4 .font-bold {
            font-weight: bold;
          }
          .receipt-a4 .font-semibold {
            font-weight: 600;
          }
          .receipt-a4 .grid {
            display: grid;
          }
          .receipt-a4 .grid-cols-2 {
            grid-template-columns: repeat(2, 1fr);
          }
          .receipt-a4 .gap-4 {
            gap: 16px;
          }
          .receipt-a4 .mb-6 {
            margin-bottom: 24px;
          }
          .receipt-a4 .mb-2 {
            margin-bottom: 8px;
          }
          .receipt-a4 .mt-8 {
            margin-top: 32px;
          }
          .receipt-a4 .pt-4 {
            padding-top: 16px;
          }
          .receipt-a4 .space-y-2 > * + * {
            margin-top: 8px;
          }
          .receipt-a4 .text-sm {
            font-size: 14px;
          }
          .receipt-a4 .text-lg {
            font-size: 18px;
          }
          .receipt-a4 .text-2xl {
            font-size: 24px;
          }
          .receipt-a4 .text-muted-foreground {
            color: #666;
          }
          .receipt-a4 .border-t-2 {
            border-top: 2px solid #999;
          }
          .receipt-a4 .border-t {
            border-top: 1px solid #999;
          }
          .receipt-a4 .border-gray-300 {
            border-color: #d1d5db;
          }
          .receipt-a4 .border-gray-200 {
            border-color: #e5e7eb;
          }
          .receipt-a4 .font-mono {
            font-family: monospace;
          }
        </style>
        <style id="__receipt-page-style"></style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `);

  printWindow.document.close();

  printWindow.onload = () => {
    if (!isA4) {
      const doc = printWindow.document;
      const body = doc.body;
      const html = doc.documentElement;
      const scrollHeightPx = Math.max(body.scrollHeight, html.scrollHeight);
      const bodyWidthPx = Math.max(body.clientWidth, html.clientWidth);
      // Derive mm-per-px from actual rendered width to avoid driver scaling.
      const mmPerPx = bodyWidthPx > 0 ? pageWidthMm / bodyWidthPx : 25.4 / 96;
      const extraMm = 4; // small buffer to avoid clipping
      const heightMm = Math.max(120, Math.ceil(scrollHeightPx * mmPerPx + extraMm + marginMm * 2));
      const styleTag = doc.getElementById('__receipt-page-style');
      if (styleTag) {
        styleTag.textContent = `
          @media print {
            @page { size: ${pageWidthMm}mm ${heightMm}mm; margin: ${margin}; }
            html, body { width: ${pageWidthMm}mm; height: ${heightMm}mm; }
          }
        `;
      }
    }

    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}

/**
 * Opens a print window for a custom label size (in millimeters).
 * Use this for label printers; margins/padding are set to 0 so content doesn't get pushed off-page.
 */
export function openPrintWindowLabel(
  htmlContent: string,
  opts: {
    widthMm: number;
    heightMm: number;
    safeMarginMm?: number;
    scale?: number;
    offsetXmm?: number;
    offsetYmm?: number;
    rotateDeg?: number;
    swapPageSize?: boolean;
  }
): void {
  const w = Number(opts.widthMm);
  const h = Number(opts.heightMm);
  const widthMm = Number.isFinite(w) && w > 0 ? w : 30;
  const heightMm = Number.isFinite(h) && h > 0 ? h : 20;
  const safeMarginMm = Number(opts.safeMarginMm);
  const safeScale = Number(opts.scale);
  // Defaults: don't shrink or add margins (other software prints perfectly for the same label size).
  // Use calibration controls (margin/scale/offset) only if the printer/driver requires it.
  const marginMm = Number.isFinite(safeMarginMm) && safeMarginMm >= 0 ? safeMarginMm : 0;
  // Allow slight upscaling too (some drivers shrink output).
  const scale = Number.isFinite(safeScale) && safeScale > 0 && safeScale <= 2 ? safeScale : 1;
  const offsetXmm = Number.isFinite(opts.offsetXmm) ? Number(opts.offsetXmm) : 0;
  const offsetYmm = Number.isFinite(opts.offsetYmm) ? Number(opts.offsetYmm) : 0;
  const rotateDegRaw = Number(opts.rotateDeg ?? 0);
  const rotateDeg = Number.isFinite(rotateDegRaw) ? rotateDegRaw : 0;
  const swapPageSize = Boolean(opts.swapPageSize);

  const pageW = swapPageSize ? heightMm : widthMm;
  const pageH = swapPageSize ? widthMm : heightMm;

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) {
    throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Label</title>
        <meta charset="utf-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          @media print {
            @page {
              size: ${pageW}mm ${pageH}mm;
              margin: 0;
            }
            html, body {
              width: ${pageW}mm;
              height: ${pageH}mm;
              margin: 0;
              padding: 0;
              background: #fff;
              color: #000;
              font-family: Arial, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              overflow: hidden;
            }
            .__label-safe {
              width: calc(100% - ${marginMm}mm);
              height: calc(100% - ${marginMm}mm);
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            }
            .__label-safe .__label-transform {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            }
            /* Apply transform to any label content (BarcodeLabel, BarcodeDesignerLabel, etc.) */
            .__label-safe .__label-transform .__label-target {
              transform: translate(${offsetXmm}mm, ${offsetYmm}mm) rotate(${rotateDeg}deg) scale(${scale});
              transform-origin: center;
            }
          }
          @media screen {
            body {
              font-family: Arial, sans-serif;
              padding: 12px;
              background: #f5f5f5;
            }
          }
        </style>
      </head>
      <body>
        <div class="__label-safe">
          <div class="__label-transform">
            <div class="__label-target">
              ${htmlContent}
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();

  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}

/**
 * Opens a print window with the given HTML content (thermal)
 */
export function openPrintWindow(htmlContent: string, paperSize: '58mm' | '78mm' | '80mm' = '78mm'): void {
  printHtml('Chek', htmlContent, paperSize);
}

/**
 * Opens print window for A4 format
 */
export function openPrintWindowA4(htmlContent: string): void {
  printHtml('Chek', htmlContent, 'A4');
}

