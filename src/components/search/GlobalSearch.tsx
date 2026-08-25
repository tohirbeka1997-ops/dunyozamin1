import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Package,
  Users,
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  RotateCcw,
  Warehouse,
  ShoppingBag,
  Truck,
  BarChart3,
  UserCog,
  Settings,
  Wallet,
  Tag,
  FileText,
  Barcode,
  Clock,
  Globe,
} from 'lucide-react';
import { searchProducts, getCustomers, getOrdersPage } from '@/db/api';
import type { ProductWithCategory, Customer } from '@/types/database';
import { highlightMatch } from '@/utils/searchHighlight';
import { getRecentSearches, addRecentSearch } from '@/utils/recentSearches';
import { formatMoneyUZS } from '@/lib/format';
import { useDebounce } from '@/hooks/use-debounce';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/', icon: <LayoutDashboard className="h-4 w-4" />, keywords: 'bosh sahifa' },
  { name: 'POS Terminal', path: '/pos', icon: <ShoppingCart className="h-4 w-4" />, keywords: 'savdo kassa' },
  { name: 'Mahsulotlar', path: '/products', icon: <Package className="h-4 w-4" />, keywords: 'products tovarlar' },
  { name: 'Buyurtmalar', path: '/orders', icon: <Receipt className="h-4 w-4" />, keywords: 'orders' },
  { name: 'Onlayn buyurtmalar', path: '/web-orders', icon: <Globe className="h-4 w-4" />, keywords: 'web online telegram marketplace' },
  { name: 'Qaytarishlar', path: '/returns', icon: <RotateCcw className="h-4 w-4" />, keywords: 'returns returns' },
  { name: 'Mijozlar', path: '/customers', icon: <Users className="h-4 w-4" />, keywords: 'customers clients' },
  { name: 'Ombor', path: '/inventory', icon: <Warehouse className="h-4 w-4" />, keywords: 'inventory sklad' },
  { name: 'Xaridlar', path: '/purchase-orders', icon: <ShoppingBag className="h-4 w-4" />, keywords: 'purchase zakupki' },
  { name: 'Yetkazib beruvchilar', path: '/suppliers', icon: <Truck className="h-4 w-4" />, keywords: 'suppliers postavshiki' },
  { name: 'Xarajatlar', path: '/expenses', icon: <Wallet className="h-4 w-4" />, keywords: 'expenses rashod' },
  { name: 'Aksiyalar', path: '/promotions', icon: <Tag className="h-4 w-4" />, keywords: 'promotions' },
  { name: 'Hisobotlar', path: '/reports', icon: <BarChart3 className="h-4 w-4" />, keywords: 'reports' },
  { name: 'Xodimlar', path: '/employees', icon: <UserCog className="h-4 w-4" />, keywords: 'employees staff' },
  { name: 'Sozlamalar', path: '/settings', icon: <Settings className="h-4 w-4" />, keywords: 'settings nastroyki' },
  { name: 'Barkodlar', path: '/barcodes', icon: <Barcode className="h-4 w-4" />, keywords: 'barcode' },
  { name: 'Smeta', path: '/quotes', icon: <FileText className="h-4 w-4" />, keywords: 'quotes smeta' },
];

type OrderSearchHit = {
  id: string;
  order_number?: string | null;
  customer_name?: string | null;
  total_amount?: number | null;
};

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 220);

  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<OrderSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const recentSearches = getRecentSearches('global');

  const filteredNav = NAV_ITEMS.filter((item) => {
    if (!query) return false;
    const q = query.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q) ||
      item.path.toLowerCase().includes(q)
    );
  }).slice(0, 5);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setProducts([]);
      setCustomers([]);
      setOrders([]);
      setSearchError(null);
    }
  }, [open]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    if (!term || term.length < 2) {
      setProducts([]);
      setCustomers([]);
      setOrders([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const seq = ++seqRef.current;
    setSearching(true);
    setSearchError(null);

    Promise.allSettled([
      searchProducts(term),
      getCustomers({ searchTerm: term }),
      getOrdersPage({ search: term, limit: 5, sort_by: 'created_at', sort_order: 'DESC' }),
    ]).then((results) => {
      if (seqRef.current !== seq) return;

      const prods =
        results[0].status === 'fulfilled' && Array.isArray(results[0].value)
          ? (results[0].value as ProductWithCategory[])
          : [];
      const custs =
        results[1].status === 'fulfilled' && Array.isArray(results[1].value)
          ? (results[1].value as Customer[])
          : [];
      const ords =
        results[2].status === 'fulfilled' && Array.isArray(results[2].value)
          ? (results[2].value as OrderSearchHit[])
          : [];

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0 && prods.length + custs.length + ords.length === 0) {
        setSearchError(t('common.error', 'Qidiruvda xatolik'));
        console.error('Global search failed', results.filter((r) => r.status === 'rejected'));
      }

      setProducts(prods.slice(0, 5));
      setCustomers(custs.slice(0, 4));
      setOrders(ords.slice(0, 5));
      setSearching(false);
      if (prods.length + custs.length + ords.length > 0) {
        addRecentSearch('global', term);
      }
    });
  }, [debouncedQuery, t]);

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate(path);
    },
    [navigate, onOpenChange]
  );

  const isEmpty =
    !searching &&
    !searchError &&
    query.trim().length >= 2 &&
    products.length === 0 &&
    customers.length === 0 &&
    orders.length === 0 &&
    filteredNav.length === 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Global qidiruv"
      description="Mahsulot, mijoz, buyurtma yoki sahifa qidiring"
    >
      <CommandInput
        placeholder="Mahsulot, SKU, barkod, mijoz, telefon yoki buyurtma..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[480px]">
        {/* Recent searches (shown when query is empty) */}
        {!query && recentSearches.length > 0 && (
          <CommandGroup heading="Oxirgi qidiruvlar">
            {recentSearches.slice(0, 5).map((s) => (
              <CommandItem
                key={s}
                value={`recent ${s}`}
                onSelect={() => setQuery(s)}
                className="gap-2"
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{s}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Navigation shortcuts (shown when query is empty) */}
        {!query && (
          <CommandGroup heading="Tez o'tish">
            {NAV_ITEMS.slice(0, 6).map((item) => (
              <CommandItem
                key={item.path}
                value={`nav ${item.name} ${item.keywords} ${item.path}`}
                onSelect={() => handleSelect(item.path)}
                className="gap-2"
              >
                {item.icon}
                <span>{item.name}</span>
                <CommandShortcut className="text-[10px] opacity-50">{item.path}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Products */}
        {products.length > 0 && (
          <CommandGroup heading="Mahsulotlar">
            {products.map((p) => {
              const barcode = String((p as any).barcode || '').trim();
              return (
                <CommandItem
                  key={p.id}
                  value={`product ${p.name} ${p.sku || ''} ${barcode}`}
                  onSelect={() => handleSelect(`/products/${p.id}`)}
                  className="gap-3"
                >
                  <Package className="h-4 w-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {highlightMatch(p.name, query)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      SKU: {highlightMatch(p.sku || '—', query)}
                      {barcode ? <> · Barkod: {highlightMatch(barcode, query)}</> : null}
                      {(p as any).category_name ? ` · ${(p as any).category_name}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {formatMoneyUZS(Number(p.sale_price))}
                  </span>
                </CommandItem>
              );
            })}
            <CommandItem
              value={`products all ${query}`}
              onSelect={() => handleSelect(`/products?search=${encodeURIComponent(query)}`)}
              className="justify-center text-xs text-muted-foreground"
            >
              Barcha mahsulotlarda ko'rish →
            </CommandItem>
          </CommandGroup>
        )}

        {products.length > 0 && (customers.length > 0 || orders.length > 0) && <CommandSeparator />}

        {/* Customers */}
        {customers.length > 0 && (
          <CommandGroup heading="Mijozlar">
            {customers.map((c) => (
              <CommandItem
                key={c.id}
                value={`customer ${c.name} ${c.phone || ''}`}
                onSelect={() => handleSelect(`/customers/${c.id}`)}
                className="gap-3"
              >
                <Users className="h-4 w-4 shrink-0 text-green-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {highlightMatch(c.name, query)}
                  </div>
                  {c.phone && (
                    <div className="text-xs text-muted-foreground">
                      {highlightMatch(c.phone, query)}
                    </div>
                  )}
                </div>
              </CommandItem>
            ))}
            <CommandItem
              value={`customers all ${query}`}
              onSelect={() => handleSelect(`/customers?search=${encodeURIComponent(query)}`)}
              className="justify-center text-xs text-muted-foreground"
            >
              Barcha mijozlarda ko'rish →
            </CommandItem>
          </CommandGroup>
        )}

        {(products.length > 0 || customers.length > 0) && orders.length > 0 && <CommandSeparator />}

        {/* Orders */}
        {orders.length > 0 && (
          <CommandGroup heading="Buyurtmalar">
            {orders.map((o) => (
              <CommandItem
                key={o.id}
                value={`order ${o.order_number || ''} ${o.customer_name || ''} ${o.id}`}
                onSelect={() => handleSelect(`/orders/${o.id}`)}
                className="gap-3"
              >
                <Receipt className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {highlightMatch(String(o.order_number || o.id), query)}
                  </div>
                  {o.customer_name ? (
                    <div className="text-xs text-muted-foreground">
                      {highlightMatch(o.customer_name, query)}
                    </div>
                  ) : null}
                </div>
                {o.total_amount != null ? (
                  <span className="shrink-0 text-sm font-semibold">
                    {formatMoneyUZS(Number(o.total_amount) || 0)}
                  </span>
                ) : null}
              </CommandItem>
            ))}
            <CommandItem
              value={`orders all ${query}`}
              onSelect={() => handleSelect(`/orders?search=${encodeURIComponent(query)}`)}
              className="justify-center text-xs text-muted-foreground"
            >
              Barcha buyurtmalarda ko'rish →
            </CommandItem>
          </CommandGroup>
        )}

        {/* Navigation matches */}
        {filteredNav.length > 0 && (
          <>
            {(products.length > 0 || customers.length > 0 || orders.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Sahifalar">
              {filteredNav.map((item) => (
                <CommandItem
                  key={item.path}
                  value={`page ${item.name} ${item.keywords} ${item.path}`}
                  onSelect={() => handleSelect(item.path)}
                  className="gap-2"
                >
                  {item.icon}
                  <span>{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Searching indicator */}
        {searching && (
          <div className="animate-pulse py-4 text-center text-sm text-muted-foreground">
            Qidirilmoqda...
          </div>
        )}

        {searchError && !searching && (
          <div className="py-6 text-center text-sm text-destructive">{searchError}</div>
        )}

        {/* Empty state */}
        {isEmpty && <CommandEmpty>Hech narsa topilmadi</CommandEmpty>}
      </CommandList>
    </CommandDialog>
  );
}
