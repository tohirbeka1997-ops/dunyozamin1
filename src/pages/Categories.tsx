import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
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
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryProductCount,
  getProducts,
  assignProductsToCategory,
} from '@/db/api';
import type { Category, ProductWithCategory } from '@/types/database';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Eye,
  FolderTree,
  Package,
  Download,
  FolderPlus,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/datetime';

function buildCategoryTreeOptions(cats: Category[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const p = c.parent_id || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) || [];
    for (const c of children) {
      const prefix = depth > 0 ? `${'\u00A0\u00A0'.repeat(depth)}` : '';
      out.push({
        id: c.id,
        label: `${prefix}${c.icon || '📁'} ${c.name}`.trimStart(),
      });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function Categories() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const consumedEditIdRef = useRef<string | null>(null);
  const confirmDialog = useConfirmDialog();
  const [categories, setCategories] = useState<Category[]>([]);
  const categoriesRef = useRef<Category[]>([]);
  categoriesRef.current = categories;
  const [productCounts, setProductCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#2563EB',
    icon: '📁',
    parent_id: '',
  });
  const [creatingAsSubcategoryOf, setCreatingAsSubcategoryOf] = useState<Category | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignProductsList, setAssignProductsList] = useState<ProductWithCategory[]>([]);
  const [assignProductsLoading, setAssignProductsLoading] = useState(false);
  const [assignProductSearch, setAssignProductSearch] = useState('');
  const [assignSelectedIds, setAssignSelectedIds] = useState<string[]>([]);
  const [assignTargetCategoryId, setAssignTargetCategoryId] = useState('none');
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (!dialogOpen) {
      setCreatingAsSubcategoryOf(null);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (!assignDialogOpen) return;
    setAssignProductSearch('');
    setAssignSelectedIds([]);
    const treeOpts = buildCategoryTreeOptions(categoriesRef.current);
    setAssignTargetCategoryId(treeOpts.length > 0 ? treeOpts[0].id : 'none');
    let cancelled = false;
    (async () => {
      setAssignProductsLoading(true);
      try {
        const list = await getProducts(false, {
          limit: 5000,
          offset: 0,
          sortBy: 'name',
          sortOrder: 'asc',
          stockStatus: 'all',
        });
        if (!cancelled) setAssignProductsList(list);
      } catch {
        if (!cancelled) {
          setAssignProductsList([]);
          toast({
            title: t('common.error'),
            description: t('categories.assign_load_products_failed'),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setAssignProductsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignDialogOpen, t, toast]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, sortBy]);

  useEffect(() => {
    const editId = (location.state as { editCategoryId?: string } | null)?.editCategoryId;
    if (!editId) {
      consumedEditIdRef.current = null;
      return;
    }
    if (loading) return;
    if (categories.length === 0) return;
    if (consumedEditIdRef.current === editId) return;

    const cat = categories.find((c) => c.id === editId);
    if (!cat) {
      consumedEditIdRef.current = editId;
      navigate(location.pathname, { replace: true, state: {} });
      toast({
        title: t('common.info'),
        description: t('categories.edit_target_missing'),
      });
      return;
    }

    consumedEditIdRef.current = editId;
    setEditingCategory(cat);
    setFormData({
      name: cat.name,
      description: cat.description || '',
      color: cat.color || '#2563EB',
      icon: cat.icon || '📁',
      parent_id: cat.parent_id || '',
    });
    setDialogOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [loading, categories, location.state, location.pathname, navigate, toast, t]);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const data = await getCategories();
      setCategories(data);

      const counts: Record<string, number> = {};
      const missingCountIds: string[] = [];
      for (const category of data) {
        if (category.products_count !== undefined) {
          counts[category.id] = category.products_count;
        } else {
          missingCountIds.push(category.id);
        }
      }
      if (missingCountIds.length > 0) {
        const pairs = await Promise.all(
          missingCountIds.map(async (cid) => {
            try {
              const count = await getCategoryProductCount(cid);
              return [cid, count] as const;
            } catch {
              return [cid, 0] as const;
            }
          })
        );
        for (const [cid, count] of pairs) {
          counts[cid] = count;
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
    setCreatingAsSubcategoryOf(null);
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

  const handleOpenSubcategory = (parent: Category) => {
    setCreatingAsSubcategoryOf(parent);
    setEditingCategory(null);
    setFormData({
      name: '',
      description: '',
      color: parent.color || '#2563EB',
      icon: '📁',
      parent_id: parent.id,
    });
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
      // Ensure all category consumers refresh (React Query users)
      queryClient.invalidateQueries({ queryKey: qk.categories, exact: false });
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
    const cachedProductCount =
      category.products_count ?? productCounts[category.id] ?? 0;
    
    if (cachedProductCount > 0) {
      toast({
        title: t('categories.messages.cannot_delete_title'),
        description: t('categories.messages.cannot_delete', { count: cachedProductCount }),
        variant: 'destructive',
      });
      return;
    }

    // Confirm deletion
    const confirmed = await confirmDialog({
      title: t('common.warning'),
      description: t('categories.delete_confirm', { name: category.name }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;

    try {
      // CRITICAL: Attempt deletion - backend will verify product count again
      await deleteCategory(category.id);
      
      toast({
        title: t('common.success'),
        description: t('categories.messages.deleted'),
      });
      
      // Reload categories list to reflect the deletion
      queryClient.invalidateQueries({ queryKey: qk.categories, exact: false });
      loadCategories();
    } catch (error: any) {
      // CRITICAL: Handle specific error messages from backend
      console.error('Category deletion error:', error);
      
      let errorMessage = t('categories.messages.delete_failed');
      let errorTitle = t('common.error');
      
      // Check if error is about products or child categories
      if (error?.message) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('contains') && errorMsg.includes('product')) {
          // Backend detected products - show user-friendly message
          errorTitle = t('categories.messages.cannot_delete_title');
          errorMessage = error.message; // Use the detailed backend message
        } else if (errorMsg.includes('child categor')) {
          errorTitle = t('categories.messages.cannot_delete_title');
          errorMessage = error.message; // Use the detailed backend message
        } else {
          // Generic error - use translation
          errorMessage = error.message || t('categories.messages.delete_failed');
        }
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: 'destructive',
      });
      
      // CRITICAL: Do NOT remove category from UI state if deletion failed
      // The category list will remain unchanged, showing the error to the user
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

  const showParentColumn = useMemo(
    () => categories.some((c) => Boolean(c.parent_id)),
    [categories]
  );

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));

  const paginatedCategories = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCategories.slice(start, start + pageSize);
  }, [filteredCategories, page, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleExportCsv = () => {
    const escapeCell = (cell: string) => {
      const s = String(cell ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const headers = [
      t('categories.export_col_name'),
      t('categories.export_col_description'),
      t('categories.export_col_parent'),
      t('categories.export_col_products'),
      t('categories.export_col_created'),
    ];
    const rows = filteredCategories.map((c) => [
      c.name,
      c.description || '',
      c.parent_id ? getParentCategoryName(c.parent_id) || '' : t('categories.root'),
      String(c.products_count ?? productCounts[c.id] ?? 0),
      formatDate(c.created_at),
    ]);
    const lines = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(',')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `categories-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const editingProductCount = editingCategory
    ? editingCategory.products_count ?? productCounts[editingCategory.id] ?? 0
    : 0;

  const parentSelectOptions = useMemo(() => {
    const available = categories.filter(
      (cat) => !editingCategory || cat.id !== editingCategory.id
    );
    return buildCategoryTreeOptions(available);
  }, [categories, editingCategory?.id]);

  const assignCategoryOptions = useMemo(
    () => buildCategoryTreeOptions(categories),
    [categories]
  );

  const filteredAssignProducts = useMemo(() => {
    const q = assignProductSearch.trim().toLowerCase();
    if (!q) return assignProductsList;
    return assignProductsList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q)
    );
  }, [assignProductsList, assignProductSearch]);

  const toggleAssignProduct = (id: string) => {
    setAssignSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllFilteredAssign = () => {
    setAssignSelectedIds(filteredAssignProducts.map((p) => p.id));
  };

  const clearAssignSelection = () => setAssignSelectedIds([]);

  const handleAssignApply = async () => {
    if (assignSelectedIds.length === 0) {
      toast({
        title: t('common.warning'),
        description: t('categories.assign_select_first'),
        variant: 'destructive',
      });
      return;
    }
    const categoryId = assignTargetCategoryId === 'none' ? null : assignTargetCategoryId;
    setAssignSubmitting(true);
    try {
      const { updated } = await assignProductsToCategory(assignSelectedIds, categoryId);
      toast({
        title: t('common.success'),
        description: t('categories.assign_success', { count: updated }),
      });
      queryClient.invalidateQueries({ queryKey: qk.products, exact: false });
      queryClient.invalidateQueries({ queryKey: qk.categories, exact: false });
      await loadCategories();
      setAssignDialogOpen(false);
    } catch (err) {
      toast({
        title: t('common.error'),
        description:
          err instanceof Error ? err.message : t('categories.assign_failed'),
        variant: 'destructive',
      });
    } finally {
      setAssignSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('categories.title')}</h1>
          <p className="text-muted-foreground">{t('categories.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setAssignDialogOpen(true)}>
            <Package className="h-4 w-4 mr-2" />
            {t('categories.assign_products')}
          </Button>
          <Button type="button" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            {t('categories.add_category')}
          </Button>
        </div>
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
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between space-y-0">
          <CardTitle className="leading-tight">
            {t('categories.title')} ({filteredCategories.length})
          </CardTitle>
          {!loading && filteredCategories.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={handleExportCsv}
            >
              <Download className="h-4 w-4 mr-2" />
              {t('categories.export_csv')}
            </Button>
          )}
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
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('categories.table.category')}</TableHead>
                    <TableHead>{t('categories.table.description')}</TableHead>
                    {showParentColumn && (
                      <TableHead>{t('categories.table.parent_category')}</TableHead>
                    )}
                    <TableHead className="text-right">{t('categories.table.products')}</TableHead>
                    <TableHead>{t('categories.table.created')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCategories.map((category) => (
                    <TableRow key={category.id} className="align-middle">
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="h-9 w-9 shrink-0 rounded flex items-center justify-center text-lg leading-none"
                            style={{ backgroundColor: category.color || '#2563EB' }}
                          >
                            {category.icon || '📁'}
                          </div>
                          <p className="font-medium leading-tight">{category.name}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-muted-foreground max-w-[220px] truncate">
                        {category.description || '—'}
                      </TableCell>
                      {showParentColumn && (
                        <TableCell className="py-2">
                          {category.parent_id ? (
                            <Badge variant="outline" className="font-normal">
                              <FolderTree className="h-3 w-3 mr-1 shrink-0" />
                              {getParentCategoryName(category.parent_id) || '—'}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {t('categories.root')}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium tabular-nums">
                            {category.products_count !== undefined
                              ? category.products_count
                              : productCounts[category.id] ?? 0}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2 whitespace-nowrap">
                        {formatDate(category.created_at)}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => navigate(`/categories/${category.id}`)}
                            aria-label={`${t('common.view')}: ${category.name}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleOpenSubcategory(category)}
                            aria-label={`${t('categories.add_subcategory')}: ${category.name}`}
                          >
                            <FolderPlus className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleOpenDialog(category)}
                            aria-label={`${t('common.edit')}: ${category.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(category)}
                            aria-label={`${t('common.delete')}: ${category.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {t('categories.rows_per_page')}
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[100px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <span className="text-sm text-muted-foreground">
                    {t('categories.pagination_range', {
                      from:
                        filteredCategories.length === 0
                          ? 0
                          : (page - 1) * pageSize + 1,
                      to: Math.min(page * pageSize, filteredCategories.length),
                      total: filteredCategories.length,
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('common.previous')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {creatingAsSubcategoryOf
                ? t('categories.add_subcategory_title', { parent: creatingAsSubcategoryOf.name })
                : editingCategory
                  ? t('categories.edit_category')
                  : t('categories.add_category')}
            </DialogTitle>
            <DialogDescription>
              {creatingAsSubcategoryOf
                ? t('categories.add_subcategory_description', { parent: creatingAsSubcategoryOf.name })
                : editingCategory
                  ? t('categories.update_category_info')
                  : t('categories.create_new_category')}
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
                    maxLength={12}
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
                    {parentSelectOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className="font-sans">{opt.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {editingCategory && editingProductCount > 0 && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {t('categories.contains_products', { count: editingProductCount })}
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

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('categories.assign_products_title')}</DialogTitle>
            <DialogDescription>{t('categories.assign_products_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 min-h-0 flex flex-col flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('categories.assign_target_category')}</Label>
                <Select value={assignTargetCategoryId} onValueChange={setAssignTargetCategoryId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('categories.assign_no_category')}</SelectItem>
                    {assignCategoryOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        <span className="font-sans text-sm">{opt.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-product-search">{t('categories.assign_search_label')}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="assign-product-search"
                    className="pl-9"
                    value={assignProductSearch}
                    onChange={(e) => setAssignProductSearch(e.target.value)}
                    placeholder={t('categories.assign_search_placeholder')}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {t('categories.assign_selected_count', { count: assignSelectedIds.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={selectAllFilteredAssign}>
                  {t('categories.assign_all_filtered')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAssignSelection}>
                  {t('categories.assign_clear_selection')}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[min(50vh,400px)] rounded-md border">
              {assignProductsLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>{t('products.product_name')}</TableHead>
                      <TableHead>{t('products.sku')}</TableHead>
                      <TableHead>{t('products.category')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAssignProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          {t('categories.assign_no_products_match')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAssignProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Checkbox
                              checked={assignSelectedIds.includes(p.id)}
                              onCheckedChange={() => toggleAssignProduct(p.id)}
                              aria-label={p.name}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {p.category?.name || t('categories.assign_no_category')}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleAssignApply} disabled={assignSubmitting}>
              {assignSubmitting ? t('common.loading') : t('categories.assign_apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
