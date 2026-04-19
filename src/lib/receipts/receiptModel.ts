import type { CartItem, CompanySettings, Customer, OrderWithDetails, ReceiptSettings } from '@/types/database';
import { formatReceiptDateTime } from '@/lib/datetime';

export type ReceiptItem = {
  name: string;
  sku?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  lineTotal: number;
  returnedQty?: number;
  qtyTotal?: number;
};

export type ReceiptPayment = {
  method: string;
  amount: number;
};

export type ReceiptInput = {
  storeName?: string;
  storePhone?: string;
  storeAddress?: string;
  storeTaxId?: string;
  headerText?: string;
  /** Sozlamalardan: mahsulotlardan keyin, jami oldidan */
  middleText?: string;
  footerText?: string;
  showCashier: boolean;
  showCustomer: boolean;
  showSku: boolean;
  orderNumber: string;
  dateTime: string;
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  priceTier?: string;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount: number;
  totalDiscount?: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  creditAmount: number;
  remainingDebt?: number;
  payments: ReceiptPayment[];
  note?: string;
};

export type PosReceiptData = {
  orderNumber: string;
  items: CartItem[];
  customer: Customer | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string;
  dateTime: string;
  cashierName?: string;
  priceTierCode?: string | null;
  customerTotalDebt?: number;
};

const getStoreName = (company?: CompanySettings | null): string => {
  const storeNameRaw = company?.name?.trim() || (company as any)?.legal_name?.trim() || 'POS tizimi';
  return storeNameRaw === 'POS tizimi' ? '' : storeNameRaw;
};

const getStoreAddress = (company?: CompanySettings | null): string => {
  return [
    (company as any)?.address_country,
    (company as any)?.address_city,
    (company as any)?.address_street,
  ]
    .map((v: any) => String(v ?? '').trim())
    .filter(Boolean)
    .join(', ');
};

const getEffectiveDiscountAmount = (order: OrderWithDetails): number => {
  const orderLevel = Number((order as any)?.discount_amount || 0);
  if (orderLevel > 0) return orderLevel;
  const items = Array.isArray((order as any)?.items) ? ((order as any).items as any[]) : [];
  const itemsSum = items.reduce((sum, it) => sum + Number(it?.discount_amount || 0), 0);
  return itemsSum > 0 ? itemsSum : 0;
};

const buildReceiptItemsFromOrder = (order: OrderWithDetails): ReceiptItem[] => {
  return (
    order.items
      ?.filter((item: any) => {
        const remaining =
          (item.remaining_quantity ?? ((item.qty_sale ?? item.quantity) - (item.returned_quantity || 0))) ||
          (item.qty_sale ?? item.quantity) ||
          0;
        return remaining > 0;
      })
      .map((item: any) => {
        const returned = item.returned_quantity || 0;
        const unit = (item as any).sale_unit || item.product?.unit || item.unit;
        const qtySale = (item as any).qty_sale ?? item.quantity;
        const remaining =
          (item.remaining_quantity ?? (qtySale - returned)) ||
          qtySale ||
          0;
        const baseLineTotal = Number(
          item.total ??
            item.line_total ??
            item.subtotal ??
            (Number(item.unit_price || 0) * Number(qtySale || 0))
        );
        const lineTotal = baseLineTotal * (remaining / Number(qtySale || 1));
        const sku = item.product?.sku || '';

        return {
          name: String(item.product_name || item.product?.name || ''),
          sku: sku || undefined,
          qty: Number(remaining || 0),
          unit: unit || undefined,
          unitPrice: Number(item.unit_price || 0),
          lineTotal: Number(lineTotal || 0),
          returnedQty: Number(returned || 0),
          qtyTotal: Number(qtySale || 0),
        };
      }) || []
  );
};

const buildPayments = (payments: any[] | undefined | null): ReceiptPayment[] => {
  return (payments || [])
    .map((payment) => ({
      method: String(payment?.payment_method || '').toLowerCase(),
      amount: Number((payment as any)?.amount || 0),
    }))
    .filter((entry) => entry.amount > 0);
};

export function buildReceiptInputFromOrder(
  order: OrderWithDetails,
  company?: CompanySettings | null,
  settings?: ReceiptSettings | null,
  note?: string
): ReceiptInput {
  const storeName = getStoreName(company);
  const storePhone = company?.phone?.trim() || '';
  const storeAddress = getStoreAddress(company);
  const storeTaxId = String((company as any)?.tax_id ?? '').trim();

  const headerText = settings?.header_text?.trim() || '';
  const middleText = settings?.middle_text?.trim() || '';
  const footerText = settings?.footer_text?.trim() || '';

  const showCashier = settings?.show_cashier ?? true;
  const showCustomer = settings?.show_customer ?? true;
  const showSku = settings?.show_sku ?? true;

  const dateTime = formatReceiptDateTime(order.created_at);
  const cashierName = order.cashier?.username || order.cashier?.full_name || '-';
  const customerName = order.customer?.name || 'Yangi mijoz';
  const customerPhone = (order.customer as any)?.phone || '';

  const payments = buildPayments(order.payments as any);
  const paidAmount =
    Number((order as any)?.paid_amount || 0) ||
    payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const discountAmount = getEffectiveDiscountAmount(order);
  const priceTier =
    (order as any)?.price_tier_code ||
    (order as any)?.price_tier ||
    undefined;
  const creditAmount = Number(order.credit_amount || 0);
  const remainingDebt = Math.max(
    0,
    Number((order as any)?.customer_total_debt || 0) ||
      Math.max(0, -Number((order.customer as any)?.balance || 0))
  );

  return {
    storeName,
    storePhone,
    storeAddress,
    storeTaxId,
    headerText,
    middleText: middleText || undefined,
    footerText,
    showCashier,
    showCustomer,
    showSku,
    orderNumber: order.order_number,
    dateTime,
    cashierName,
    customerName,
    customerPhone,
    priceTier,
    items: buildReceiptItemsFromOrder(order),
    subtotal: Number(order.subtotal || 0),
    discountAmount,
    totalDiscount: discountAmount,
    taxAmount: Number(order.tax_amount || 0),
    totalAmount: Number(order.total_amount || 0),
    paidAmount: Number(paidAmount || 0),
    changeAmount: Number(order.change_amount || 0),
    creditAmount,
    remainingDebt,
    payments,
    note: note?.trim() || undefined,
  };
}

export function buildReceiptInputFromPos(
  data: PosReceiptData,
  company?: CompanySettings | null,
  settings?: ReceiptSettings | null
): ReceiptInput {
  const storeName = getStoreName(company);
  const storePhone = company?.phone?.trim() || '';
  const storeAddress = getStoreAddress(company);
  const storeTaxId = String((company as any)?.tax_id ?? '').trim();

  const headerText = settings?.header_text?.trim() || '';
  const middleText = settings?.middle_text?.trim() || '';
  const footerText = settings?.footer_text?.trim() || '';
  const showCashier = settings?.show_cashier ?? true;
  const showCustomer = settings?.show_customer ?? true;
  const showSku = settings?.show_sku ?? true;

  const items: ReceiptItem[] = (data.items || []).map((item) => {
    const qty = Number((item as any).qty_sale ?? item.quantity ?? 0);
    const unit = (item as any).sale_unit || item.product?.unit;
    const unitPrice = Number(item.unit_price ?? item.product?.sale_price ?? 0);
    const subtotal = Number(item.subtotal ?? unitPrice * qty);
    const discount = Number((item as any).discount_amount ?? 0);
    const lineTotal = subtotal - discount;
    return {
      name: String(item.product?.name || ''),
      sku: item.product?.sku || undefined,
      qty: Number(qty || 0),
      unit: unit || undefined,
      unitPrice,
      lineTotal: Number(lineTotal || 0),
    };
  });

  const paymentMethod = String(data.paymentMethod || '').toLowerCase();
  const payments: ReceiptPayment[] = data.paidAmount
    ? [
        {
          method: paymentMethod,
          amount: Number(data.paidAmount || 0),
        },
      ]
    : [];

  return {
    storeName,
    storePhone,
    storeAddress,
    storeTaxId,
    headerText,
    middleText: middleText || undefined,
    footerText,
    showCashier,
    showCustomer,
    showSku,
    orderNumber: data.orderNumber,
    dateTime: data.dateTime,
    cashierName: data.cashierName || '-',
    customerName: data.customer?.name || 'Yangi mijoz',
    customerPhone: (data.customer as any)?.phone || '',
    priceTier: data.priceTierCode || undefined,
    items,
    subtotal: Number(data.subtotal || 0),
    discountAmount: Number(data.discountAmount || 0),
    totalDiscount: Number(data.discountAmount || 0),
    taxAmount: 0,
    totalAmount: Number(data.total || 0),
    paidAmount: Number(data.paidAmount || 0),
    changeAmount: Number(data.changeAmount || 0),
    creditAmount: Math.max(0, Number(data.total || 0) - Number(data.paidAmount || 0)),
    remainingDebt:
      Number(data.customerTotalDebt || 0) > 0
        ? Number(data.customerTotalDebt || 0)
        : Math.max(0, Number(data.total || 0) - Number(data.paidAmount || 0)),
    payments,
  };
}
