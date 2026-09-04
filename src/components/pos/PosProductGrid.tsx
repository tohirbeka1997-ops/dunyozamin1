import { memo, useRef, useEffect, Fragment, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Package, Plus, Store, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { productShowInMarketplace } from '@/lib/productMarketplace';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { resolveUsdRetailDisplay } from '@/lib/productPricing';
import { formatUnit } from '@/utils/formatters';
import { highlightMatch } from '@/utils/searchHighlight';
import { getSaleUnitConfig, getProductUnits } from '@/pages/posTerminalHelpers';
import { isOutOfStockForSale, isProductPriceNotSet } from '@/lib/posHardening';
import type { Product } from '@/types/database';
import type { TFunction } from 'i18next';

/** Virtualizer estimate; measureElement adjusts for promo badges / long names. */
const ROW_HEIGHT = 52;

type PosProductRow = Product & { category_name?: string | null };

export type PosProductGridProps = {
  products: Product[];
  totalCount: number;
  isTruncated: boolean;
  maxDisplay: number;
  searchTerm: string;
  saleCurrency: string;
  saleFxRate?: number | null;
  usdRetailByProductId: Record<string, number>;
  formatCurrency: (value: number) => string;
  formatMoney: (value: number, currency: string) => string;
  hasPromoForProduct: (product: Product) => boolean;
  onRequestAddToCart: (product: Product) => void;
  onQuickAddOneToCart: (product: Product) => void;
  onFocusSearch: () => void;
  renderSkuWithHighlight: (sku: string, term: string) => ReactNode;
  categoryNameById?: Record<string, string>;
  /** When true (return mode), zero-stock products may still be added. */
  allowOutOfStockAdd?: boolean;
  /** Catalog fetch failed — show error+retry instead of empty "not found". */
  loadError?: string | null;
  onRetryLoad?: () => void;
  /** Keyboard highlight in the visible catalog/search list (−1 = none). */
  highlightedIndex?: number;
  t: TFunction;
};

function productCategoryLabel(product: PosProductRow, categoryNameById?: Record<string, string>) {
  const fromRow = String(product.category_name ?? '').trim();
  if (fromRow) return fromRow;
  const id = product.category_id;
  if (id && categoryNameById?.[id]) return categoryNameById[id];
  return null;
}

function PosProductGridInner({
  products,
  totalCount,
  isTruncated,
  maxDisplay,
  searchTerm,
  saleCurrency,
  saleFxRate,
  usdRetailByProductId,
  formatCurrency,
  formatMoney,
  hasPromoForProduct,
  onRequestAddToCart,
  onQuickAddOneToCart,
  onFocusSearch,
  renderSkuWithHighlight,
  categoryNameById,
  allowOutOfStockAdd = false,
  loadError = null,
  onRetryLoad,
  highlightedIndex = -1,
  t,
}: PosProductGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    if (highlightedIndex < 0 || highlightedIndex >= products.length) return;
    virtualizer.scrollToIndex(highlightedIndex, { align: 'auto' });
  }, [highlightedIndex, products.length, virtualizer]);

  if (products.length === 0 && loadError) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-muted-foreground">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-2 h-10 w-10 text-destructive opacity-80" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            {t('pos.catalog_load_failed_title', { defaultValue: 'Katalog yuklanmadi' })}
          </p>
          <p className="mt-1 text-xs">{loadError}</p>
          {onRetryLoad && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 gap-1.5"
              onClick={() => onRetryLoad()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {t('common.retry', { defaultValue: 'Qayta urinish' })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-muted-foreground">
        <div className="text-center">
          <Package className="mx-auto mb-2 h-10 w-10 opacity-50" />
          <p className="text-sm font-medium">
            {searchTerm.trim()
              ? t('pos.product_not_found', { defaultValue: 'Mahsulot topilmadi' })
              : t('pos.no_products')}
          </p>
          <p className="mt-1 text-xs">{t('pos.try_searching')}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="w-full">
        <div className="sticky top-0 z-10 grid grid-cols-12 items-center gap-2 border-b border-border bg-white px-2 py-0.5 dark:bg-gray-900">
          <div className="col-span-6">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Mahsulot</span>
              {isTruncated && (
                <span
                  className="truncate text-[10px] text-muted-foreground"
                  title={`Ko'rsatilmoqda: ${maxDisplay} / Jami: ${totalCount} ta mahsulot`}
                >
                  {maxDisplay}/{totalCount}
                </span>
              )}
            </div>
          </div>
          <div className="col-span-2 text-right">
            <span className="text-[11px] text-muted-foreground">Narx</span>
          </div>
          <div className="col-span-1 text-center">
            <span className="sr-only">Savatga qo&apos;shish</span>
            <Plus className="mx-auto h-3 w-3 text-muted-foreground" aria-hidden />
          </div>
          <div className="col-span-3 text-right">
            <span className="text-[11px] text-muted-foreground">Ombor</span>
          </div>
        </div>

        <div
          className="relative divide-y divide-gray-100 dark:divide-gray-700"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const product = products[virtualRow.index] as PosProductRow;
            if (!product) return null;

            const brand = String(product.brand ?? '').trim();
            const article = String(product.article ?? '').trim();
            const sku = String(product.sku ?? '').trim();
            const categoryLabel = productCategoryLabel(product, categoryNameById);
            const { saleUnit, sale_price: defaultSalePrice } = getSaleUnitConfig(product);
            const { baseUnit } = getProductUnits(product);
            const catalogRetailPrice =
              Number(defaultSalePrice ?? product.sale_price ?? 0) || 0;
            const usdDisplay = resolveUsdRetailDisplay(
              catalogRetailPrice,
              usdRetailByProductId[product.id],
              saleFxRate
            );
            const saleUnitLabel = formatUnit(saleUnit) || saleUnit || 'Dona';
            const baseUnitLabel = formatUnit(baseUnit) || baseUnit;
            const outOfStock = !allowOutOfStockAdd && isOutOfStockForSale(product);
            const priceBlocked = isProductPriceNotSet(product as any);
            const rowDisabled = outOfStock || priceBlocked;
            // Compact: SKU · Artikul · Brend (then unit); category only in title to avoid wrap.
            const metaItems: ReactNode[] = [];
            if (sku) {
              metaItems.push(
                <span key="sku">{renderSkuWithHighlight(product.sku, searchTerm)}</span>,
              );
            }
            if (article) metaItems.push(<span key="article">{article}</span>);
            if (brand) metaItems.push(<span key="brand">{brand}</span>);
            if (saleUnit) metaItems.push(<span key="unit">{saleUnitLabel}</span>);
            const metaTitle = [
              sku && `SKU: ${sku}`,
              article && `Artikul: ${article}`,
              brand && `Brend: ${brand}`,
              categoryLabel,
              saleUnit && saleUnitLabel,
            ]
              .filter(Boolean)
              .join(' · ');

            const exactSingleHighlight = Boolean(searchTerm.trim()) && products.length === 1;
            const isKeyboardHighlight = highlightedIndex === virtualRow.index;

            return (
              <div
                key={product.id}
                data-index={virtualRow.index}
                data-pos-product-row={isKeyboardHighlight ? 'active' : undefined}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  role="button"
                  tabIndex={rowDisabled ? -1 : isKeyboardHighlight ? 0 : -1}
                  aria-disabled={rowDisabled || undefined}
                  aria-selected={isKeyboardHighlight || undefined}
                  onClick={() => {
                    if (rowDisabled) return;
                    onRequestAddToCart(product);
                    onFocusSearch();
                  }}
                  onKeyDown={(e) => {
                    if (rowDisabled) return;
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onRequestAddToCart(product);
                      onFocusSearch();
                    }
                  }}
                  className={cn(
                    'grid w-full grid-cols-12 items-center gap-2 border-b border-transparent bg-white p-1.5 transition-colors dark:bg-gray-800',
                    rowDisabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-primary/5 dark:hover:bg-primary/10',
                    !productShowInMarketplace(product) && 'opacity-[0.92]',
                    exactSingleHighlight &&
                      'bg-emerald-50 ring-2 ring-inset ring-emerald-500/70 dark:bg-emerald-950/40',
                    isKeyboardHighlight &&
                      'bg-primary/10 ring-2 ring-inset ring-primary/60 dark:bg-primary/20',
                  )}
                >
                  <div className="col-span-6 min-w-0 text-left">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {product.image_url ? (
                          <img
                            src={getProductImageDisplayUrl(product.image_url) || product.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1">
                          <p className="min-w-0 truncate text-[11px] font-medium leading-tight md:text-xs">
                            {searchTerm ? highlightMatch(product.name, searchTerm) : product.name}
                          </p>
                          {hasPromoForProduct(product) && (
                            <span className="shrink-0 rounded bg-green-600 px-1 py-px text-[9px] font-medium text-white">
                              Aksiya
                            </span>
                          )}
                          {productShowInMarketplace(product) ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 text-[9px] text-primary"
                              title={t('pos.marketplace_on')}
                            >
                              <Store className="h-2.5 w-2.5" aria-hidden />
                            </span>
                          ) : (
                            <span
                              className="shrink-0 text-[9px] text-muted-foreground"
                              title={t('pos.marketplace_off')}
                            >
                              off
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 min-w-0 truncate text-[10px] leading-tight text-muted-foreground" title={metaTitle || undefined}>
                          {metaItems.map((item, idx) => (
                            <Fragment key={idx}>
                              {idx > 0 && (
                                <span aria-hidden className="text-muted-foreground/60">
                                  {' '}
                                  ·{' '}
                                </span>
                              )}
                              {item}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 text-right">
                    {priceBlocked ? (
                      <p className="text-[10px] font-medium text-destructive md:text-xs">
                        {t('products.price_not_set', { defaultValue: 'Price not set' })}
                      </p>
                    ) : saleCurrency === 'USD' ? (
                      <>
                        <p className="text-[11px] font-semibold tabular-nums text-primary md:text-xs">
                          {usdDisplay != null ? formatMoney(usdDisplay, 'USD') : '—'}
                        </p>
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          {formatMoney(catalogRetailPrice, 'UZS')} / {saleUnitLabel}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] font-semibold tabular-nums text-primary md:text-xs">
                          {formatCurrency(catalogRetailPrice)}
                        </p>
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          / {saleUnitLabel}
                        </p>
                        {usdDisplay != null && (
                          <p className="text-[10px] tabular-nums text-muted-foreground">
                            {formatMoney(usdDisplay, 'USD')}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="col-span-1 flex justify-center">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0 touch-manipulation md:h-6 md:w-6"
                      aria-label={`${product.name} — 1 ${saleUnitLabel} savatga qo'shish`}
                      title={
                        priceBlocked
                          ? t('products.price_not_set', { defaultValue: 'Price not set' })
                          : outOfStock
                            ? t('pos.stock_zero_blocked', {
                                defaultValue: '{{name}}: omborda qoldiq 0 — savatga qo‘shib bo‘lmaydi',
                                name: product.name,
                              })
                            : `1 ${saleUnitLabel} savatga qo'shish`
                      }
                      disabled={rowDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (rowDisabled) return;
                        onQuickAddOneToCart(product);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 md:h-3 md:w-3" aria-hidden />
                    </Button>
                  </div>

                  <div className="col-span-3 text-right">
                    <span
                      className={cn(
                        'text-[10px] tabular-nums',
                        product.current_stock === 0
                          ? 'font-semibold text-destructive'
                          : product.current_stock < 10
                            ? 'font-medium text-orange-500'
                            : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {product.current_stock}
                      {baseUnitLabel ? (
                        <span className="ml-0.5 text-muted-foreground">{baseUnitLabel}</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PosProductGrid = memo(PosProductGridInner);
export default PosProductGrid;
