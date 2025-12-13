import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategories, createCategory, updateCategory, deleteCategory, getCategoryProductCount } from '@/db/api';
import type { Category } from '@/types/database';
import { Plus, Pencil, Trash2, Search, Eye, FolderTree, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Categories() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#2563EB',
    icon: '📁',
    parent_id: '',
  });

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const data = await getCategories();
      setCategories(data);
      
      const counts: Record<string, number> = {};
      for (const category of data) {
        try {
          const count = await getCategoryProductCount(category.id);
          counts[category.id] = count;
        } catch (error) {
          counts[category.id] = 0;
        }
      }
      setProductCounts(counts);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('categories.failed_to_load'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        description: category.description || '',
        color: category.color || '#2563EB',
        icon: category.icon || '📁',
        parent_id: category.parent_id || '',
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: '',
        description: '',
        color: '#2563EB',
        icon: '📁',
        parent_id: '',
      });
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        title: t('categories.validation.name_required_title'),
        description: t('categories.validation.name_required'),
        variant: 'destructive',
      });
      return;
    }

    if (formData.parent_id && editingCategory) {
      if (formData.parent_id === editingCategory.id) {
        toast({
          title: t('categories.validation.invalid_parent_title'),
          description: t('categories.validation.invalid_parent'),
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      const categoryData = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        color: formData.color || null,
        icon: formData.icon || null,
        parent_id: formData.parent_id || null,
      };

      if (editingCategory) {
        await updateCategory(editingCategory.id, categoryData);
        toast({
          title: t('common.success'),
          description: t('categories.messages.updated'),
        });
      } else {
        await createCategory(categoryData);
        toast({
          title: t('common.success'),
          description: t('categories.messages.created'),
        });
      }

      setDialogOpen(false);
      loadCategories();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('categories.messages.save_failed'),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (category: Category) => {
    const productCount = productCounts[category.id] || 0;
    
    if (productCount > 0) {
      toast({
        title: t('categories.messages.cannot_delete_title'),
        description: t('categories.messages.cannot_delete', { count: productCount }),
        variant: 'destructive',
      });
      return;
    }

    if (!confirm(t('categories.delete_confirm', { name: category.name }))) return;

    try {
      await deleteCategory(category.id);
      toast({
        title: t('common.success'),
        description: t('categories.messages.deleted'),
      });
      loadCategories();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('categories.messages.delete_failed'),
        variant: 'destructive',
      });
    }
  };

  const getParentCategoryName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = categories.find(c => c.id === parentId);
    return parent?.name;
  };

  // Memoize sort function
  const sortCategories = useCallback((cats: Category[]) => {
    const sorted = [...cats];
    switch (sortBy) {
      case 'name-asc':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return sorted.sort((a, b) => b.name.localeCompare(a.name));
      case 'newest':
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'oldest':
        return sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      default:
        return sorted;
    }
  }, [sortBy]);

  // Memoize filtered categories to prevent recalculation on every render
  const filteredCategories = useMemo(() => {
    const filtered = categories.filter((category) =>
      searchTerm === '' ||
      category.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (category.description && category.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    return sortCategories(filtered);
  }, [categories, searchTerm, sortCategories]);

  const availableParentCategories = categories.filter(
    (cat) => !editingCategory || cat.id !== editingCategory.id
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('categories.title')}</h1>
          <p className="text-muted-foreground">{t('categories.subtitle')}</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="h-4 w-4 mr-2" />
          {t('categories.add_category')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('categories.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('categories.search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder={t('categories.sort_by')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">{t('categories.sort.name_asc')}</SelectItem>
                <SelectItem value="name-desc">{t('categories.sort.name_desc')}</SelectItem>
                <SelectItem value="newest">{t('categories.sort.newest')}</SelectItem>
                <SelectItem value="oldest">{t('categories.sort.oldest')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('categories.title')} ({filteredCategories.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="text-center py-12">
              <FolderTree className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('categories.no_categories_found')}</p>
              <Button className="mt-4" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                {t('categories.add_first_category')}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('categories.table.category')}</TableHead>
                  <TableHead>{t('categories.table.description')}</TableHead>
                  <TableHead>{t('categories.table.parent_category')}</TableHead>
                  <TableHead className="text-right">{t('categories.table.products')}</TableHead>
                  <TableHead>{t('categories.table.created')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          className="h-10 w-10 rounded flex items-center justify-center text-xl"
                          style={{ backgroundColor: category.color || '#2563EB' }}
                        >
                          {category.icon || '📁'}
                        </div>
                        <div>
                          <p className="font-medium">{category.name}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {category.description || '-'}
                    </TableCell>
                    <TableCell>
                      {category.parent_id ? (
                        <Badge variant="outline">
                          <FolderTree className="h-3 w-3 mr-1" />
                          {getParentCategoryName(category.parent_id)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t('categories.root')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{productCounts[category.id] || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(category.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/categories/${category.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(category)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(category)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategory ? t('categories.edit_category') : t('categories.add_category')}</DialogTitle>
            <DialogDescription>
              {editingCategory ? t('categories.update_category_info') : t('categories.create_new_category')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('categories.category_name_required')}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('categories.enter_category_name')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t('categories.description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('categories.enter_description')}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="icon">{t('categories.icon_emoji')}</Label>
                  <Input
                    id="icon"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    placeholder="📁"
                    maxLength={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="color">{t('categories.color')}</Label>
                  <Input
                    id="color"
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="parent">{t('categories.parent_category')}</Label>
                <Select
                  value={formData.parent_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, parent_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="parent">
                    <SelectValue placeholder={t('categories.select_parent')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('categories.no_parent')}</SelectItem>
                    {availableParentCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.icon} {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {editingCategory && productCounts[editingCategory.id] > 0 && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {t('categories.contains_products', { count: productCounts[editingCategory.id] })}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit">
                {editingCategory ? t('common.update') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
