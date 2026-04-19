import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getSuppliers, deleteSupplier } from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import { Plus, Search, Edit, Trash2 } from 'lucide-react';
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
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
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
      return <Badge className="bg-success text-white">Faol</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">Faol emas</Badge>;
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
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Yetkazib beruvchilar</h1>
          <p className="text-muted-foreground">Yetkazib beruvchilar maʼlumotlari va kontaktlarini boshqarish</p>
        </div>
        <Button onClick={() => navigate('/suppliers/new', { state: createBackNavigationState(location) })}>
          <Plus className="h-4 w-4 mr-2" />
          Yangi yetkazib beruvchi
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                    value={searchTerm}
                    onChange={(e) => updateParams({ search: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pl-9"
                  />
                </div>
                <Button onClick={handleSearch}>Qidirish</Button>
              </div>
            </div>

            <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="active">Faol</SelectItem>
                <SelectItem value="inactive">Faol emas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
              <SelectTrigger>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {sortedSuppliers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Yetkazib beruvchilar topilmadi</p>
              <Button
                onClick={() => navigate('/suppliers/new', { state: createBackNavigationState(location) })}
                className="mt-4"
              >
                <Plus className="h-4 w-4 mr-2" />
                Birinchi yetkazib beruvchini yaratish
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomi</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Balans</TableHead>
                  <TableHead>Holati</TableHead>
                  <TableHead>Yaratilgan sana</TableHead>
                  <TableHead className="text-right">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSuppliers.map((supplier) => (
                  <TableRow
                    key={supplier.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      navigate(`/suppliers/${supplier.id}`, {
                        state: createBackNavigationState(location),
                      })
                    }
                  >
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.phone || '-'}</TableCell>
                    <TableCell>{supplier.email || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        className={
                          supplier.balance > 0 
                            ? 'bg-destructive text-white' 
                            : supplier.balance < 0 
                            ? 'bg-success text-white' 
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {formatSupplierBalance(supplier)}
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(supplier.status)}</TableCell>
                    <TableCell>
                      {formatDate(supplier.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(supplier);
                          }}
                          title="O'chirish"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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
