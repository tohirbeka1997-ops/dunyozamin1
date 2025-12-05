import { useEffect, useState } from 'react';
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
  createStockAdjustment,
} from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Product, Category } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';

export default function ProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    description: '',
    category_id: '',
    unit: 'pcs',
    purchase_price: '',
    sale_price: '',
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
          unit: product.unit,
          purchase_price: product.purchase_price.toString(),
          sale_price: product.sale_price.toString(),
          min_stock_level: product.min_stock_level.toString(),
          initial_stock: '0',
          image_url: product.image_url || '',
          is_active: product.is_active,
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load product',
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
    const purchase = Number(formData.purchase_price) || 0;
    const sale = Number(formData.sale_price) || 0;
    if (purchase === 0) return 0;
    return (((sale - purchase) / purchase) * 100).toFixed(2);
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Product name is required',
        variant: 'destructive',
      });
      return false;
    }

    if (!formData.sku.trim()) {
      toast({
        title: 'Validation Error',
        description: 'SKU is required',
        variant: 'destructive',
      });
      return false;
    }

    const purchasePrice = Number(formData.purchase_price);
    const salePrice = Number(formData.sale_price);

    if (purchasePrice < 0 || salePrice < 0) {
      toast({
        title: 'Validation Error',
        description: 'Prices cannot be negative',
        variant: 'destructive',
      });
      return false;
    }

    if (salePrice < purchasePrice) {
      const confirmed = confirm(
        'Warning: Sale price is lower than purchase price. This will result in a loss. Continue?'
      );
      if (!confirmed) return false;
    }

    if (!isEditMode) {
      const initialStock = Number(formData.initial_stock);
      if (initialStock < 0) {
        toast({
          title: 'Validation Error',
          description: 'Initial stock cannot be negative',
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
        unit: formData.unit,
        purchase_price: Number(formData.purchase_price),
        sale_price: Number(formData.sale_price),
        min_stock_level: Number(formData.min_stock_level),
        image_url: formData.image_url.trim() || null,
        is_active: formData.is_active,
      };

      if (isEditMode && id) {
        await updateProduct(id, productData);
        toast({
          title: 'Success',
          description: 'Product updated successfully',
        });
      } else {
        const newProduct = await createProduct(productData);
        
        const initialStock = Number(formData.initial_stock);
        if (initialStock > 0 && profile) {
          await createStockAdjustment({
            product_id: newProduct.id,
            quantity: initialStock,
            reason: 'initial_stock',
            notes: 'Initial stock',
          });
        }

        toast({
          title: 'Success',
          description: 'Product created successfully',
        });
      }

      navigate('/products');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save product',
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
          <h1 className="text-3xl font-bold">{isEditMode ? 'Edit Product' : 'Add Product'}</h1>
          <p className="text-muted-foreground">
            {isEditMode ? 'Update product information' : 'Create a new product'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>General Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter product name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sku">SKU *</Label>
                <div className="flex gap-2">
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="SKU-000123"
                    required
                    className="font-mono"
                  />
                  {!isEditMode && (
                    <Button type="button" variant="outline" onClick={generateNewSKU}>
                      Generate
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="Enter or scan barcode"
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, category_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Category</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unit">Unit of Measure</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger id="unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">Pieces (pcs)</SelectItem>
                    <SelectItem value="kg">Kilogram (kg)</SelectItem>
                    <SelectItem value="g">Gram (g)</SelectItem>
                    <SelectItem value="l">Liter (l)</SelectItem>
                    <SelectItem value="ml">Milliliter (ml)</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                    <SelectItem value="box">Box</SelectItem>
                    <SelectItem value="dozen">Dozen</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="image_url">Image URL</Label>
                <Input
                  id="image_url"
                  value={formData.image_url}
                  onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                  type="url"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter product description"
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="purchase_price">Purchase Price *</Label>
                <Input
                  id="purchase_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.purchase_price}
                  onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sale_price">Sale Price *</Label>
                <Input
                  id="sale_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.sale_price}
                  onChange={(e) => setFormData({ ...formData, sale_price: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Profit Margin</Label>
                <div className="h-10 px-3 py-2 border rounded-md bg-muted flex items-center">
                  <span className="font-medium">{margin}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!isEditMode && (
                <div className="space-y-2">
                  <Label htmlFor="initial_stock">Initial Stock</Label>
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
                    Set the starting stock quantity for this product
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="min_stock_level">Minimum Stock Level</Label>
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
                  Alert when stock falls below this level
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            {loading ? 'Saving...' : isEditMode ? 'Update Product' : 'Create Product'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/products')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
