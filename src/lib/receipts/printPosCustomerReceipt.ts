import type { CompanySettings, ReceiptSettings } from '@/types/database';
import { buildReceiptInputFromPos, type PosReceiptData } from '@/lib/receipts/receiptModel';
import {
  buildReceiptLines,
  DEFAULT_CHARS_PER_LINE,
  DEFAULT_CHARS_PER_LINE_58,
} from '@/lib/receipts/receiptTextBuilder';
import { printEscposReceipt } from '@/lib/receipts/escposPrint';
import { normalizeReceiptSettings } from '@/lib/receipts/normalizeReceiptSettings';

export type PosPrintResult = {
  transport: 'escpos' | 'none';
};

/**
 * Mijoz cheki — ESC/POS (Electron IPC yoki print-agent).
 * Muvaffaqiyatda printerga yuboriladi; xato bo‘lsa caller HTML fallback qiladi.
 */
export async function printPosCustomerReceiptEscpos(
  data: PosReceiptData,
  company: CompanySettings | null | undefined,
  settings: ReceiptSettings | null | undefined,
): Promise<PosPrintResult> {
  const normalized = normalizeReceiptSettings(settings as unknown as Record<string, unknown> | null);
  const receiptInput = buildReceiptInputFromPos(data, company, normalized);
  const charsPerLine =
    normalized.paper_size === '58mm' ? DEFAULT_CHARS_PER_LINE_58 : DEFAULT_CHARS_PER_LINE;
  const lines = buildReceiptLines(receiptInput, { charsPerLine });
  await printEscposReceipt(lines, {
    charsPerLine,
    feedLines: 6,
    cut: true,
  });
  return { transport: 'escpos' };
}
