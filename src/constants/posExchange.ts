import type { PaymentMethod } from '@/types/database';

/** Bir chekda almashuv: mijozga naqd chiqim (backend `payments` + `cash_movements.refund`) */
export const POS_EXCHANGE_PAYOUT_METHOD = 'refund_cash' as const satisfies PaymentMethod;

export type PosCheckoutPaymentKind =
  | 'cash'
  | 'card'
  | 'qr'
  | 'mixed'
  | typeof POS_EXCHANGE_PAYOUT_METHOD
  | 'zero_settle';
