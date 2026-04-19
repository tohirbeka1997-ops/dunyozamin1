import { formatNumberUZ } from '@/lib/format';
import { formatQuantity } from '@/utils/quantity';
import type { ReceiptInput, ReceiptPayment } from './receiptModel';

export type ReceiptLine = {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
};

export const DEFAULT_PRINTABLE_WIDTH_MM = 72;
export const DEFAULT_CHARS_PER_LINE = 48;
export const DEFAULT_CHARS_PER_LINE_58 = 32;

const normalizeSpaces = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

export const wrapText = (value: string, width: number): string[] => {
  const text = normalizeSpaces(value);
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const wordRaw of words) {
    let word = wordRaw;
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      while (word.length > width) {
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (word.length > 0) {
        current = word;
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
};

const padRight = (value: string, width: number): string => value.padEnd(width, ' ').slice(0, width);
const padLeft = (value: string, width: number): string => value.padStart(width, ' ').slice(0, width);

export const makeLine = (left: string, right: string, width: number): string => {
  const l = normalizeSpaces(left);
  const r = normalizeSpaces(right);
  if (!r) return l.slice(0, width);
  if (r.length >= width) return r.slice(0, width);
  const maxLeft = Math.max(0, width - r.length - 1);
  const leftText = l.slice(0, maxLeft);
  const spaceCount = Math.max(1, width - leftText.length - r.length);
  return `${leftText}${' '.repeat(spaceCount)}${r}`.slice(0, width);
};

const buildPaymentsLines = (payments: ReceiptPayment[], width: number): string[] => {
  if (!payments.length) return [];
  return payments.map((payment) =>
    makeLine(formatPaymentLabel(payment.method), formatNumberUZ(payment.amount), width)
  );
};

const formatPaymentLabel = (method: string): string => {
  const normalized = String(method || '').toLowerCase();
  const map: Record<string, string> = {
    cash: 'Naqd pul',
    card: 'Karta',
    qr: "QR to'lov",
    credit: 'Kredit',
    mixed: 'Aralash',
  };
  return map[normalized] || method || '-';
};

export const buildReceiptLines = (
  input: ReceiptInput,
  opts?: { charsPerLine?: number }
): ReceiptLine[] => {
  const width = Math.max(24, Number(opts?.charsPerLine || DEFAULT_CHARS_PER_LINE));
  const lines: ReceiptLine[] = [];

  const push = (text: string, align: ReceiptLine['align'] = 'left', bold = false) => {
    const safeText = text.slice(0, width);
    lines.push({ text: safeText, align, bold });
  };

  const pushWrapped = (
    value: string,
    align: ReceiptLine['align'] = 'left',
    bold = false
  ) => {
    wrapText(value, width).forEach((line) => push(line, align, bold));
  };

  if (input.storeName) pushWrapped(input.storeName, 'center', true);
  if (input.storePhone) pushWrapped(input.storePhone, 'center');
  if (input.storeAddress) pushWrapped(input.storeAddress, 'center');
  if (input.storeTaxId) pushWrapped(`STIR: ${input.storeTaxId}`, 'center');
  if (input.headerText) {
    input.headerText.split('\n').forEach((line) => pushWrapped(line, 'center'));
  }
  push('Chek', 'center');
  push('', 'center');

  push(makeLine('Chek:', input.orderNumber, width), 'left');
  push(makeLine('Sana:', input.dateTime, width), 'left');
  if (input.showCashier && input.cashierName) {
    push(makeLine('Kassir:', input.cashierName, width), 'left');
  }
  if (input.showCustomer && input.customerName) {
    push(makeLine('Mijoz:', input.customerName, width), 'left');
  }
  if (input.showCustomer && input.customerPhone) {
    push(makeLine('Tel:', input.customerPhone, width), 'left');
  }
  if (input.priceTier) {
    push(makeLine('Narx turi:', input.priceTier, width), 'left');
  }

  push('-'.repeat(width), 'left');
  push(makeLine('Miqdor x Narx', 'Jami', width), 'left', true);
  push('-'.repeat(width), 'left');

  input.items.forEach((item) => {
    const nameLines = wrapText(item.name, width);
    nameLines.forEach((line) => push(line, 'left'));

    if (input.showSku && item.sku) {
      push(item.sku, 'left');
    }

    if (item.returnedQty && item.returnedQty > 0) {
      push(`(Qaytarilgan: ${formatQuantity(item.returnedQty, item.unit)})`, 'left');
    }

    const qtyText = formatQuantity(item.qty, item.unit);
    const left = `${qtyText} x ${formatNumberUZ(item.unitPrice)}`;
    const right = formatNumberUZ(item.lineTotal);
    push(makeLine(left, right, width), 'left');
  });

  if (input.middleText?.trim()) {
    push('', 'left');
    input.middleText.split('\n').forEach((line) => pushWrapped(line.trim(), 'center'));
    push('', 'left');
  }

  push('-'.repeat(width), 'left');
  push(makeLine('Oraliq summa:', formatNumberUZ(input.subtotal), width), 'left');
  const totalDiscount = Number(input.totalDiscount ?? input.discountAmount ?? 0) || 0;
  if (totalDiscount > 0) {
    push(makeLine('Chegirma jami:', `-${formatNumberUZ(totalDiscount)}`, width), 'left');
  }
  if (input.taxAmount > 0) {
    push(makeLine('Soliq:', formatNumberUZ(input.taxAmount), width), 'left');
  }
  push(makeLine('JAMI:', formatNumberUZ(input.totalAmount), width), 'left', true);

  if (input.payments.length > 0) {
    push('', 'left');
    push('To\'lovlar:', 'left', true);
    buildPaymentsLines(input.payments, width).forEach((line) => push(line, 'left'));
  } else if (input.paidAmount > 0) {
    push(makeLine("To'landi:", formatNumberUZ(input.paidAmount), width), 'left');
  }

  if (input.changeAmount > 0) {
    push(makeLine('Qaytim:', formatNumberUZ(input.changeAmount), width), 'left');
  }
  if (input.creditAmount > 0) {
    push(makeLine('Kredit:', formatNumberUZ(input.creditAmount), width), 'left');
  }
  if (Number(input.remainingDebt || 0) > 0) {
    push(makeLine('Umumiy qarz:', formatNumberUZ(Number(input.remainingDebt || 0)), width), 'left');
  }

  push('', 'left');
  if (input.footerText) {
    input.footerText.split('\n').forEach((line) => pushWrapped(line, 'center'));
  } else {
    push('Xaridingiz uchun rahmat!', 'center');
  }

  if (input.note?.trim()) {
    pushWrapped(input.note.trim(), 'center');
  }

  return lines;
};

export const buildReceiptPlainText = (
  input: ReceiptInput,
  opts?: { charsPerLine?: number }
): string => {
  const lines = buildReceiptLines(input, opts);
  return lines.map((line) => line.text).join('\n');
};
