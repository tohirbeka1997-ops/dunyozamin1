import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/use-debounce';
import { getCustomers } from '@/db/api';
import type { Customer } from '@/types/database';
import { cn } from '@/lib/utils';
import type { SearchableComboboxOption } from './SearchableCombobox';

export type SearchableCustomerComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  knownCustomers?: Customer[];
  prefixOptions?: SearchableComboboxOption[];
  status?: string;
  excludeIds?: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
  onCustomerPick?: (customer: Customer) => void;
};

export default function SearchableCustomerCombobox({
  value,
  onValueChange,
  knownCustomers = [],
  prefixOptions = [],
  status,
  excludeIds = [],
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  loading: externalLoading = false,
  id,
  className,
  triggerClassName,
  onCustomerPick,
}: SearchableCustomerComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [pickerCustomers, setPickerCustomers] = useState<Customer[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setPickerLoading(true);
      try {
        const list = await getCustomers({
          searchTerm: debouncedSearch.trim() || undefined,
          status: status && status !== 'all' ? status : undefined,
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 50,
          offset: 0,
        });
        if (cancelled) return;
        const filtered = (Array.isArray(list) ? list : []).filter((c) => !excludeSet.has(c.id));
        setPickerCustomers(filtered);
      } catch {
        if (!cancelled) setPickerCustomers([]);
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, status, excludeSet]);

  const selectedPrefix = useMemo(
    () => prefixOptions.find((option) => option.value === value) ?? null,
    [prefixOptions, value]
  );

  const selectedCustomer = useMemo(() => {
    if (selectedPrefix) return null;
    if (!value) return null;
    if (pickedCustomer?.id === value) return pickedCustomer;
    const fromKnown = knownCustomers.find((c) => c.id === value);
    if (fromKnown) return fromKnown;
    return pickerCustomers.find((c) => c.id === value) || null;
  }, [selectedPrefix, value, pickedCustomer, knownCustomers, pickerCustomers]);

  const resolvedPlaceholder = placeholder ?? t('combobox.select_customer', 'Mijozni tanlang...');
  const resolvedSearchPlaceholder =
    searchPlaceholder ??
    t('combobox.search_customer', "Ism, telefon yoki email bo'yicha qidirish...");
  const resolvedEmptyMessage = emptyMessage ?? t('combobox.no_customer', 'Mijoz topilmadi');
  const resolvedLoadingMessage = t('combobox.loading', 'Qidirilmoqda...');
  const isLoading = externalLoading || pickerLoading;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return;
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-9 w-full justify-between font-normal px-3',
            triggerClassName,
            className
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {selectedPrefix ? (
              <span className="text-foreground">{selectedPrefix.label}</span>
            ) : selectedCustomer ? (
              <span className="text-foreground">
                {selectedCustomer.name}
                {selectedCustomer.phone ? ` — ${selectedCustomer.phone}` : ''}
              </span>
            ) : value ? (
              <span className="text-muted-foreground">{value.slice(0, 8)}…</span>
            ) : (
              <span className="text-muted-foreground">{resolvedPlaceholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,32rem)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={resolvedSearchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <p className="p-2 text-xs text-muted-foreground">{resolvedLoadingMessage}</p>
            ) : (
              <>
                <CommandEmpty>{resolvedEmptyMessage}</CommandEmpty>
                <CommandGroup>
                  {prefixOptions.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`prefix-${option.value}-${option.label}`}
                      onSelect={() => {
                        onValueChange(option.value);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === option.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium leading-tight">{option.label}</div>
                      </div>
                    </CommandItem>
                  ))}
                  {pickerCustomers.map((customer) => (
                    <CommandItem
                      key={customer.id}
                      value={`${customer.id}-${customer.name}-${customer.phone || ''}`}
                      onSelect={() => {
                        setPickedCustomer(customer);
                        onValueChange(customer.id);
                        onCustomerPick?.(customer);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === customer.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-medium leading-tight">{customer.name}</div>
                        {(customer.phone || customer.email) && (
                          <div className="text-xs text-muted-foreground">
                            {customer.phone || ''}
                            {customer.phone && customer.email ? ' · ' : ''}
                            {customer.email || ''}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
