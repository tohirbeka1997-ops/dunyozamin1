import { useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';

export type SearchableComboboxOption = {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string;
};

export type SearchableComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingMessage?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function optionMatches(option: SearchableComboboxOption, term: string) {
  if (!term) return true;
  const haystack = `${option.label} ${option.sublabel || ''} ${option.keywords || ''}`.toLowerCase();
  return haystack.includes(term);
}

export default function SearchableCombobox({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  loading = false,
  loadingMessage,
  id,
  className,
  triggerClassName,
  contentClassName,
}: SearchableComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const term = normalizeSearch(search);
    return options.filter((option) => optionMatches(option, term));
  }, [options, search]);

  const resolvedPlaceholder = placeholder ?? t('combobox.select_option', 'Tanlang...');
  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t('combobox.search_default', 'Qidirish...');
  const resolvedEmptyMessage = emptyMessage ?? t('combobox.not_found', 'Topilmadi');
  const resolvedLoadingMessage = loadingMessage ?? t('combobox.loading', 'Qidirilmoqda...');

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
            {selected ? (
              <span className="text-foreground">
                {selected.label}
                {selected.sublabel ? ` — ${selected.sublabel}` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">{resolvedPlaceholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[min(92vw,32rem)] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={resolvedSearchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <p className="p-2 text-xs text-muted-foreground">{resolvedLoadingMessage}</p>
            ) : (
              <>
                <CommandEmpty>{resolvedEmptyMessage}</CommandEmpty>
                <CommandGroup>
                  {filteredOptions.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.value}-${option.label}`}
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
                        {option.sublabel ? (
                          <div className="text-xs text-muted-foreground">{option.sublabel}</div>
                        ) : null}
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
