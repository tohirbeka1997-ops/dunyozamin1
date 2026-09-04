import { memo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProductWithCategory } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { formatQuantity } from '@/utils/quantity';
import { formatUnit } from '@/utils/formatters';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { isProductPriceNotSet, isProductFreeSaleAllowed } from '@/lib/posHardening';
import { cn } from '@/lib/utils';
import { Eye, Pencil, Trash2, AlertTriangle, Package, RotateCcw, History } from 'lucide-react';

type StatusFilter = 'active' | 'inactive' | 'all' | string;

type Props = {
  products: ProductWithCategory[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onRestore?: (id: string) => void;
  onHistory?: (id: string) => void;
  showRestore?: boolean;
  /** When active/inactive tab is selected, hide redundant Faol/Nofaol badges. */
  statusFilter?: StatusFilter;
  t: (key: string) => string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** Applied once when ready — omit/undefined until parent finished paging restore. */
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

const ROW_HEIGHT = 64;
const OVERSCAN = 8;
const TABLE_MIN_WIDTH = 1140;

/** Name | SKU | Barcode | Artikul | Brend | Category | Buy | Sell | Stock | Actions */
const GRID_COLS =
  'minmax(220px,2.4fr) minmax(100px,0.85fr) minmax(120px,1fr) minmax(88px,0.7fr) minmax(88px,0.7fr) minmax(110px,0.9fr) minmax(100px,0.85fr) minmax(100px,0.85fr) minmax(92px,0.75fr) 112px';

function emptyCell(value: string) {
  const v = value.trim();
  if (!v) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return null;
}

function stockTone(p: ProductWithCategory): 'ok' | 'low' | 'out' {
  if (p.current_stock <= 0) return 'out';
  if (p.current_stock <= p.min_stock_level) return 'low';
  return 'ok';
}

/** Canonical field is `article` (DB + form "Artikul"). Aliases only for defensive reads. */
function productArticleOf(p: ProductWithCategory): string {
  const row = p as ProductWithCategory & {
    artikul?: string | null;
    article_number?: string | null;
    vendor_code?: string | null;
  };
  return String(row.article ?? row.artikul ?? row.article_number ?? row.vendor_code ?? '').trim();
}

/** Primary barcode (`products.barcode`). Fallbacks only if list payload uses aliases. */
function productBarcodeOf(p: ProductWithCategory): string {
  const row = p as ProductWithCategory & {
    barcode_value?: string | null;
    barcodes?: Array<string | null> | null;
    alt_barcodes?: Array<string | null> | null;
  };
  const primary = String(row.barcode ?? row.barcode_value ?? '').trim();
  if (primary) return primary;
  const extras = [row.barcodes, row.alt_barcodes].find((list) => Array.isArray(list) && list.length);
  return extras ? String(extras[0] ?? '').trim() : '';
}

type RowProps = {
  product: ProductWithCategory;
  t: (key: string) => string;
  showRestore?: boolean;
  statusFilter?: StatusFilter;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onRestore?: (id: string) => void;
  onHistory?: (id: string) => void;
};

const ProductVirtualRow = memo(function ProductVirtualRow({
  product,
  t,
  showRestore,
  statusFilter = 'active',
  onView,
  onEdit,
  onDelete,
  onRestore,
  onHistory,
}: RowProps) {
  const tone = stockTone(product);
  const active = product.is_active;
  const categoryName = String(
    product.category?.name || (product as { category_name?: string }).category_name || ''
  ).trim();
  const imageSrc = product.image_url
    ? getProductImageDisplayUrl(product.image_url) || product.image_url
    : null;

  const article = productArticleOf(product);
  const barcode = productBarcodeOf(product);
  const brand = String(product.brand ?? '').trim();
  const unitLabel = formatUnit(product.unit);
  const priceNotSet = isProductPriceNotSet(product);
  const freeSale = isProductFreeSaleAllowed(product) && Number(product.sale_price) <= 0;

  // Tabs already separate Faol / Nofaol — only show status when browsing "all".
  const showStatusBadge = statusFilter === 'all';

  return (
    <div
      className="grid h-full items-center gap-x-3 border-b border-border/70 px-3"
      style={{ gridTemplateColumns: GRID_COLS, minWidth: TABLE_MIN_WIDTH }}
    >
      {/* Name */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <Package className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-snug" title={product.name}>
              {product.name}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              {unitLabel ? (
                <span className="truncate text-[11px] text-muted-foreground" title={unitLabel}>
                  {unitLabel}
                </span>
              ) : null}
              {showStatusBadge ? (
                <Badge
                  variant={active ? 'default' : 'secondary'}
                  className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
                >
                  {active ? t('common.active') : t('common.inactive')}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* SKU — only here, never under name */}
      <div className="min-w-0 truncate font-mono text-xs tabular-nums" title={product.sku || undefined}>
        {emptyCell(product.sku || '') ?? product.sku}
      </div>

      {/* Barcode */}
      <div className="min-w-0 truncate font-mono text-xs tabular-nums" title={barcode || undefined}>
        {emptyCell(barcode) ?? barcode}
      </div>

      {/* Artikul */}
      <div
        className="min-w-0 truncate font-mono text-xs text-muted-foreground tabular-nums"
        title={article || undefined}
      >
        {emptyCell(article) ?? article}
      </div>

      {/* Brend */}
      <div className="min-w-0 truncate text-xs" title={brand || undefined}>
        {emptyCell(brand) ?? brand}
      </div>

      {/* Category */}
      <div className="min-w-0 truncate text-xs" title={categoryName || undefined}>
        {emptyCell(categoryName) ?? (
          <span className="rounded-md border border-border/80 bg-muted/40 px-1.5 py-0.5 text-[11px] text-foreground/80">
            {categoryName}
          </span>
        )}
      </div>

      {/* Buy */}
      <div
        className="truncate text-right text-xs tabular-nums text-muted-foreground"
        title={formatMoneyUZS(product.purchase_price)}
      >
        {formatMoneyUZS(product.purchase_price)}
      </div>

      {/* Sell */}
      <div className="min-w-0 text-right">
        {priceNotSet ? (
          <Badge
            variant="outline"
            className="h-5 border-destructive/40 px-1.5 text-[10px] font-medium text-destructive"
            title={t('products.price_not_set')}
          >
            {t('products.price_not_set')}
          </Badge>
        ) : freeSale ? (
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-medium"
            title={t('products.free_sale_allowed')}
          >
            {t('products.free_sale_label')}
          </Badge>
        ) : (
          <div
            className="truncate text-sm font-medium tabular-nums"
            title={formatMoneyUZS(product.sale_price)}
          >
            {formatMoneyUZS(product.sale_price)}
          </div>
        )}
      </div>

      {/* Stock + status only when low/out */}
      <div className="min-w-0 text-right">
        <div
          className={cn(
            'inline-flex items-center justify-end gap-1 text-xs font-medium tabular-nums',
            tone === 'out' && 'text-destructive',
            tone === 'low' && 'text-warning'
          )}
          title={(() => {
            const stockUnit =
              (product as any).base_unit || product.unit || 'pcs';
            const exact = formatQuantity(
              Number(product.current_stock) || 0,
              typeof stockUnit === 'string' ? stockUnit : 3,
            );
            const tip =
              tone === 'out'
                ? t('products.out_of_stock_label')
                : tone === 'low'
                  ? t('products.low_stock_label')
                  : undefined;
            return tip ? `${tip} · ${exact}` : exact;
          })()}
        >
          {tone !== 'ok' ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
          <span>
            {formatQuantity(
              Number(product.current_stock) || 0,
              (product as any).base_unit || product.unit || 'pcs',
            )}
          </span>
        </div>
        {tone === 'out' ? (
          <div className="truncate text-[10px] leading-tight text-destructive">
            {t('products.out_of_stock_label')}
          </div>
        ) : tone === 'low' ? (
          <div className="truncate text-[10px] leading-tight text-warning">
            {t('products.low_stock_label')}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-0.5">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onView(product.id)}
                aria-label={t('products.actions.view')}
                title={t('products.actions.view')}
              >
                <Eye className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('products.actions.view')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEdit(product.id)}
                aria-label={t('products.actions.edit')}
                title={t('products.actions.edit')}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('products.actions.edit')}</TooltipContent>
          </Tooltip>
          {onHistory ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onHistory(product.id)}
                  aria-label={t('products.actions.history')}
                  title={t('products.actions.history')}
                >
                  <History className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.actions.history')}</TooltipContent>
            </Tooltip>
          ) : null}
          {showRestore && onRestore ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onRestore(product.id)}
                  aria-label={t('products.restore')}
                  title={t('products.restore')}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.restore')}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onDelete(product.id, product.name)}
                  aria-label={t('products.actions.deactivate')}
                  title={t('products.actions.deactivate')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('products.actions.deactivate')}</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>
    </div>
  );
});

export default function VirtualizedProductsTable({
  products,
  onView,
  onEdit,
  onDelete,
  onRestore,
  onHistory,
  showRestore,
  statusFilter = 'active',
  t,
  hasMore,
  loadingMore,
  loadMore,
  initialScrollTop,
  onScrollTopChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);
  const persistRafRef = useRef(0);
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);

  useEffect(() => {
    loadMoreRef.current = loadMore;
    hasMoreRef.current = hasMore;
    loadingMoreRef.current = loadingMore;
  }, [loadMore, hasMore, loadingMore]);

  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Restore scroll once when parent marks ready — never re-apply while the user scrolls.
  useEffect(() => {
    if (restoredRef.current) return;
    if (typeof initialScrollTop !== 'number') return;
    if (products.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (initialScrollTop > 0) {
      el.scrollTop = initialScrollTop;
    }
    restoredRef.current = true;
  }, [initialScrollTop, products.length]);

  const persistScrollTop = useCallback(
    (scrollTop: number) => {
      if (!onScrollTopChange) return;
      if (persistRafRef.current) return;
      persistRafRef.current = requestAnimationFrame(() => {
        persistRafRef.current = 0;
        onScrollTopChange(scrollTop);
      });
    },
    [onScrollTopChange]
  );

  useEffect(() => {
    return () => {
      if (persistRafRef.current) cancelAnimationFrame(persistRafRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    persistScrollTop(el.scrollTop);
    if (!hasMoreRef.current || loadingMoreRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      loadMoreRef.current();
    }
  }, [persistScrollTop]);

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        className="relative overflow-auto rounded-md border"
        style={{ height: '70vh' }}
        onScroll={handleScroll}
      >
        <div
          className="sticky top-0 z-10 grid items-center gap-x-3 border-b bg-background px-3 py-2 text-xs font-semibold text-muted-foreground"
          style={{ gridTemplateColumns: GRID_COLS, minWidth: TABLE_MIN_WIDTH }}
        >
          <div className="min-w-0 truncate">{t('products.product_name')}</div>
          <div className="min-w-0 truncate">{t('products.sku')}</div>
          <div className="min-w-0 truncate">{t('products.barcode')}</div>
          <div
            className="min-w-0 truncate"
            title="Mahsulot formasidagi Artikul maydoni (SKU emas). Bo‘sh bo‘lsa — ko‘rinadi."
          >
            {t('products.article')}
          </div>
          <div className="min-w-0 truncate">{t('products.brand')}</div>
          <div className="min-w-0 truncate">{t('products.category')}</div>
          <div className="min-w-0 truncate text-right">{t('products.purchase_price')}</div>
          <div className="min-w-0 truncate text-right">{t('products.sale_price')}</div>
          <div className="min-w-0 truncate text-right">{t('pos.stock')}</div>
          <div className="text-right">{t('common.actions')}</div>
        </div>

        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px`, minWidth: TABLE_MIN_WIDTH }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const product = products[virtualRow.index];
            if (!product) return null;
            return (
              <div
                key={product.id}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  minWidth: TABLE_MIN_WIDTH,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ProductVirtualRow
                  product={product}
                  t={t}
                  showRestore={showRestore}
                  statusFilter={statusFilter}
                  onView={onView}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onHistory={onHistory}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          Yuklangan: <span className="font-medium">{products.length}</span>
        </p>
        {hasMore ? (
          <Button variant="outline" onClick={() => loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Yuklanmoqda...' : 'Yana yuklash'}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Barchasi yuklandi</span>
        )}
      </div>
    </div>
  );
}
