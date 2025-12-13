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
import { Plus, Search, Eye, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';

export default function Suppliers() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
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
      window.history.replaceState({}, document.title, location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.refresh]);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      // Always fetch all suppliers (including inactive) to ensure we get newly created ones
      // Then filter client-side based on statusFilter
      const data = await getSuppliers(true); // includeInactive = true to get all
      
      console.log('getSuppliers returned:', data.length, 'suppliers');
      
      // Apply client-side filtering based on statusFilter
      let filteredData = data;
      if (statusFilter === 'active') {
        filteredData = data.filter(s => s.status === 'active');
      } else if (statusFilter === 'inactive') {
        filteredData = data.filter(s => s.status === 'inactive');
      }
      // 'all' shows everything, no additional filtering needed
      
      setSuppliers(filteredData);
      console.log('Loaded suppliers:', filteredData.length, 'with filter:', statusFilter, 'from total:', data.length);
      
      // If we have a created supplier ID in state, verify it's in the list
      if (location.state?.createdSupplierId) {
        const createdId = location.state.createdSupplierId;
        const found = filteredData.find(s => s.id === createdId);
        if (found) {
          console.log('Created supplier found in list:', found.name);
        } else {
          console.warn('Created supplier not found in filtered list:', createdId, 'Filter:', statusFilter);
        }
      }
    } catch (error) {
      console.error('Error loading suppliers:', error);
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchilarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
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
      await deleteSupplier(supplierToDelete.id);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Yetkazib beruvchi muvaffaqiyatli o\'chirildi',
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
      return <Badge className="bg-success text-success-foreground">Faol</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">Faol emas</Badge>;
  };

  // Client-side filtering for search (status filtering is done in loadSuppliers)
  const filteredSuppliers = suppliers.filter((supplier) => {
    if (!searchTerm) return true;
    
    const term = searchTerm.toLowerCase();
    return (
      supplier.name.toLowerCase().includes(term) ||
      (supplier.phone && supplier.phone.toLowerCase().includes(term)) ||
      (supplier.email && supplier.email.toLowerCase().includes(term))
    );
  });

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
        <Button onClick={() => navigate('/suppliers/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Yangi yetkazib beruvchi
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pl-9"
                  />
                </div>
                <Button onClick={handleSearch}>Qidirish</Button>
              </div>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="active">Faol</SelectItem>
                <SelectItem value="inactive">Faol emas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredSuppliers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Yetkazib beruvchilar topilmadi</p>
              <Button onClick={() => navigate('/suppliers/new')} className="mt-4">
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
                {filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.phone || '-'}</TableCell>
                    <TableCell>{supplier.email || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        className={
                          supplier.balance > 0 
                            ? 'bg-destructive text-destructive-foreground' 
                            : supplier.balance < 0 
                            ? 'bg-success text-success-foreground' 
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {formatMoneyUZS(supplier.balance)}
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(supplier.status)}</TableCell>
                    <TableCell>
                      {format(new Date(supplier.created_at), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/suppliers/${supplier.id}`)}
                          title="Ko'rish"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                          title="Tahrirlash"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(supplier)}
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
