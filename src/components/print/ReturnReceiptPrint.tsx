import React from 'react';
import type { SalesReturnWithDetails } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { formatReceiptDateTime } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';

interface ReturnReceiptPrintProps {
  returnData: SalesReturnWithDetails;
  variant?: 'thermal' | 'a4';
}

export default function ReturnReceiptPrint({ returnData, variant = 'thermal' }: ReturnReceiptPrintProps) {
  const storeName = 'POS tizimi'; // TODO: Get from settings
  const dateTime = formatReceiptDateTime(returnData.created_at);
  const cashierName = returnData.cashier?.username || returnData.cashier?.full_name || '-';
  const customerName = returnData.customer?.name || 'Yangi mijoz';
  const orderNumber = returnData.order?.order_number || 'Ordersiz';
  const isPending = returnData.status === 'Pending';
  const isManual = returnData.return_mode === 'manual';

  const statusLabels: Record<string, string> = {
    Completed: 'Yakunlangan',
    Pending: 'Kutilmoqda',
    Cancelled: 'Bekor qilingan',
  };

  if (variant === 'a4') {
    return (
      <div className="return-receipt-a4">
        {isPending && (
          <div className="text-center mb-4 p-2 bg-yellow-100 border-2 border-yellow-400 rounded">
            <p className="font-bold text-yellow-800">QORALAMA / JARAYONDA</p>
          </div>
        )}
        
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">{storeName}</h1>
          <p className="text-sm text-muted-foreground">Sotuv qaytarilishi cheki</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="font-semibold">Qaytarish raqami:</p>
            <p className="font-mono">{returnData.return_number}</p>
          </div>
          <div>
            <p className="font-semibold">Manba:</p>
            <p>{isManual ? 'Ordersiz qaytarish' : 'Buyurtma bo‘yicha qaytarish'}</p>
          </div>
          <div>
            <p className="font-semibold">Buyurtma raqami:</p>
            <p className="font-mono">{orderNumber}</p>
          </div>
          <div>
            <p className="font-semibold">Sana va vaqt:</p>
            <p>{dateTime}</p>
          </div>
          <div>
            <p className="font-semibold">Holati:</p>
            <p>{statusLabels[returnData.status] || returnData.status}</p>
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

        {returnData.reason && (
          <div className="mb-6">
            <p className="font-semibold mb-2">Qaytarish sababi:</p>
            <p className="text-sm">{returnData.reason}</p>
          </div>
        )}

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
              {returnData.items?.map((item, index) => (
                <tr key={item.id || index} className="border-b border-gray-200">
                  <td className="py-2 px-2">
                    <div>{item.product?.name || item.product_name || '-'}</div>
                    {isManual && (
                      <div className="text-xs text-muted-foreground">
                        Narx turi: {item.price_source === 'usta' ? 'Usta' : 'Oddiy'}
                      </div>
                    )}
                  </td>
                  <td className="text-center py-2 px-2">
                    {formatQuantity(
                      (item as any).qty_sale ?? item.quantity,
                      (item as any).sale_unit || item.product?.unit || item.unit
                    )}
                  </td>
                  <td className="text-right py-2 px-2">{formatMoneyUZS(item.unit_price)}</td>
                  <td className="text-right py-2 px-2 font-medium">{formatMoneyUZS(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between font-bold text-lg border-t-2 border-gray-300 pt-2">
            <span>Jami qaytarilgan summa:</span>
            <span>{formatMoneyUZS(returnData.total_amount)}</span>
          </div>
        </div>

        {returnData.notes && (
          <div className="mb-6">
            <p className="font-semibold mb-2">Izoh:</p>
            <p className="text-sm text-muted-foreground">{returnData.notes}</p>
          </div>
        )}

        <div className="text-center mt-8 pt-4 border-t border-gray-300">
          <p className="text-sm text-muted-foreground">Rahmat!</p>
          <p className="text-xs text-muted-foreground mt-2">{dateTime}</p>
        </div>
      </div>
    );
  }

  // Thermal receipt
  return (
    <div className="return-receipt-thermal">
      {isPending && (
        <div className="text-center mb-2 p-1 border border-yellow-400 rounded">
          <p className="text-xs font-bold text-yellow-800">QORALAMA</p>
        </div>
      )}
      
      <div className="text-center mb-2">
        <h2 className="text-lg font-bold">{storeName}</h2>
        <p className="text-xs">Sotuv qaytarilishi cheki</p>
      </div>

      <div className="text-center mb-3 text-xs">
        <p className="font-mono">{returnData.return_number}</p>
        <p className="font-mono">Buyurtma: {orderNumber}</p>
        <p>{isManual ? 'Ordersiz qaytarish' : 'Buyurtma bo‘yicha qaytarish'}</p>
        <p>{dateTime}</p>
      </div>

      <div className="mb-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span>Holati:</span>
          <span className="font-semibold">{statusLabels[returnData.status] || returnData.status}</span>
        </div>
        <div className="flex justify-between">
          <span>Kassir:</span>
          <span>{cashierName}</span>
        </div>
        <div className="flex justify-between">
          <span>Mijoz:</span>
          <span>{customerName}</span>
        </div>
      </div>

      {returnData.reason && (
        <div className="mb-3 text-xs">
          <p className="font-semibold">Sabab:</p>
          <p>{returnData.reason}</p>
        </div>
      )}

      <div className="border-t border-b border-dashed border-gray-400 py-2 mb-3">
        {returnData.items?.map((item, index) => (
          <div key={item.id || index} className="mb-2 text-xs">
            <div className="font-medium">{item.product?.name || item.product_name || '-'}</div>
            {isManual && (
              <div className="text-[11px] text-gray-600">
                Narx turi: {item.price_source === 'usta' ? 'Usta' : 'Oddiy'}
              </div>
            )}
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">
                {formatQuantity(
                  (item as any).qty_sale ?? item.quantity,
                  (item as any).sale_unit || item.product?.unit || item.unit
                )}{' '}
                x {formatMoneyUZS(item.unit_price)}
              </span>
              <span className="font-semibold">{formatMoneyUZS(item.line_total)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 text-xs">
        <div className="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1">
          <span>JAMI QAYTARILGAN:</span>
          <span>{formatMoneyUZS(returnData.total_amount)}</span>
        </div>
      </div>

      {returnData.notes && (
        <div className="mb-3 text-xs border-t border-dashed border-gray-400 pt-2">
          <p className="font-semibold">Izoh:</p>
          <p className="text-gray-600">{returnData.notes}</p>
        </div>
      )}

      <div className="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
        <p className="text-xs">Rahmat!</p>
        <p className="text-xs text-gray-500 mt-1">{dateTime}</p>
      </div>
    </div>
  );
}

