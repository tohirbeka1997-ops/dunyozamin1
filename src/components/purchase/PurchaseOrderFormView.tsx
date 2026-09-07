import { useMemo, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import MoneyInput from '@/components/common/MoneyInput';
import NumberInput from '@/components/common/NumberInput';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { formatMoney } from '@/lib/currency';
import { formatUnit } from '@/utils/formatters';
import { getProductUnits } from '@/pages/posTerminalHelpers';
import type { ProductScanIndexEntry } from '@/lib/purchase/purchaseScanSearch';
import type { SupplierWithBalance } from '@/types/database';
import {
  ArrowLeft,
  Barcode,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Layers,
  Minus,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react';
import type { LedgerCurrency } from '@/lib/supplierPaymentPayload';
import type { PoPaymentScheme, PoScheduleRow } from '@/lib/purchasePaymentScheme';
import { cn } from '@/lib/utils';

export type PoFormItem = {
  product_id: string;
  product_name: string;
  product_sku?: string;
  product_barcode?: string | null;
  ordered_qty: number;
  base_unit_cost?: number;
  base_unit_cost_usd?: number | null;
  unit_cost: number;
  line_total: number;
  line_total_usd?: number | null;
  sale_price?: number | null;
  sale_unit?: string;
};

type PoPaymentMethod = 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';

export type IndexedPoFormItem = { item: PoFormItem; index: number };

/** UZS per-unit cost for display — prefers warehouse base_unit_cost (same as save/FIFO). */
function resolveUnitCostUzs(item: PoFormItem, fxRate: number | null | undefined): number | null {
  const uzs = Number(item.base_unit_cost ?? 0);
  if (uzs > 0) return uzs;
  const usd = Number(item.base_unit_cost_usd ?? 0);
  const rate = Number(fxRate ?? 0);
  if (usd > 0 && rate > 0) return usd * rate;
  return null;
}

function hasUsdUnitCostInput(item: PoFormItem): boolean {
  return Number(item.base_unit_cost_usd ?? 0) > 0;
}

type Props = {
  isEditMode: boolean;
  isReadOnly: boolean;
  status: string;
  currency: 'UZS' | 'USD';
  loading: boolean;
  suppliers: SupplierWithBalance[];
  supplierId: string;
  onSupplierChange: (id: string) => void;
  onNewSupplier: () => void;
  orderDate: string;
  onOrderDateChange: (v: string) => void;
  invoiceNumber: string;
  onInvoiceNumberChange: (v: string) => void;
  showMoreMeta: boolean;
  onToggleMoreMeta: () => void;
  expectedDate: string;
  onExpectedDateChange: (v: string) => void;
  purchaseName: string;
  onPurchaseNameChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  scanInput: string;
  onScanInputChange: (v: string) => void;
  scanInputRef: RefObject<HTMLInputElement | null>;
  quickAddQty: number;
  onQuickAddQtyChange: (v: number) => void;
  onScanSubmit: () => void;
  onScanKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  scanCandidates: ProductScanIndexEntry[];
  /** Total matches before display cap (for «Yana N ta…»). */
  scanMatchTotal?: number;
  onPickCandidate: (p: ProductScanIndexEntry) => void;
  onOpenBulkAdd: () => void;
  onOpenCreateProduct: () => void;
  supplierPurchasedIdSet?: Set<string>;
  orderItemRows: IndexedPoFormItem[];
  itemsSearchTerm: string;
  onItemsSearchTermChange: (v: string) => void;
  items: PoFormItem[];
  highlightIds: Set<string>;
  qtyViolations?: Map<string, { receivedQty: number; orderedQty: number }>;
  receivedQtyByProductId?: Map<string, number>;
  onUpdateQty: (index: number, qty: number) => void;
  onBumpQty: (index: number, delta: number) => void;
  onUpdateCost: (index: number, cost: number) => void;
  onUpdateSalePrice: (index: number, price: number) => void;
  onUpdateUnit: (index: number, unit: string) => void;
  onRemoveItem: (index: number) => void;
  getMarginPercent: (item: PoFormItem) => number | null;
  subtotal: number;
  orderDiscountPercent: number;
  onOrderDiscountPercentChange: (v: number) => void;
  summaryExpense: number;
  onSummaryExpenseChange: (v: number) => void;
  orderTaxPercent: number;
  onOrderTaxPercentChange: (v: number) => void;
  grandTotal: number;
  orderDiscountApplied: number;
  orderTaxApplied: number;
  warehouseTotalUzs?: number | null;
  formatPoMoney?: (value: number) => string;
  fxRate: number | null;
  onFxRateChange: (v: number | null) => void;
  showFxRate: boolean;
  supplierSettlementCurrency: LedgerCurrency;
  supplierBalanceNow: number;
  existingPaidOnPo: number;
  paymentAmount: number | null;
  onPaymentAmountChange: (v: number | null) => void;
  paymentMethod: PoPaymentMethod;
  onPaymentMethodChange: (v: PoPaymentMethod) => void;
  paymentNote: string;
  onPaymentNoteChange: (v: string) => void;
  entryCurrency: LedgerCurrency;
  paymentFx: number | null;
  payableForPayment: number;
  poRemainingBeforePay: number;
  needsFxForPayment: boolean;
  paymentEntered: number;
  paymentSettlement: number;
  poRemainingAfterPay: number;
  projectedIfReceived: number | null;
  projectedIfDraftOnly: number | null;
  poAlreadyReceived: boolean;
  onFillFullPayment: () => void;
  formatSettlement: (value: number) => string;
  paymentScheme: PoPaymentScheme;
  onPaymentSchemeChange: (v: PoPaymentScheme) => void;
  paymentDueDate: string;
  onPaymentDueDateChange: (v: string) => void;
  installmentSchedule: PoScheduleRow[];
  onInstallmentScheduleChange: (rows: PoScheduleRow[]) => void;
  schemePayNow: number;
  schemeDebt: number;
  schemeDueLabel: string | null;
  installmentSumError: string | null;
  totalQty: number;
  updateSalePriceOnReceive: boolean;
  onUpdateSalePriceOnReceiveChange: (v: boolean) => void;
  onSaveDraft: () => void;
  onSaveReceive: () => void;
  onConfirmReceive?: () => void;
  showConfirmReceiveButton: boolean;
  confirmReceiveLabel: string;
  onBack: () => void;
};

function QtyStepper({
  value,
  onChange,
  onBump,
  disabled,
  size = 'lg',
}: {
  value: number;
  onChange: (v: number) => void;
  onBump: (d: number) => void;
  disabled?: boolean;
  size?: 'lg' | 'sm';
}) {
  const h = size === 'lg' ? 'h-11' : 'h-8';
  return (
    <div className={cn('inline-flex items-center border rounded-md bg-white', h)}>
      <button
        type="button"
        className="w-9 h-full hover:bg-muted/60 disabled:opacity-40"
        onClick={() => onBump(-1)}
        disabled={disabled}
      >
        <Minus className="h-3.5 w-3.5 mx-auto" />
      </button>
      {size === 'lg' ? (
        <span className="min-w-[2rem] text-center font-semibold tabular-nums">{value}</span>
      ) : (
        <NumberInput
          value={value}
          onValueChange={(v) => onChange(Math.max(0.01, Number(v ?? 1)))}
          allowZero
          min={0.01}
          disabled={disabled}
          containerClassName="space-y-0"
          className="w-12 h-full border-0 text-center shadow-none focus-visible:ring-0 p-0 font-semibold"
        />
      )}
      <button
        type="button"
        className="w-9 h-full hover:bg-muted/60 disabled:opacity-40"
        onClick={() => onBump(1)}
        disabled={disabled}
      >
        <Plus className="h-3.5 w-3.5 mx-auto" />
      </button>
    </div>
  );
}

export default function PurchaseOrderFormView(props: Props) {
  const {
    isEditMode,
    isReadOnly,
    status,
    currency,
    loading,
    suppliers,
    supplierId,
    onSupplierChange,
    onNewSupplier,
    orderDate,
    onOrderDateChange,
    invoiceNumber,
    onInvoiceNumberChange,
    showMoreMeta,
    onToggleMoreMeta,
    expectedDate,
    onExpectedDateChange,
    purchaseName,
    onPurchaseNameChange,
    notes,
    onNotesChange,
    scanInput,
    onScanInputChange,
    scanInputRef,
    quickAddQty,
    onQuickAddQtyChange,
    onScanSubmit,
    onScanKeyDown,
    scanCandidates,
    scanMatchTotal = 0,
    onPickCandidate,
    onOpenBulkAdd,
    onOpenCreateProduct,
    supplierPurchasedIdSet,
    orderItemRows,
    itemsSearchTerm,
    onItemsSearchTermChange,
    items,
    highlightIds,
    qtyViolations,
    receivedQtyByProductId,
    onUpdateQty,
    onBumpQty,
    onUpdateCost,
    onUpdateSalePrice,
    onUpdateUnit,
    onRemoveItem,
    getMarginPercent,
    subtotal,
    orderDiscountPercent,
    onOrderDiscountPercentChange,
    summaryExpense,
    onSummaryExpenseChange,
    orderTaxPercent,
    onOrderTaxPercentChange,
    grandTotal,
    orderDiscountApplied,
    orderTaxApplied,
    warehouseTotalUzs,
    formatPoMoney,
    fxRate,
    onFxRateChange,
    showFxRate,
    supplierSettlementCurrency,
    supplierBalanceNow,
    existingPaidOnPo,
    paymentAmount,
    onPaymentAmountChange,
    paymentMethod,
    onPaymentMethodChange,
    paymentNote,
    onPaymentNoteChange,
    entryCurrency,
    paymentFx,
    payableForPayment,
    poRemainingBeforePay,
    needsFxForPayment,
    paymentEntered,
    paymentSettlement,
    poRemainingAfterPay,
    projectedIfReceived,
    projectedIfDraftOnly,
    poAlreadyReceived,
    onFillFullPayment,
    formatSettlement,
    paymentScheme,
    onPaymentSchemeChange,
    paymentDueDate,
    onPaymentDueDateChange,
    installmentSchedule,
    onInstallmentScheduleChange,
    schemePayNow,
    schemeDebt,
    schemeDueLabel,
    installmentSumError,
    totalQty,
    updateSalePriceOnReceive,
    onUpdateSalePriceOnReceiveChange,
    onSaveDraft,
    onSaveReceive,
    onConfirmReceive,
    showConfirmReceiveButton,
    confirmReceiveLabel,
    onBack,
  } = props;

  const fmtPo = formatPoMoney ?? ((v: number) => formatMoney(v, currency));
  const isUsdPo = currency === 'USD';
  const itemsSearchActive = itemsSearchTerm.trim().length > 0;
  const visibleItemCount = orderItemRows.length;

  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId]
  );

  const filteredSuppliers = useMemo(() => {
    const term = supplierSearch.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (!term) return true;
        return (
          s.name.toLowerCase().includes(term) ||
          (s.phone && s.phone.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, supplierSearch]);

  const canReceive = !isReadOnly && !!supplierId && items.length > 0;

  return (
    <div className="min-h-screen bg-[#f4f6f8] -m-4 md:-m-6 p-4 md:p-5 max-w-[1700px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4 pb-3 border-b bg-white/80 rounded-lg px-4 py-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← Xarid buyurtmalari
            </button>
            <h1 className="text-xl font-semibold text-[#1d2127]">
              {isEditMode ? 'Xarid buyurtmasini tahrirlash' : 'Yangi xarid buyurtmasi'}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border bg-muted/50 px-3 py-1 capitalize">{status}</span>
          <span className="rounded-full border bg-emerald-50 text-emerald-800 font-medium px-3 py-1">
            {items.length} xil · {totalQty} dona
          </span>
          <span className="rounded-full border bg-muted/50 px-3 py-1">
            {currency}
            {supplierId ? ` · ${supplierSettlementCurrency}` : ''}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            {/* Top meta — compact */}
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div className="flex-[2] min-w-[200px] space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Yetkazib beruvchi <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-1.5">
                  <Popover
                    open={supplierPickerOpen}
                    onOpenChange={(open) => {
                      if (isReadOnly) return;
                      setSupplierPickerOpen(open);
                      if (!open) setSupplierSearch('');
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={supplierPickerOpen}
                        disabled={isReadOnly}
                        className="h-9 flex-1 justify-between font-normal px-3"
                      >
                        <span className="min-w-0 flex-1 truncate text-left text-sm">
                          {selectedSupplier ? (
                            <span className="text-foreground">
                              {selectedSupplier.name}
                              {selectedSupplier.phone ? ` — ${selectedSupplier.phone}` : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Yetkazib beruvchini tanlang</span>
                          )}
                        </span>
                        <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(92vw,32rem)] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Ism yoki telefon bo‘yicha qidirish..."
                          value={supplierSearch}
                          onValueChange={setSupplierSearch}
                        />
                        <CommandList>
                          <CommandEmpty>Yetkazib beruvchi topilmadi</CommandEmpty>
                          <CommandGroup>
                            {filteredSuppliers.map((s) => (
                              <CommandItem
                                key={s.id}
                                value={`${s.id}-${s.name}-${s.phone || ''}`}
                                onSelect={() => {
                                  onSupplierChange(s.id);
                                  setSupplierPickerOpen(false);
                                  setSupplierSearch('');
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    supplierId === s.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <div className="min-w-0 text-sm">
                                  <div className="font-medium leading-tight">{s.name}</div>
                                  {s.phone && (
                                    <div className="text-xs text-muted-foreground">{s.phone}</div>
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {!isReadOnly && (
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={onNewSupplier}>
                      <UserPlus className="h-4 w-4 text-emerald-700" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-[130px] space-y-1">
                <Label className="text-xs text-muted-foreground">Sana</Label>
                <Input type="date" value={orderDate} onChange={(e) => onOrderDateChange(e.target.value)} disabled={isReadOnly} className="h-9" />
              </div>
              <div className="flex-1 min-w-[130px] space-y-1">
                <Label className="text-xs text-muted-foreground">Nakladnoy №</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => onInvoiceNumberChange(e.target.value)}
                  placeholder="INV-2026-00125"
                  disabled={isReadOnly}
                  className="h-9"
                />
              </div>
              <Button type="button" variant="outline" className="h-9 text-muted-foreground" onClick={onToggleMoreMeta}>
                <ChevronDown className={cn('h-4 w-4 mr-1 transition', showMoreMeta && 'rotate-180')} />
                Qo‘shimcha
              </Button>
              {showFxRate && (
                <div className="w-full flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[160px] space-y-1">
                    <Label className="text-xs text-muted-foreground">Kurs (1 USD = UZS)</Label>
                    <MoneyInput
                      value={typeof fxRate === 'number' && fxRate > 0 ? fxRate : null}
                      onValueChange={(v) => onFxRateChange(v == null ? null : Number(v))}
                      allowDecimals
                      allowZero={false}
                      disabled={isReadOnly}
                      containerClassName="space-y-0"
                      className="h-9 text-right"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground pb-2">
                    Buyurtma USD da — kurs majburiy (ombor tannarxi UZS da saqlanadi)
                  </p>
                </div>
              )}
            </div>

            {showMoreMeta && (
              <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b">
                <div className="flex-1 min-w-[140px] space-y-1">
                  <Label className="text-xs text-muted-foreground">Kutilayotgan sana</Label>
                  <Input type="date" value={expectedDate} onChange={(e) => onExpectedDateChange(e.target.value)} disabled={isReadOnly} className="h-9" />
                </div>
                <div className="flex-1 min-w-[160px] space-y-1">
                  <Label className="text-xs text-muted-foreground">Xarid nomi</Label>
                  <Input value={purchaseName} onChange={(e) => onPurchaseNameChange(e.target.value)} disabled={isReadOnly} className="h-9" />
                </div>
                <div className="w-full space-y-1">
                  <Label className="text-xs text-muted-foreground">Izoh</Label>
                  <Textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} disabled={isReadOnly} rows={2} className="resize-none" />
                </div>
              </div>
            )}

            {/* Scan hero */}
            {!isReadOnly && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 mb-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Barcode className="h-6 w-6 text-emerald-700 shrink-0 hidden sm:block" />
                  <Input
                    ref={scanInputRef}
                    value={scanInput}
                    onChange={(e) => onScanInputChange(e.target.value)}
                    onKeyDown={onScanKeyDown}
                    placeholder="Skanerlang yoki nom / SKU bo‘yicha qidiring…"
                    className="flex-1 min-w-[200px] h-11 text-base border-emerald-300 focus-visible:ring-emerald-200"
                    autoFocus
                  />
                  <QtyStepper
                    value={quickAddQty}
                    onChange={onQuickAddQtyChange}
                    onBump={(d) => onQuickAddQtyChange(Math.max(1, quickAddQty + d))}
                  />
                  <Button
                    type="button"
                    className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    onClick={onScanSubmit}
                  >
                    ↵ Qo‘shish
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 border-emerald-300 text-emerald-800 hover:bg-emerald-100/80 font-medium"
                    onClick={onOpenCreateProduct}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Yangi mahsulot
                  </Button>
                  <Button type="button" variant="outline" className="h-11" onClick={onOpenBulkAdd}>
                    <Layers className="h-4 w-4 mr-1.5" />
                    Ko‘p mahsulot
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-emerald-800">
                  <span>⚡ Skan = avtomatik qo‘shiladi</span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border bg-white text-[10px] font-mono">F2</kbd> fokus
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border bg-white text-[10px] font-mono">Enter</kbd> qo‘shish
                  </span>
                  <span>
                    <kbd className="px-1.5 py-0.5 rounded border bg-white text-[10px] font-mono">↑ ↓</kbd> miqdor
                  </span>
                </div>

                {scanCandidates.length > 0 && (
                  <div className="mt-2 rounded-lg border bg-white overflow-hidden max-h-64 overflow-y-auto">
                    {scanCandidates.map((p) => {
                      const stock = Number((p as { current_stock?: number }).current_stock ?? 0) || 0;
                      const minStock = Number((p as { min_stock_level?: number }).min_stock_level ?? 0) || 0;
                      const unit = String((p as { unit?: string }).unit || 'pcs');
                      const inactive = (p as { is_active?: boolean }).is_active === false;
                      const lowStock = stock > 0 && minStock > 0 && stock <= minStock;
                      const outOfStock = stock <= 0;
                      const fromSupplierHistory = supplierPurchasedIdSet?.has(p.id);
                      const costUzs =
                        Number((p as ProductScanIndexEntry).cost_price ?? p.purchase_price ?? 0) || 0;
                      const rate = Number(fxRate ?? 0);
                      const costUsd =
                        currency === 'USD' && rate > 0 && costUzs > 0 ? costUzs / rate : null;
                      return (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b last:border-0 text-sm"
                        onClick={() => onPickCandidate(p)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium">{p.name}</span>
                            {fromSupplierHistory && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-700 bg-sky-50 border border-sky-200 rounded px-1 py-0.5">
                                avval xarid
                              </span>
                            )}
                            {inactive && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                                nofaol
                              </span>
                            )}
                            <div className="text-muted-foreground font-mono text-xs mt-0.5">
                              {p.sku}
                              {(p as { barcode?: string }).barcode ? ` · ${(p as { barcode?: string }).barcode}` : ''}
                              {(p as { article?: string | null }).article
                                ? ` · ${(p as { article?: string | null }).article}`
                                : ''}
                              {(p as { brand?: string | null }).brand
                                ? ` · ${(p as { brand?: string | null }).brand}`
                                : ''}
                            </div>
                          </div>
                          <div className="text-right shrink-0 text-xs tabular-nums">
                            {currency === 'USD' && costUsd != null && costUsd > 0 ? (
                              <>
                                <div className="font-medium">{formatMoney(costUsd, 'USD')}</div>
                                <div className="text-muted-foreground">{formatMoneyUZS(costUzs)}</div>
                              </>
                            ) : (
                              <div className="font-medium">{formatMoneyUZS(costUzs)}</div>
                            )}
                            <div className="text-muted-foreground flex items-center justify-end gap-1">
                              <span>{formatNumberUZ(stock)} {formatUnit(unit)}</span>
                              {outOfStock && (
                                <span className="text-[10px] text-destructive font-medium">tugagan</span>
                              )}
                              {!outOfStock && lowStock && (
                                <span className="text-[10px] text-amber-700 font-medium">kam</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                    })}
                    {scanMatchTotal > scanCandidates.length && (
                      <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border-t sticky bottom-0">
                        Yana {scanMatchTotal - scanCandidates.length} ta… Qidiruvni aniqlashtiring.
                      </div>
                    )}
                  </div>
                )}

                {scanInput.trim() && scanCandidates.length === 0 && (
                  <button
                    type="button"
                    className="mt-2 text-sm text-emerald-800 font-medium hover:underline"
                    onClick={onOpenCreateProduct}
                  >
                    + Yangi mahsulot: &apos;{scanInput.trim()}&apos;
                  </button>
                )}
              </div>
            )}

            {/* Product table */}
            <div className="rounded-lg border overflow-hidden">
              {items.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/20">
                  <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={itemsSearchTerm}
                      onChange={(e) => onItemsSearchTermChange(e.target.value)}
                      placeholder="Buyurtmadagi mahsulotlarni qidiring (nom, SKU, shtrix)…"
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                  {itemsSearchActive && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {visibleItemCount} / {items.length} qator
                    </span>
                  )}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/40 text-muted-foreground text-xs">
                      <th className="w-8 p-2 text-center font-semibold">#</th>
                      <th className="p-2 text-left font-semibold min-w-[160px]">Mahsulot</th>
                      <th className="p-2 text-center font-semibold w-[118px]">Miqdor</th>
                      <th className="p-2 text-center font-semibold w-[84px]">Birlik</th>
                      <th className="p-2 text-right font-semibold w-[104px]">
                        Tannarx {currency === 'USD' ? '(USD)' : '(UZS)'}
                        <span className="block font-normal text-[10px] text-muted-foreground">
                          qoralamada ixtiyoriy
                        </span>
                      </th>
                      <th className="p-2 text-right font-semibold w-[110px]">
                        Sotuv (UZS)
                        <span className="block font-normal text-[10px] text-muted-foreground">
                          ixtiyoriy
                        </span>
                      </th>
                      <th className="p-2 text-right font-semibold w-[72px]">Marja</th>
                      <th className="p-2 text-right font-semibold w-[100px]">Jami</th>
                      {!isReadOnly && <th className="w-9" />}
                    </tr>
                  </thead>
                  <tbody>
                    {orderItemRows.map(({ item, index }, displayIndex) => {
                      const units = getProductUnits(item as any).units;
                      const margin = getMarginPercent(item);
                      const isNew = highlightIds.has(item.product_id);
                      const violation = qtyViolations?.get(item.product_id);
                      const receivedQty = receivedQtyByProductId?.get(item.product_id) ?? 0;
                      return (
                        <tr
                          key={`${item.product_id}-${item.sale_unit || 'pcs'}-${index}`}
                          className={cn(
                            'border-t',
                            isNew && 'animate-[poFlash_1.1s_ease] bg-emerald-50',
                            violation && 'bg-destructive/10 ring-1 ring-inset ring-destructive/35',
                          )}
                        >
                          <td className="p-2 text-center text-muted-foreground text-xs">{displayIndex + 1}</td>
                          <td className="p-2">
                            <div className="font-semibold text-[#1d2127]">{item.product_name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {item.product_sku || '—'}
                              {item.product_barcode ? ` · ${item.product_barcode}` : ''}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            {isReadOnly ? (
                              item.ordered_qty
                            ) : (
                              <div className="inline-flex flex-col items-center gap-1">
                                <QtyStepper
                                  size="sm"
                                  value={item.ordered_qty}
                                  onChange={(v) => onUpdateQty(index, v)}
                                  onBump={(d) => onBumpQty(index, d)}
                                />
                                {violation ? (
                                  <p className="text-[10px] text-destructive font-medium leading-tight max-w-[110px]">
                                    Qabul: {formatNumberUZ(violation.receivedQty)} · Buyurtma:{' '}
                                    {formatNumberUZ(violation.orderedQty)}
                                  </p>
                                ) : receivedQty > 0 ? (
                                  <p className="text-[10px] text-muted-foreground leading-tight">
                                    Qabul: {formatNumberUZ(receivedQty)}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {isReadOnly ? (
                              formatUnit(item.sale_unit)
                            ) : (
                              <Select value={item.sale_unit || 'pcs'} onValueChange={(u) => onUpdateUnit(index, u)}>
                                <SelectTrigger className="h-8 text-xs w-[74px] mx-auto">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {units.map((u: any) => (
                                    <SelectItem key={u.unit} value={u.unit}>
                                      {formatUnit(u.unit)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="p-2 text-right">
                            {isReadOnly ? (
                              currency === 'USD' ? (
                                <div className="text-right tabular-nums">
                                  <div>{Number(item.base_unit_cost_usd ?? 0).toFixed(2)} USD</div>
                                  {(() => {
                                    const rate = Number(fxRate ?? 0);
                                    const uzsEquiv = resolveUnitCostUzs(item, fxRate);
                                    if (rate > 0 && uzsEquiv != null && uzsEquiv > 0) {
                                      return (
                                        <div className="text-[10px] font-normal text-muted-foreground">
                                          {formatMoneyUZS(uzsEquiv)}
                                        </div>
                                      );
                                    }
                                    if (hasUsdUnitCostInput(item) && rate <= 0) {
                                      return (
                                        <div className="text-[10px] font-normal text-muted-foreground italic">
                                          kurs kiriting
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              ) : (
                                formatMoneyUZS(Number(item.base_unit_cost ?? 0))
                              )
                            ) : currency === 'USD' ? (
                              <div className="ml-auto text-right min-w-[92px]">
                                <MoneyInput
                                  value={
                                    Number(item.base_unit_cost_usd ?? 0) > 0
                                      ? Number(item.base_unit_cost_usd)
                                      : null
                                  }
                                  onValueChange={(v) => onUpdateCost(index, Number(v ?? 0))}
                                  allowDecimals
                                  decimalScale={2}
                                  allowZero
                                  disabled={isReadOnly}
                                  containerClassName="space-y-0"
                                  className="h-8 w-[92px] ml-auto text-right text-xs"
                                  placeholder="—"
                                />
                                {(() => {
                                  const rate = Number(fxRate ?? 0);
                                  const uzsEquiv = resolveUnitCostUzs(item, fxRate);
                                  if (rate > 0 && uzsEquiv != null && uzsEquiv > 0) {
                                    return (
                                      <div className="text-[10px] font-normal text-muted-foreground tabular-nums">
                                        {formatMoneyUZS(uzsEquiv)}
                                      </div>
                                    );
                                  }
                                  if (hasUsdUnitCostInput(item) && rate <= 0) {
                                    return (
                                      <div className="text-[10px] font-normal text-muted-foreground italic">
                                        kurs kiriting
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            ) : (
                              <MoneyInput
                                value={
                                  Number(item.base_unit_cost ?? 0) > 0
                                    ? Number(item.base_unit_cost)
                                    : null
                                }
                                onValueChange={(v) => onUpdateCost(index, Number(v ?? 0))}
                                allowZero
                                containerClassName="space-y-0"
                                className="h-8 w-[92px] ml-auto text-right text-xs"
                                placeholder="—"
                              />
                            )}
                          </td>
                          <td className="p-2 text-right">
                            {isReadOnly ? (
                              Number(item.sale_price ?? 0) > 0 ? formatMoneyUZS(item.sale_price!) : '—'
                            ) : (
                              <MoneyInput
                                value={typeof item.sale_price === 'number' && item.sale_price > 0 ? item.sale_price : null}
                                onValueChange={(v) => onUpdateSalePrice(index, Number(v ?? 0))}
                                allowZero
                                containerClassName="space-y-0"
                                className="h-8 w-[92px] ml-auto text-right text-xs"
                                placeholder="—"
                              />
                            )}
                          </td>
                          <td className="p-2 text-right text-xs tabular-nums text-muted-foreground">
                            {margin == null ? '—' : `${margin.toFixed(0)}%`}
                          </td>
                          <td className="p-2 text-right font-semibold tabular-nums">
                            {currency === 'USD' ? (
                              <div className="text-right">
                                <div>{Number(item.line_total_usd ?? 0).toFixed(2)} USD</div>
                                <div className="text-[10px] font-normal text-muted-foreground">
                                  {formatMoneyUZS(item.line_total)}
                                </div>
                              </div>
                            ) : (
                              formatMoneyUZS(item.line_total)
                            )}
                          </td>
                          {!isReadOnly && (
                            <td className="p-2 text-center">
                              {receivedQty > 0 ? (
                                <button
                                  type="button"
                                  className="text-muted-foreground/40 cursor-not-allowed"
                                  title="Qabul qilingan mahsulotni o‘chirib bo‘lmaydi"
                                  aria-label="Qabul qilingan mahsulotni o‘chirib bo‘lmaydi"
                                  disabled
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => onRemoveItem(index)}
                                  aria-label="Mahsulotni o‘chirish"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {items.length === 0 && (
                <p className="text-center text-muted-foreground py-12 text-sm">
                  Hozircha mahsulot yo‘q — skanerlang, qidiring yoki «Yangi mahsulot» tugmasini bosing.
                </p>
              )}
              {items.length > 0 && itemsSearchActive && visibleItemCount === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  «{itemsSearchTerm.trim()}» bo‘yicha buyurtmada mahsulot topilmadi.
                </p>
              )}
              <div className="flex justify-between px-3 py-2 text-xs text-muted-foreground border-t bg-muted/20">
                <span>
                  {items.length} xil · {totalQty} dona
                </span>
                <span>Yangi skan — ro‘yxat tepasida</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky summary */}
        <div className="xl:sticky xl:top-4 rounded-xl border bg-white p-4 shadow-sm space-y-1">
          <div className="flex justify-between text-sm py-1">
            <span className="text-muted-foreground">Oraliq summa</span>
            <span className="tabular-nums font-medium">{fmtPo(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center text-sm py-1">
            <span className="text-muted-foreground">Chegirma %</span>
            <MoneyInput
              value={orderDiscountPercent > 0 ? orderDiscountPercent : null}
              onValueChange={(v) => onOrderDiscountPercentChange(Number(v ?? 0))}
              allowDecimals
              allowZero
              max={100}
              disabled={isReadOnly}
              containerClassName="space-y-0"
              className="w-20 h-8 text-right"
            />
          </div>
          {orderDiscountApplied > 0 && (
            <div className="flex justify-between text-sm py-0.5 text-muted-foreground">
              <span>Chegirma summasi</span>
              <span className="tabular-nums">−{fmtPo(orderDiscountApplied)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm py-1">
            <span className="text-muted-foreground">Xarajat (tannarxga)</span>
            {isUsdPo ? (
              <MoneyInput
                value={summaryExpense > 0 ? summaryExpense : null}
                onValueChange={(v) => onSummaryExpenseChange(Number(v ?? 0))}
                allowDecimals
                allowZero
                disabled={isReadOnly}
                containerClassName="space-y-0"
                className="w-24 h-8 text-right"
              />
            ) : (
              <MoneyInput
                value={summaryExpense}
                onValueChange={(v) => onSummaryExpenseChange(Number(v ?? 0))}
                allowZero
                disabled={isReadOnly}
                containerClassName="space-y-0"
                className="w-20 h-8 text-right"
              />
            )}
          </div>
          <div className="flex justify-between items-center text-sm py-1">
            <span className="text-muted-foreground">Soliq %</span>
            <MoneyInput
              value={orderTaxPercent > 0 ? orderTaxPercent : null}
              onValueChange={(v) => onOrderTaxPercentChange(Number(v ?? 0))}
              allowDecimals
              allowZero
              disabled={isReadOnly}
              containerClassName="space-y-0"
              className="w-20 h-8 text-right"
            />
          </div>
          {orderTaxApplied > 0 && (
            <div className="flex justify-between text-sm py-0.5 text-muted-foreground">
              <span>Soliq summasi</span>
              <span className="tabular-nums">+{fmtPo(orderTaxApplied)}</span>
            </div>
          )}

          <div className="flex justify-between items-baseline pt-3 mt-2 border-t">
            <span className="font-semibold">Jami</span>
            <span className="text-2xl font-bold text-emerald-700 tabular-nums">
              {fmtPo(grandTotal)}
            </span>
          </div>
          {isUsdPo && warehouseTotalUzs != null && warehouseTotalUzs > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Jami (ombor UZS)</span>
              <span className="tabular-nums font-medium">{formatMoneyUZS(warehouseTotalUzs)}</span>
            </div>
          )}

          {!isReadOnly && supplierId && (
            <div className="border-t pt-3 mt-3 space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-emerald-700" />
                To&apos;lov sxemasi
              </div>
              <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[12px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {supplierBalanceNow > 0
                      ? 'Yetkazib beruvchi qarzi'
                      : supplierBalanceNow < 0
                        ? 'Yetkazib beruvchi avansi'
                        : 'Yetkazib beruvchi balansi'}
                  </span>
                  <span
                    className={
                      supplierBalanceNow > 0
                        ? 'font-medium text-destructive'
                        : supplierBalanceNow < 0
                          ? 'font-medium text-emerald-600'
                          : 'font-medium'
                    }
                  >
                    {fmtPo(Math.abs(supplierBalanceNow))}
                    {supplierBalanceNow < 0 ? ' (avans)' : ''}
                  </span>
                </div>
                {existingPaidOnPo > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avval to&apos;langan</span>
                    <span className="font-medium">{fmtPo(existingPaidOnPo)}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'full', label: "To'liq" },
                    { id: 'partial', label: 'Qisman + qarz' },
                    { id: 'installment', label: "Bo'lib to'lash" },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.id}
                    type="button"
                    size="sm"
                    variant={paymentScheme === opt.id ? 'default' : 'outline'}
                    className={cn('h-8 text-[11px] px-1', paymentScheme === opt.id && 'bg-emerald-600 hover:bg-emerald-700')}
                    onClick={() => onPaymentSchemeChange(opt.id)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {entryCurrency !== supplierSettlementCurrency && (
                <p className="text-[11px] text-muted-foreground">
                  Hisob valyutasi: {supplierSettlementCurrency}
                  {paymentFx ? ` · kurs ${paymentFx.toLocaleString('uz-UZ')}` : ''}
                </p>
              )}
              {needsFxForPayment && (
                <p className="text-[11px] text-destructive">
                  To&apos;lov uchun USD/UZS kursini kiriting.
                </p>
              )}

              <div className="space-y-1.5">
                <Label className="text-[12px]">
                  Hozir to&apos;lanadi {entryCurrency === 'USD' ? '(USD)' : '(UZS)'}
                </Label>
                <div className="flex gap-2">
                  {currency === 'USD' ? (
                    <MoneyInput
                      value={paymentAmount}
                      onValueChange={(v) => onPaymentAmountChange(v)}
                      allowDecimals
                      allowZero
                      containerClassName="flex-1 space-y-0"
                      className="h-9"
                    />
                  ) : (
                    <MoneyInput
                      value={paymentAmount}
                      onValueChange={(v) => onPaymentAmountChange(v)}
                      allowDecimals
                      allowZero
                      containerClassName="flex-1 space-y-0"
                      className="h-9"
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-9"
                    onClick={onFillFullPayment}
                    disabled={poRemainingBeforePay <= 0 || needsFxForPayment}
                  >
                    To&apos;liq
                  </Button>
                </div>
              </div>

              {paymentScheme === 'partial' && (
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Qarz muddati</Label>
                  <Input
                    type="date"
                    value={paymentDueDate}
                    onChange={(e) => onPaymentDueDateChange(e.target.value)}
                    className="h-9"
                  />
                </div>
              )}

              {paymentScheme === 'installment' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px]">To&apos;lov jadvali</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() =>
                        onInstallmentScheduleChange([
                          ...installmentSchedule,
                          {
                            seq: installmentSchedule.length + 1,
                            due_date: paymentDueDate || '',
                            amount: 0,
                            amount_usd: currency === 'USD' ? 0 : null,
                          },
                        ])
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Qator
                    </Button>
                  </div>
                  {installmentSchedule.map((row, idx) => (
                    <div key={`sched-${row.seq}-${idx}`} className="flex gap-1.5 items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Sana</Label>
                        <Input
                          type="date"
                          value={row.due_date || ''}
                          onChange={(e) => {
                            const next = [...installmentSchedule];
                            next[idx] = { ...row, due_date: e.target.value };
                            onInstallmentScheduleChange(next);
                          }}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Summa</Label>
                        {currency === 'USD' ? (
                          <MoneyInput
                            value={row.amount_usd ?? row.amount ?? null}
                            onValueChange={(v) => {
                              const next = [...installmentSchedule];
                              const amt = Number(v ?? 0);
                              next[idx] = { ...row, amount_usd: amt, amount: paymentFx ? amt * paymentFx : 0 };
                              onInstallmentScheduleChange(next);
                            }}
                            allowDecimals
                            allowZero
                            containerClassName="space-y-0"
                            className="h-8 text-xs"
                          />
                        ) : (
                          <MoneyInput
                            value={row.amount}
                            onValueChange={(v) => {
                              const next = [...installmentSchedule];
                              next[idx] = { ...row, amount: Number(v ?? 0) };
                              onInstallmentScheduleChange(next);
                            }}
                            allowDecimals
                            allowZero
                            containerClassName="space-y-0"
                            className="h-8 text-xs"
                          />
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive"
                        disabled={installmentSchedule.length <= 1}
                        onClick={() =>
                          onInstallmentScheduleChange(
                            installmentSchedule
                              .filter((_, i) => i !== idx)
                              .map((r, i) => ({ ...r, seq: i + 1 }))
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {installmentSumError && (
                    <p className="text-[11px] text-destructive">{installmentSumError}</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-[12px]">To&apos;lov usuli</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => onPaymentMethodChange(v as PoPaymentMethod)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Naqd</SelectItem>
                    <SelectItem value="card">Karta</SelectItem>
                    <SelectItem value="transfer">O&apos;tkazma</SelectItem>
                    <SelectItem value="click">Click</SelectItem>
                    <SelectItem value="payme">Payme</SelectItem>
                    <SelectItem value="uzum">Uzum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Izoh (ixtiyoriy)</Label>
                <Input
                  value={paymentNote}
                  onChange={(e) => onPaymentNoteChange(e.target.value)}
                  placeholder="Masalan: naqd, oldindan to'lov"
                  className="h-9"
                />
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/40 px-2.5 py-2 text-[11px] space-y-0.5">
                <p>
                  <span className="text-muted-foreground">Hozir to&apos;lanadi:</span>{' '}
                  <span className="font-medium">{formatSettlement(schemePayNow)}</span>
                  {' · '}
                  <span className="text-muted-foreground">Qarz:</span>{' '}
                  <span className={schemeDebt > 0 ? 'font-medium text-destructive' : 'font-medium'}>
                    {formatSettlement(schemeDebt)}
                  </span>
                  {schemeDueLabel ? (
                    <>
                      {' · '}
                      <span className="text-muted-foreground">Muddat:</span>{' '}
                      <span className="font-medium">{schemeDueLabel}</span>
                    </>
                  ) : null}
                </p>
              </div>
              {paymentEntered > 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-2.5 py-2 text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span>Buyurtma jami</span>
                    <span className="font-medium">{fmtPo(payableForPayment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Farq (hisob valyutasida)</span>
                    <span
                      className={
                        paymentSettlement > poRemainingBeforePay
                          ? 'font-medium text-emerald-600'
                          : paymentSettlement < poRemainingBeforePay
                            ? 'font-medium text-destructive'
                            : 'font-medium'
                      }
                    >
                      {formatSettlement(paymentSettlement - poRemainingBeforePay)}
                    </span>
                  </div>
                  {poRemainingAfterPay > 0 ? (
                    <p className="text-destructive">
                      Buyurtma bo&apos;yicha qoldiq: {formatSettlement(poRemainingAfterPay)}
                    </p>
                  ) : poRemainingAfterPay < 0 ? (
                    <p className="text-emerald-700">
                      Ortiqcha to&apos;lov (avans): {formatSettlement(Math.abs(poRemainingAfterPay))}
                    </p>
                  ) : (
                    <p className="text-emerald-700">Buyurtma to&apos;liq yopiladi</p>
                  )}
                  {projectedIfReceived != null && (
                    <p>
                      Qabul qilinganda taxminiy balans:{' '}
                      <span className="font-semibold">{formatSettlement(projectedIfReceived)}</span>
                    </p>
                  )}
                  {projectedIfDraftOnly != null && !poAlreadyReceived && (
                    <p className="text-muted-foreground">
                      Qoralama (qabulsiz) balans:{' '}
                      <span className="font-medium">{formatSettlement(projectedIfDraftOnly)}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!isReadOnly && (
            <>
              <Button
                className="w-full h-11 mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                onClick={onSaveReceive}
                disabled={loading || !canReceive}
              >
                ⬇ Saqlash va qabul
              </Button>
              <Button
                variant="outline"
                className="w-full h-10 mt-2"
                onClick={onSaveDraft}
                disabled={loading || items.length === 0}
              >
                Qoralama saqlash
              </Button>
              {showConfirmReceiveButton && onConfirmReceive && (
                <Button className="w-full h-10 mt-2" variant="secondary" onClick={onConfirmReceive} disabled={loading || !canReceive}>
                  {confirmReceiveLabel}
                </Button>
              )}
              <div className="flex items-center justify-between gap-2 pt-3 text-xs">
                <Label htmlFor="update-sale-price" className="text-muted-foreground font-normal cursor-pointer">
                  Qabulda sotuv narxini yangilash
                </Label>
                <Switch
                  id="update-sale-price"
                  checked={updateSalePriceOnReceive}
                  onCheckedChange={onUpdateSalePriceOnReceiveChange}
                />
              </div>
            </>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed pt-2">
            Qabul qilinganda ombor qoldig‘i va partiya (FIFO tannarx) darhol yangilanadi. Qoralama omborga ta’sir qilmaydi.
            Tannarx va sotuv narxi qoralamada ixtiyoriy; qabuldan oldin tannarxni to‘ldiring.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes poFlash {
          from { background-color: rgb(236 253 245); }
          to { background-color: transparent; }
        }
      `}</style>
    </div>
  );
}
