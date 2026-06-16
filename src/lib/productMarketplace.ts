/** Whether product is visible in Telegram / public catalog (default: yes). */
export function productShowInMarketplace(
  product: { show_in_marketplace?: boolean | number | null | undefined },
): boolean {
  const v = product.show_in_marketplace;
  return v === undefined || v === null || v === true || v === 1;
}

/** Whether stock is tracked for availability (default: yes). */
export function productTracksStock(
  product: { track_stock?: boolean | number | null | undefined },
): boolean {
  const v = product.track_stock;
  return v === undefined || v === null || v === true || v === 1;
}
