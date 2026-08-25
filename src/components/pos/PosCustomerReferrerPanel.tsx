import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getCustomerBalances } from '@/lib/currency';
import { formatCustomerBalance } from '@/lib/format';
import type { PosSaleCurrency } from '@/lib/posSaleCurrency';
import type { Customer } from '@/types/database';
import { Check, ChevronsUpDown, HelpCircle, IdCard, UserRound, Wrench } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';

export interface PosCustomerReferrerPanelProps {
  t: TFunction;
  customers: Customer[];
  recentCustomers: Customer[];
  selectedCustomer: Customer | null;
  selectedBonusReferrer: Customer | null;
  customerComboboxOpen: boolean;
  setCustomerComboboxOpen: (open: boolean) => void;
  customerSearchTerm: string;
  setCustomerSearchTerm: (term: string) => void;
  bonusReferrerComboboxOpen: boolean;
  setBonusReferrerComboboxOpen: (open: boolean) => void;
  bonusReferrerSearchTerm: string;
  setBonusReferrerSearchTerm: (term: string) => void;
  bonusReferrerCandidates: Customer[];
  applySelectedCustomer: (customer: Customer | null) => void;
  applySelectedBonusReferrer: (customer: Customer | null) => void;
  isWalkInCustomer: (customer: Customer | null) => boolean;
  saleCurrency: PosSaleCurrency;
  currentTierCode: string;
  getCustomerDebtInCurrency: (
    customer: Customer | null | undefined,
    currency: PosSaleCurrency
  ) => number;
  getCustomerCreditInCurrency: (
    customer: Customer | null | undefined,
    currency: PosSaleCurrency
  ) => number;
  formatCurrency: (amount: number) => string;
  priorDebtInSaleCurrency: number;
  priorCreditInSaleCurrency: number;
  onPayCustomerDebt: () => void;
}

export default function PosCustomerReferrerPanel({
  t,
  customers,
  recentCustomers,
  selectedCustomer,
  selectedBonusReferrer,
  customerComboboxOpen,
  setCustomerComboboxOpen,
  customerSearchTerm,
  setCustomerSearchTerm,
  bonusReferrerComboboxOpen,
  setBonusReferrerComboboxOpen,
  bonusReferrerSearchTerm,
  setBonusReferrerSearchTerm,
  bonusReferrerCandidates,
  applySelectedCustomer,
  applySelectedBonusReferrer,
  isWalkInCustomer,
  saleCurrency,
  currentTierCode,
  getCustomerDebtInCurrency,
  getCustomerCreditInCurrency,
  formatCurrency,
  priorDebtInSaleCurrency,
  priorCreditInSaleCurrency,
  onPayCustomerDebt,
}: PosCustomerReferrerPanelProps) {
  const navigate = useNavigate();
  const customerButtonLabel = selectedCustomer
    ? selectedCustomer.name
    : t('pos.select_customer');
  const canOpenCustomerProfile =
    !!selectedCustomer && !isWalkInCustomer(selectedCustomer);

  return (
    <div className="flex-shrink-0 space-y-1 border-b bg-white p-2 dark:bg-gray-900">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,7rem)] items-end gap-1.5">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1 px-0.5">
            <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-[10px] text-muted-foreground">{t('pos.customer')}</span>
          </div>
          <div className="flex items-center gap-1">
            <Popover
              open={customerComboboxOpen}
              onOpenChange={(open) => {
                setCustomerComboboxOpen(open);
                if (!open) setCustomerSearchTerm('');
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={customerComboboxOpen}
                  aria-label={t('pos.customer')}
                  title={
                    selectedCustomer?.phone
                      ? `${selectedCustomer.name} — ${selectedCustomer.phone}`
                      : undefined
                  }
                  className="h-7 min-w-0 flex-1 justify-between px-2 text-[11px]"
                >
                  <span className="truncate">{customerButtonLabel}</span>
                  <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(92vw,28rem)] p-0 sm:w-[min(90vw,30rem)]" align="start">
              <Command
                shouldFilter={false}
                className="[&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border/40 [&_[data-slot=command-input-wrapper]]:bg-transparent [&_[data-slot=command-input-wrapper]_svg]:text-gray-400 [&_[data-slot=command-input-wrapper]_svg]:opacity-60"
              >
                <CommandInput
                  placeholder={t('pos.search_customer')}
                  value={customerSearchTerm}
                  onValueChange={setCustomerSearchTerm}
                  className="border-0 bg-transparent shadow-none outline-none ring-0 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <CommandList className="max-h-[min(55vh,22rem)]">
                  <CommandEmpty>{t('pos.no_customer_found')}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="walk-in" onSelect={() => applySelectedCustomer(null)}>
                      <Check
                        className={cn('mr-2 h-4 w-4', !selectedCustomer ? 'opacity-100' : 'opacity-0')}
                      />
                      {t('pos.walk_in_customer')}
                    </CommandItem>
                    {customers
                      .filter((customer) => {
                        if (!customerSearchTerm) return true;
                        const searchLower = customerSearchTerm.toLowerCase();
                        return (
                          customer.name.toLowerCase().includes(searchLower) ||
                          (customer.phone && customer.phone.toLowerCase().includes(searchLower)) ||
                          customer.id.toLowerCase().includes(searchLower)
                        );
                      })
                      .sort((a, b) => {
                        if (!customerSearchTerm) {
                          const aDebt = Number(a.balance || 0) < 0 ? 1 : 0;
                          const bDebt = Number(b.balance || 0) < 0 ? 1 : 0;
                          if (aDebt !== bDebt) return bDebt - aDebt;
                        }
                        return a.name.localeCompare(b.name);
                      })
                      .map((customer) => (
                        <CommandItem
                          key={customer.id}
                          value={`${customer.id}-${customer.name}-${customer.phone || ''}`}
                          onSelect={() => applySelectedCustomer(customer)}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              selectedCustomer?.id === customer.id ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{customer.name}</span>
                              {customer.phone && (
                                <span className="block text-xs text-muted-foreground">{customer.phone}</span>
                              )}
                              {customer.id && (
                                <span className="block text-[11px] text-muted-foreground">
                                  ({customer.id.slice(0, 8)})
                                </span>
                              )}
                            </span>
                            <span className="flex min-w-0 flex-wrap items-center gap-1">
                              {(() => {
                                const b = getCustomerBalances(customer);
                                const uzsInfo = formatCustomerBalance(b.uzs, 'UZS');
                                const usdInfo = formatCustomerBalance(b.usd, 'USD');
                                if (uzsInfo.type === 'zero' && Math.abs(b.usd) <= 0.0001) return null;
                                return (
                                  <span className="flex flex-wrap gap-1">
                                    {uzsInfo.type !== 'zero' && (
                                      <span
                                        className={cn(
                                          'rounded px-1.5 py-0.5 text-[10px]',
                                          uzsInfo.type === 'debt'
                                            ? 'bg-destructive/10 text-destructive'
                                            : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                                        )}
                                      >
                                        {uzsInfo.label}
                                      </span>
                                    )}
                                    {Math.abs(b.usd) > 0.0001 && (
                                      <span
                                        className={cn(
                                          'rounded px-1.5 py-0.5 text-[10px]',
                                          usdInfo.type === 'debt'
                                            ? 'bg-destructive/10 text-destructive'
                                            : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                                        )}
                                      >
                                        {usdInfo.label}
                                      </span>
                                    )}
                                  </span>
                                );
                              })()}
                              {customer.status !== 'active' && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                  Nofaol
                                </span>
                              )}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t('pos.customer_profile')}
                    disabled={!canOpenCustomerProfile}
                    onClick={() => {
                      if (!canOpenCustomerProfile || !selectedCustomer) return;
                      navigate(`/customers/${selectedCustomer.id}`);
                    }}
                  >
                    <IdCard className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('pos.customer_profile')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-0.5 px-0.5">
            <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-[10px] text-muted-foreground">
              {t('pos.bonus_referrer_short')}
            </span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('pos.bonus_referrer_hint')}
                  >
                    <HelpCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  {t('pos.bonus_referrer_hint')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Popover
            open={bonusReferrerComboboxOpen}
            onOpenChange={(open) => {
              setBonusReferrerComboboxOpen(open);
              if (!open) setBonusReferrerSearchTerm('');
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={bonusReferrerComboboxOpen}
                aria-label={t('pos.bonus_referrer')}
                title={
                  selectedBonusReferrer
                    ? `${selectedBonusReferrer.name}${
                        selectedBonusReferrer.phone ? ` — ${selectedBonusReferrer.phone}` : ''
                      }`
                    : undefined
                }
                className={cn(
                  'h-7 w-full min-w-0 justify-between px-2 text-[11px]',
                  selectedBonusReferrer && 'border-amber-300/80 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20'
                )}
              >
                <span className="truncate">
                  {selectedBonusReferrer
                    ? selectedBonusReferrer.name.split(/\s+/)[0] || selectedBonusReferrer.name
                    : t('pos.bonus_referrer_short')}
                </span>
                <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,28rem)] p-0 sm:w-[min(90vw,30rem)]" align="end">
              <Command
                shouldFilter={false}
                className="[&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border/40 [&_[data-slot=command-input-wrapper]]:bg-transparent [&_[data-slot=command-input-wrapper]_svg]:text-gray-400 [&_[data-slot=command-input-wrapper]_svg]:opacity-60"
              >
                <CommandInput
                  placeholder={t('pos.search_bonus_referrer')}
                  value={bonusReferrerSearchTerm}
                  onValueChange={setBonusReferrerSearchTerm}
                  className="border-0 bg-transparent shadow-none outline-none ring-0 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <CommandList className="max-h-[min(55vh,22rem)]">
                  <CommandEmpty>{t('pos.no_bonus_referrer_found')}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="none" onSelect={() => applySelectedBonusReferrer(null)}>
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          !selectedBonusReferrer ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {t('pos.clear_bonus_referrer')}
                    </CommandItem>
                    {bonusReferrerCandidates.map((customer) => {
                      const isMaster =
                        String((customer as { pricing_tier?: string }).pricing_tier || '') ===
                        'master';
                      return (
                        <CommandItem
                          key={`usta-${customer.id}`}
                          value={`${customer.id}-${customer.name}-${customer.phone || ''}`}
                          onSelect={() => applySelectedBonusReferrer(customer)}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              selectedBonusReferrer?.id === customer.id ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{customer.name}</span>
                              {isMaster && (
                                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                  Usta
                                </span>
                              )}
                            </span>
                            {customer.phone && (
                              <span className="text-xs text-muted-foreground">{customer.phone}</span>
                            )}
                            {Number(customer.bonus_points ?? 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {t('pos.bonus_referrer_points', {
                                  points: Math.floor(Number(customer.bonus_points) || 0),
                                })}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {recentCustomers.length > 0 && (
        <div className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-0.5 [scrollbar-width:thin]">
          {recentCustomers.map((customer) => {
            const debt = getCustomerDebtInCurrency(customer, saleCurrency);
            const credit = getCustomerCreditInCurrency(customer, saleCurrency);
            const isSelected = selectedCustomer?.id === customer.id;
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => applySelectedCustomer(customer)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-foreground/80 hover:bg-muted'
                )}
              >
                <span className="max-w-[6.5rem] truncate">{customer.name}</span>
                {debt > 0 && (
                  <span className="rounded bg-destructive/10 px-1 text-[9px] text-destructive">
                    {formatCurrency(debt)}
                  </span>
                )}
                {credit > 0 && (
                  <span className="rounded bg-emerald-600/15 px-1 text-[9px] text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(credit)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedCustomer && !isWalkInCustomer(selectedCustomer) && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-0.5 text-[10px] text-muted-foreground [scrollbar-width:thin]">
          <span className="shrink-0 font-medium text-foreground">
            {String((selectedCustomer as { pricing_tier?: string })?.pricing_tier || currentTierCode || 'retail')}
          </span>
          {String((selectedCustomer as { pricing_tier?: string })?.pricing_tier || currentTierCode || 'retail') ===
            'master' && (
            <span className="shrink-0">{Number(selectedCustomer.bonus_points ?? 0)} ball</span>
          )}
          <span
            className={cn(
              'shrink-0',
              selectedCustomer.status === 'active'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {selectedCustomer.status === 'active' ? 'Faol' : 'Nofaol'}
          </span>
          {(() => {
            const b = getCustomerBalances(selectedCustomer);
            const activeBal = saleCurrency === 'USD' ? b.usd : b.uzs;
            const activeInfo = formatCustomerBalance(activeBal, saleCurrency);
            const otherCur = saleCurrency === 'USD' ? 'UZS' : 'USD';
            const otherBal = saleCurrency === 'USD' ? b.uzs : b.usd;
            const otherInfo = formatCustomerBalance(otherBal, otherCur);
            const balanceLabel =
              activeInfo.type === 'debt'
                ? t('pos.customer_debt_label')
                : activeInfo.type === 'balance'
                  ? t('pos.customer_credit_label')
                  : t('pos.customer_balance_zero');

            return (
              <>
                <span className="shrink-0">{balanceLabel}</span>
                <span className={cn('shrink-0 font-medium text-foreground', activeInfo.color)}>
                  {activeInfo.type === 'zero'
                    ? formatCurrency(0)
                    : formatCurrency(
                        activeInfo.type === 'debt' ? priorDebtInSaleCurrency : priorCreditInSaleCurrency
                      )}
                </span>
                {Math.abs(otherBal) > 0.0001 && (
                  <span className={cn('shrink-0 text-[9px]', otherInfo.color)}>{otherInfo.label}</span>
                )}
                {priorDebtInSaleCurrency > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 shrink-0 px-1.5 text-[10px]"
                    onClick={onPayCustomerDebt}
                    disabled={selectedCustomer.status !== 'active'}
                  >
                    {t('pos.pay_customer_debt')}
                  </Button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
