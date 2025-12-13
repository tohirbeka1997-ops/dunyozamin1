import {
  createOrder,
  createCreditOrder,
  generateOrderNumber,
  generatePaymentNumber,
} from '@/db/api';
import type { CartItem } from '@/types/cart';
import type { Payment } from '@/types/payment';
import type { Customer } from '@/types/database';
import { addToOfflineQueue, isOnline } from '@/utils/offline';

export interface CreateOrderParams {
  items: CartItem[];
  customer: Customer | null;
  payments: Payment[];
  creditAmount: number;
  subtotal: number;
  discount: number;
  total: number;
  shiftId: string | null;
  cashierId: string;
}

export interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  error?: string;
}

/**
 * Create order with offline support
 */
export const createOrderService = async (
  params: CreateOrderParams
): Promise<CreateOrderResult> => {
  try {
    if (!isOnline()) {
      // Queue for offline sync
      addToOfflineQueue({
        type: 'order',
        data: params,
      });
      return {
        success: false,
        error: 'Offline mode: Order queued for sync',
      };
    }

    const orderNumber = await generateOrderNumber();
    const paymentNumbers = await Promise.all(
      params.payments.map(() => generatePaymentNumber())
    );

    const orderItems = params.items.map((item) => ({
      product_id: item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.line_subtotal,
      discount_amount: item.line_discount,
      total: item.line_total,
    }));

    const orderPayments = params.payments.map((payment, index) => ({
      payment_number: paymentNumbers[index],
      payment_method: payment.method,
      amount: payment.amount,
      reference_number: payment.reference || null,
      notes: payment.notes || null,
    }));

    if (params.creditAmount > 0 && params.customer) {
      // Credit order
      const result = await createCreditOrder({
        customer_id: params.customer.id,
        cashier_id: params.cashierId,
        shift_id: params.shiftId,
        items: orderItems,
        subtotal: params.subtotal,
        discount_amount: params.discount,
        discount_percent: 0,
        tax_amount: 0,
        total_amount: params.total,
        credit_amount: params.creditAmount,
      });

      return {
        success: true,
        orderId: result.id,
        orderNumber: result.order_number,
      };
    } else {
      // Regular order
      const order = {
        order_number: orderNumber,
        customer_id: params.customer?.id || null,
        cashier_id: params.cashierId,
        shift_id: params.shiftId,
        subtotal: params.subtotal,
        discount_amount: params.discount,
        discount_percent: 0,
        tax_amount: 0,
        total_amount: params.total,
        paid_amount: params.payments.reduce((sum, p) => sum + p.amount, 0),
        credit_amount: params.creditAmount,
        change_amount: 0, // Will be calculated
        status: 'completed' as const,
        payment_status: 'paid' as const,
        notes: null,
      };

      await createOrder(order, orderItems, orderPayments);

      return {
        success: true,
        orderId: order.order_number, // Using order_number as ID for now
        orderNumber: order.order_number,
      };
    }
  } catch (error) {
    console.error('Create order error:', error);
    
    // Queue for retry if network error
    if (!isOnline() || (error instanceof Error && error.message.includes('network'))) {
      addToOfflineQueue({
        type: 'order',
        data: params,
      });
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create order',
    };
  }
};


