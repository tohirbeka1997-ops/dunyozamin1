import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CartItem, Customer } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { formatQuantity } from '@/utils/quantity';

export type ReceiptProps = {
  orderNumber: string;
  items: CartItem[];
  customer: Customer | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  /** Ko'rsatiladigan to'lov usuli (allaqachon lokalizatsiya qilingan matn) */
  paymentMethod: string;
  dateTime: string;
  cashierName?: string;
  customerTotalDebt?: number;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyTaxId?: string;
  headerText?: string;
  /** Mahsulotlar blokidan keyin, jami oldidan */
  middleText?: string;
  footerText?: string;
  showCashier?: boolean;
  showCustomer?: boolean;
  showSku?: boolean;
  paperSize?: '58mm' | '78mm' | '80mm';
};

const ReceiptInner = (props: ReceiptProps & { forwardedRef: React.ForwardedRef<HTMLDivElement> }) => {
  const { t } = useTranslation();
  const {
    forwardedRef,
    orderNumber,
    items,
    customer,
    subtotal,
    discountAmount,
    total,
    paidAmount,
    changeAmount,
    paymentMethod,
    dateTime,
    cashierName,
    customerTotalDebt,
    companyName,
    companyPhone,
    companyAddress,
    companyTaxId,
    headerText,
    middleText,
    footerText,
    showCashier = true,
    showCustomer = true,
    showSku = true,
    paperSize = '78mm',
  } = props;

  const thermalWidth = paperSize === '58mm' ? '58mm' : paperSize === '78mm' ? '78mm' : '80mm';

  const lineTotal = (item: CartItem) => {
    const st = Number(item.subtotal || 0);
    const disc = Number((item.discount_amount as any) || 0);
    return st - disc;
  };

  const hasFooter = Boolean(footerText?.trim());

  return (
    <div
      ref={forwardedRef}
      className="receipt-thermal font-semibold"
      style={{
        maxWidth: thermalWidth,
        margin: '0 auto',
        padding: paperSize === '58mm' ? '10px' : '12px',
        background: '#fff',
      }}
    >
      <div className="text-center mb-2">
        <h2 className="text-lg font-bold">{companyName?.trim() || t('receipt.title')}</h2>
        {companyPhone?.trim() && <p className="text-xs">{companyPhone.trim()}</p>}
        {companyAddress?.trim() && <p className="text-xs">{companyAddress.trim()}</p>}
        {companyTaxId?.trim() && (
          <p className="text-xs">
            {t('receipt.tax_id_prefix')} {companyTaxId.trim()}
          </p>
        )}
        {headerText?.trim() && <p className="text-xs mt-1 whitespace-pre-wrap">{headerText.trim()}</p>}
        <p className="text-xs mt-1">{t('receipt.title')}</p>
      </div>

      <div className="text-center mb-3 text-xs">
        <p className="font-mono">{orderNumber}</p>
        <p>{dateTime}</p>
      </div>

      {(showCashier || (showCustomer && !!customer)) && (
        <div className="mb-3 text-xs space-y-1">
          {showCashier && cashierName && (
            <div className="flex justify-between">
              <span>{t('receipt.cashier')}</span>
              <span>{cashierName}</span>
            </div>
          )}
          {showCustomer && customer && (
            <div className="flex justify-between">
              <span>{t('receipt.customer')}</span>
              <span>{customer.name}</span>
            </div>
          )}
          {showCustomer && customer?.phone && (
            <div className="flex justify-between">
              <span>{t('receipt.phone')}</span>
              <span className="font-mono">{customer.phone}</span>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3">
        {items.map((item, index) => {
          const q = Number((item as any).qty_sale ?? item.quantity ?? 0) || 0;
          const isReturnLine = q < 0;
          return (
            <div key={index} className="mb-2 text-xs">
              <div className="font-medium">
                {item.product.name}
                {isReturnLine && (
                  <span className="ml-1 text-[10px] font-normal text-red-600">
                    {t('receipt.return_line_suffix')}
                  </span>
                )}
              </div>
              {showSku && item.product.sku && (
                <div className="text-[11px] text-gray-600 font-mono">{item.product.sku}</div>
              )}
              <div className="flex justify-between mt-1">
                <span className="text-gray-600">
                  {formatQuantity(q, (item as any).sale_unit || item.product?.unit)} ×{' '}
                  {formatMoneyUZS(Number(item.unit_price || 0))}
                </span>
                <span className={`font-semibold ${isReturnLine ? 'text-red-600' : ''}`}>
                  {formatMoneyUZS(lineTotal(item))}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {middleText?.trim() && (
        <div className="mb-3 text-xs text-center whitespace-pre-wrap border-t border-dashed border-gray-300 pt-2">
          {middleText.trim()}
        </div>
      )}

      <div className="mb-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span>{t('receipt.subtotal')}</span>
          <span>{formatMoneyUZS(subtotal)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>{t('receipt.discount')}</span>
            <span>-{formatMoneyUZS(discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1">
          <span>{t('receipt.total')}</span>
          <span>{formatMoneyUZS(total)}</span>
        </div>
        {total < 0 && (
          <div className="flex justify-between text-red-600 font-semibold">
            <span>{t('receipt.customer_refund')}</span>
            <span>{formatMoneyUZS(Math.abs(total))}</span>
          </div>
        )}
        {total > 0 && (
          <div className="flex justify-between">
            <span>{t('receipt.paid')}</span>
            <span>{formatMoneyUZS(paidAmount)}</span>
          </div>
        )}
        {total === 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>{t('receipt.diff_zero_label')}</span>
            <span>{t('receipt.diff_zero_value')}</span>
          </div>
        )}
        {changeAmount > 0 && total > 0 && (
          <div className="flex justify-between">
            <span>{t('receipt.change')}</span>
            <span>{formatMoneyUZS(changeAmount)}</span>
          </div>
        )}
        {Number(customerTotalDebt || 0) > 0 && (
          <div className="flex justify-between font-semibold text-orange-600">
            <span>{t('receipt.total_debt')}</span>
            <span>{formatMoneyUZS(Number(customerTotalDebt || 0))}</span>
          </div>
        )}
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>{t('receipt.payment_method')}</span>
          <span>{paymentMethod || '—'}</span>
        </div>
      </div>

      <div className="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
        {hasFooter ? (
          <p className="text-xs mb-1 whitespace-pre-wrap">{footerText!.trim()}</p>
        ) : (
          <p className="text-xs mb-1">{t('receipt.thanks')}</p>
        )}
        <p className="text-xs">{t('receipt.thanks_short')}</p>
      </div>
    </div>
  );
};

const Receipt = forwardRef<HTMLDivElement, ReceiptProps>((props, ref) => (
  <ReceiptInner {...props} forwardedRef={ref} />
));

Receipt.displayName = 'Receipt';

export default Receipt;
