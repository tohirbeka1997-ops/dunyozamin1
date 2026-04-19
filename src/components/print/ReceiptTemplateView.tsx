import { useEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { format } from 'date-fns';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import type { CompanySettings, OrderWithDetails, ReceiptTemplate } from '@/types/database';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { formatReceiptDateTime } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';

interface ReceiptTemplateViewProps {
  template: ReceiptTemplate;
  order: OrderWithDetails;
  company?: CompanySettings | null;
  note?: string;
  mode?: 'preview' | 'print';
  /** Chek sozlamalaridan: mahsulotlar qatorlaridan keyin */
  settingsMiddleText?: string;
}

function ReceiptBarcode({
  type,
  value,
  size,
}: {
  type: 'order_id' | 'qr';
  value: string;
  size: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (type !== 'order_id') return;
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'code128',
        displayValue: false,
        margin: 0,
        lineColor: '#000',
        background: '#fff',
        width: 1,
        height: Math.max(24, Math.floor(size / 2)),
      });
    } catch {
      // ignore barcode rendering errors
    }
  }, [type, value, size]);

  if (type === 'qr') {
    return (
      <div className="flex items-center justify-center">
        <QRCodeDataUrl text={value} width={size} />
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      style={{
        display: 'block',
        width: size,
        height: Math.max(24, Math.floor(size / 2)),
        shapeRendering: 'crispEdges',
      }}
    />
  );
}

export default function ReceiptTemplateView({
  template,
  order,
  company,
  note,
  mode = 'preview',
  settingsMiddleText,
}: ReceiptTemplateViewProps) {
  const { sections, sectionsOrder, paperWidth } = template;
  const storeNameRaw = company?.name?.trim() || (company as any)?.legal_name?.trim() || 'POS tizimi';
  const storeName = storeNameRaw === 'POS tizimi' ? '' : storeNameRaw;
  const storePhone = company?.phone?.trim() || '';
  const storeAddress = [
    (company as any)?.address_country,
    (company as any)?.address_city,
    (company as any)?.address_street,
  ]
    .map((v: any) => String(v ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const branchName = sections.header?.branchName?.trim() || '';

  const dateTime = useMemo(() => {
    const raw = new Date(order.created_at);
    const fmt = sections.orderInfo?.dateFormat || '';
    if (fmt) {
      try {
        return format(raw, fmt);
      } catch {
        return formatReceiptDateTime(order.created_at);
      }
    }
    return formatReceiptDateTime(order.created_at);
  }, [order.created_at, sections.orderInfo?.dateFormat]);

  const cashierName = order.cashier?.username || order.cashier?.full_name || '-';
  const customerName = order.customer?.name || 'Yangi mijoz';
  const customerTotalDebt = Math.max(
    0,
    Number((order as any)?.customer_total_debt || 0) ||
      Math.max(0, -Number((order.customer as any)?.balance || 0))
  );

  const getEffectiveDiscountAmount = (): number => {
    const orderLevel = Number((order as any)?.discount_amount || 0);
    if (orderLevel > 0) return orderLevel;
    const items = Array.isArray((order as any)?.items) ? ((order as any).items as any[]) : [];
    const itemsSum = items.reduce((sum, it) => sum + Number(it?.discount_amount || 0), 0);
    return itemsSum > 0 ? itemsSum : 0;
  };
  const effectiveDiscountAmount = getEffectiveDiscountAmount();

  const payments = order.payments || [];
  const paymentBreakdown = payments.reduce((acc, payment) => {
    const method = payment.payment_method;
    if (!acc[method]) acc[method] = 0;
    acc[method] += Number((payment as any)?.amount || 0);
    return acc;
  }, {} as Record<string, number>);

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Naqd pul',
    card: 'Karta',
    qr: 'QR to\'lov',
    credit: 'Kredit',
    mixed: 'Aralash',
  };

  const lineWidth = paperWidth === 58 ? 32 : 42;
  const lineSpacing = Math.max(0.6, Math.min(2, Number(sections.products?.lineSpacing || 1)));

  const normalizeSpaces = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();
  const wrapText = (value: string, width: number) => {
    const text = normalizeSpaces(value);
    if (!text) return [''];
    const lines: string[] = [];
    let start = 0;
    while (start < text.length) {
      lines.push(text.slice(start, start + width));
      start += width;
    }
    return lines;
  };
  const formatMoneyPlain = (value: number | string) => formatNumberUZ(value);
  const makeLine = (left: string, right: string) => {
    const l = normalizeSpaces(left);
    const r = normalizeSpaces(right);
    const spaceCount = Math.max(1, lineWidth - l.length - r.length);
    return `${l}${' '.repeat(spaceCount)}${r}`;
  };
  const padRight = (value: string, width: number) => value.padEnd(width, ' ').slice(0, width);
  const padLeft = (value: string, width: number) => value.padStart(width, ' ').slice(0, width);
  const makeQtyPriceTotalLine = (qty: string, price: string, total: string) => {
    const qtyCol = 8;
    const priceCol = 10;
    const totalCol = 10;
    const space = ' ';
    const left = padRight(qty, qtyCol);
    const mid = padRight(price, priceCol);
    const right = padLeft(total, totalCol);
    return `${left}${space}${mid}${space}${right}`.slice(0, lineWidth);
  };

  return (
    <div
      className="receipt-template font-semibold text-black"
      style={{
        width: `${paperWidth}mm`,
        maxWidth: `${paperWidth}mm`,
        margin: mode === 'preview' ? '0 auto' : 0,
        padding: 0,
        background: '#fff',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.4,
        fontWeight: 700,
      }}
    >
      {sectionsOrder.map((key) => {
        if (key === 'header' && sections.header?.enabled) {
          const align = sections.header.align === 'left' ? 'left' : 'center';
          return (
            <div
              key="header"
              className="mb-1"
              style={{
                textAlign: align,
                fontSize: sections.header.fontSize,
                fontWeight: 700,
              }}
            >
              {sections.header.showLogo && (company as any)?.logo_url ? (
                <div className="flex justify-center mb-1">
                  <img
                    src={(company as any)?.logo_url}
                    alt="Logo"
                    style={{ maxHeight: 40, maxWidth: '70%' }}
                  />
                </div>
              ) : null}
              {sections.header.showStoreName && storeName && <div>{storeName}</div>}
              {sections.header.showBranchName && branchName && <div>{branchName}</div>}
              {sections.header.showAddress && storeAddress && <div className="text-xs">{storeAddress}</div>}
              {sections.header.showPhone && storePhone && <div className="text-xs">{storePhone}</div>}
            </div>
          );
        }

        if (key === 'orderInfo' && sections.orderInfo?.enabled) {
          if (sections.orderInfo.layout === 'two-column') {
            return (
              <pre key="orderInfo" className="mb-2 text-xs whitespace-pre">
                {[
                  makeLine('Chek:', order.order_number),
                  makeLine('Sana:', dateTime),
                  sections.orderInfo.showCashier ? makeLine('Kassir:', cashierName) : null,
                  sections.orderInfo.showCustomer ? makeLine('Mijoz:', customerName) : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </pre>
            );
          }

          return (
            <pre key="orderInfo" className="mb-2 text-xs whitespace-pre">
              {[
                `Chek: ${order.order_number}`,
                `Sana: ${dateTime}`,
                sections.orderInfo.showCashier ? `Kassir: ${cashierName}` : null,
                sections.orderInfo.showCustomer ? `Mijoz: ${customerName}` : null,
              ]
                .filter(Boolean)
                .join('\n')}
            </pre>
          );
        }

        if (key === 'products' && sections.products?.enabled) {
          return (
            <div key="products" className="border-t border-b border-dashed border-gray-400 py-1 mb-2 text-xs">
              <pre className="whitespace-pre font-semibold">
                {makeQtyPriceTotalLine('Miqdor', 'Narx', 'Jami')}
              </pre>
              <pre className="whitespace-pre">{'-'.repeat(lineWidth)}</pre>
              {order.items
                ?.filter((item: any) => {
                  const remaining =
                    (item.remaining_quantity ?? ((item.qty_sale ?? item.quantity) - (item.returned_quantity || 0))) ||
                    (item.qty_sale ?? item.quantity) ||
                    0;
                  return remaining > 0;
                })
                .map((item: any, index) => {
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
                  const nameLines = wrapText(String(item.product_name || ''), lineWidth);
                  const qtyLine = makeQtyPriceTotalLine(
                    `${formatQuantity(remaining, unit)} x`,
                    formatMoneyPlain(item.unit_price),
                    formatMoneyPlain(lineTotal)
                  );

                  return (
                    <div key={item.id || index} style={{ marginBottom: 6 * lineSpacing }}>
                      {nameLines.map((line, idx) => (
                        <pre key={`${item.id || index}-n-${idx}`} className="whitespace-pre font-medium">
                          {line}
                        </pre>
                      ))}
                      {returned > 0 && (
                        <pre className="whitespace-pre text-red-600">{`(Qaytarilgan: ${returned})`}</pre>
                      )}
                      {sections.products.showSku && sku && (
                        <pre className="whitespace-pre text-[11px] text-gray-700">{sku}</pre>
                      )}
                      <pre className="whitespace-pre mt-1">{qtyLine}</pre>
                    </div>
                  );
                })}
              {settingsMiddleText?.trim() ? (
                <div className="mt-2 pt-2 border-t border-dashed border-gray-400 text-center">
                  <pre className="whitespace-pre-wrap">{settingsMiddleText.trim()}</pre>
                </div>
              ) : null}
            </div>
          );
        }

        if (key === 'totals' && sections.totals?.enabled) {
          return (
            <pre key="totals" className="mb-2 text-xs whitespace-pre">
              {[
                sections.totals.showSubtotal ? makeLine('Oraliq summa:', formatMoneyPlain(order.subtotal)) : null,
                sections.totals.showDiscount && effectiveDiscountAmount > 0
                  ? makeLine('Chegirma:', `-${formatMoneyPlain(effectiveDiscountAmount)}`)
                  : null,
                sections.totals.showTax && order.tax_amount > 0
                  ? makeLine('Soliq:', formatMoneyPlain(order.tax_amount))
                  : null,
                makeLine('JAMI:', formatMoneyPlain(order.total_amount)),
              ]
                .filter(Boolean)
                .join('\n')}
            </pre>
          );
        }

        if (key === 'payments' && sections.payments?.enabled && (payments.length > 0 || customerTotalDebt > 0)) {
          return (
            <pre key="payments" className="mb-2 text-xs border-t border-dashed border-gray-400 pt-2 whitespace-pre">
              {[
                'To‘lovlar:',
                ...Object.entries(paymentBreakdown).map(([method, amount]) =>
                  makeLine(`${paymentMethodLabels[method] || method}:`, formatMoneyPlain(amount))
                ),
                customerTotalDebt > 0
                  ? makeLine('Umumiy qarz:', formatMoneyPlain(customerTotalDebt))
                  : null,
              ]
                .filter(Boolean)
                .join('\n')}
            </pre>
          );
        }

        if (key === 'footer' && sections.footer?.enabled) {
          return (
            <div
              key="footer"
              className="text-xs border-t border-dashed border-gray-400 pt-2"
              style={{
                textAlign: sections.footer.align,
                fontSize: sections.footer.fontSize,
                fontWeight: 700,
              }}
            >
              {sections.footer.text ? (
                <pre className="whitespace-pre-wrap">{sections.footer.text}</pre>
              ) : null}
              {note?.trim() ? <pre className="whitespace-pre-wrap mt-1">{note.trim()}</pre> : null}
            </div>
          );
        }

        if (key === 'barcode' && sections.barcode?.enabled) {
          const align = sections.barcode.align === 'left' ? 'flex-start' : 'center';
          const value = sections.barcode.type === 'qr' ? order.order_number : order.order_number;
          return (
            <div key="barcode" className="mt-2" style={{ display: 'flex', justifyContent: align }}>
              <ReceiptBarcode type={sections.barcode.type} value={value} size={sections.barcode.size} />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
