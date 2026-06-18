import type { PaymentMethod } from '@/types/database';

/** Bir chekda almashuv: mijozga naqd chiqim (backend `payments` + `cash_movements.refund`) */
export const POS_EXCHANGE_PAYOUT_METHOD = 'refund_cash' as const satisfies PaymentMethod;

/** Almashuv qaytimi mijoz balansiga (naqd emas — do‘kon mijoz oldida qarzdor) */
export const POS_EXCHANGE_BALANCE_METHOD = 'refund_balance' as const satisfies PaymentMethod;

export type PosCheckoutPaymentKind =
  | 'cash'
  | 'card'
  | 'qr'
  | 'mixed'
  | typeof POS_EXCHANGE_PAYOUT_METHOD
  | typeof POS_EXCHANGE_BALANCE_METHOD
  | 'zero_settle';
