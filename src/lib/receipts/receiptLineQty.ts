/**
 * Shared receipt line quantity helpers — sale reprints vs POS exchange return lines.
 */

export function getReceiptDisplayQty(item: Record<string, unknown> | null | undefined): number {
  const qtySale = Number(item?.qty_sale ?? item?.quantity ?? 0) || 0;
  if (qtySale < 0) return qtySale;
  const returned = Number(item?.returned_quantity ?? 0) || 0;
  if (item?.remaining_quantity != null && item?.remaining_quantity !== '') {
    return Number(item.remaining_quantity) || 0;
  }
  return qtySale - returned;
}

export function shouldShowOnReceipt(item: Record<string, unknown> | null | undefined): boolean {
  const qtySale = Number(item?.qty_sale ?? item?.quantity ?? 0) || 0;
  if (qtySale < 0) return true;
  return getReceiptDisplayQty(item) > 0;
}

export function getReceiptLineTotal(
  item: Record<string, unknown> | null | undefined,
  displayQty: number
): number {
  const qtySale = Number(item?.qty_sale ?? item?.quantity ?? 0) || 0;
  const discount = Number(item?.discount_amount ?? 0) || 0;
  const explicit = item?.line_total ?? item?.total ?? item?.subtotal;
  if (qtySale < 0) {
    if (explicit != null && explicit !== '') return Number(explicit) || 0;
    const subtotal = Number(item?.subtotal ?? 0);
    if (subtotal !== 0) return subtotal - discount;
    return Number(item?.unit_price ?? 0) * displayQty;
  }
  const baseLineTotal =
    explicit != null && explicit !== ''
      ? Number(explicit) || 0
      : Number(item?.unit_price ?? 0) * qtySale;
  if (qtySale === 0) return 0;
  return baseLineTotal * (displayQty / qtySale);
}
