import type { CompanySettings, ReceiptSettings, SalesReturnWithDetails } from '@/types/database';
import { printHtml } from '@/lib/print';
import { printEscposReceipt } from '@/lib/receipts/escposPrint';
import { normalizeReceiptSettings } from '@/lib/receipts/normalizeReceiptSettings';
import {
  buildReturnReceiptEscposFromReturn,
  generateReturnReceiptHTML,
  resolveReturnReceiptPaperSize,
} from '@/lib/receipts/returnReceiptBuilder';
import { DEFAULT_CHARS_PER_LINE, DEFAULT_CHARS_PER_LINE_58 } from '@/lib/receipts/receiptTextBuilder';

export type PrintReturnReceiptOptions = {
  silent?: boolean;
  variant?: 'thermal' | 'a4';
};

/**
 * Print a sales return receipt — ESC/POS (XP-80C / print-agent) first, HTML fallback.
 */
export async function printReturnReceipt(
  returnData: SalesReturnWithDetails,
  company?: CompanySettings | null,
  settings?: ReceiptSettings | null,
  opts?: PrintReturnReceiptOptions
): Promise<'escpos' | 'html'> {
  const normalized = normalizeReceiptSettings(settings as Record<string, unknown> | null);
  const variant = opts?.variant ?? 'thermal';
  const paperSize = resolveReturnReceiptPaperSize(normalized);

  if (variant === 'thermal') {
    try {
      const lines = buildReturnReceiptEscposFromReturn(returnData, company, normalized);
      if (!lines.length) {
        throw new Error('Qaytarish cheki bo‘sh');
      }
      const charsPerLine = paperSize === '58mm' ? DEFAULT_CHARS_PER_LINE_58 : DEFAULT_CHARS_PER_LINE;
      await printEscposReceipt(lines, { charsPerLine, feedLines: 3, cut: true });
      return 'escpos';
    } catch (escposError) {
      if (!opts?.silent) {
        console.warn('[Print] Return ESC/POS failed, falling back to HTML', escposError);
      }
    }
  }

  const htmlContent = generateReturnReceiptHTML(returnData, variant, company);
  printHtml('Qaytarish cheki', htmlContent, variant === 'a4' ? 'A4' : paperSize);
  return 'html';
}
