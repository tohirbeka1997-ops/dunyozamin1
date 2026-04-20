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
import { searchProducts, getCustomers } from '@/db/api';
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
  const [searching, setSearching] = useState(false);
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
    }
  }, [open]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    if (!term || term.length < 2) {
      setProducts([]);
      setCustomers([]);
      setSearching(false);
      return;
    }

    const seq = ++seqRef.current;
    setSearching(true);

    Promise.all([
      searchProducts(term).catch(() => [] as ProductWithCategory[]),
      getCustomers({ searchTerm: term }).catch(() => [] as Customer[]),
    ]).then(([prods, custs]) => {
      if (seqRef.current !== seq) return;
      setProducts(prods.slice(0, 5));
      setCustomers(custs.slice(0, 4));
      setSearching(false);
      if (prods.length + custs.length > 0) {
        addRecentSearch('global', term);
      }
    });
  }, [debouncedQuery]);

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate(path);
    },
    [navigate, onOpenChange]
  );

  const isEmpty =
    !searching &&
    query.trim().length >= 2 &&
    products.length === 0 &&
    customers.length === 0 &&
    filteredNav.length === 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Global qidiruv"
      description="Mahsulot, mijoz yoki sahifa qidiring"
    >
      <CommandInput
        placeholder="Mahsulot, mijoz yoki sahifa nomi..."
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
            {products.map((p) => (
              <CommandItem
                key={p.id}
                onSelect={() => handleSelect(`/products/${p.id}`)}
                className="gap-3"
              >
                <Package className="h-4 w-4 shrink-0 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {highlightMatch(p.name, query)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    SKU: {highlightMatch(p.sku, query)}
                    {(p as any).category_name ? ` · ${(p as any).category_name}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-blue-600 dark:text-blue-400">
                  {formatMoneyUZS(Number(p.sale_price))}
                </span>
              </CommandItem>
            ))}
            <CommandItem
              onSelect={() => handleSelect(`/products?search=${encodeURIComponent(query)}`)}
              className="text-xs text-muted-foreground justify-center"
            >
              Barcha mahsulotlarda ko'rish →
            </CommandItem>
          </CommandGroup>
        )}

        {products.length > 0 && customers.length > 0 && <CommandSeparator />}

        {/* Customers */}
        {customers.length > 0 && (
          <CommandGroup heading="Mijozlar">
            {customers.map((c) => (
              <CommandItem
                key={c.id}
                onSelect={() => handleSelect(`/customers/${c.id}`)}
                className="gap-3"
              >
                <Users className="h-4 w-4 shrink-0 text-green-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
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
              onSelect={() => handleSelect(`/customers?search=${encodeURIComponent(query)}`)}
              className="text-xs text-muted-foreground justify-center"
            >
              Barcha mijozlarda ko'rish →
            </CommandItem>
          </CommandGroup>
        )}

        {/* Navigation matches */}
        {filteredNav.length > 0 && (
          <>
            {(products.length > 0 || customers.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Sahifalar">
              {filteredNav.map((item) => (
                <CommandItem
                  key={item.path}
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
          <div className="py-4 text-center text-sm text-muted-foreground animate-pulse">
            Qidirilmoqda...
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <CommandEmpty>
            "{query}" bo'yicha hech narsa topilmadi
          </CommandEmpty>
        )}
      </CommandList>
    </CommandDialog>
  );
}
