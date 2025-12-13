import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getInventory, getCategories } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';
import { FileDown, ArrowLeft, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';

type SortField = 'name' | 'stock' | 'value';
type SortOrder = 'asc' | 'desc';

export default function ValuationReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  useEffect(() => {
    loadData();
  }, [categoryFilter, statusFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([
        getInventory(),
        getCategories(),
      ]);
      
      let filtered = productsData;

      if (categoryFilter !== 'all') {
        filtered = filtered.filter((p) => p.category_id === categoryFilter);
      }

      if (statusFilter !== 'all') {
        filtered = filtered.filter((p) => {
          const stock = Number(p.current_stock);
          const minStock = Number(p.min_stock_level);
          
          if (statusFilter === 'out_of_stock') return stock === 0;
          if (statusFilter === 'low') return stock > 0 && stock <= minStock;
          if (statusFilter === 'ok') return stock > minStock;
          return true;
        });
      }

      setProducts(filtered);
      setCategories(categoriesData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Ombor baholash ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStockStatus = (product: ProductWithCategory) => {
    const stock = Number(product.current_stock);
    const minStock = Number(product.min_stock_level);

    if (stock === 0) {
      return { label: 'Tugagan', className: 'bg-destructive text-destructive-foreground' };
    } else if (stock <= minStock) {
      return { label: 'Kam zaxira', className: 'bg-warning text-warning-foreground' };
    } else {
      return { label: 'Omborda bor', className: 'bg-success text-success-foreground' };
    }
  };

  const filteredProducts = useMemo(() => {
    let filtered = products.filter((product) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (
        product.name.toLowerCase().includes(search) ||
        product.sku.toLowerCase().includes(search) ||
        (product.barcode && product.barcode.toLowerCase().includes(search))
      );
    });

    // Sort
    filtered.sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      if (sortField === 'name') {
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
      } else if (sortField === 'stock') {
        aValue = Number(a.current_stock || 0);
        bValue = Number(b.current_stock || 0);
      } else {
        // value
        const aCost = Number(a.purchase_price || 0);
        const aQty = Number(a.current_stock || 0);
        const bCost = Number(b.purchase_price || 0);
        const bQty = Number(b.current_stock || 0);
        aValue = aCost * aQty;
        bValue = bCost * bQty;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      } else {
        return sortOrder === 'asc'
          ? (aValue as number) - (bValue as number)
          : (bValue as number) - (aValue as number);
      }
    });

    return filtered;
  }, [products, searchTerm, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const calculateInventoryValue = (product: ProductWithCategory) => {
    const cost = Number(product.purchase_price || 0);
    const qty = Number(product.current_stock || 0);
    return cost * qty;
  };

  const totalInventoryValue = filteredProducts.reduce((sum, p) => {
    return sum + calculateInventoryValue(p);
  }, 0);

  const totalProducts = filteredProducts.length;

  const lowStockValue = filteredProducts
    .filter((p) => {
      const stock = Number(p.current_stock);
      const minStock = Number(p.min_stock_level);
      return stock > 0 && stock <= minStock;
    })
    .reduce((sum, p) => sum + calculateInventoryValue(p), 0);

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} ga eksport qilinmoqda...`,
    });
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1"
      onClick={() => handleSort(field)}
    >
      {children}
      <ArrowUpDown className="h-4 w-4" />
    </Button>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Baholash hisobotlari</h1>
            <p className="text-muted-foreground">
              Ombordagi mahsulotlarning umumiy qiymatini tahlil qilish
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Kategoriya</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
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
            <div>
              <label className="text-sm text-muted-foreground">Ombor holati</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  <SelectItem value="ok">Omborda bor</SelectItem>
                  <SelectItem value="low">Kam zaxira</SelectItem>
                  <SelectItem value="out_of_stock">Tugagan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Mahsulot nomi yoki SKU bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Umumiy ombor qiymati
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{formatMoneyUZS(totalInventoryValue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mahsulotlar soni
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Kam zaxiradagi mahsulotlar qiymati
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{formatMoneyUZS(lowStockValue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma'lumot topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortButton field="name">Mahsulot nomi</SortButton>
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Kategoriya</TableHead>
                  <TableHead>Birlik</TableHead>
                  <TableHead className="text-right">
                    <SortButton field="stock">Joriy zaxira</SortButton>
                  </TableHead>
                  <TableHead className="text-right">Sotib olish narxi</TableHead>
                  <TableHead className="text-right">
                    <SortButton field="value">Ombor qiymati</SortButton>
                  </TableHead>
                  <TableHead>Holati</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => {
                  const cost = Number(product.purchase_price || 0);
                  const qty = Number(product.current_stock || 0);
                  const totalValue = calculateInventoryValue(product);
                  const status = getStockStatus(product);
                  
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.category?.name || '-'}</TableCell>
                      <TableCell>{formatUnit(product.unit)}</TableCell>
                      <TableCell className="text-right">
                        {qty.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(cost)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(totalValue)}
                      </TableCell>
                      <TableCell>
                        <Badge className={status.className}>{status.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
