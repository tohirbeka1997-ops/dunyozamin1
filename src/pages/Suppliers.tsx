import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getSuppliers, deleteSupplier } from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import { Plus, Search, Edit, Trash2, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';

export default function Suppliers() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'suppliers.filters.query',
    trackedKeys: ['search', 'status', 'sortBy'],
  });
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || 'all';
  const sortBy = searchParams.get('sortBy') || 'name-asc';
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<SupplierWithBalance | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reload suppliers when status filter changes or when navigating back to this page
  useEffect(() => {
    // Always reload when pathname changes (including navigation from form)
    loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, location.pathname]);

  // Separate effect to handle refresh state changes
  useEffect(() => {
    if (location.state?.refresh) {
      console.log('Refresh triggered from navigation state:', location.state);
      loadSuppliers();
      // Clear the state to prevent infinite loops
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.refresh]);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      // Always fetch all suppliers (including inactive) to ensure we get newly created ones
      // Then filter client-side based on statusFilter
      const data = await getSuppliers(true); // includeInactive = true to get all
      
      // CRITICAL: Ensure data is always an array, never null or undefined
      const suppliersData = Array.isArray(data) ? data : [];
      
      console.log('getSuppliers returned:', suppliersData.length, 'suppliers');
      
      // Apply client-side filtering based on statusFilter
      let filteredData = suppliersData;
      if (statusFilter === 'active') {
        filteredData = suppliersData.filter(s => s && s.status === 'active');
      } else if (statusFilter === 'inactive') {
        filteredData = suppliersData.filter(s => s && s.status === 'inactive');
      }
      // 'all' shows everything, no additional filtering needed
      
      // Ensure filteredData is always an array
      const safeFilteredData = Array.isArray(filteredData) ? filteredData : [];
      
      setSuppliers(safeFilteredData);
      console.log('Loaded suppliers:', safeFilteredData.length, 'with filter:', statusFilter, 'from total:', suppliersData.length);
      
      // If we have a created supplier ID in state, verify it's in the list
      if (location.state?.createdSupplierId) {
        const createdId = location.state.createdSupplierId;
        const found = safeFilteredData.find(s => s && s.id === createdId);
        if (found) {
          console.log('Created supplier found in list:', found.name);
        } else {
          console.warn('Created supplier not found in filtered list:', createdId, 'Filter:', statusFilter);
        }
      }
    } catch (error: unknown) {
      console.error('Error loading suppliers:', error);
      
      // Extract exact error message from backend
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Yetkazib beruvchilarni yuklab bo\'lmadi';
      
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
      
      // Set empty array to prevent crashes
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadSuppliers();
  };

  const handleDeleteClick = (supplier: SupplierWithBalance) => {
    setSupplierToDelete(supplier);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!supplierToDelete) return;

    try {
      setDeleting(true);
      const result = await deleteSupplier(supplierToDelete.id);
      toast({
        title: 'Muvaffaqiyatli',
        description: result?.softDeleted
          ? 'Yetkazib beruvchi xarid tarixiga bog‘langanligi sababli o‘chirilmadi, lekin faol emas qilindi'
          : 'Yetkazib beruvchi muvaffaqiyatli o‘chirildi',
      });
      setDeleteDialogOpen(false);
      setSupplierToDelete(null);
      loadSuppliers();
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Yetkazib beruvchini o\'chirishda xatolik yuz berdi',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return (
        <Badge className="bg-success px-1.5 py-0 text-[10px] font-normal text-white sm:text-xs">Faol</Badge>
      );
    }
    return (
      <Badge className="bg-muted px-1.5 py-0 text-[10px] font-normal text-muted-foreground sm:text-xs">
        Faol emas
      </Badge>
    );
  };

  const formatSupplierBalance = (s: any) => {
    const cur = String(s?.settlement_currency || 'USD').toUpperCase();
    const bal = Number(s?.balance || 0);
    if (cur === 'USD') return `${bal.toFixed(2)} USD`;
    return formatMoneyUZS(bal);
  };

  // Client-side filtering for search (status filtering is done in loadSuppliers)
  // CRITICAL: Ensure suppliers is always an array before filtering
  const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];
  const filteredSuppliers = safeSuppliers.filter((supplier) => {
    // Skip null/undefined suppliers
    if (!supplier) return false;
    
    if (!searchTerm) return true;
    
    const term = searchTerm.toLowerCase();
    return (
      (supplier.name && supplier.name.toLowerCase().includes(term)) ||
      (supplier.phone && supplier.phone.toLowerCase().includes(term)) ||
      (supplier.email && supplier.email.toLowerCase().includes(term))
    );
  });

  const sortedSuppliers = (() => {
    const [field, dir] = String(sortBy || 'name-asc').split('-');
    const direction = dir === 'asc' ? 1 : -1;
    return [...filteredSuppliers].sort((a: any, b: any) => {
      if (field === 'name') {
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }) * direction;
      }
      if (field === 'balance') {
        return (Number(a.balance) - Number(b.balance)) * direction;
      }
      if (field === 'created_at') {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction;
      }
      return 0;
    });
  })();

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Yetkazib beruvchilar</h1>
          <p className="page-heading-sub">Yetkazib beruvchilar maʼlumotlari va kontaktlarini boshqarish</p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => navigate('/suppliers/new', { state: createBackNavigationState(location) })}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Yangi yetkazib beruvchi
        </Button>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center lg:max-w-xl">
                <div className="relative h-8 min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                    value={searchTerm}
                    onChange={(e) => updateParams({ search: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="h-8 py-1 pl-8 text-xs sm:text-sm"
                  />
                </div>
                <Button type="button" size="sm" className="h-8 shrink-0 text-xs" onClick={handleSearch}>
                  Qidirish
                </Button>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                      <SelectValue placeholder="Holati" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Barcha holatlar</SelectItem>
                      <SelectItem value="active">Faol</SelectItem>
                      <SelectItem value="inactive">Faol emas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
                  <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                      <SelectValue placeholder="Saralash" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name-asc">Nomi (A-Z)</SelectItem>
                      <SelectItem value="name-desc">Nomi (Z-A)</SelectItem>
                      <SelectItem value="balance-desc">Balans (Ko'p → Kam)</SelectItem>
                      <SelectItem value="balance-asc">Balans (Kam → Ko'p)</SelectItem>
                      <SelectItem value="created_at-desc">Eng yangisi</SelectItem>
                      <SelectItem value="created_at-asc">Eng eskisi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Ro&apos;yxat</span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              ({sortedSuppliers.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {sortedSuppliers.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center">
              <p className="text-sm text-muted-foreground">Yetkazib beruvchilar topilmadi</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => navigate('/suppliers/new', { state: createBackNavigationState(location) })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi yetkazib beruvchini yaratish
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold sm:text-sm">Nomi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Telefon</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Email</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Balans</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Yaratilgan sana</TableHead>
                    <TableHead className="w-[1%] text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSuppliers.map((supplier) => (
                    <TableRow
                      key={supplier.id}
                      className="cursor-pointer text-sm hover:bg-muted/50"
                      onClick={() =>
                        navigate(`/suppliers/${supplier.id}`, {
                          state: createBackNavigationState(location),
                        })
                      }
                    >
                      <TableCell className="max-w-[14rem] truncate py-2 font-medium">{supplier.name}</TableCell>
                      <TableCell className="max-w-[10rem] truncate py-2 text-xs">{supplier.phone || '-'}</TableCell>
                      <TableCell className="max-w-[12rem] truncate py-2 text-xs">{supplier.email || '-'}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Badge
                          className={`px-1.5 py-0 text-[10px] font-normal sm:text-xs ${
                            supplier.balance > 0
                              ? 'bg-destructive text-white'
                              : supplier.balance < 0
                                ? 'bg-success text-white'
                                : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {formatSupplierBalance(supplier)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">{getStatusBadge(supplier.status)}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {formatDate(supplier.created_at)}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/suppliers/${supplier.id}/edit`, {
                                state: createBackNavigationState(location),
                              });
                            }}
                            title="Tahrirlash"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(supplier);
                            }}
                            title="O'chirish"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yetkazib beruvchini o'chirish</DialogTitle>
            <DialogDescription>
              "{supplierToDelete?.name}" ni o'chirishni tasdiqlaysizmi? Bu amalni bekor qilib bo'lmaydi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Bekor qilish
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'O\'chirilmoqda...' : 'O\'chirish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
