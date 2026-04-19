import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import {
  createProduct,
  getCategories,
  generateSKU,
  generateBarcodeForUnit,
  getProductByBarcode,
} from '@/db/api';
import type { Category, ProductWithCategory } from '@/types/database';
import MoneyInput from '@/components/common/MoneyInput';

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: ProductWithCategory) => void;
}

const UNIT_OPTIONS = [
  { value: 'pcs', labelKey: 'productForm.unit_pcs' },
  { value: 'kg', labelKey: 'productForm.unit_kg' },
  { value: 'g', labelKey: 'productForm.unit_g' },
  { value: 'l', labelKey: 'productForm.unit_l' },
  { value: 'ml', labelKey: 'productForm.unit_ml' },
  { value: 'm', labelKey: 'productForm.unit_m' },
  { value: 'pack', labelKey: 'productForm.unit_pack' },
  { value: 'box', labelKey: 'productForm.unit_box' },
  { value: 'dozen', labelKey: 'productForm.unit_dozen' },
];

export default function CreateProductModal({
  open,
  onOpenChange,
  onCreated,
}: CreateProductModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirmDialog = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [purchasePrice, setPurchasePrice] = useState<number | null>(0);
  const [salePrice, setSalePrice] = useState<number | null>(0);
  const [masterPrice, setMasterPrice] = useState<number | null>(null);
  const [masterMinQty, setMasterMinQty] = useState('');
  const [categoryId, setCategoryId] = useState<string>('none');
  const [brand, setBrand] = useState('');
  const [article, setArticle] = useState('');
  const [description, setDescription] = useState('');
  const [minStockLevel, setMinStockLevel] = useState('0');
  const [initialStock, setInitialStock] = useState('0');

  const margin = useMemo(() => {
    const purchase = purchasePrice ?? 0;
    const sale = salePrice ?? 0;
    if (purchase === 0) return '0.00';
    return ((((sale - purchase) / purchase) * 100).toFixed(2));
  }, [purchasePrice, salePrice]);

  useEffect(() => {
    if (open) {
      getCategories().then(setCategories).catch(() => setCategories([]));
      setName('');
      setSku('');
      setBarcode('');
      setUnit('pcs');
      setPurchasePrice(0);
      setSalePrice(0);
      setMasterPrice(null);
      setMasterMinQty('');
      setCategoryId('none');
      setBrand('');
      setArticle('');
      setDescription('');
      setMinStockLevel('0');
      setInitialStock('0');
      generateSKU().then(setSku).catch(() => setSku(''));
    }
  }, [open]);

  const resetForm = () => {
    setName('');
    setSku('');
    setBarcode('');
    setUnit('pcs');
    setPurchasePrice(0);
    setSalePrice(0);
    setMasterPrice(null);
    setMasterMinQty('');
    setCategoryId('none');
    setBrand('');
    setArticle('');
    setDescription('');
    setMinStockLevel('0');
    setInitialStock('0');
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const handleGenerateSku = () => {
    generateSKU().then(setSku).catch(() => {});
  };

  const handleGenerateBarcode = () => {
    const u = String(unit).trim().toLowerCase();
    const forUnit = u === 'kg' ? 'kg' : 'pcs';
    generateBarcodeForUnit(forUnit)
      .then(setBarcode)
      .catch(() => {
        toast({
          title: t('common.error'),
          description: "Shtrix kod yaratib bo'lmadi",
          variant: 'destructive',
        });
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSku = sku.trim();
    if (!trimmedName) {
      toast({
        title: t('common.error'),
        description: t('productForm.product_name_placeholder'),
        variant: 'destructive',
      });
      return;
    }
    if (!trimmedSku) {
      toast({
        title: t('common.error'),
        description: t('productForm.sku_label'),
        variant: 'destructive',
      });
      return;
    }

    const initialN = Number(initialStock);
    if (initialN < 0) {
      toast({
        title: t('productForm.validation_error'),
        description: t('productForm.initial_stock_negative'),
        variant: 'destructive',
      });
      return;
    }

    const purchase = purchasePrice ?? 0;
    const sale = salePrice ?? purchase;
    if (sale < purchase) {
      const ok = await confirmDialog({
        title: 'Ogohlantirish',
        description: t('productForm.sale_price_warning'),
        confirmText: 'Davom etish',
        cancelText: 'Bekor qilish',
      });
      if (!ok) return;
    }

    try {
      setLoading(true);
      const trimmedBc = barcode.trim();
      if (trimmedBc) {
        const existing = await getProductByBarcode(trimmedBc);
        if (existing?.id) {
          toast({
            title: t('common.error'),
            description: `Bu shtrix-kod allaqachon boshqa mahsulotda mavjud: ${existing.name || '-'} (SKU: ${existing.sku || '-'})`,
            variant: 'destructive',
          });
          return;
        }
      }

      const productData = {
        name: trimmedName,
        sku: trimmedSku,
        barcode: trimmedBc || null,
        description: description.trim() || null,
        category_id: categoryId && categoryId !== 'none' ? categoryId : null,
        unit,
        base_unit: unit,
        product_units: [{ unit, ratio_to_base: 1, sale_price: sale, is_default: true }],
        purchase_price: purchase,
        sale_price: sale,
        master_price: masterPrice,
        master_min_qty: masterMinQty.trim() ? Number(masterMinQty) : null,
        min_stock_level: Number(minStockLevel) || 0,
        image_url: null as string | null,
        is_active: true,
        brand: brand.trim() || null,
        article: article.trim() || null,
      };
      const newProduct = await createProduct(productData, initialN);
      const withCategory: ProductWithCategory = {
        ...newProduct,
        category:
          categoryId && categoryId !== 'none'
            ? categories.find((c) => c.id === categoryId) || null
            : null,
      };
      toast({
        title: t('common.success'),
        description: t('productForm.created_success'),
      });
      onCreated(withCategory);
      handleClose(false);
    } catch (error: any) {
      const msg = String(error?.message || '').trim();
      toast({
        title: t('common.error'),
        description:
          msg.includes('SKU') || msg.includes('sku')
            ? 'Bu SKU allaqachon mavjud. Boshqa SKU kiriting.'
            : msg.includes('Barcode') || msg.includes('barcode')
              ? "Bu shtrix-kod boshqa mahsulotda bor (unikal bo'lishi kerak)."
              : msg || t('productForm.failed_to_save'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('products.create_new_product')}</DialogTitle>
          <DialogDescription>
            Mahsulot qo‘shish sahifasidagi asosiy maydonlar — xarid buyurtmasi va boshqa joylardan tez
            yaratish uchun
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="create-product-name">{t('productForm.product_name_label')}</Label>
            <Input
              id="create-product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('productForm.product_name_placeholder')}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-product-sku">{t('productForm.sku_label')}</Label>
            <div className="flex gap-2">
              <Input
                id="create-product-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={handleGenerateSku}>
                Yangilash
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-product-barcode">Shtrix kod (Barcode)</Label>
            <div className="flex gap-2">
              <Input
                id="create-product-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Shtrix kod kiriting yoki skanerlang..."
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={handleGenerateBarcode}>
                Yangilash
              </Button>
            </div>
            {String(unit).toLowerCase() === 'kg' && (
              <p className="text-xs text-muted-foreground">
                Kg mahsulotlar uchun alohida kod (`310...`) — tarozi PLU bilan aralashmaydi.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('productForm.unit_label')}</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {t(u.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Brend</Label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Samsung, Bosch..."
              />
            </div>
            <div className="space-y-2">
              <Label>Artikul</Label>
              <Input
                value={article}
                onChange={(e) => setArticle(e.target.value.toUpperCase())}
                placeholder="BOLGA-150"
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Kategoriya</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder={t('productForm.no_category')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('productForm.no_category')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-product-desc">{t('productForm.description_label')}</Label>
            <Textarea
              id="create-product-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('productForm.description_placeholder')}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('productForm.purchase_price_label')}</Label>
              <MoneyInput
                value={purchasePrice}
                onValueChange={setPurchasePrice}
                placeholder="0"
                allowZero
                allowDecimals
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>Usta narxi</Label>
              <MoneyInput
                value={masterPrice}
                onValueChange={setMasterPrice}
                placeholder="0"
                allowZero
                allowDecimals
                min={0}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Usta minimal miqdor</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={masterMinQty}
                onChange={(e) => setMasterMinQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('productForm.profit_margin_label')}</Label>
              <div className="h-10 px-3 py-2 border rounded-md bg-muted flex items-center">
                <span className="font-medium">{margin}%</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('productForm.sale_price_label')}</Label>
            <MoneyInput
              value={salePrice}
              onValueChange={setSalePrice}
              placeholder="0"
              allowZero
              allowDecimals
              min={0}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-initial-stock">{t('products.initial_stock')}</Label>
              <Input
                id="create-initial-stock"
                type="text"
                inputMode="decimal"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('productForm.initial_stock_help')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-min-stock">{t('products.min_stock_level')}</Label>
              <Input
                id="create-min-stock"
                type="text"
                inputMode="decimal"
                value={minStockLevel}
                onChange={(e) => setMinStockLevel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('productForm.min_stock_help')}</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saqlanmoqda...' : "Yaratish va qo'shish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
