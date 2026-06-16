'use strict';

/**
 * Pure receipt line builder (mirrors src/lib/receipts/receiptTextBuilder.ts for Node smoke tests).
 */

const DEFAULT_CHARS_PER_LINE = 48;

function formatNumberUZ(value) {
  const n = Math.round(Number(value) || 0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function wrapText(value, width) {
  const text = normalizeSpaces(value);
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
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
      if (word.length > 0) current = word;
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
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function makeLine(left, right, width) {
  const l = normalizeSpaces(left);
  const r = normalizeSpaces(right);
  if (!r) return l.slice(0, width);
  if (r.length >= width) return r.slice(0, width);
  const maxLeft = Math.max(0, width - r.length - 1);
  const leftText = l.slice(0, maxLeft);
  const spaceCount = Math.max(1, width - leftText.length - r.length);
  return `${leftText}${' '.repeat(spaceCount)}${r}`.slice(0, width);
}

function buildReceiptLines(input, opts = {}) {
  const width = Math.max(24, Number(opts.charsPerLine || DEFAULT_CHARS_PER_LINE));
  const lines = [];
  const push = (text, align = 'left', bold = false) => {
    lines.push({ text: String(text).slice(0, width), align, bold });
  };
  const pushWrapped = (value, align = 'left', bold = false) => {
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

  push(makeLine('Chek:', input.orderNumber, width));
  push(makeLine('Sana:', input.dateTime, width));
  if (input.showCashier && input.cashierName) push(makeLine('Kassir:', input.cashierName, width));
  if (input.showCustomer && input.customerName) push(makeLine('Mijoz:', input.customerName, width));
  if (input.showCustomer && input.customerPhone) push(makeLine('Tel:', input.customerPhone, width));

  push('-'.repeat(width));
  push(makeLine('Miqdor x Narx', 'Jami', width), 'left', true);
  push('-'.repeat(width));

  for (const item of input.items || []) {
    wrapText(item.name, width).forEach((line) => push(line));
    if (input.showSku && item.sku) push(item.sku);
    const left = `${item.qty} x ${formatNumberUZ(item.unitPrice)}`;
    push(makeLine(left, formatNumberUZ(item.lineTotal), width));
  }

  push('-'.repeat(width));
  push(makeLine('Oraliq summa:', formatNumberUZ(input.subtotal), width));
  const totalDiscount = Number(input.totalDiscount ?? input.discountAmount ?? 0) || 0;
  if (totalDiscount > 0) {
    push(makeLine('Chegirma jami:', `-${formatNumberUZ(totalDiscount)}`, width));
  }
  if (Number(input.taxAmount) > 0) {
    push(makeLine('Soliq:', formatNumberUZ(input.taxAmount), width));
  }
  push(makeLine('JAMI:', formatNumberUZ(input.totalAmount), width), 'left', true);

  if ((input.payments || []).length > 0) {
    push('', 'left');
    push("To'lovlar:", 'left', true);
    for (const p of input.payments) {
      push(makeLine(p.method || 'Naqd', formatNumberUZ(p.amount), width));
    }
  } else if (Number(input.paidAmount) > 0) {
    push(makeLine("To'landi:", formatNumberUZ(input.paidAmount), width));
  }
  if (Number(input.changeAmount) > 0) {
    push(makeLine('Qaytim:', formatNumberUZ(input.changeAmount), width));
  }
  if (Number(input.creditAmount) > 0) {
    push(makeLine('Kredit:', formatNumberUZ(input.creditAmount), width));
  }

  push('', 'left');
  if (input.footerText) {
    input.footerText.split('\n').forEach((line) => pushWrapped(line, 'center'));
  } else {
    push('Xaridingiz uchun rahmat!', 'center');
  }

  return lines;
}

function buildReceiptInputFromOrder(order, company, settings) {
  const payments = (order.payments || [])
    .map((p) => ({
      method: String(p.payment_method || 'cash').toLowerCase() === 'cash' ? 'Naqd pul' : p.payment_method,
      amount: Number(p.amount || 0),
    }))
    .filter((p) => p.amount > 0);

  return {
    storeName: company?.name || company?.store_name || 'Do\'kon',
    storePhone: company?.phone || '',
    storeAddress: company?.address || '',
    storeTaxId: company?.tax_id || '',
    headerText: settings?.header_text || '',
    footerText: settings?.footer_text || '',
    showCashier: settings?.show_cashier !== false,
    showCustomer: settings?.show_customer !== false,
    showSku: settings?.show_sku !== false,
    orderNumber: order.order_number,
    dateTime: String(order.created_at || '').slice(0, 19),
    cashierName: order.cashier?.username || order.cashier?.full_name || '-',
    customerName: order.customer?.name || 'Yangi mijoz',
    customerPhone: order.customer?.phone || '',
    items: (order.items || []).map((it) => ({
      name: it.product_name || it.name || 'Mahsulot',
      sku: it.product_sku || it.sku || '',
      qty: Number(it.quantity || it.qty_sale || 0),
      unit: it.product_unit || it.unit || 'dona',
      unitPrice: Number(it.unit_price || 0),
      lineTotal: Number(it.line_total || 0),
    })),
    subtotal: Number(order.subtotal || order.total_amount || 0),
    discountAmount: Number(order.discount_amount || 0),
    totalDiscount: Number(order.discount_amount || 0),
    taxAmount: Number(order.tax_amount || 0),
    totalAmount: Number(order.total_amount || 0),
    paidAmount: Number(order.paid_amount || 0) || payments.reduce((s, p) => s + p.amount, 0),
    changeAmount: Number(order.change_amount || 0),
    creditAmount: Number(order.credit_amount || 0),
    payments,
  };
}

function buildReceiptInputFromPos(data, company, settings) {
  const showCashier = settings?.show_cashier !== false;
  const showCustomer = settings?.show_customer !== false;
  const showSku = settings?.show_sku !== false;
  const items = (data.items || []).map((item) => {
    const qty = Number(item.qty_sale ?? item.quantity ?? 0);
    const unitPrice = Number(item.unit_price ?? item.product?.sale_price ?? 0);
    const lineTotal = Number(item.line_total ?? item.total ?? unitPrice * qty);
    return {
      name: String(item.product?.name || item.product_name || 'Mahsulot'),
      sku: showSku ? item.product?.sku || item.sku || '' : '',
      qty,
      unit: item.sale_unit || item.product?.unit || 'dona',
      unitPrice,
      lineTotal,
    };
  });
  const paid = Number(data.paidAmount || 0);
  const total = Number(data.total || 0);
  const paymentMethod = String(data.paymentMethod || 'cash').toLowerCase();
  const payments =
    paid > 0
      ? [
          {
            method:
              paymentMethod === 'cash'
                ? 'Naqd pul'
                : paymentMethod === 'card'
                  ? 'Karta'
                  : data.paymentMethod || 'To\'lov',
            amount: paid,
          },
        ]
      : [];

  return {
    storeName: company?.name || company?.store_name || 'Do\'kon',
    storePhone: company?.phone || '',
    storeAddress: company?.address || '',
    storeTaxId: company?.tax_id || '',
    headerText: settings?.header_text || '',
    middleText: settings?.middle_text || '',
    footerText: settings?.footer_text || '',
    showCashier,
    showCustomer,
    showSku,
    orderNumber: data.orderNumber || 'N/A',
    dateTime: data.dateTime || '',
    cashierName: data.cashierName || '-',
    customerName: data.customer?.name || 'Yangi mijoz',
    customerPhone: data.customer?.phone || '',
    priceTier: data.priceTierCode || undefined,
    items,
    subtotal: Number(data.subtotal || 0),
    discountAmount: Number(data.discountAmount || 0),
    totalDiscount: Number(data.discountAmount || 0),
    taxAmount: Number(data.taxAmount || 0),
    totalAmount: total,
    paidAmount: paid,
    changeAmount: Number(data.changeAmount || 0),
    creditAmount: Math.max(0, total - paid),
    remainingDebt: Number(data.customerTotalDebt || 0),
    payments,
  };
}

function shouldAutoPrintReceipt(settings) {
  if (!settings || typeof settings !== 'object') return true;
  if (settings.auto_print === false || settings.auto_print === 0) return false;
  const s = String(settings.auto_print ?? '').toLowerCase();
  if (s === '0' || s === 'false' || s === 'no') return false;
  return true;
}

module.exports = {
  DEFAULT_CHARS_PER_LINE,
  formatNumberUZ,
  wrapText,
  makeLine,
  buildReceiptLines,
  buildReceiptInputFromOrder,
  buildReceiptInputFromPos,
  shouldAutoPrintReceipt,
};
