import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Printer, RotateCcw } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';

type Props = {
  orders: any[];
  getPaymentStatusBadge: (status: string) => JSX.Element;
  getStatusBadge: (status: string) => JSX.Element;
  getPaymentMethodIcons: (order: any) => JSX.Element | string;
  onView: (id: string) => void;
  onPrint: (id: string) => void;
  onReturn: (id: string) => void;
  canReturn: (order: any) => boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

const ROW_HEIGHT = 60;
const OVERSCAN = 10;

export default function VirtualizedOrdersTable({
  orders,
  getPaymentStatusBadge,
  getStatusBadge,
  getPaymentMethodIcons,
  onView,
  onPrint,
  onReturn,
  canReturn,
  hasMore,
  loadingMore,
  loadMore,
  initialScrollTop = 0,
  onScrollTopChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = initialScrollTop;
    setScrollTop(initialScrollTop);
  }, [initialScrollTop, orders.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = orders.length * ROW_HEIGHT;

  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(orders.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
    return { start, end };
  }, [scrollTop, viewportHeight, orders.length]);

  const visible = useMemo(() => orders.slice(range.start, range.end), [orders, range.start, range.end]);
  const offsetY = range.start * ROW_HEIGHT;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!hasMore || loadingMore) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
    if (nearBottom) loadMore();
  }, [scrollTop, hasMore, loadingMore, loadMore]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-2">
        <div className="col-span-2">Buyurtma</div>
        <div className="col-span-2">Sana</div>
        <div className="col-span-2">Kassir</div>
        <div className="col-span-2">Mijoz</div>
        <div className="col-span-2 text-right">Jami</div>
        <div className="col-span-2 text-right">Amallar</div>
      </div>

      <div
        ref={scrollRef}
        className="relative overflow-y-auto border rounded-md"
        style={{ height: '70vh' }}
        onScroll={(e) => {
          const next = e.currentTarget.scrollTop;
          setScrollTop(next);
          onScrollTopChange?.(next);
        }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visible.map((o: any) => (
              <div
                key={o.id}
                className="grid grid-cols-12 gap-2 items-center px-2 border-b"
                style={{ height: ROW_HEIGHT }}
              >
                <div className="col-span-2 font-mono text-xs">{o.order_number}</div>
                <div className="col-span-2 text-xs">{formatOrderDateTime(o.created_at)}</div>
                <div className="col-span-2 text-xs">{o.cashier_name || '-'}</div>
                <div className="col-span-2 text-xs truncate">{o.customer_name || 'Yangi mijoz'}</div>
                <div className="col-span-2 text-right text-xs">
                  <div className="font-medium">{formatMoneyUZS(o.total_amount)}</div>
                  <div className="flex justify-end gap-1 mt-0.5">
                    {getPaymentStatusBadge(o.payment_status)}
                    {getStatusBadge(o.status)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{getPaymentMethodIcons(o)}</div>
                </div>
                <div className="col-span-2 flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onView(o.id)} title="Tafsilotlari">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onPrint(o.id)} title="Chek">
                    <Printer className="h-4 w-4" />
                  </Button>
                  {canReturn(o) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onReturn(o.id)}
                      title="Qaytarish"
                      className="text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground">
          Yuklangan: <span className="font-medium">{orders.length}</span>
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

