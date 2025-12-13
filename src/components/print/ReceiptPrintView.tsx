import React from 'react';
import type { OrderWithDetails } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { format } from 'date-fns';

interface ReceiptPrintViewProps {
  order: OrderWithDetails;
  variant?: 'thermal' | 'a4';
}

export default function ReceiptPrintView({ order, variant = 'thermal' }: ReceiptPrintViewProps) {
  const storeName = 'POS tizimi'; // TODO: Get from settings
  const dateTime = format(new Date(order.created_at), 'dd.MM.yyyy HH:mm');
  const cashierName = order.cashier?.username || order.cashier?.full_name || '-';
  const customerName = order.customer?.name || 'Yangi mijoz';

  // Calculate payment breakdown
  const payments = order.payments || [];
  const paymentBreakdown = payments.reduce((acc, payment) => {
    const method = payment.payment_method;
    if (!acc[method]) {
      acc[method] = 0;
    }
    acc[method] += payment.amount;
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
      <div className="receipt-a4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">{storeName}</h1>
          <p className="text-sm text-muted-foreground">Chek</p>
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
          <div>
            <p className="font-semibold">Kassir:</p>
            <p>{cashierName}</p>
          </div>
          <div>
            <p className="font-semibold">Mijoz:</p>
            <p>{customerName}</p>
          </div>
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
              {order.items?.map((item, index) => (
                <tr key={item.id || index} className="border-b border-gray-200">
                  <td className="py-2 px-2">{item.product_name}</td>
                  <td className="text-center py-2 px-2">{item.quantity}</td>
                  <td className="text-right py-2 px-2">{formatMoneyUZS(item.unit_price)}</td>
                  <td className="text-right py-2 px-2 font-medium">{formatMoneyUZS(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Jami (chegirma oldidan):</span>
            <span>{formatMoneyUZS(order.subtotal)}</span>
          </div>
          {order.discount_amount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Chegirma:</span>
              <span>-{formatMoneyUZS(order.discount_amount)}</span>
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

        <div className="text-center mt-8 pt-4 border-t border-gray-300">
          <p className="text-sm text-muted-foreground">Xaridingiz uchun rahmat!</p>
        </div>
      </div>
    );
  }

  // Thermal receipt (80mm)
  return (
    <div className="receipt-thermal">
      <div className="text-center mb-2">
        <h2 className="text-lg font-bold">{storeName}</h2>
        <p className="text-xs">Chek</p>
      </div>

      <div className="text-center mb-3 text-xs">
        <p className="font-mono">{order.order_number}</p>
        <p>{dateTime}</p>
      </div>

      <div className="mb-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span>Kassir:</span>
          <span>{cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>Mijoz:</span>
          <span>{customerName}</span>
        </div>
      </div>

      <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3">
        {order.items?.map((item, index) => (
          <div key={item.id || index} className="mb-2 text-xs">
            <div className="font-medium">{item.product_name}</div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">
                {item.quantity} x {formatMoneyUZS(item.unit_price)}
              </span>
              <span className="font-semibold">{formatMoneyUZS(item.total)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span>Jami:</span>
          <span>{formatMoneyUZS(order.subtotal)}</span>
        </div>
        {order.discount_amount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Chegirma:</span>
            <span>-{formatMoneyUZS(order.discount_amount)}</span>
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

      <div className="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
        <p className="text-xs">Xaridingiz uchun rahmat!</p>
      </div>
    </div>
  );
}
