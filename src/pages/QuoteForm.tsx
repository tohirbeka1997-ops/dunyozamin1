import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { formatUnit } from '@/utils/formatters';
import MoneyInput from '@/components/common/MoneyInput';
import { cn } from '@/lib/utils';
import {
  searchProductsScreen,
  getProductById,
  getQuoteById,
  createQuote,
  updateQuote,
  generateQuoteNumber,
  getCategories,
} from '@/db/api';
import type { ProductWithCategory, Quote, QuoteItem } from '@/types/database';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  FileSpreadsheet,
  Loader2,
  Package,
  Plus,
  Printer,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import * as XLSX from 'xlsx';
import { printHtml } from '@/lib/print';

type PriceType = 'retail' | 'usta';

interface QuoteItemRow {
  id: string;
  product_id: string;
  product_name: string;
  sku?: string;
  unit: string;
  quantity: number;
  unit_price: number;
  price_type_used: 'retail' | 'usta' | 'manual';
  override_price?: number | null;
  retail_price?: number | null;
  usta_price?: number | null;
  discount_percent: number;
  discount_amount: number;
  cost_price?: number | null;
  line_total: number;
  line_profit?: number | null;
}

function getUnitPrice(p: ProductWithCategory, priceType: PriceType, override?: number | null): number {
  if (override != null && Number.isFinite(override)) return override;
  if (priceType === 'usta') {
    const mp = (p as any).master_price;
    return Number.isFinite(mp) && mp != null ? mp : p.sale_price;
  }
  return p.sale_price;
}

function getStockQty(p: ProductWithCategory): number {
  const x = p as ProductWithCategory & {
    stock_available?: number;
    available_stock?: number;
    stock_quantity?: number;
  };
  return (
    x.stock_available ??
    x.available_stock ??
    x.current_stock ??
    x.stock_quantity ??
    0
  );
}

type PickerSort = 'relevance' | 'name' | 'stock';

export default function QuoteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isEdit = !!id;

  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [priceType, setPriceType] = useState<PriceType>('retail');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<QuoteItemRow[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ProductWithCategory[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [pickerSort, setPickerSort] = useState<PickerSort>('relevance');
  const [categoryNameById, setCategoryNameById] = useState<Map<string, string>>(new Map());
  const [orderDiscountType, setOrderDiscountType] = useState<'percent' | 'amount'>('amount');
  const [orderDiscountPercent, setOrderDiscountPercent] = useState('');
  const [orderDiscountAmount, setOrderDiscountAmount] = useState<number | null>(null);
  const [quoteNumber, setQuoteNumber] = useState('');
  const [showProfit, setShowProfit] = useState(false);

  const computeLineTotal = (row: QuoteItemRow): number => {
    const qty = Number(row.quantity) || 0;
    const price = Number(row.unit_price) || 0;
    const disc = Number(row.discount_amount) || 0;
    const pct = Number(row.discount_percent) || 0;
    const beforeDisc = price * qty;
    const discAmt = pct > 0 ? (beforeDisc * pct) / 100 : disc;
    return Math.max(0, beforeDisc - discAmt);
  };

  const subtotal = items.reduce((s, it) => s + computeLineTotal(it), 0);
  const orderDiscNumber = useMemo(() => {
    if (orderDiscountType === 'percent') {
      const p = Math.min(100, Math.max(0, Number(orderDiscountPercent) || 0));
      return (subtotal * p) / 100;
    }
    return Math.max(0, orderDiscountAmount ?? 0);
  }, [orderDiscountType, orderDiscountPercent, orderDiscountAmount, subtotal]);
  const total = Math.max(0, subtotal - orderDiscNumber);

  // Oddiy vs Usta umumiy farqi
  const subtotalOddiy = items.reduce((s, it) => {
    const retail = it.retail_price ?? it.unit_price;
    const qty = Number(it.quantity) || 0;
    const disc = Number(it.discount_amount) || 0;
    const pct = Number(it.discount_percent) || 0;
    const before = retail * qty;
    const discAmt = pct > 0 ? (before * pct) / 100 : disc;
    return s + Math.max(0, before - discAmt);
  }, 0);
  const subtotalUsta = items.reduce((s, it) => {
    const usta = it.usta_price ?? it.unit_price;
    const qty = Number(it.quantity) || 0;
    const disc = Number(it.discount_amount) || 0;
    const pct = Number(it.discount_percent) || 0;
    const before = usta * qty;
    const discAmt = pct > 0 ? (before * pct) / 100 : disc;
    return s + Math.max(0, before - discAmt);
  }, 0);
  const totalTafovut = subtotalOddiy - subtotalUsta;
  const totalCost = items.reduce((s, it) => {
    const cp = Number(it.cost_price);
    const qty = Number(it.quantity) || 1;
    if (!Number.isFinite(cp) || cp <= 0) return s;
    return s + cp * qty;
  }, 0);
  const totalProfit = total - totalCost;

  useEffect(() => {
    if (!productPickerOpen) {
      setSearchResults([]);
      setProductSearchLoading(false);
      return;
    }
    const id = setTimeout(() => {
      void (async () => {
        setProductSearchLoading(true);
        try {
          const term = (searchTerm || '').trim().toLowerCase();
          const res = await searchProductsScreen(term, { limit: 80 });
          setSearchResults(Array.isArray(res) ? res : []);
        } catch {
          setSearchResults([]);
        } finally {
          setProductSearchLoading(false);
        }
      })();
    }, 200);
    return () => clearTimeout(id);
  }, [searchTerm, productPickerOpen]);

  useEffect(() => {
    if (!productPickerOpen) return;
    let cancelled = false;
    void getCategories().then((cats) => {
      if (cancelled || !Array.isArray(cats)) return;
      setCategoryNameById(new Map(cats.map((c) => [c.id, c.name])));
    });
    return () => {
      cancelled = true;
    };
  }, [productPickerOpen]);

  const sortedPickerResults = useMemo(() => {
    const list = [...searchResults];
    if (pickerSort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (pickerSort === 'stock') {
      list.sort((a, b) => getStockQty(b) - getStockQty(a));
    }
    return list;
  }, [searchResults, pickerSort]);

  const addProduct = (p: ProductWithCategory) => {
    if (items.some((it) => it.product_id === p.id)) {
      toast({ title: t('quotes.duplicate_product'), variant: 'destructive' });
      return;
    }
    const retail = p.sale_price;
    const usta = (p as any).master_price ?? p.sale_price;
    const up = getUnitPrice(p, priceType, null);
    const row: QuoteItemRow = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      product_id: p.id,
      product_name: p.name,
      sku: p.sku || undefined,
      unit: (p as any).base_unit || p.unit || 'pcs',
      quantity: 1,
      unit_price: up,
      price_type_used: priceType,
      override_price: null,
      retail_price: retail,
      usta_price: usta,
      discount_percent: 0,
      discount_amount: 0,
      cost_price: p.purchase_price ?? null,
      line_total: up,
      line_profit: Number.isFinite(p.purchase_price) ? up - p.purchase_price : null,
    };
    setItems((prev) => [...prev, row]);
    setProductPickerOpen(false);
    setSearchTerm('');
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: keyof QuoteItemRow, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value };
      if (field === 'quantity' || field === 'unit_price' || field === 'discount_amount' || field === 'discount_percent') {
        row.line_total = computeLineTotal(row);
      }
      if (field === 'quantity' || field === 'unit_price' || field === 'cost_price') {
        const cp = Number(row.cost_price);
        const qty = Number(row.quantity) || 1;
        if (Number.isFinite(cp)) {
          row.line_profit = (row.unit_price - cp) * qty;
        }
      }
      next[idx] = row;
      return next;
    });
  };

  const handleExportExcel = () => {
    const headers = [
      '№',
      t('quotes.col_name'),
      t('quotes.col_qty'),
      t('quotes.col_price'),
      t('quotes.col_discount'),
      t('quotes.col_line_total'),
    ];
    const rows = items.map((it, idx) => [
      idx + 1,
      it.product_name || '-',
      `${it.quantity} ${formatUnit(it.unit)}`,
      formatMoneyUZS(it.unit_price),
      formatMoneyUZS(it.discount_amount || 0),
      formatMoneyUZS(computeLineTotal(it)),
    ]);
    const wb = XLSX.utils.book_new();
    const wsData = [
      [t('quotes.print_title'), quoteNumber || '—'],
      [`${t('quotes.customer_section')}:`, customerName || '—'],
      [`${t('quotes.phone')}:`, phone || '—'],
      [
        `${t('quotes.price_type')}:`,
        priceType === 'usta' ? t('quotes.price_usta') : t('quotes.price_retail'),
      ],
      [],
      headers,
      ...rows,
      [],
      [`${t('quotes.subtotal')}:`, formatMoneyUZS(subtotal)],
      [`${t('quotes.discount')}:`, `-${formatMoneyUZS(orderDiscNumber)}`],
      [`${t('quotes.total')}:`, formatMoneyUZS(total)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 4 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, t('quotes.excel_sheet_name'));
    XLSX.writeFile(wb, `smeta-${quoteNumber || 'draft'}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: t('quotes.toast_excel') });
  };

  const handlePrint = () => {
    const itemsHtml = items
      .map(
        (it, idx) =>
          `<tr><td>${idx + 1}</td><td>${(it.product_name || '-').replace(/</g, '&lt;')}</td><td>${it.quantity} ${formatUnit(it.unit)}</td><td>${formatMoneyUZS(it.unit_price)}</td><td>${formatMoneyUZS(it.discount_amount || 0)}</td><td>${formatMoneyUZS(computeLineTotal(it))}</td></tr>`
      )
      .join('');
    const pt = priceType === 'usta' ? t('quotes.price_usta') : t('quotes.price_retail');
    const html = `
      <div class="receipt-a4" style="font-family: Arial; padding: 20px;">
        <h2 style="text-align: center; margin-bottom: 16px;">${t('quotes.print_title')}</h2>
        <p><strong>${t('quotes.quote_number')}:</strong> ${(quoteNumber || '—').replace(/</g, '&lt;')}</p>
        <p><strong>${t('quotes.customer_section')}:</strong> ${(customerName || '—').replace(/</g, '&lt;')}</p>
        <p><strong>${t('quotes.phone')}:</strong> ${(phone || '—').replace(/</g, '&lt;')}</p>
        <p><strong>${t('quotes.price_type')}:</strong> ${pt}</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <thead><tr style="background: #f0f0f0;"><th style="border: 1px solid #ddd; padding: 6px;">№</th><th style="border: 1px solid #ddd; padding: 6px;">${t('quotes.col_name')}</th><th style="border: 1px solid #ddd; padding: 6px;">${t('quotes.col_qty')}</th><th style="border: 1px solid #ddd; padding: 6px;">${t('quotes.col_price')}</th><th style="border: 1px solid #ddd; padding: 6px;">${t('quotes.col_discount')}</th><th style="border: 1px solid #ddd; padding: 6px;">${t('quotes.col_line_total')}</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="margin-top: 16px; text-align: right;">
          <p>${t('quotes.subtotal')}: ${formatMoneyUZS(subtotal)}</p>
          <p>${t('quotes.discount')}: -${formatMoneyUZS(orderDiscNumber)}</p>
          <p><strong>${t('quotes.total')}: ${formatMoneyUZS(total)}</strong></p>
        </div>
      </div>`;
    printHtml(t('quotes.print_title'), html, 'A4');
    toast({ title: t('quotes.toast_print') });
  };

  const recalcPrices = async (newPriceType: PriceType) => {
    const pt = newPriceType;
    const current = items;
    const next: QuoteItemRow[] = [];
    for (const row of current) {
      try {
        const p = await getProductById(row.product_id) as ProductWithCategory | null;
        if (p) {
          const up = getUnitPrice(p, pt, row.override_price);
          const retail = p.sale_price;
          const usta = (p as any).master_price ?? p.sale_price;
          const updated = {
            ...row,
            unit_price: up,
            price_type_used: pt,
            retail_price: retail,
            usta_price: usta,
          };
          next.push({
            ...updated,
            line_total: computeLineTotal(updated),
          });
        } else {
          next.push({ ...row, price_type_used: pt });
        }
      } catch {
        next.push({ ...row, price_type_used: pt });
      }
    }
    setItems(next);
  };

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      try {
        setLoading(true);
        const q = await getQuoteById(id!);
        if (q) {
          setCustomerName(q.customer_name || '');
          setPhone(q.phone || '');
          setPriceType((q.price_type as PriceType) || 'retail');
          setNotes(q.notes || '');
          setQuoteNumber(q.quote_number || '');
          if (q.items && q.items.length > 0) {
            setItems(
              q.items.map((it: any) => ({
                id: it.id || `tmp-${Date.now()}-${it.product_id}`,
                product_id: it.product_id,
                product_name: it.name_snapshot || it.product_name || '',
                sku: it.sku_snapshot,
                unit: it.unit || 'pcs',
                quantity: it.quantity || 1,
                unit_price: it.unit_price || 0,
                price_type_used: it.price_type_used || 'retail',
                override_price: it.override_price,
                retail_price: it.retail_price ?? null,
                usta_price: it.usta_price ?? null,
                discount_percent: it.discount_percent || 0,
                discount_amount: it.discount_amount || 0,
                cost_price: it.cost_price,
                line_total: it.line_total || 0,
                line_profit: it.line_profit,
              }))
            );
          }
          const d = Number(q.discount_amount) || 0;
          const pctStored = Number(q.discount_percent) || 0;
          if (pctStored > 0) {
            setOrderDiscountType('percent');
            setOrderDiscountPercent(String(pctStored));
            setOrderDiscountAmount(null);
          } else {
            setOrderDiscountType('amount');
            setOrderDiscountAmount(d > 0 ? d : null);
            setOrderDiscountPercent('');
          }
        }
      } catch (e) {
        toast({
          title: t('common.error'),
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, isEdit, t, toast]);

  useEffect(() => {
    if (!isEdit && !quoteNumber) {
      generateQuoteNumber().then(setQuoteNumber);
    }
  }, [isEdit, quoteNumber]);

  const handleSave = async () => {
    if (!profile) {
      toast({ title: t('common.error'), description: t('quotes.error_login'), variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: t('common.error'), description: t('quotes.error_min_items'), variant: 'destructive' });
      return;
    }
    if (!customerName.trim()) {
      toast({ title: t('common.error'), description: t('quotes.error_customer_name'), variant: 'destructive' });
      return;
    }

    const payload = {
      quote_number: quoteNumber,
      customer_name: customerName.trim(),
      phone: phone.trim() || null,
      price_type: priceType,
      status: 'draft',
      subtotal,
      discount_amount: orderDiscNumber,
      discount_percent:
        orderDiscountType === 'percent' ? Math.min(100, Math.max(0, Number(orderDiscountPercent) || 0)) : 0,
      total,
      total_profit: Number.isFinite(totalProfit) ? totalProfit : null,
      notes: notes.trim() || null,
      created_by: profile.id || 'default-admin-001',
      items: items.map((it) => ({
        product_id: it.product_id,
        name_snapshot: it.product_name,
        sku_snapshot: it.sku,
        unit: it.unit,
        quantity: it.quantity,
        unit_price: it.unit_price,
        price_type_used: it.price_type_used,
        override_price: it.override_price,
        retail_price: it.retail_price ?? null,
        usta_price: it.usta_price ?? null,
        discount_percent: it.discount_percent,
        discount_amount: it.discount_amount,
        cost_price: it.cost_price,
        line_total: computeLineTotal(it),
        line_profit: it.line_profit,
      })),
    };

    try {
      setLoading(true);
      if (isEdit) {
        await updateQuote(id!, payload);
        toast({ title: t('quotes.toast_updated') });
      } else {
        await createQuote(payload);
        toast({ title: t('quotes.toast_created') });
      }
      navigate('/quotes');
    } catch (e) {
      toast({
        title: t('common.error'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && isEdit) {
    return (
      <div className="space-y-6 w-full min-w-0">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <Skeleton className="h-8 w-56" />
        </div>
        <div className="flex flex-col lg:flex-row gap-6">
          <Skeleton className="flex-1 h-[min(480px,60vh)] rounded-lg" />
          <Skeleton className="lg:w-80 h-96 rounded-lg shrink-0" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isEdit ? t('quotes.edit_quote') : t('quotes.new_quote')}
            </h1>
            {quoteNumber ? (
              <p className="text-sm text-muted-foreground mt-0.5 font-mono">
                {t('quotes.quote_number')}: {quoteNumber}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>
            {t('quotes.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {isEdit ? t('quotes.save') : t('quotes.create')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <Card className="flex-1 min-w-0 flex flex-col">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">{t('quotes.products_section')}</CardTitle>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2 sm:w-auto sm:justify-start"
                    onClick={() => setProductPickerOpen(true)}
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    {t('quotes.add_product')}
                  </Button>

                  <Dialog
                    open={productPickerOpen}
                    onOpenChange={(open) => {
                      setProductPickerOpen(open);
                      if (!open) {
                        setSearchTerm('');
                        setPickerSort('relevance');
                      }
                    }}
                  >
                    <DialogContent
                      className={cn(
                        'flex max-h-[min(88vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,52rem)]'
                      )}
                    >
                      <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
                        <DialogTitle>{t('quotes.product_picker_title')}</DialogTitle>
                        <DialogDescription>{t('quotes.product_picker_hint')}</DialogDescription>
                      </DialogHeader>

                      <div className="space-y-3 px-6 pt-4">
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                          />
                          <Input
                            className="h-11 pl-9"
                            placeholder={t('quotes.product_picker_search_placeholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                          />
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-muted-foreground">{t('quotes.product_picker_browse_hint')}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {t('quotes.product_picker_sort_label')}
                            </span>
                            <Select
                              value={pickerSort}
                              onValueChange={(v) => setPickerSort(v as PickerSort)}
                            >
                              <SelectTrigger className="h-9 w-[190px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="relevance">
                                  {t('quotes.product_picker_sort_relevance')}
                                </SelectItem>
                                <SelectItem value="name">{t('quotes.product_picker_sort_name')}</SelectItem>
                                <SelectItem value="stock">{t('quotes.product_picker_sort_stock')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <ScrollArea className="h-[min(50vh,440px)] min-h-[200px] border-y">
                        <div className="space-y-1 p-2">
                          {productSearchLoading ? (
                            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                              <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                              <span>{t('quotes.product_picker_loading')}</span>
                            </div>
                          ) : sortedPickerResults.length === 0 ? (
                            <div className="py-16 text-center text-sm text-muted-foreground">
                              {(searchTerm || '').trim()
                                ? t('quotes.search_no_results')
                                : t('quotes.product_picker_empty_browse')}
                            </div>
                          ) : (
                            sortedPickerResults.map((p) => {
                              const inList = items.some((it) => it.product_id === p.id);
                              const stock = getStockQty(p);
                              const minL = Number(p.min_stock_level) || 0;
                              const low = stock > 0 && minL > 0 && stock <= minL;
                              const out = stock <= 0;
                              const catName =
                                p.category?.name ??
                                (p.category_id ? categoryNameById.get(p.category_id) : null);
                              const imgSrc = getProductImageDisplayUrl(p.image_url) || p.image_url || null;
                              const retail = p.sale_price;
                              const usta = (p as { master_price?: number | null }).master_price ?? p.sale_price;
                              const article = (p as { article?: string | null }).article;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  disabled={inList}
                                  onClick={() => addProduct(p)}
                                  className={cn(
                                    'flex w-full gap-3 rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-muted/80',
                                    inList && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                                    !inList &&
                                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                                  )}
                                >
                                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                                    {imgSrc ? (
                                      <img
                                        src={imgSrc}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                        <Package className="h-6 w-6" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium leading-snug">{p.name}</span>
                                      {inList ? (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                          {t('quotes.product_picker_in_list')}
                                        </Badge>
                                      ) : null}
                                      {catName ? (
                                        <Badge variant="outline" className="text-xs font-normal">
                                          {catName}
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                      <span>
                                        {t('quotes.product_picker_sku')}: {p.sku || '—'}
                                      </span>
                                      {p.barcode ? (
                                        <span>
                                          {t('quotes.product_picker_barcode')}: {p.barcode}
                                        </span>
                                      ) : null}
                                      {article ? (
                                        <span>
                                          {t('quotes.product_picker_article')}: {article}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                      <span
                                        className={cn(
                                          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                                          out && 'bg-destructive/10 text-destructive',
                                          low && !out && 'bg-amber-500/15 text-amber-900 dark:text-amber-100',
                                          !low && !out && 'bg-muted text-muted-foreground'
                                        )}
                                      >
                                        {t('quotes.product_picker_stock')}: {formatNumberUZ(stock)}{' '}
                                        {formatUnit(p.unit || 'pcs')}
                                        {low ? ` · ${t('quotes.product_picker_low_stock')}` : ''}
                                      </span>
                                      <span
                                        className={
                                          priceType === 'retail'
                                            ? 'font-semibold text-foreground'
                                            : 'text-muted-foreground'
                                        }
                                      >
                                        {t('quotes.price_retail')}: {formatMoneyUZS(retail)}
                                      </span>
                                      {Number.isFinite(usta) && usta !== retail ? (
                                        <span
                                          className={
                                            priceType === 'usta'
                                              ? 'font-semibold text-foreground'
                                              : 'text-muted-foreground'
                                          }
                                        >
                                          {t('quotes.price_usta')}: {formatMoneyUZS(usta)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>

                      <div className="flex justify-end border-t px-6 py-3">
                        <Button type="button" variant="outline" onClick={() => setProductPickerOpen(false)}>
                          {t('common.close')}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-visible flex flex-col flex-1 min-h-0">
              {items.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground border rounded-lg bg-muted/30">
                  <p className="font-medium mb-1">{t('quotes.items_empty_title')}</p>
                  <p className="text-sm max-w-md mx-auto">{t('quotes.items_empty_hint')}</p>
                </div>
              ) : (
              <div className="overflow-auto max-h-[calc(100vh-280px)] min-h-[180px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">{t('quotes.col_name')}</TableHead>
                    <TableHead>{t('quotes.col_qty')}</TableHead>
                    <TableHead>{t('quotes.col_price')}</TableHead>
                    <TableHead>{t('quotes.col_discount')}</TableHead>
                    <TableHead className="w-28 text-right">{t('quotes.col_line_total')}</TableHead>
                    <TableHead className="w-12 px-1" aria-hidden />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row, idx) => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-[140px] font-medium">
                        <span className="truncate block max-w-[200px]" title={row.product_name}>
                          {row.product_name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0.001}
                          step="any"
                          className="w-20"
                          value={row.quantity}
                          onChange={(e) =>
                            updateItem(idx, 'quantity', Number(e.target.value) || 1)
                          }
                        />
                        <span className="ml-1 text-muted-foreground text-sm">
                          {formatUnit(row.unit)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <MoneyInput
                          value={row.unit_price}
                          onValueChange={(v) => updateItem(idx, 'unit_price', Number(v ?? 0))}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="w-20"
                          value={row.discount_amount || ''}
                          onChange={(e) =>
                            updateItem(idx, 'discount_amount', Number(e.target.value) || 0)
                          }
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(computeLineTotal(row))}
                      </TableCell>
                      <TableCell className="w-12 px-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeItem(idx)}
                          aria-label={t('quotes.remove_line')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              )}
            </CardContent>
          </Card>

          <aside className="lg:w-80 shrink-0 flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{t('quotes.customer_section')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div>
                <Label htmlFor="customer-name" className="text-sm">
                  {t('quotes.customer_name_required')}
                </Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={t('quotes.customer_placeholder')}
                  className="mt-1"
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="customer-phone" className="text-sm">
                  {t('quotes.phone')}
                </Label>
                <Input
                  id="customer-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('quotes.phone_placeholder')}
                  className="mt-1"
                  type="tel"
                  autoComplete="tel"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{t('quotes.price_type')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={priceType === 'retail' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setPriceType('retail');
                    void recalcPrices('retail');
                  }}
                >
                  {t('quotes.price_retail')}
                </Button>
                <Button
                  type="button"
                  variant={priceType === 'usta' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setPriceType('usta');
                    void recalcPrices('usta');
                  }}
                >
                  {t('quotes.price_usta')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{t('quotes.order_discount')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={orderDiscountType === 'amount' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOrderDiscountType('amount')}
                >
                  {t('quotes.discount_by_amount')}
                </Button>
                <Button
                  type="button"
                  variant={orderDiscountType === 'percent' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOrderDiscountType('percent')}
                >
                  {t('quotes.discount_by_percent')}
                </Button>
              </div>
              {orderDiscountType === 'percent' ? (
                <div className="space-y-1">
                  <Label htmlFor="order-discount-pct" className="text-xs text-muted-foreground">
                    {t('quotes.discount_percent_label')}
                  </Label>
                  <Input
                    id="order-discount-pct"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    inputMode="decimal"
                    value={orderDiscountPercent}
                    onChange={(e) => setOrderDiscountPercent(e.target.value)}
                    placeholder="0"
                    className="tabular-nums"
                  />
                  <p className="text-[11px] text-muted-foreground">{t('quotes.discount_percent_hint')}</p>
                </div>
              ) : (
                <MoneyInput
                  value={orderDiscountAmount}
                  onValueChange={(v) => setOrderDiscountAmount(v)}
                  placeholder="0"
                />
              )}
            </CardContent>
          </Card>

          <div>
            <Label htmlFor="notes" className="text-sm">
              {t('quotes.notes')}
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('quotes.notes_placeholder')}
              rows={2}
              className="mt-1 resize-none"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('quotes.totals')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t('quotes.subtotal')}</span>
                <span className="tabular-nums">{formatMoneyUZS(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t('quotes.discount')}</span>
                <span className="tabular-nums">-{formatMoneyUZS(orderDiscNumber)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>{t('quotes.total')}</span>
                <span className="tabular-nums">{formatMoneyUZS(total)}</span>
              </div>
              {Number.isFinite(totalProfit) && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant={showProfit ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() => setShowProfit(!showProfit)}
                    title={showProfit ? t('quotes.profit_toggle_hide') : t('quotes.profit_toggle_show')}
                  >
                    <TrendingUp className="h-4 w-4 mr-1" />
                    {showProfit ? t('quotes.profit_toggle_hide') : t('quotes.profit_toggle_show')}
                  </Button>
                  {showProfit && (
                    <span className="text-muted-foreground font-medium tabular-nums">
                      {formatMoneyUZS(totalProfit)}
                    </span>
                  )}
                </div>
              )}
              {Math.abs(totalTafovut) > 0.01 && (
                <div className="pt-2 mt-2 border-t space-y-1 text-muted-foreground text-xs">
                  <div className="flex justify-between gap-2">
                    <span>{t('quotes.compare_retail')}</span>
                    <span className="tabular-nums shrink-0">{formatMoneyUZS(subtotalOddiy)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>{t('quotes.compare_usta')}</span>
                    <span className="tabular-nums shrink-0">{formatMoneyUZS(subtotalUsta)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-green-600 dark:text-green-500 gap-2">
                    <span>{t('quotes.compare_diff')}</span>
                    <span className="tabular-nums shrink-0 text-right">
                      {formatMoneyUZS(totalTafovut)}{' '}
                      {totalTafovut > 0 ? t('quotes.compare_usta_cheaper') : ''}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleExportExcel()}
                  disabled={items.length === 0}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1.5 shrink-0" />
                  {t('quotes.export_excel')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePrint()}
                  disabled={items.length === 0}
                >
                  <Printer className="h-4 w-4 mr-1.5 shrink-0" />
                  {t('quotes.print')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
