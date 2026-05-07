import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { getInventoryAll, getCategories } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';
import { FileDown, ArrowLeft, AlertTriangle, ChevronDown, Lightbulb } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function StockLevelsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [inventory, setInventory] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([getInventoryAll(), getCategories()]);
      setInventory(Array.isArray(productsData) ? productsData : []);
      setCategories(Array.isArray(categoriesData) ? categoriesData : []);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: "Ombor darajalarini yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  /** Tanlangan kategoriyadagi mahsulotlar (KPI shu yerdan) */
  const byCategory = useMemo(() => {
    if (categoryFilter === 'all') return inventory;
    return inventory.filter((p) => p.category_id === categoryFilter);
  }, [inventory, categoryFilter]);

  const stats = useMemo(() => {
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of byCategory) {
      const stock = Number(p.current_stock);
      const minStock = Number(p.min_stock_level);
      if (stock === 0) outOfStock += 1;
      else if (stock <= minStock) lowStock += 1;
      else inStock += 1;
    }
    return { inStock, lowStock, outOfStock };
  }, [byCategory]);

  const getStockStatus = (product: ProductWithCategory) => {
    const stock = Number(product.current_stock);
    const minStock = Number(product.min_stock_level);
    if (stock === 0) {
      return { label: 'Tugagan', className: 'bg-destructive text-white' };
    }
    if (stock <= minStock) {
      return { label: 'Kam zaxira', className: 'bg-warning text-white' };
    }
    return { label: 'Omborda bor', className: 'bg-success text-white' };
  };

  const tableRows = useMemo(() => {
    let list = byCategory;
    if (statusFilter === 'out_of_stock') {
      list = list.filter((p) => Number(p.current_stock) === 0);
    } else if (statusFilter === 'low') {
      list = list.filter((p) => {
        const stock = Number(p.current_stock);
        const minStock = Number(p.min_stock_level);
        return stock > 0 && stock <= minStock;
      });
    } else if (statusFilter === 'ok') {
      list = list.filter((p) => Number(p.current_stock) > Number(p.min_stock_level));
    }
    if (!searchTerm.trim()) return list;
    const q = searchTerm.toLowerCase();
    return list.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        (product.barcode && product.barcode.toLowerCase().includes(q))
    );
  }, [byCategory, statusFilter, searchTerm]);

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} formatiga eksport qilinmoqda...`,
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  const { inStock, lowStock, outOfStock } = stats;
  const hasRisk = outOfStock > 0 || lowStock > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="page-heading text-base md:text-lg">Ombor darajalari</h1>
            <p className="text-muted-foreground text-xs">Joriy zaxira, kam va tugagan mahsulotlar</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('excel')}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Excel
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('pdf')}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Ixcham: eslatma + tezkor filtr (katta karta o‘rniga) */}
      {hasRisk && (
        <div className="text-muted-foreground flex flex-col gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="min-w-0 text-amber-900 dark:text-amber-200">
              {outOfStock > 0 && <strong className="font-medium">{outOfStock} ta tugagan</strong>}
              {outOfStock > 0 && lowStock > 0 && ' · '}
              {lowStock > 0 && <strong className="font-medium">{lowStock} ta kam zaxira</strong>}
              {categoryFilter !== 'all' && ' (tanlangan kategoriya)'}
            </span>
            <span className="ml-auto flex flex-wrap gap-1">
              {outOfStock > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setStatusFilter('out_of_stock')}
                >
                  Tugaganlarni ko‘rish
                </Button>
              )}
              {lowStock > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setStatusFilter('low')}
                >
                  Kam zaxirani ko‘rish
                </Button>
              )}
              {statusFilter !== 'all' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setStatusFilter('all')}
                >
                  Filtrni olib tashlash
                </Button>
              )}
            </span>
          </div>

          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="text-muted-foreground flex w-full items-center gap-1 text-left text-[11px] font-medium hover:underline">
              <Lightbulb className="h-3 w-3 shrink-0" />
              Tavsiyalar
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1.5 pl-0">
              <ul className="text-muted-foreground list-inside list-disc space-y-0.5 pl-0.5 text-[11px] leading-snug">
                <li>
                  Tugagan mahsulotni sotishni vaqtincha to‘xtating yoki «Xarid»/«Inventarizatsiya» orqali qayta
                  to‘ldiring.
                </li>
                <li>
                  Kam zaxirada: minimal ombor chegara (<code className="rounded bg-muted px-0.5">min</code>) ni
                  muntazam yangilang, yetkazib beruvchiga oldindan buyurtma bering.
                </li>
                <li>
                  Yuqoridagi tezkor tugmalar jadvalni shu guruhga filtrlash uchun; barcha kategoriyani ko‘rish
                  uchun filtr &quot;Barcha kategoriyalar&quot;.
                </li>
                <li>
                  Aytish mumkin: haftada bir marta ushbu hisobotni «Tugagan» + Excel eksport bilan
                  sotib olish rejasiga ulang.
                </li>
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-[11px]">Omborda bor</p>
                <p className="text-primary text-lg font-bold">{inStock}</p>
              </div>
              <div className="h-7 w-7 shrink-0 rounded-full bg-success/15" />
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-[11px]">Kam zaxira</p>
                <p className="text-lg font-bold text-warning">{lowStock}</p>
              </div>
              <div className="bg-warning/15 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-[11px]">Zaxira tugagan</p>
                <p className="text-destructive text-lg font-bold">{outOfStock}</p>
              </div>
              <div className="h-7 w-7 shrink-0 rounded-full bg-destructive/15" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Kategoriya</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Barcha kategoriyalar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Ombor holati</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Barcha holatlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holatlar</SelectItem>
                  <SelectItem value="ok">Omborda bor</SelectItem>
                  <SelectItem value="low">Kam zaxira</SelectItem>
                  <SelectItem value="out_of_stock">Tugagan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Qidirish</Label>
              <Input
                className="h-8"
                placeholder="Nomi, SKU, shtrixkod"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {tableRows.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">Mahsulotlar topilmadi</div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[640px] text-sm [&_td]:p-2 [&_th]:p-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot nomi</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead className="text-right tabular-nums">Joriy</TableHead>
                    <TableHead className="text-right tabular-nums">Minimal</TableHead>
                    <TableHead>Holati</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((product) => {
                    const status = getStockStatus(product);
                    return (
                      <TableRow key={product.id} className="h-9">
                        <TableCell className="max-w-[10rem] truncate font-medium" title={product.name}>
                          {product.name}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">{product.sku}</TableCell>
                        <TableCell className="text-xs">{product.category?.name || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(product.current_stock)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(product.min_stock_level)}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('text-xs', status.className)}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
