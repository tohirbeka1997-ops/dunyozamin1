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
import {
  getProductById,
  getCategories,
  createProduct,
  updateProduct,
  generateSKU,
} from '@/db/api';
import type { Category } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';
import { useInventoryStore } from '@/store/inventoryStore';
import MoneyInput from '@/components/common/MoneyInput';

export default function ProductForm() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
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
    purchase_price: null as number | null,
    sale_price: null as number | null,
    min_stock_level: '0',
    initial_stock: '0',
    image_url: '',
    is_active: true,
  });

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
        setFormData({
          name: product.name,
          sku: product.sku,
          barcode: product.barcode || '',
          description: product.description || '',
          category_id: product.category_id || '',
          unit: product.unit || 'pcs',
          purchase_price: product.purchase_price,
          sale_price: product.sale_price,
          min_stock_level: product.min_stock_level.toString(),
          initial_stock: '0',
          image_url: product.image_url || '',
          is_active: product.is_active,
        });
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

  const generateNewSKU = async () => {
    try {
      const sku = await generateSKU();
      setFormData((prev) => ({ ...prev, sku }));
    } catch (error) {
      console.error('Error generating SKU:', error);
    }
  };

  const calculateMargin = () => {
    const purchase = formData.purchase_price || 0;
    const sale = formData.sale_price || 0;
    if (purchase === 0) return 0;
    return (((sale - purchase) / purchase) * 100).toFixed(2);
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast({
        title: t('productForm.validation_error'),
        description: t('productForm.name_required'),
        variant: 'destructive',
      });
      return false;
    }

    if (!formData.sku.trim()) {
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

    if (salePrice < purchasePrice) {
      const confirmed = confirm(t('productForm.sale_price_warning'));
      if (!confirmed) return false;
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

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      setLoading(true);

      const productData = {
        name: formData.name.trim(),
        sku: formData.sku.trim(),
        barcode: formData.barcode.trim() || null,
        description: formData.description.trim() || null,
        category_id: formData.category_id || null,
        unit: formData.unit || 'pcs',
        purchase_price: formData.purchase_price || 0,
        sale_price: formData.sale_price || 0,
        min_stock_level: Number(formData.min_stock_level),
        image_url: formData.image_url.trim() || null,
        is_active: formData.is_active,
      };

      if (isEditMode && id) {
        await updateProduct(id, productData);
        toast({
          title: t('common.success'),
          description: t('productForm.updated_success'),
        });
      } else {
        const initialStock = Number(formData.initial_stock) || 0;
        const newProduct = await createProduct(productData, initialStock);

        // Add initial stock movement to inventory store
        if (initialStock > 0) {
          addMovement({
            product_id: newProduct.id,
            quantity: initialStock,
            type: 'initial',
            reason: 'Initial stock on product creation',
          });
        }

        toast({
          title: t('common.success'),
          description: t('productForm.created_success'),
        });
      }

      navigate('/products');
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('productForm.failed_to_save'),
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
                  {!isEditMode && (
                    <Button type="button" variant="outline" onClick={generateNewSKU}>
                      {t('products.generate')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">{t('products.barcode')}</Label>
                <Input
                  id="barcode"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder={t('productForm.barcode_placeholder')}
                  className="font-mono"
                />
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="unit">{t('productForm.unit_label')}</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger id="unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">{t('productForm.unit_pcs')}</SelectItem>
                    <SelectItem value="kg">{t('productForm.unit_kg')}</SelectItem>
                    <SelectItem value="g">{t('productForm.unit_g')}</SelectItem>
                    <SelectItem value="l">{t('productForm.unit_l')}</SelectItem>
                    <SelectItem value="ml">{t('productForm.unit_ml')}</SelectItem>
                    <SelectItem value="pack">{t('productForm.unit_pack')}</SelectItem>
                    <SelectItem value="box">{t('productForm.unit_box')}</SelectItem>
                    <SelectItem value="dozen">{t('productForm.unit_dozen')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="image_url">{t('products.image_url')}</Label>
                <Input
                  id="image_url"
                  value={formData.image_url}
                  onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                  placeholder={t('productForm.image_url_placeholder')}
                  type="url"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('productForm.description_label')}</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('productForm.description_placeholder')}
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">{t('products.is_active')}</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('products.pricing')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

              <MoneyInput
                id="sale_price"
                label={t('productForm.sale_price_label')}
                value={formData.sale_price}
                onValueChange={(val) => setFormData({ ...formData, sale_price: val })}
                placeholder="0"
                allowZero={true}
                min={0}
                required
              />

              <div className="space-y-2">
                <Label>{t('productForm.profit_margin_label')}</Label>
                <div className="h-10 px-3 py-2 border rounded-md bg-muted flex items-center">
                  <span className="font-medium">{margin}%</span>
                </div>
              </div>
            </div>
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
                    step="1"
                    min="0"
                    value={formData.initial_stock}
                    onChange={(e) => setFormData({ ...formData, initial_stock: e.target.value })}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('productForm.initial_stock_help')}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="min_stock_level">{t('products.min_stock_level')}</Label>
                <Input
                  id="min_stock_level"
                  type="number"
                  step="1"
                  min="0"
                  value={formData.min_stock_level}
                  onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {t('productForm.min_stock_help')}
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
