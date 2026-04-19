import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ProductWithCategory } from '@/types/database';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { Eye, Pencil, Trash2, AlertTriangle, Package, RotateCcw } from 'lucide-react';

type Props = {
  products: ProductWithCategory[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onRestore?: (id: string) => void;
  showRestore?: boolean;
  t: (key: string) => string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

const ROW_HEIGHT = 72;
const OVERSCAN = 10;

export default function VirtualizedProductsTable({
  products,
  onView,
  onEdit,
  onDelete,
  onRestore,
  showRestore,
  t,
  hasMore,
  loadingMore,
  loadMore,
  initialScrollTop,
  onScrollTopChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof initialScrollTop !== 'number') return;
    el.scrollTop = initialScrollTop;
    setScrollTop(initialScrollTop);
  }, [initialScrollTop]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = products.length * ROW_HEIGHT;

  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      products.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
    );
    return { start, end };
  }, [scrollTop, viewportHeight, products.length]);

  const visible = useMemo(() => products.slice(range.start, range.end), [products, range.start, range.end]);
  const offsetY = range.start * ROW_HEIGHT;

  // Auto-load more when nearing bottom of the scroll container (for huge datasets)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!hasMore || loadingMore) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
    if (nearBottom) loadMore();
  }, [scrollTop, hasMore, loadingMore, loadMore]);

  const getStockStatus = (p: ProductWithCategory) => {
    if (p.current_stock <= 0) {
      return { label: t('products.out_of_stock_label'), color: 'bg-destructive text-destructive-foreground' };
    }
    if (p.current_stock <= p.min_stock_level) {
      return { label: t('products.low_stock_label'), color: 'bg-warning text-warning-foreground' };
    }
    return { label: t('products.in_stock_label'), color: 'bg-success text-success-foreground' };
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-2">
        <div className="col-span-4">{t('products.product_name')}</div>
        <div className="col-span-2">{t('products.sku')}</div>
        <div className="col-span-2">{t('products.category')}</div>
        <div className="col-span-2 text-right">{t('products.sale_price')}</div>
        <div className="col-span-1 text-right">{t('pos.stock')}</div>
        <div className="col-span-1 text-right">{t('common.actions')}</div>
      </div>

      <div
        ref={scrollRef}
        className="relative overflow-y-auto border rounded-md"
        style={{ height: '70vh' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
        onScrollTopChange?.(el.scrollTop);
        }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visible.map((product, i) => {
              const idx = range.start + i;
              const stockStatus = getStockStatus(product);
              const lowStock = product.current_stock <= product.min_stock_level;
              const active = product.is_active;
              return (
                <div
                  key={product.id}
                  className="grid grid-cols-12 gap-2 items-center px-2 border-b"
                  style={{ height: ROW_HEIGHT }}
                  data-index={idx}
                >
                  <div className="col-span-4 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {product.image_url ? (
                          <img
                            src={getProductImageDisplayUrl(product.image_url) || product.image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{product.name}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant={active ? 'default' : 'secondary'} className="h-5 text-[10px] px-1.5">
                            {active ? t('common.active') : t('common.inactive')}
                          </Badge>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${stockStatus.color}`}>
                            {stockStatus.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatUnit(product.unit)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 font-mono text-xs truncate">{product.sku}</div>

                  <div className="col-span-2 text-xs truncate">
                    {product.category?.name || (product as any).category_name ? (
                      <Badge variant="outline">{product.category?.name || (product as any).category_name}</Badge>
                    ) : (
                      <span>-</span>
                    )}
                  </div>

                  <div className="col-span-2 text-right font-medium">{formatMoneyUZS(product.sale_price)}</div>

                  <div className="col-span-1 text-right text-xs">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {lowStock && <AlertTriangle className="h-3 w-3 text-warning" />}
                      <span className="font-medium">{formatNumberUZ(product.current_stock)}</span>
                    </span>
                  </div>

                  <div className="col-span-1 flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onView(product.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product.id)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {showRestore && onRestore ? (
                      <Button variant="ghost" size="icon" onClick={() => onRestore(product.id)} title={t('products.restore')}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => onDelete(product.id, product.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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

