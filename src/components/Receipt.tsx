import React from 'react';
import type { CartItem, Customer } from '@/types/database';

interface ReceiptProps {
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
}

export default React.forwardRef<HTMLDivElement, ReceiptProps>(
  function Receipt(
    {
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
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className="receipt-container"
        style={{
          width: '200px',
          maxWidth: '200px',
          margin: '0 auto',
          padding: '10px',
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#000',
          backgroundColor: '#fff',
        }}
      >
        {/* Store Name */}
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <h2 style={{ fontWeight: 'bold', fontSize: '14px', margin: '5px 0' }}>
            POS SYSTEM
          </h2>
          <p style={{ fontSize: '9px', margin: '2px 0' }}>
            Point of Sale Terminal
          </p>
        </div>

        {/* Separator */}
        <div
          style={{
            borderTop: '1px dashed #000',
            margin: '8px 0',
          }}
        />

        {/* Order Info */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>Order #:</span>
            <span style={{ fontWeight: 'bold' }}>{orderNumber}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>Date:</span>
            <span>{dateTime}</span>
          </div>
          {cashierName && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span>Cashier:</span>
              <span>{cashierName}</span>
            </div>
          )}
        </div>

        {/* Customer Info */}
        {customer && (
          <>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>Customer:</div>
              <div>{customer.name}</div>
              {customer.phone && <div>{customer.phone}</div>}
            </div>
            <div
              style={{
                borderTop: '1px dashed #000',
                margin: '8px 0',
              }}
            />
          </>
        )}

        {/* Items */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '5px', textAlign: 'center' }}>
            ITEMS
          </div>
          {items.map((item, index) => (
            <div key={index} style={{ marginBottom: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ fontWeight: 'bold' }}>{item.product.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' }}>
                <span>
                  {item.quantity} × {Number(item.product.sale_price).toFixed(2)}
                </span>
                <span>{item.subtotal.toFixed(2)} UZS</span>
              </div>
              {item.discount_amount > 0 && (
                <div style={{ fontSize: '8px', color: '#666', marginLeft: '5px' }}>
                  Disc: -{item.discount_amount.toFixed(2)} UZS
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Separator */}
        <div
          style={{
            borderTop: '1px dashed #000',
            margin: '8px 0',
          }}
        />

        {/* Totals */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>Subtotal:</span>
            <span>{subtotal.toFixed(2)} UZS</span>
          </div>
          {discountAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span>Discount:</span>
              <span>-{discountAmount.toFixed(2)} UZS</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '5px',
              paddingTop: '5px',
              borderTop: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '12px',
            }}
          >
            <span>TOTAL:</span>
            <span>{total.toFixed(2)} UZS</span>
          </div>
        </div>

        {/* Payment Info */}
        <div
          style={{
            borderTop: '1px dashed #000',
            margin: '8px 0',
            paddingTop: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>Payment:</span>
            <span style={{ textTransform: 'uppercase' }}>{paymentMethod}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span>Paid:</span>
            <span>{paidAmount.toFixed(2)} UZS</span>
          </div>
          {changeAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span>Change:</span>
              <span>{changeAmount.toFixed(2)} UZS</span>
            </div>
          )}
        </div>

        {/* Separator */}
        <div
          style={{
            borderTop: '1px dashed #000',
            margin: '10px 0',
          }}
        />

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <p style={{ fontSize: '9px', margin: '5px 0' }}>
            Thank you for your purchase!
          </p>
          <p style={{ fontSize: '8px', margin: '5px 0', color: '#666' }}>
            Have a nice day
          </p>
        </div>

        {/* Barcode placeholder */}
        <div
          style={{
            textAlign: 'center',
            marginTop: '15px',
            padding: '10px',
            border: '1px dashed #ccc',
            fontSize: '8px',
          }}
        >
          <div style={{ marginBottom: '5px' }}>Barcode/QR Code</div>
          <div style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>
            {orderNumber}
          </div>
        </div>
      </div>
    );
  }
);



