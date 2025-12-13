import { useEffect, useState } from 'react';
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
import { getSalesReturns, getCustomers, getSalesReturnById } from '@/db/api';
import type { Customer, SalesReturnWithDetails } from '@/types/database';
import { Plus, Search, Eye, Printer, RotateCcw, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { printHtml } from '@/lib/print';

export default function SalesReturns() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [returns, setReturns] = useState<SalesReturnWithDetails[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [printingReturnId, setPrintingReturnId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Reload data when navigating to this page (e.g., after creating a return)
  useEffect(() => {
    if (location.pathname === '/returns' || location.pathname === '/sales-returns') {
      loadData();
    }
  }, [location.pathname]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [returnsData, customersData] = await Promise.all([
        getSalesReturns(),
        getCustomers(),
      ]);
      setReturns(returnsData);
      setCustomers(customersData);
    } catch (error) {
      console.error('Error loading sales returns:', error);
      const errorMessage = error instanceof Error ? error.message : 'Qaytarishlarni yuklab bo\'lmadi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      
      if (startDate) filters.startDate = new Date(startDate).toISOString();
      if (endDate) filters.endDate = new Date(endDate).toISOString();
      if (selectedCustomer !== 'all') filters.customerId = selectedCustomer;
      if (selectedStatus !== 'all') filters.status = selectedStatus;
      
      const data = await getSalesReturns(filters);
      setReturns(data);
    } catch (error) {
      console.error('Error searching sales returns:', error);
      const errorMessage = error instanceof Error ? error.message : 'Qaytarishlarni qidirib bo\'lmadi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed':
        return <Badge className="bg-success text-success-foreground">Yakunlangan</Badge>;
      case 'Pending':
        return <Badge className="bg-primary text-primary-foreground">Kutilmoqda</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive">Bekor qilingan</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handlePrint = async (returnId: string) => {
    try {
      setPrintingReturnId(returnId);
      const returnData = await getSalesReturnById(returnId);
      
      // Generate HTML content for the receipt
      const htmlContent = generateReturnReceiptHTML(returnData, 'thermal');
      printHtml('Qaytarish cheki', htmlContent, 'thermal');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chop etishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setPrintingReturnId(null);
    }
  };

  const generateReturnReceiptHTML = (returnData: SalesReturnWithDetails, variant: 'thermal' | 'a4'): string => {
    // Create a temporary wrapper to render React component
    // For simplicity, we'll generate HTML string directly
    const storeName = 'POS tizimi';
    const dateTime = new Date(returnData.created_at).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const cashierName = returnData.cashier?.username || returnData.cashier?.full_name || '-';
    const customerName = returnData.customer?.name || 'Yangi mijoz';
    const orderNumber = returnData.order?.order_number || '-';
    const isPending = returnData.status === 'Pending';
    
    const statusLabels: Record<string, string> = {
      Completed: 'Yakunlangan',
      Pending: 'Kutilmoqda',
      Cancelled: 'Bekor qilingan',
    };
    
    if (variant === 'a4') {
      return `
        <div class="return-receipt-a4">
          ${isPending ? '<div class="text-center mb-4 p-2 bg-yellow-100 border-2 border-yellow-400 rounded"><p class="font-bold text-yellow-800">QORALAMA / JARAYONDA</p></div>' : ''}
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold mb-2">${storeName}</h1>
            <p class="text-sm text-muted-foreground">Sotuv qaytarilishi cheki</p>
          </div>
          <div class="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div><p class="font-semibold">Qaytarish raqami:</p><p class="font-mono">${returnData.return_number}</p></div>
            <div><p class="font-semibold">Buyurtma raqami:</p><p class="font-mono">${orderNumber}</p></div>
            <div><p class="font-semibold">Sana va vaqt:</p><p>${dateTime}</p></div>
            <div><p class="font-semibold">Holati:</p><p>${statusLabels[returnData.status] || returnData.status}</p></div>
            <div><p class="font-semibold">Kassir:</p><p>${cashierName}</p></div>
            <div><p class="font-semibold">Mijoz:</p><p>${customerName}</p></div>
          </div>
          ${returnData.reason ? `<div class="mb-6"><p class="font-semibold mb-2">Qaytarish sababi:</p><p class="text-sm">${returnData.reason}</p></div>` : ''}
          <div class="mb-6">
            <table class="w-full border-collapse">
              <thead>
                <tr class="border-b-2 border-gray-300">
                  <th class="text-left py-2 px-2">Mahsulot</th>
                  <th class="text-center py-2 px-2">Miqdor</th>
                  <th class="text-right py-2 px-2">Narx</th>
                  <th class="text-right py-2 px-2">Jami</th>
                </tr>
              </thead>
              <tbody>
                ${returnData.items?.map(item => `
                  <tr class="border-b border-gray-200">
                    <td class="py-2 px-2">${item.product?.name || item.product_name || '-'}</td>
                    <td class="text-center py-2 px-2">${item.quantity}</td>
                    <td class="text-right py-2 px-2">${formatMoneyUZS(item.unit_price)}</td>
                    <td class="text-right py-2 px-2 font-medium">${formatMoneyUZS(item.line_total)}</td>
                  </tr>
                `).join('') || ''}
              </tbody>
            </table>
          </div>
          <div class="mb-6 space-y-2 text-sm">
            <div class="flex justify-between font-bold text-lg border-t-2 border-gray-300 pt-2">
              <span>Jami qaytarilgan summa:</span>
              <span>${formatMoneyUZS(returnData.total_amount)}</span>
            </div>
          </div>
          ${returnData.notes ? `<div class="mb-6"><p class="font-semibold mb-2">Izoh:</p><p class="text-sm text-muted-foreground">${returnData.notes}</p></div>` : ''}
          <div class="text-center mt-8 pt-4 border-t border-gray-300">
            <p class="text-sm text-muted-foreground">Rahmat!</p>
            <p class="text-xs text-muted-foreground mt-2">${dateTime}</p>
          </div>
        </div>
      `;
    }
    
    // Thermal format
    return `
      <div class="return-receipt-thermal">
        ${isPending ? '<div class="text-center mb-2 p-1 border border-yellow-400 rounded"><p class="text-xs font-bold text-yellow-800">QORALAMA</p></div>' : ''}
        <div class="text-center mb-2">
          <h2 class="text-lg font-bold">${storeName}</h2>
          <p class="text-xs">Sotuv qaytarilishi cheki</p>
        </div>
        <div class="text-center mb-3 text-xs">
          <p class="font-mono">${returnData.return_number}</p>
          <p class="font-mono">Buyurtma: ${orderNumber}</p>
          <p>${dateTime}</p>
        </div>
        <div class="mb-3 text-xs space-y-1">
          <div class="flex justify-between">
            <span>Holati:</span>
            <span class="font-semibold">${statusLabels[returnData.status] || returnData.status}</span>
          </div>
          <div class="flex justify-between">
            <span>Kassir:</span>
            <span>${cashierName}</span>
          </div>
          <div class="flex justify-between">
            <span>Mijoz:</span>
            <span>${customerName}</span>
          </div>
        </div>
        ${returnData.reason ? `<div class="mb-3 text-xs"><p class="font-semibold">Sabab:</p><p>${returnData.reason}</p></div>` : ''}
        <div class="border-t border-b border-dashed border-gray-400 py-2 mb-3">
          ${returnData.items?.map(item => `
            <div class="mb-2 text-xs">
              <div class="font-medium">${item.product?.name || item.product_name || '-'}</div>
              <div class="flex justify-between mt-1">
                <span class="text-gray-600">${item.quantity} x ${formatMoneyUZS(item.unit_price)}</span>
                <span class="font-semibold">${formatMoneyUZS(item.line_total)}</span>
              </div>
            </div>
          `).join('') || ''}
        </div>
        <div class="mb-3 text-xs">
          <div class="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1">
            <span>JAMI QAYTARILGAN:</span>
            <span>${formatMoneyUZS(returnData.total_amount)}</span>
          </div>
        </div>
        ${returnData.notes ? `<div class="mb-3 text-xs border-t border-dashed border-gray-400 pt-2"><p class="font-semibold">Izoh:</p><p class="text-gray-600">${returnData.notes}</p></div>` : ''}
        <div class="text-center mt-4 pt-2 border-t border-dashed border-gray-400">
          <p class="text-xs">Rahmat!</p>
          <p class="text-xs text-gray-500 mt-1">${dateTime}</p>
        </div>
      </div>
    `;
  };

  const filteredReturns = returns.filter((ret) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      ret.return_number?.toLowerCase().includes(search) ||
      ret.order?.order_number?.toLowerCase().includes(search) ||
      ret.customer?.name?.toLowerCase().includes(search)
    );
  });

  const totalReturned = filteredReturns.reduce((sum, ret) => sum + Number(ret.total_amount || 0), 0);
  const completedReturns = filteredReturns.filter(ret => ret.status === 'Completed').length;
  const pendingReturns = filteredReturns.filter(ret => ret.status === 'Pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sotuv qaytarishlari</h1>
          <p className="text-muted-foreground">Qaytarish va pulni qaytarishni boshqarish</p>
        </div>
        <Button onClick={() => navigate('/returns/create')}>
          <Plus className="h-4 w-4 mr-2" />
          Yangi qaytarish
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami qaytarilgan</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalReturned)}</div>
            <p className="text-xs text-muted-foreground">{filteredReturns.length} qaytarish</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Yakunlangan</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedReturns}</div>
            <p className="text-xs text-muted-foreground">Qayta ishlangan qaytarishlar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kutilmoqda</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingReturns}</div>
            <p className="text-xs text-muted-foreground">Qayta ishlash kutilmoqda</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrlar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Qaytarishlarni qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Boshlanish sanasi"
            />

            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="Tugash sanasi"
            />

            <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha mijozlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha mijozlar</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha holatlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="Pending">Kutilmoqda</SelectItem>
                <SelectItem value="Completed">Yakunlangan</SelectItem>
                <SelectItem value="Cancelled">Bekor qilingan</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm('');
                setStartDate('');
                setEndDate('');
                setSelectedCustomer('all');
                setSelectedStatus('all');
                loadData();
              }}
            >
              Tozalash
            </Button>
            <Button onClick={handleSearch}>Filtrni qo'llash</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qaytarishlar ro'yxati ({filteredReturns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-12">
              <RotateCcw className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Qaytarishlar topilmadi</p>
              <Button className="mt-4" onClick={() => navigate('/returns/create')}>
                <Plus className="h-4 w-4 mr-2" />
                Birinchi qaytarishni yaratish
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Qaytarish raqami</TableHead>
                  <TableHead>Buyurtma raqami</TableHead>
                  <TableHead>Mijoz</TableHead>
                  <TableHead>Sana va vaqt</TableHead>
                  <TableHead className="text-right">Summa</TableHead>
                  <TableHead>Holati</TableHead>
                  <TableHead>Kassir</TableHead>
                  <TableHead className="text-right">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret) => (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">{ret.return_number}</TableCell>
                    <TableCell>{ret.order?.order_number || '-'}</TableCell>
                    <TableCell>{ret.customer?.name || 'Yangi mijoz'}</TableCell>
                    <TableCell>
                      {new Date(ret.created_at).toLocaleString('uz-UZ')}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoneyUZS(ret.total_amount)}
                    </TableCell>
                    <TableCell>{getStatusBadge(ret.status)}</TableCell>
                    <TableCell>{ret.cashier?.username || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/returns/${ret.id}`)}
                          title="Tafsilotlarni ko'rish"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {ret.status !== 'Completed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/returns/${ret.id}/edit`)}
                            title="Qaytarishni tahrirlash"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePrint(ret.id)}
                          disabled={printingReturnId === ret.id}
                          title="Chop etish"
                        >
                          {printingReturnId === ret.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                          ) : (
                            <Printer className="h-4 w-4" />
                          )}
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
    </div>
  );
}
