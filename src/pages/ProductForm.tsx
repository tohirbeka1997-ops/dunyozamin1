import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import {
  getProductById,
  getProductByBarcode,
  getCategories,
  createProduct,
  updateProduct,
  generateSKU,
  generateBarcodeForUnit,
  getProductImages,
  setProductImages,
} from '@/db/api';
import type { Category, ProductUnit } from '@/types/database';
import { ArrowLeft, Save, ImagePlus, X, Link, Upload } from 'lucide-react';
import { useInventoryStore } from '@/store/inventoryStore';
import MoneyInput from '@/components/common/MoneyInput';
import { isElectron, requireElectron, handleIpcResponse } from '@/utils/electron';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';

export default function ProductForm() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirmDialog = useConfirmDialog();
  const { addMovement } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    description: '',
    category_id: '',
    unit: 'pcs',
    base_unit: 'pcs',
    purchase_price: null as number | null,
    sale_price: null as number | null,
    master_price: null as number | null,
    master_min_qty: '',
    min_stock_level: '0',
    initial_stock: '0',
    image_url: '',
    is_active: true,
    brand: '',
    article: '',
  });
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([
    { unit: 'pcs', ratio_to_base: 1, sale_price: 0, is_default: true },
  ]);
  const [categoryNameFallback, setCategoryNameFallback] = useState('');
  const [descriptionEnabled, setDescriptionEnabled] = useState(false);
  const [images, setImages] = useState<Array<{ url: string; id?: string; sort_order?: number; is_primary?: number }>>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const isEditMode = !!id;

  useEffect(() => {
    loadCategories();
    if (isEditMode) {
      loadProduct();
    } else {
      generateNewSKU();
    }
  }, [id]);

  const loadCategories = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const loadProduct = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const product = await getProductById(id);
      if (product) {
        const baseUnit =
          (product as any).base_unit || product.unit || (product as any).unit_code || 'pcs';
        const units: ProductUnit[] =
          Array.isArray((product as any).product_units) && (product as any).product_units.length > 0
            ? (product as any).product_units
            : [
                {
                  unit: baseUnit,
                  ratio_to_base: 1,
                  sale_price: Number(product.sale_price ?? 0) || 0,
                  is_default: true,
                },
              ];
        setCategoryNameFallback(
          String((product as any).category?.name || (product as any).category_name || '').trim()
        );
        setFormData({
          name: product.name,
          sku: product.sku,
          barcode: product.barcode || '',
          description: product.description || '',
          category_id: product.category_id || '',
          unit: baseUnit,
          base_unit: baseUnit,
          purchase_price: product.purchase_price,
          sale_price: product.sale_price,
          master_price: (product as any).master_price ?? null,
          master_min_qty:
            (product as any).master_min_qty === null || (product as any).master_min_qty === undefined
              ? ''
              : String((product as any).master_min_qty),
          min_stock_level: product.min_stock_level.toString(),
          initial_stock: '0',
          image_url: product.image_url || '',
          is_active: product.is_active,
          brand: (product as any).brand || '',
          article: (product as any).article || '',
        });
        setDescriptionEnabled(!!product.description);
        setProductUnits(units);
        try {
          const imgs = await getProductImages(id);
          setImages(imgs.map((i) => ({ url: i.url, id: i.id, sort_order: i.sort_order, is_primary: i.is_primary })));
        } catch {
          setImages(product.image_url ? [{ url: product.image_url, sort_order: 0, is_primary: 1 }] : []);
        }
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('productForm.failed_to_load'),
        variant: 'destructive',
      });
      navigate('/products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isEditMode) return;
    if (formData.category_id) return;
    if (!categoryNameFallback || categories.length === 0) return;
    const match = categories.find(
      (c) => String(c.name || '').trim().toLowerCase() === categoryNameFallback.trim().toLowerCase()
    );
    if (match?.id) {
      setFormData((prev) => ({ ...prev, category_id: match.id }));
    }
  }, [isEditMode, formData.category_id, categoryNameFallback, categories]);

  useEffect(() => {
    const baseUnit = String(formData.base_unit || formData.unit || 'pcs').trim().toLowerCase();
    setProductUnits((prev) => {
      const next = [...prev];
      const baseIndex = next.findIndex((u) => String(u.unit || '').toLowerCase() === baseUnit);
      if (baseIndex >= 0) {
        next[baseIndex] = { ...next[baseIndex], unit: baseUnit, ratio_to_base: 1 };
      } else {
        next.unshift({ unit: baseUnit, ratio_to_base: 1, sale_price: Number(formData.sale_price ?? 0) || 0, is_default: true });
      }
      if (!next.some((u) => u.is_default)) {
        next[0].is_default = true;
      }
      return next;
    });
  }, [formData.base_unit, formData.unit, formData.sale_price]);

  useEffect(() => {
    const candidate =
      productUnits.find((u) => Number(u.ratio_to_base || 0) === 1) || productUnits[0];
    if (!candidate?.unit) return;
    const nextBase = String(candidate.unit || '').trim().toLowerCase();
    if (!nextBase) return;
    const nextSale = Number(candidate.sale_price ?? 0) || 0;
    setFormData((prev) => {
      const prevBase = String(prev.base_unit || prev.unit || '').trim().toLowerCase();
      const next = { ...prev };
      let changed = false;
      if (prevBase !== nextBase) {
        next.base_unit = nextBase;
        next.unit = nextBase;
        changed = true;
      }
      if (Number(prev.sale_price || 0) !== nextSale) {
        next.sale_price = nextSale;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [productUnits]);

  const generateNewSKU = async () => {
    try {
      if (isEditMode) {
        const ok = await confirmDialog({
          title: "Ogohlantirish",
          description:
            "Diqqat: mavjud mahsulotning SKU (PLU) kodi o'zgarsa, eski yorliqlar/PLU ishlamay qolishi mumkin.\n\nDavom etamizmi?",
          confirmText: "Davom etish",
          cancelText: "Bekor qilish",
          variant: 'destructive',
        });
        if (!ok) return;
      }
      const sku = await generateSKU();
      setFormData((prev) => ({ ...prev, sku }));
    } catch (error) {
      console.error('Error generating SKU:', error);
    }
  };

  const generateNewBarcode = async () => {
    try {
      if (isEditMode) {
        const ok = await confirmDialog({
          title: "Ogohlantirish",
          description:
            "Diqqat: mavjud mahsulotning shtrix-kodini o'zgartirsangiz, eski chop etilgan label/shtrix-kodlar ishlamay qoladi.\n\nDavom etamizmi?",
          confirmText: "Davom etish",
          cancelText: "Bekor qilish",
          variant: 'destructive',
        });
        if (!ok) return;
      }
      const unit = String(formData.base_unit || formData.unit || '').toLowerCase();
      const barcode =
        unit === 'kg'
          ? await generateBarcodeForUnit('kg')
          : await generateBarcodeForUnit('pcs');
      setFormData((prev) => ({ ...prev, barcode }));
    } catch (error) {
      console.error('Error generating barcode:', error);
      toast({
        title: t('common.error'),
        description:
          (error as any)?.message
            ? `Shtrix kod yaratib bo'lmadi: ${(error as any).message}`
            : "Shtrix kod yaratib bo'lmadi",
        variant: 'destructive',
      });
    }
  };

  const calculateMargin = () => {
    const purchase = formData.purchase_price || 0;
    const sale = formData.sale_price || 0;
    if (purchase === 0) return 0;
    return (((sale - purchase) / purchase) * 100).toFixed(2);
  };

  const updateProductUnit = (index: number, patch: Partial<ProductUnit>) => {
    setProductUnits((prev) =>
      prev.map((u, i) => (i === index ? { ...u, ...patch } : u))
    );
  };

  const addProductUnit = () => {
    setProductUnits((prev) => [
      ...prev,
      { unit: 'pcs', ratio_to_base: 1, sale_price: Number(formData.sale_price ?? 0) || 0, is_default: false },
    ]);
  };

  const removeProductUnit = (index: number) => {
    setProductUnits((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((u) => u.is_default)) {
        next[0] = { ...next[0], is_default: true };
      }
      return next;
    });
  };

  const setDefaultUnit = (index: number) => {
    setProductUnits((prev) =>
      prev.map((u, i) => ({ ...u, is_default: i === index }))
    );
  };

  const addImageUrl = (url: string) => {
    const u = String(url || '').trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u) && !/^product-image:\/\//i.test(u) && !/^data:image\//i.test(u)) {
      toast({ title: t('common.error'), description: 'Tekshirilgan URL kiriting (http://, https://...)', variant: 'destructive' });
      return;
    }
    setImages((prev) => {
      const next = [...prev, { url: u, sort_order: prev.length, is_primary: prev.length === 0 ? 1 : 0 }];
      setFormData((f) => ({ ...f, image_url: next[0]?.url || f.image_url }));
      return next;
    });
    setImageUrlInput('');
  };

  const saveFileAsProductImage = async (filePath: string, index: number): Promise<string | null> => {
    if (!isElectron()) return null;
    const api = requireElectron();
    const productIdOrTempId = id || `temp-${Date.now()}`;
    const saved = await handleIpcResponse(api.files.saveProductImage(filePath, productIdOrTempId, index));
    return saved?.fileUrl || null;
  };

  const handlePickImage = async () => {
    if (!isElectron()) return;
    try {
      const api = requireElectron();
      const res = await handleIpcResponse(api.files.selectImageFile());
      if (res?.canceled || !res?.filePaths?.length) return;
      const filePaths = res.filePaths as string[];
      const productIdOrTempId = id || `temp-${Date.now()}`;
      const startIdx = images.length;
      for (let i = 0; i < filePaths.length; i++) {
        const saved = await saveFileAsProductImage(filePaths[i], startIdx + i);
        if (saved) {
          setImages((prev) => {
            const next = [...prev, { url: saved, sort_order: prev.length, is_primary: prev.length === 0 ? 1 : 0 }];
            setFormData((f) => ({ ...f, image_url: next[0]?.url || f.image_url }));
            return next;
          });
        }
      }
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error?.message || 'Rasm yuklab bo\'lmadi',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      const first = next[0];
      setFormData((f) => ({ ...f, image_url: first?.url || '' }));
      return next;
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!isElectron()) return;
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    const startIdx = images.length;
    for (let i = 0; i < files.length; i++) {
      const saved = await saveFileAsProductImage((files[i] as any).path, startIdx + i);
      if (saved) {
        setImages((prev) => {
          const next = [...prev, { url: saved, sort_order: prev.length, is_primary: prev.length === 0 ? 1 : 0 }];
          setFormData((f) => ({ ...f, image_url: next[0]?.url || f.image_url }));
          return next;
        });
      }
    }
  };

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items?.length || !isElectron()) return;
      const el = document.activeElement;
      const isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
      if (isInput) return;
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
          hasImage = true;
          break;
        }
      }
      if (!hasImage) return;
      e.preventDefault();
      const api = requireElectron();
      const productIdOrTempId = id || `temp-${Date.now()}`;
      const newUrls: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const path = (file as any).path;
        if (!path) continue;
        try {
          const saved = await handleIpcResponse(api.files.saveProductImage(path, productIdOrTempId, newUrls.length));
          if (saved?.fileUrl) newUrls.push(saved.fileUrl);
        } catch (_) {}
      }
      if (newUrls.length > 0) {
        setImages((prev) => {
          const next = [...prev, ...newUrls.map((url, i) => ({ url, sort_order: prev.length + i, is_primary: prev.length === 0 && i === 0 ? 1 : 0 }))];
          setFormData((f) => ({ ...f, image_url: next[0]?.url || f.image_url }));
          return next;
        });
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [id]);

  const validateForm = (nextSku?: string) => {
    if (!formData.name.trim()) {
      toast({
        title: t('productForm.validation_error'),
        description: t('productForm.name_required'),
        variant: 'destructive',
      });
      return false;
    }

    if (!(nextSku ?? formData.sku).trim()) {
      toast({
        title: t('productForm.validation_error'),
        description: t('productForm.sku_required'),
        variant: 'destructive',
      });
      return false;
    }

    const purchasePrice = formData.purchase_price || 0;
    const salePrice = formData.sale_price || 0;

    if (purchasePrice < 0 || salePrice < 0) {
      toast({
        title: t('productForm.validation_error'),
        description: t('productForm.prices_negative'),
        variant: 'destructive',
      });
      return false;
    }

    if (!isEditMode) {
      const initialStock = Number(formData.initial_stock);
      if (initialStock < 0) {
        toast({
          title: t('productForm.validation_error'),
          description: t('productForm.initial_stock_negative'),
          variant: 'destructive',
        });
        return false;
      }
    }

    const baseUnit = String(formData.base_unit || formData.unit || 'pcs').trim().toLowerCase();
    if (!baseUnit) {
      toast({
        title: t('productForm.validation_error'),
        description: 'Asosiy birlik tanlanishi kerak',
        variant: 'destructive',
      });
      return false;
    }

    if (!productUnits || productUnits.length === 0) {
      toast({
        title: t('productForm.validation_error'),
        description: 'Sotuv birliklari kamida bittadan bo‘lishi kerak',
        variant: 'destructive',
      });
      return false;
    }

    const hasBaseUnit = productUnits.some(
      (u) => String(u.unit || '').trim().toLowerCase() === baseUnit && Number(u.ratio_to_base || 0) === 1
    );
    if (!hasBaseUnit) {
      toast({
        title: t('productForm.validation_error'),
        description: 'Asosiy birlik uchun nisbat 1 bo‘lishi shart',
        variant: 'destructive',
      });
      return false;
    }

    if (productUnits.some((u) => !Number.isFinite(Number(u.ratio_to_base)) || Number(u.ratio_to_base) <= 0)) {
      toast({
        title: t('productForm.validation_error'),
        description: 'Nisbat 0 dan katta bo‘lishi kerak',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let skuToUse = formData.sku.trim();
    if (!skuToUse) {
      try {
        skuToUse = await generateSKU();
        setFormData((prev) => ({ ...prev, sku: skuToUse }));
      } catch (error: any) {
        toast({
          title: t('productForm.validation_error'),
          description: error?.message || t('productForm.sku_required'),
          variant: 'destructive',
        });
        return;
      }
    }

    if (!validateForm(skuToUse)) return;

    // Non-blocking confirm: if sale price is lower than purchase price, ask user to confirm.
    // We intentionally avoid `window.confirm()` because it can leave inputs "blocked" in Electron.
    const purchasePrice = formData.purchase_price || 0;
    const salePrice = formData.sale_price || 0;
    if (salePrice < purchasePrice) {
      const ok = await confirmDialog({
        title: "Ogohlantirish",
        description: t('productForm.sale_price_warning'),
        confirmText: "Davom etish",
        cancelText: "Bekor qilish",
      });
      if (!ok) return;
    }

    try {
      setLoading(true);

      const firstImageUrl = images[0]?.url?.trim() || formData.image_url?.trim() || null;
      const productData = {
        name: formData.name.trim(),
        sku: skuToUse,
        barcode: formData.barcode.trim() || null,
        description: formData.description.trim() || null,
        category_id: formData.category_id || null,
        unit: formData.base_unit || formData.unit || 'pcs',
        base_unit: formData.base_unit || formData.unit || 'pcs',
        product_units: productUnits.map((u) => ({
          unit: u.unit,
          ratio_to_base: Number(u.ratio_to_base || 0) || 0,
          sale_price: Number(u.sale_price || 0) || 0,
          is_default: !!u.is_default,
        })),
        purchase_price: formData.purchase_price || 0,
        sale_price: formData.sale_price || 0,
        master_price: formData.master_price === null ? null : formData.master_price,
        master_min_qty: formData.master_min_qty.trim() ? Number(formData.master_min_qty) : null,
        min_stock_level: Number(formData.min_stock_level),
        image_url: firstImageUrl,
        is_active: formData.is_active,
        brand: formData.brand.trim() || null,
        article: formData.article.trim() || null,
      };

      // Pre-check barcode uniqueness to show a clear error (instead of generic backend message)
      const b = String(productData.barcode || '').trim();
      if (b) {
        const existing = await getProductByBarcode(b);
        if (existing?.id && (!isEditMode || existing.id !== id)) {
          toast({
            title: t('common.error'),
            description: `Bu shtrix-kod allaqachon boshqa mahsulotda mavjud: ${existing.name || '-'} (SKU: ${existing.sku || '-'})`,
            variant: 'destructive',
          });
          return;
        }
      }

      if (isEditMode && id) {
        await updateProduct(id, productData);
        try {
          await setProductImages(id, images.map((i) => ({ url: i.url, sort_order: i.sort_order ?? 0, is_primary: i.is_primary === 1 })));
        } catch (e: any) {
          if (!e?.message?.includes('setImages') && !e?.message?.includes('setimages')) throw e;
          console.warn('[ProductForm] setProductImages failed, product saved without images sync:', e?.message);
        }
        toast({
          title: t('common.success'),
          description: t('productForm.updated_success'),
        });
      } else {
        const initialStock = Number(formData.initial_stock) || 0;
        const newProduct = await createProduct(productData, initialStock);

        if (images.length > 0) {
          try {
            await setProductImages(newProduct.id, images.map((i) => ({ url: i.url, sort_order: i.sort_order ?? 0, is_primary: i.is_primary === 1 })));
          } catch (e: any) {
            if (!e?.message?.includes('setImages') && !e?.message?.includes('setimages')) throw e;
            console.warn('[ProductForm] setProductImages failed, product created without images:', e?.message);
          }
        }

        // Add initial stock movement to inventory store
        if (initialStock > 0) {
          addMovement({
            id: `mov-${newProduct.id}-${Date.now()}`,
            product_id: newProduct.id,
            movement_number: `MOV-${Date.now()}`,
            quantity: initialStock,
            movement_type: 'adjustment',
            before_quantity: 0,
            after_quantity: initialStock,
            reference_type: 'product_creation',
            reference_id: newProduct.id,
            reason: 'Initial stock on product creation',
            notes: null,
            created_by: null,
            created_at: new Date().toISOString(),
          });
        }

        toast({
          title: t('common.success'),
          description: t('productForm.created_success'),
        });
      }

      navigate('/products');
    } catch (error: any) {
      console.error('Submit error:', error);
      const msg = String(error?.message || error?.error_description || '').trim();
      toast({
        title: t('common.error'),
        description:
          msg.includes('Barcode must be unique')
            ? "Bu shtrix-kod boshqa mahsulotda bor (unikal bo‘lishi kerak)."
            : msg.includes('SKU must be unique')
              ? 'Bu SKU boshqa mahsulotda bor (unikal bo‘lishi kerak).'
              : msg || t('productForm.failed_to_save'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const margin = calculateMargin();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/products')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{isEditMode ? t('productForm.edit_title') : t('productForm.add_title')}</h1>
          <p className="text-muted-foreground">
            {isEditMode ? t('productForm.edit_subtitle') : t('productForm.add_subtitle')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('products.general_information')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('productForm.product_name_label')}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('productForm.product_name_placeholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sku">{t('productForm.sku_label')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder={t('products.sku_placeholder')}
                    required
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" onClick={generateNewSKU}>
                    {t('products.generate')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">{t('products.barcode')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="barcode"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                    placeholder={t('productForm.barcode_placeholder')}
                    className="font-mono"
                  />
                    <Button type="button" variant="outline" onClick={generateNewBarcode}>
                      {t('products.generate')}
                    </Button>
                </div>
                {String(formData.unit || '').toLowerCase() === 'kg' && (
                  <div className="text-xs text-muted-foreground">
                    Kg mahsulotlar uchun: alohida barcode (`310...`) generatsiya qilinadi (tarozi kodi bilan aralashmaydi). Savatchada tarozi shtrix-kodi PLU (SKU) bo‘yicha ishlaydi.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">{t('products.category')}</Label>
                <Select
                  value={formData.category_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, category_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder={t('products.select_category')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('productForm.no_category')}</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!formData.category_id && categoryNameFallback && (
                  <p className="text-xs text-muted-foreground">
                    Kategoriya topilmadi: {categoryNameFallback}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="brand">Brend</Label>
                <Input
                  id="brand"
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  placeholder="Samsung, Bosch, Hilti..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="article">Artikul</Label>
                <Input
                  id="article"
                  value={formData.article}
                  onChange={(e) => setFormData({ ...formData, article: e.target.value.toUpperCase() })}
                  placeholder="BOLGA-150"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Bir artikulga ega barcha mahsulotlar qidiruvda birga chiqadi
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>{t('productForm.image_url')} — 3–4 xil yuklash</Label>
                <div
                  className={`rounded-lg border-2 border-dashed p-4 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/30'}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className="flex flex-wrap gap-3 items-start">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <div className="h-20 w-20 rounded-lg border bg-muted overflow-hidden flex-shrink-0">
                          <img
                            src={getProductImageDisplayUrl(img.url) || img.url}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-1 -right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRemoveImage(idx)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {isElectron() && (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={handlePickImage}>
                          <Upload className="h-4 w-4 mr-1" />
                          Fayl tanlash
                        </Button>
                        <span className="text-xs text-muted-foreground self-center">|</span>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addImageUrl(imageUrlInput)}
                    >
                      <Link className="h-4 w-4 mr-1" />
                      URL qo‘shish
                    </Button>
                    <Input
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      placeholder="https://..."
                      className="w-32 h-8 text-xs"
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addImageUrl(imageUrlInput), setImageUrlInput(''))}
                    />
                    <span className="text-xs text-muted-foreground self-center">|</span>
                    <span className="text-xs text-muted-foreground self-center">Ctrl+V — buferdan</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('productForm.image_url_hint')} — Telegram bot / online market uchun
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <Label htmlFor="description">{t('productForm.description_label')}</Label>
                <div className="flex items-center gap-4">
                  <Switch
                    id="description_enabled"
                    checked={descriptionEnabled}
                    onCheckedChange={(checked) => setDescriptionEnabled(checked)}
                  />
                  <Label htmlFor="description_enabled" className="text-sm">
                    Ko‘rsatish
                  </Label>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active" className="text-sm">
                    {t('products.is_active')}
                  </Label>
                </div>
              </div>
              {descriptionEnabled && (
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('productForm.description_placeholder')}
                  rows={2}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Sotuv birliklari</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addProductUnit}>
              Birlik qo‘shish
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="space-y-2 md:col-span-3">
                <MoneyInput
                  id="purchase_price"
                  label={t('productForm.purchase_price_label')}
                  value={formData.purchase_price}
                  onValueChange={(val) => setFormData({ ...formData, purchase_price: val })}
                  placeholder="0"
                  allowZero={true}
                  min={0}
                  required
                />
              </div>
              <div className="space-y-2 md:col-span-3">
                <MoneyInput
                  id="master_price"
                  label="Usta narxi"
                  value={formData.master_price}
                  onValueChange={(val) => setFormData({ ...formData, master_price: val })}
                  placeholder="0"
                  allowZero={true}
                  min={0}
                />
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label htmlFor="master_min_qty">Usta minimal miqdor</Label>
                <Input
                  id="master_min_qty"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.master_min_qty}
                  onChange={(e) => setFormData({ ...formData, master_min_qty: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label>{t('productForm.profit_margin_label')}</Label>
                <div className="h-10 px-3 py-2 border rounded-md bg-muted flex items-center">
                  <span className="font-medium">{margin}%</span>
                </div>
              </div>
            </div>
            {productUnits.map((u, index) => (
              <div key={`${u.unit}-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="space-y-2 md:col-span-4">
                  <Label>Birlik</Label>
                  <Select
                    value={u.unit}
                    onValueChange={(value) => updateProductUnit(index, { unit: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pcs">{t('productForm.unit_pcs')}</SelectItem>
                      <SelectItem value="kg">{t('productForm.unit_kg')}</SelectItem>
                      <SelectItem value="g">{t('productForm.unit_g')}</SelectItem>
                      <SelectItem value="l">{t('productForm.unit_l')}</SelectItem>
                      <SelectItem value="ml">{t('productForm.unit_ml')}</SelectItem>
                      <SelectItem value="m">{t('productForm.unit_m')}</SelectItem>
                      <SelectItem value="pack">{t('productForm.unit_pack')}</SelectItem>
                      <SelectItem value="box">{t('productForm.unit_box')}</SelectItem>
                      <SelectItem value="dozen">{t('productForm.unit_dozen')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Nisbat (asosiy)</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={u.ratio_to_base}
                    onChange={(e) => updateProductUnit(index, { ratio_to_base: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <MoneyInput
                    id={`unit-price-${index}`}
                    label="Sotuv narxi"
                    value={u.sale_price}
                    onValueChange={(val) => updateProductUnit(index, { sale_price: val ?? 0 })}
                    placeholder="0"
                    allowZero={true}
                    min={0}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Default</Label>
                  <Button
                    type="button"
                    variant={u.is_default ? 'default' : 'outline'}
                    onClick={() => setDefaultUnit(index)}
                    className="w-full"
                  >
                    {u.is_default ? 'Default' : 'Tanlash'}
                  </Button>
                </div>
                <div className="space-y-2 md:col-span-1">
                  <Label className="opacity-0">.</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeProductUnit(index)}
                    disabled={productUnits.length <= 1}
                    className="w-full"
                  >
                    O‘chirish
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Nisbat asosiy birlikka nisbatan. Masalan: 1 dona = 0.18 kg.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('productForm.inventory_settings')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isEditMode && (
                <div className="space-y-2">
                  <Label htmlFor="initial_stock">{t('products.initial_stock')}</Label>
                  <Input
                    id="initial_stock"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.initial_stock}
                    onChange={(e) => setFormData({ ...formData, initial_stock: e.target.value })}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('productForm.initial_stock_help')} (kasr sonlar qo'llab-quvvatlanadi: 0.5, 1.5, 2.3...)
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="min_stock_level">{t('products.min_stock_level')}</Label>
                <Input
                  id="min_stock_level"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.min_stock_level}
                  onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {t('productForm.min_stock_help')} (kasr sonlar qo'llab-quvvatlanadi)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            {loading ? t('productForm.saving') : isEditMode ? t('productForm.update_button') : t('productForm.create_button')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/products')}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
