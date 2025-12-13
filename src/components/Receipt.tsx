// src/components/Receipt.tsx

import React, { forwardRef } from "react";
import type { CartItem, Customer } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';

type ReceiptProps = {
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
};

const Receipt = forwardRef<HTMLDivElement, ReceiptProps>((props, ref) => {
  const {
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
  } = props;

  return (
    <div ref={ref} className="p-8 max-w-md mx-auto bg-white">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold">Chek</h2>
        <p className="text-sm text-gray-600">Order: {orderNumber}</p>
        <p className="text-xs text-gray-500">{dateTime}</p>
      </div>

      {customer && (
        <div className="mb-4 border-b pb-2">
          <p className="font-semibold">Mijoz: {customer.name}</p>
          {customer.phone && <p className="text-sm">Tel: {customer.phone}</p>}
        </div>
      )}

      <div className="mb-4 border-b pb-2">
        {items.map((item, index) => (
          <div key={index} className="flex justify-between py-1">
            <div className="flex-1">
              <p className="font-medium">{item.product.name}</p>
              <p className="text-xs text-gray-600">
                {item.quantity} x {formatMoneyUZS(item.product.sale_price)}
              </p>
            </div>
            <p className="font-semibold">
              {formatMoneyUZS(item.subtotal - (item.discount_amount || 0))}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-sm mb-4">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>{formatMoneyUZS(subtotal)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Chegirma:</span>
            <span>-{formatMoneyUZS(discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg border-t pt-2">
          <span>Jami:</span>
          <span>{formatMoneyUZS(total)}</span>
        </div>
        <div className="flex justify-between">
          <span>To'landi:</span>
          <span>{formatMoneyUZS(paidAmount)}</span>
        </div>
        {changeAmount > 0 && (
          <div className="flex justify-between">
            <span>Qaytim:</span>
            <span>{formatMoneyUZS(changeAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs text-gray-600 mt-2">
          <span>To'lov usuli:</span>
          <span>{paymentMethod}</span>
        </div>
      </div>

      {cashierName && (
        <div className="text-center text-xs text-gray-500 border-t pt-2">
          Kassir: {cashierName}
        </div>
      )}

      <div className="text-center text-xs text-gray-400 mt-4">
        Rahmat!
      </div>
    </div>
  );
});

Receipt.displayName = 'Receipt';

export default Receipt;
