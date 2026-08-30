/**
 * Helpers for POS checkout / return refresh sequencing (unit-tested).
 */

/** After sale success: close dialog first so an emptied cart never flashes zero-settle UI. */
export function shouldClosePaymentDialogBeforeClearingCart(): boolean {
  return true;
}

/**
 * Query keys that must be invalidated after a successful return create
 * so orders / returns / reports refresh without a manual reload.
 */
export function getPostReturnInvalidateQueryKeys(orderId?: string | null): string[][] {
  const keys: string[][] = [
    ['returns'],
    ['sales-returns'],
    ['salesReturns'],
    ['orders'],
    ['order'],
    ['dashboard'],
    ['reports'],
  ];
  if (orderId) keys.push(['order', orderId]);
  return keys;
}
