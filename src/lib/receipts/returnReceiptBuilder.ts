import type { CompanySettings, ReceiptSettings, SalesReturnWithDetails } from '@/types/database';
import { formatOrderMoney, formatReturnMoney } from '@/lib/currency';
import { formatReceiptDateTime } from '@/lib/datetime';
import { formatNumberUZ } from '@/lib/format';
import { formatQuantity } from '@/utils/quantity';
import {
  DEFAULT_CHARS_PER_LINE,
  DEFAULT_CHARS_PER_LINE_58,
  makeLine,
  type ReceiptLine,
} from '@/lib/receipts/receiptTextBuilder';

export type ReturnReceiptItem = {
  name: string;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  lineTotal: number;
  priceSource?: string | null;
};

export type ReturnReceiptInput = {
  storeName: string;
  returnNumber: string;
  orderNumber: string;
  sourceLabel: string;
  dateTime: string;
  statusLabel: string;
  cashierName: string;
  customerName: string;
  reason?: string | null;
  notes?: string | null;
  isManual: boolean;
  isPending: boolean;
  items: ReturnReceiptItem[];
  totalAmount: number;
  orderCurrency?: string | null;
};

function getStoreName(company?: CompanySettings | null): string {
  const raw = company?.name?.trim() || (company as { legal_name?: string })?.legal_name?.trim() || 'POS tizimi';
  return raw || 'POS tizimi';
}

function normalizeReturnItem(item: Record<string, unknown>): ReturnReceiptItem {
  const quantity = Number(item.qty_sale ?? item.quantity ?? item.current_quantity ?? 0) || 0;
  const unit = (item.sale_unit as string) || (item.product as { unit?: string })?.unit || (item.unit as string) || null;
  const unitPrice = Number(item.unit_price ?? item.final_unit_price ?? 0) || 0;
  const lineTotal = Number(item.line_total ?? item.final_total ?? unitPrice * quantity) || 0;
  const product = item.product as { name?: string } | null | undefined;
  const name = String(item.product_name || product?.name || 'Mahsulot').trim() || 'Mahsulot';
  return {
    name,
    quantity,
    unit,
    unitPrice,
    lineTotal,
    priceSource: (item.price_source as string) || null,
  };
}

export function buildReturnReceiptInput(
  returnData: SalesReturnWithDetails,
  company?: CompanySettings | null
): ReturnReceiptInput {
  const statusLabels: Record<string, string> = {
    Completed: 'Yakunlangan',
    Pending: 'Kutilmoqda',
    Cancelled: 'Bekor qilingan',
    Draft: 'Qoralama',
  };
  const isManual = returnData.return_mode === 'manual';
  const orderCur =
    (returnData as { order_currency?: string }).order_currency ?? returnData.order?.currency ?? 'UZS';

  return {
    storeName: getStoreName(company),
    returnNumber: returnData.return_number,
    orderNumber: returnData.order?.order_number || 'Ordersiz',
    sourceLabel: isManual ? 'Ordersiz qaytarish' : 'Buyurtma bo‘yicha qaytarish',
    dateTime: formatReceiptDateTime(returnData.created_at),
    statusLabel: statusLabels[returnData.status] || returnData.status,
    cashierName: returnData.cashier?.username || returnData.cashier?.full_name || '-',
    customerName: returnData.customer?.name || 'Yangi mijoz',
    reason: returnData.reason ?? returnData.return_reason ?? null,
    notes: returnData.notes ?? null,
    isManual,
    isPending: returnData.status === 'Pending' || returnData.status === 'Draft',
    items: (returnData.items || []).map((item) => normalizeReturnItem(item as Record<string, unknown>)),
    totalAmount: Number(returnData.total_amount ?? returnData.refund_amount ?? 0) || 0,
    orderCurrency: orderCur,
  };
}

export function buildReturnReceiptEscposLines(
  input: ReturnReceiptInput,
  opts?: { charsPerLine?: number }
): ReceiptLine[] {
  const width = Math.max(24, Number(opts?.charsPerLine || DEFAULT_CHARS_PER_LINE));
  const lines: ReceiptLine[] = [];
  const push = (text: string, align: ReceiptLine['align'] = 'left', bold = false) => {
    lines.push({ text: String(text).slice(0, width), align, bold });
  };
  const orderCur = { currency: input.orderCurrency ?? 'UZS' };
  const fmt = (amount: number) => formatNumberUZ(amount);

  if (input.storeName) push(input.storeName, 'center', true);
  push('Sotuv qaytarilishi cheki', 'center');
  push('', 'center');
  push(makeLine('Qaytarish:', input.returnNumber, width));
  push(makeLine('Buyurtma:', input.orderNumber, width));
  push(makeLine('Manba:', input.sourceLabel, width));
  push(makeLine('Sana:', input.dateTime, width));
  push(makeLine('Holati:', input.statusLabel, width));
  push(makeLine('Kassir:', input.cashierName, width));
  push(makeLine('Mijoz:', input.customerName, width));
  if (input.reason?.trim()) push(makeLine('Sabab:', input.reason.trim(), width));
  push('-'.repeat(width));
  push(makeLine('Miqdor x Narx', 'Jami', width), 'left', true);
  push('-'.repeat(width));

  for (const item of input.items) {
    push(item.name.slice(0, width));
    if (input.isManual && item.priceSource) {
      push(`Narx turi: ${item.priceSource === 'usta' ? 'Usta' : 'Oddiy'}`);
    }
    const qtyText = formatQuantity(item.quantity, item.unit || undefined);
    push(makeLine(`${qtyText} x ${fmt(item.unitPrice)}`, fmt(item.lineTotal), width));
  }

  push('-'.repeat(width));
  push(makeLine('JAMI QAYTARILGAN:', fmt(input.totalAmount), width), 'left', true);
  if (input.notes?.trim()) {
    push('', 'left');
    push('Izoh:', 'left', true);
    push(input.notes.trim());
  }
  push('', 'left');
  push('Rahmat!', 'center');
  return lines;
}

export function generateReturnReceiptHTML(
  returnData: SalesReturnWithDetails,
  variant: 'thermal' | 'a4',
  company?: CompanySettings | null
): string {
  const input = buildReturnReceiptInput(returnData, company);
  const orderCur = { currency: input.orderCurrency ?? 'UZS' };
  const fmtLine = (amount: number) => formatOrderMoney(orderCur, amount);
  const fmtTotal = () =>
    formatReturnMoney(
      { total_amount: input.totalAmount, refund_amount: input.totalAmount },
      orderCur
    );

  if (variant === 'a4') {
    return `
      <div class="return-receipt-a4">
        ${input.isPending ? '<div class="text-center mb-4 p-2 bg-yellow-100 border-2 border-yellow-400 rounded"><p class="font-bold text-yellow-800">QORALAMA / JARAYONDA</p></div>' : ''}
        <div class="text-center mb-6">
          <h1 class="text-2xl font-bold mb-2">${input.storeName}</h1>
          <p class="text-sm text-muted-foreground">Sotuv qaytarilishi cheki</p>
        </div>
        <div class="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div><p class="font-semibold">Qaytarish raqami:</p><p class="font-mono">${input.returnNumber}</p></div>
          <div><p class="font-semibold">Manba:</p><p>${input.sourceLabel}</p></div>
          <div><p class="font-semibold">Buyurtma raqami:</p><p class="font-mono">${input.orderNumber}</p></div>
          <div><p class="font-semibold">Sana va vaqt:</p><p>${input.dateTime}</p></div>
          <div><p class="font-semibold">Holati:</p><p>${input.statusLabel}</p></div>
          <div><p class="font-semibold">Kassir:</p><p>${input.cashierName}</p></div>
          <div><p class="font-semibold">Mijoz:</p><p>${input.customerName}</p></div>
        </div>
        ${input.reason ? `<div class="mb-6"><p class="font-semibold mb-2">Qaytarish sababi:</p><p class="text-sm">${input.reason}</p></div>` : ''}
        <div class="mb-6">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-gray-300">
                <th class="text-left py-2 px-2">Mahsulot</th>
                <th class="text-center py-2 px-2">Miqdor</th>
                <th class="text-right py-2 px-2">Narx</th>
                <th class="text-right py-2 px-2">Jami</th>
              </tr>
            </thead>
            <tbody>
              ${input.items
                .map(
                  (item) => `
                  <tr class="border-b border-gray-200">
                    <td class="py-2 px-2">
                      <div>${item.name}</div>
                      ${
                        input.isManual
                          ? `<div class="text-xs text-muted-foreground">Narx turi: ${item.priceSource === 'usta' ? 'Usta' : 'Oddiy'}</div>`
                          : ''
                      }
                    </td>
                    <td class="text-center py-2 px-2">${formatQuantity(item.quantity, item.unit || undefined)}</td>
                    <td class="text-right py-2 px-2">${fmtLine(item.unitPrice)}</td>
                    <td class="text-right py-2 px-2 font-medium">${fmtLine(item.lineTotal)}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="mb-6 space-y-2 text-sm">
          <div class="flex justify-between font-bold text-lg border-t-2 border-gray-300 pt-2">
            <span>Jami qaytarilgan summa:</span>
            <span>${fmtTotal()}</span>
          </div>
        </div>
        ${input.notes ? `<div class="mb-6"><p class="font-semibold mb-2">Izoh:</p><p class="text-sm text-muted-foreground">${input.notes}</p></div>` : ''}
        <div class="text-center mt-8 pt-4 border-t border-gray-300">
          <p class="text-sm text-muted-foreground">Rahmat!</p>
          <p class="text-xs text-muted-foreground mt-2">${input.dateTime}</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="return-receipt-thermal">
      ${input.isPending ? '<div class="text-center mb-2 p-1 border border-yellow-400 rounded"><p class="text-xs font-bold text-yellow-800">QORALAMA</p></div>' : ''}
      <div class="text-center mb-2">
        <h2 class="text-lg font-bold">${input.storeName}</h2>
        <p class="text-xs">Sotuv qaytarilishi cheki</p>
      </div>
      <div class="text-center mb-3 text-xs">
        <p class="font-mono">${input.returnNumber}</p>
        <p class="font-mono">Buyurtma: ${input.orderNumber}</p>
        <p>${input.sourceLabel}</p>
        <p>${input.dateTime}</p>
      </div>
      <div class="mb-3 text-xs space-y-1">
        <div class="flex justify-between"><span>Holati:</span><span class="font-semibold">${input.statusLabel}</span></div>
        <div class="flex justify-between"><span>Kassir:</span><span>${input.cashierName}</span></div>
        <div class="flex justify-between"><span>Mijoz:</span><span>${input.customerName}</span></div>
      </div>
      ${input.reason ? `<div class="mb-3 text-xs"><p class="font-semibold">Sabab:</p><p>${input.reason}</p></div>` : ''}
      <div class="border-t border-b border-dashed border-gray-400 py-2 mb-3">
        ${input.items
          .map(
            (item) => `
          <div class="mb-2 text-xs">
            <div class="font-medium">${item.name}</div>
            ${
              input.isManual
                ? `<div class="text-[11px] text-gray-600">Narx turi: ${item.priceSource === 'usta' ? 'Usta' : 'Oddiy'}</div>`
                : ''
            }
            <div class="flex justify-between mt-1">
              <span class="text-gray-600">${formatQuantity(item.quantity, item.unit || undefined)} x ${fmtLine(item.unitPrice)}</span>
              <span class="font-semibold">${fmtLine(item.lineTotal)}</span>
            </div>
          </div>`
          )
          .join('')}
      </div>
      <div class="mb-3 text-xs">
        <div class="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1">
          <span>JAMI QAYTARILGAN:</span>
          <span>${fmtTotal()}</span>
        </div>
      </div>
      ${input.notes ? `<div class="mb-3 text-xs border-t border-dashed border-gray-400 pt-2"><p class="font-semibold">Izoh:</p><p class="text-gray-600">${input.notes}</p></div>` : ''}
      <div class="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
        <p class="text-xs">Rahmat!</p>
        <p class="text-xs text-gray-500 mt-1">${input.dateTime}</p>
      </div>
    </div>
  `;
}

export function resolveReturnReceiptPaperSize(
  settings?: ReceiptSettings | null
): '58mm' | '78mm' | '80mm' {
  const size = String(settings?.paper_size || '78mm');
  if (size === '58mm' || size === '80mm') return size;
  return '78mm';
}

export function buildReturnReceiptEscposFromReturn(
  returnData: SalesReturnWithDetails,
  company?: CompanySettings | null,
  settings?: ReceiptSettings | null
): ReceiptLine[] {
  const input = buildReturnReceiptInput(returnData, company);
  const charsPerLine =
    resolveReturnReceiptPaperSize(settings) === '58mm'
      ? DEFAULT_CHARS_PER_LINE_58
      : DEFAULT_CHARS_PER_LINE;
  return buildReturnReceiptEscposLines(input, { charsPerLine });
}
