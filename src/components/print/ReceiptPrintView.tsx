import type { CompanySettings, OrderWithDetails, ReceiptSettings } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { formatReceiptDateTime } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';

interface ReceiptPrintViewProps {
  order: OrderWithDetails;
  variant?: 'thermal' | 'a4';
  company?: CompanySettings;
  settings?: ReceiptSettings;
  note?: string;
}

export default function ReceiptPrintView({
  order,
  variant = 'thermal',
  company,
  settings,
  note,
}: ReceiptPrintViewProps) {
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
  const storeTaxId = String((company as any)?.tax_id ?? '').trim();
  const headerText = settings?.header_text?.trim() || '';
  const middleText = settings?.middle_text?.trim() || '';
  const footerText = settings?.footer_text?.trim() || '';
  const showCashier = settings?.show_cashier ?? true;
  const showCustomer = settings?.show_customer ?? true;
  const showSku = settings?.show_sku ?? true;
  const paperSize = settings?.paper_size ?? '78mm';

  const thermalWidth =
    paperSize === '58mm' ? '58mm' : paperSize === '78mm' ? '78mm' : '80mm';
  const thermalWidthStyle =
    variant === 'thermal'
      ? {
          width: thermalWidth,
          maxWidth: thermalWidth,
          margin: '0 auto',
        }
      : undefined;
  const dateTime = formatReceiptDateTime(order.created_at);
  const cashierName = order.cashier?.username || order.cashier?.full_name || '-';
  const customerName = order.customer?.name || 'Yangi mijoz';
  const priceTierLabel = (order as any)?.price_tier_code || (order as any)?.price_tier || '';
  const customerTotalDebt = Math.max(
    0,
    Number((order as any)?.customer_total_debt || 0) ||
      Math.max(0, -Number((order.customer as any)?.balance || 0))
  );

  // Match OrderDetail behavior: if order-level discount is 0, fall back to sum of item discounts
  const getEffectiveDiscountAmount = (): number => {
    const orderLevel = Number((order as any)?.discount_amount || 0);
    if (orderLevel > 0) return orderLevel;
    const items = Array.isArray((order as any)?.items) ? ((order as any).items as any[]) : [];
    const itemsSum = items.reduce((sum, it) => sum + Number(it?.discount_amount || 0), 0);
    return itemsSum > 0 ? itemsSum : 0;
  };
  const effectiveDiscountAmount = getEffectiveDiscountAmount();

  // Calculate payment breakdown
  const payments = order.payments || [];
  const paymentBreakdown = payments.reduce((acc, payment) => {
    const method = payment.payment_method;
    if (!acc[method]) {
      acc[method] = 0;
    }
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

  if (variant === 'a4') {
    return (
      <div className="receipt-a4 font-semibold">
        <div className="text-center mb-6">
          {storeName && <h1 className="text-2xl font-bold mb-2">{storeName}</h1>}
          {storePhone && <p className="text-sm text-muted-foreground">{storePhone}</p>}
          {storeAddress && <p className="text-sm text-muted-foreground">{storeAddress}</p>}
          {storeTaxId && <p className="text-sm text-muted-foreground">STIR: {storeTaxId}</p>}
          {headerText && <p className="text-sm mt-2 whitespace-pre-wrap">{headerText}</p>}
          <p className="text-sm text-muted-foreground mt-2">Chek</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="font-semibold">Buyurtma raqami:</p>
            <p className="font-mono">{order.order_number}</p>
          </div>
          <div>
            <p className="font-semibold">Sana va vaqt:</p>
            <p>{dateTime}</p>
          </div>
          {showCashier && (
            <div>
              <p className="font-semibold">Kassir:</p>
              <p>{cashierName}</p>
            </div>
          )}
          {showCustomer && (
            <div>
              <p className="font-semibold">Mijoz:</p>
              <p>{customerName}</p>
            </div>
          )}
          {priceTierLabel && (
            <div>
              <p className="font-semibold">Narx turi:</p>
              <p>{priceTierLabel}</p>
            </div>
          )}
        </div>

        <div className="mb-6">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="text-left py-2 px-2">Mahsulot</th>
                <th className="text-center py-2 px-2">Miqdor</th>
                <th className="text-right py-2 px-2">Narx</th>
                <th className="text-right py-2 px-2">Jami</th>
              </tr>
            </thead>
            <tbody>
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

                  return (
                    <tr key={item.id || index} className="border-b border-gray-200">
                      <td className="py-2 px-2">
                        <div>
                          {item.product_name}
                          {returned > 0 && (
                            <span className="text-xs text-red-600 ml-2">(Qaytarilgan: {returned})</span>
                          )}
                        </div>
                        {showSku && sku && (
                          <div className="text-xs text-muted-foreground font-mono">SKU: {sku}</div>
                        )}
                      </td>
                      <td className="text-center py-2 px-2">
                        <div>{formatQuantity(remaining, unit)}</div>
                        {returned > 0 && (
                          <div className="text-xs text-muted-foreground">Jami: {formatQuantity(item.quantity, unit)}</div>
                        )}
                      </td>
                      <td className="text-right py-2 px-2">{formatMoneyUZS(item.unit_price)}</td>
                      <td className="text-right py-2 px-2 font-medium">{formatMoneyUZS(lineTotal)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {middleText && (
          <div className="mb-6 text-sm text-center whitespace-pre-wrap border-t border-dashed border-gray-300 pt-4">
            {middleText}
          </div>
        )}

        {note?.trim() && (
          <div className="mb-6 text-sm">
            <p className="font-semibold mb-1">Izoh:</p>
            <p className="whitespace-pre-wrap">{note.trim()}</p>
          </div>
        )}

        <div className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Jami (chegirma oldidan):</span>
            <span>{formatMoneyUZS(order.subtotal)}</span>
          </div>
          {effectiveDiscountAmount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Chegirma:</span>
              <span>-{formatMoneyUZS(effectiveDiscountAmount)}</span>
            </div>
          )}
          {order.tax_amount > 0 && (
            <div className="flex justify-between">
              <span>Soliq:</span>
              <span>{formatMoneyUZS(order.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg border-t-2 border-gray-300 pt-2">
            <span>Jami:</span>
            <span>{formatMoneyUZS(order.total_amount)}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <div className="mb-6">
            <p className="font-semibold mb-2">To'lovlar:</p>
            <div className="space-y-1 text-sm">
              {Object.entries(paymentBreakdown).map(([method, amount]) => (
                <div key={method} className="flex justify-between">
                  <span>{paymentMethodLabels[method] || method}:</span>
                  <span>{formatMoneyUZS(amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {order.change_amount > 0 && (
          <div className="mb-6">
            <div className="flex justify-between font-semibold">
              <span>Qaytim:</span>
              <span>{formatMoneyUZS(order.change_amount)}</span>
            </div>
          </div>
        )}

        {order.credit_amount > 0 && (
          <div className="mb-6">
            <div className="flex justify-between font-semibold text-orange-600">
              <span>Kredit:</span>
              <span>{formatMoneyUZS(order.credit_amount)}</span>
            </div>
          </div>
        )}

        {customerTotalDebt > 0 && (
          <div className="mb-6">
            <div className="flex justify-between font-semibold text-orange-600">
              <span>Umumiy qarz:</span>
              <span>{formatMoneyUZS(customerTotalDebt)}</span>
            </div>
          </div>
        )}

        <div className="text-center mt-8 pt-4 border-t border-gray-300">
          {footerText && <p className="text-sm mb-2 whitespace-pre-wrap">{footerText}</p>}
          <p className="text-sm text-muted-foreground">Xaridingiz uchun rahmat!</p>
        </div>
      </div>
    );
  }

  // Thermal receipt
  return (
    <div className="receipt-thermal font-semibold" style={thermalWidthStyle}>
      <div className="text-center mb-2">
        {storeName && <h2 className="text-lg font-bold">{storeName}</h2>}
        {storePhone && <p className="text-xs">{storePhone}</p>}
        {storeAddress && <p className="text-xs">{storeAddress}</p>}
        {storeTaxId && <p className="text-xs">STIR: {storeTaxId}</p>}
        {headerText && <p className="text-xs mt-1 whitespace-pre-wrap">{headerText}</p>}
        <p className="text-xs">Chek</p>
      </div>

      <div className="text-center mb-3 text-xs">
        <p className="font-mono">{order.order_number}</p>
        <p>{dateTime}</p>
      </div>

      {(showCashier || showCustomer) && (
        <div className="mb-3 text-xs space-y-1">
          {showCashier && (
            <div className="flex justify-between">
              <span>Kassir:</span>
              <span>{cashierName}</span>
            </div>
          )}
          {showCustomer && (
            <div className="flex justify-between">
              <span>Mijoz:</span>
              <span>{customerName}</span>
            </div>
          )}
          {priceTierLabel && (
            <div className="flex justify-between">
              <span>Narx turi:</span>
              <span>{priceTierLabel}</span>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3">
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

            return (
              <div key={item.id || index} className="mb-2 text-xs">
                <div className="font-medium">
                  {item.product_name}
                  {returned > 0 && <span className="text-red-600"> (Qaytarilgan: {returned})</span>}
                </div>
                {showSku && sku && <div className="text-[11px] text-gray-600 font-mono">{sku}</div>}
                <div className="flex justify-between mt-1">
                  <span className="text-gray-600">
                    {formatQuantity(remaining, unit)} x {formatMoneyUZS(item.unit_price)}
                    {returned > 0 ? ` (Jami: ${formatQuantity(qtySale, unit)})` : ''}
                  </span>
                  <span className="font-semibold">{formatMoneyUZS(lineTotal)}</span>
                </div>
              </div>
            );
          })}
      </div>

      {middleText && (
        <div className="mb-3 text-xs text-center whitespace-pre-wrap border-t border-dashed border-gray-400 pt-2">
          {middleText}
        </div>
      )}

      {note?.trim() && (
        <div className="mb-3 text-xs">
          <p className="font-semibold mb-1">Izoh:</p>
          <p className="whitespace-pre-wrap">{note.trim()}</p>
        </div>
      )}

      <div className="mb-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span>Jami:</span>
          <span>{formatMoneyUZS(order.subtotal)}</span>
        </div>
        {effectiveDiscountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Chegirma:</span>
            <span>-{formatMoneyUZS(effectiveDiscountAmount)}</span>
          </div>
        )}
        {order.tax_amount > 0 && (
          <div className="flex justify-between">
            <span>Soliq:</span>
            <span>{formatMoneyUZS(order.tax_amount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1">
          <span>JAMI:</span>
          <span>{formatMoneyUZS(order.total_amount)}</span>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="mb-3 text-xs border-t border-dashed border-gray-400 pt-2">
          <p className="font-semibold mb-1">To'lovlar:</p>
          {Object.entries(paymentBreakdown).map(([method, amount]) => (
            <div key={method} className="flex justify-between">
              <span>{paymentMethodLabels[method] || method}:</span>
              <span>{formatMoneyUZS(amount)}</span>
            </div>
          ))}
        </div>
      )}

      {order.change_amount > 0 && (
        <div className="mb-3 text-xs">
          <div className="flex justify-between font-semibold">
            <span>Qaytim:</span>
            <span>{formatMoneyUZS(order.change_amount)}</span>
          </div>
        </div>
      )}

      {order.credit_amount > 0 && (
        <div className="mb-3 text-xs">
          <div className="flex justify-between font-semibold text-orange-600">
            <span>Kredit:</span>
            <span>{formatMoneyUZS(order.credit_amount)}</span>
          </div>
        </div>
      )}

      {customerTotalDebt > 0 && (
        <div className="mb-3 text-xs">
          <div className="flex justify-between font-semibold text-orange-600">
            <span>Umumiy qarz:</span>
            <span>{formatMoneyUZS(customerTotalDebt)}</span>
          </div>
        </div>
      )}

      <div className="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
        {footerText && <p className="text-xs mb-1 whitespace-pre-wrap">{footerText}</p>}
        <p className="text-xs">Xaridingiz uchun rahmat!</p>
      </div>
    </div>
  );
}
