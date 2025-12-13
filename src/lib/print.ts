/**
 * Print utility functions for receipts
 */

/**
 * Generic function to print HTML content
 */
export function printHtml(title: string, htmlContent: string, pageSize: '80mm' | 'A4' = '80mm'): void {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  
  if (!printWindow) {
    throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
  }

  const isA4 = pageSize === 'A4';
  const pageSizeCss = isA4 ? 'A4' : '80mm auto';
  const margin = isA4 ? '20mm' : '6mm';
  const fontFamily = isA4 ? 'Arial, sans-serif' : "'Courier New', monospace";
  const fontSize = isA4 ? '14px' : '11px';
  const lineHeight = isA4 ? '1.6' : '1.3';

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
          @media print {
            @page {
              size: ${pageSizeCss};
              margin: ${margin};
            }
            body {
              margin: 0;
              padding: ${margin};
              font-family: ${fontFamily};
              font-size: ${fontSize};
              line-height: ${lineHeight};
              color: #000;
            }
            .no-print {
              display: none;
            }
          }
          @media screen {
            body {
              font-family: ${fontFamily};
              font-size: ${fontSize};
              padding: 20px;
              max-width: ${isA4 ? '210mm' : '80mm'};
              margin: 0 auto;
              background: #f5f5f5;
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
          .receipt-thermal h2 {
            font-size: 14px;
            margin-bottom: 4px;
          }
          .receipt-thermal .text-xs {
            font-size: 10px;
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
          .receipt-thermal .text-gray-600 {
            color: #666;
          }
          .receipt-thermal .mb-2 {
            margin-bottom: 8px;
          }
          .receipt-thermal .mb-3 {
            margin-bottom: 12px;
          }
          .receipt-thermal .mt-1 {
            margin-top: 4px;
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
      </head>
      <body>
        ${htmlContent}
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
 * Opens a print window with the given HTML content (thermal 80mm)
 */
export function openPrintWindow(htmlContent: string): void {
  printHtml('Chek', htmlContent, '80mm');
}

/**
 * Opens print window for A4 format
 */
export function openPrintWindowA4(htmlContent: string): void {
  printHtml('Chek', htmlContent, 'A4');
}

