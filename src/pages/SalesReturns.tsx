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
import SearchableCustomerCombobox from '@/components/common/SearchableCustomerCombobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSalesReturns, getCustomers, getSalesReturnById, getSettingsByCategory } from '@/db/api';
import type { CompanySettings, Customer, SalesReturnWithDetails } from '@/types/database';
import { Plus, Search, Eye, Printer, RotateCcw, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS, formatOrderMoney, formatReturnMoney, aggregateReturnAmounts } from '@/lib/format';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatOrderDateTime } from '@/lib/datetime';
import { printReturnReceipt } from '@/lib/receipts/printReturnReceipt';
import { useReceiptSettings } from '@/hooks/useReceiptSettings';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';
import { useTranslation } from 'react-i18next';

export default function SalesReturns() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { searchParams, updateParams, clearTrackedParams } = useSessionSearchParams({
    storageKey: 'sales-returns.filters.query',
    trackedKeys: ['search', 'startDate', 'endDate', 'customer', 'status'],
  });
  const [returns, setReturns] = useState<SalesReturnWithDetails[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const selectedCustomer = searchParams.get('customer') || 'all';
  const selectedStatus = searchParams.get('status') || 'all';
  const [printingReturnId, setPrintingReturnId] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const receiptSettings = useReceiptSettings();

  useEffect(() => {
    void getSettingsByCategory('company')
      .then((raw) => setCompanySettings(raw as unknown as CompanySettings))
      .catch(() => setCompanySettings(null));
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Reload data when navigating to this page (e.g., after creating a return)
  useEffect(() => {
    if (location.pathname === '/returns' || location.pathname === '/sales-returns') {
      loadData();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (startDate || endDate || selectedCustomer !== 'all' || selectedStatus !== 'all') {
      void handleSearch();
    }
  }, [startDate, endDate, selectedCustomer, selectedStatus]);

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
      
      // Keep raw YYYY-MM-DD to avoid UTC shift bugs near midnight.
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
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
        return <Badge className="bg-success px-1.5 py-0 text-[10px] text-white sm:text-xs">Yakunlangan</Badge>;
      case 'Pending':
        return <Badge className="bg-primary px-1.5 py-0 text-[10px] text-white sm:text-xs">Kutilmoqda</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive" className="px-1.5 py-0 text-[10px] sm:text-xs">Bekor qilingan</Badge>;
      default:
        return <Badge variant="outline" className="px-1.5 py-0 text-[10px] sm:text-xs">{status}</Badge>;
    }
  };

  const handlePrint = async (returnId: string) => {
    console.log('[RETURNS] handlePrint called with returnId:', returnId, typeof returnId);
    
    if (!returnId) {
      toast({
        title: 'Xatolik',
        description: 'Qaytarish ID topilmadi',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setPrintingReturnId(returnId);
      const returnData = await getSalesReturnById(returnId);
      console.log('[RETURNS] handlePrint: loaded return data:', {
        id: returnData?.id,
        return_number: returnData?.return_number,
        items_count: returnData?.items?.length || 0,
      });

      if (!returnData?.items?.length) {
        toast({
          title: 'Ogohlantirish',
          description: 'Qaytarishda mahsulotlar topilmadi — chekda faqat jami summa chiqadi',
          variant: 'destructive',
        });
      }

      const transport = await printReturnReceipt(returnData, companySettings, receiptSettings);
      toast({
        title: 'Chek',
        description:
          transport === 'escpos'
            ? 'Qaytarish cheki printerga yuborildi'
            : 'Qaytarish cheki chop etish oynasi ochildi',
      });
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
  const filteredReturns = returns.filter((ret) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      ret.return_number?.toLowerCase().includes(search) ||
      ret.order?.order_number?.toLowerCase().includes(search) ||
      ret.customer?.name?.toLowerCase().includes(search)
    );
  });

  const returnTotals = aggregateReturnAmounts(filteredReturns as any);
  const completedReturns = filteredReturns.filter(ret => ret.status === 'Completed').length;
  const pendingReturns = filteredReturns.filter(ret => ret.status === 'Pending').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Sotuv qaytarishlari</h1>
          <p className="page-heading-sub">Qaytarish va pulni qaytarishni boshqarish</p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => navigate('/returns/create', { state: createBackNavigationState(location) })}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Yangi qaytarish
        </Button>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-3 sm:px-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            <div className="flex gap-3 border-b pb-3 sm:border-b-0 sm:pb-0 sm:pr-6 sm:border-r">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jami qaytarilgan</p>
                <p className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                  <DualCurrencyAmount uzs={returnTotals.totalUzs} usd={returnTotals.totalUsd} />
                </p>
                <p className="text-xs text-muted-foreground">{filteredReturns.length} qaytarish</p>
              </div>
            </div>
            <div className="flex gap-3 border-b pb-3 sm:border-b-0 sm:pb-0 sm:pr-6 sm:border-r">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Yakunlangan</p>
                <p className="text-base font-semibold tabular-nums leading-tight sm:text-lg">{completedReturns}</p>
                <p className="text-xs text-muted-foreground">Qayta ishlangan</p>
              </div>
            </div>
            <div className="flex gap-3">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kutilmoqda</p>
                <p className="text-base font-semibold tabular-nums leading-tight sm:text-lg">{pendingReturns}</p>
                <p className="text-xs text-muted-foreground">Jarayonda</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 lg:flex-[2]">
                <div className="relative h-8 min-w-[11rem] shrink-0 flex-[1.25]">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Qaytarishlarni qidirish..."
                    value={searchTerm}
                    onChange={(e) => updateParams({ search: e.target.value })}
                    className="h-8 py-1 pl-8 text-xs sm:text-sm"
                  />
                </div>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => updateParams({ startDate: e.target.value })}
                  className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                  aria-label="Dan"
                />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => updateParams({ endDate: e.target.value })}
                  className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                  aria-label="Gacha"
                />
                <div className="min-w-[8rem] flex-1 basis-[10rem]">
                  <SearchableCustomerCombobox
                    value={selectedCustomer}
                    onValueChange={(value) => updateParams({ customer: value })}
                    knownCustomers={customers}
                    prefixOptions={[
                      { value: 'all', label: t('combobox.all_customers', 'Barcha mijozlar') },
                    ]}
                    triggerClassName="h-8 bg-background px-2 text-xs"
                  />
                </div>
                <div className="min-w-[8rem] flex-1 basis-[9rem]">
                  <Select value={selectedStatus} onValueChange={(value) => updateParams({ status: value })}>
                    <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
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
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-dashed border-muted-foreground/25 pt-2 lg:border-t-0 lg:pt-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    clearTrackedParams();
                    loadData();
                  }}
                >
                  Tozalash
                </Button>
                <Button type="button" size="sm" className="h-8 text-xs" onClick={handleSearch}>
                  Filtrni qo'llash
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b px-4 py-2">
          <CardTitle className="text-base font-semibold">Qaytarishlar ro&apos;yxati ({filteredReturns.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loading ? (
            <div className="flex justify-center py-10 px-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <RotateCcw className="mx-auto mb-4 h-10 w-10 text-muted-foreground/70" />
              <p className="text-muted-foreground">Qaytarishlar topilmadi</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => navigate('/returns/create', { state: createBackNavigationState(location) })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi qaytarishni yaratish
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Qaytarish raqami</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Buyurtma raqami</TableHead>
                  <TableHead className="min-w-[8rem] text-xs font-semibold sm:text-sm">Mijoz</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Sana va vaqt</TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold sm:text-sm">Summa</TableHead>
                  <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                  <TableHead className="text-xs font-semibold sm:text-sm">Kassir</TableHead>
                  <TableHead className="text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret) => (
                  <TableRow key={ret.id} className="text-sm">
                    <TableCell className="max-w-[11rem] truncate py-2 font-medium font-mono text-xs">{ret.return_number}</TableCell>
                    <TableCell className="max-w-[9rem] truncate py-2 text-xs">
                      {ret.order?.order_number || (ret.return_mode === 'manual' ? 'Ordersiz' : '-')}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate py-2">{ret.customer?.name || 'Yangi mijoz'}</TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs">
                      {formatOrderDateTime(ret.created_at)}
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs tabular-nums font-medium">
                      {formatReturnMoney(ret, {
                        currency: (ret as any).order_currency ?? ret.order?.currency,
                      })}
                    </TableCell>
                    <TableCell className="py-2">{getStatusBadge(ret.status)}</TableCell>
                    <TableCell className="max-w-[7rem] truncate py-2 text-xs">{ret.cashier?.username || '-'}</TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            console.log('[RETURNS] View button clicked:', {
                              id: ret.id,
                              return_number: ret.return_number,
                              type: typeof ret.id,
                            });
                            if (!ret.id) {
                              toast({
                                title: 'Xatolik',
                                description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                variant: 'destructive',
                              });
                              return;
                            }
                            navigate(`/returns/${ret.id}`, {
                              state: createBackNavigationState(location),
                            });
                          }}
                          title="Tafsilotlarni ko'rish"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {String(ret.status || '').toLowerCase() !== 'completed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              console.log('[RETURNS] Edit button clicked:', {
                                id: ret.id,
                                return_number: ret.return_number,
                                status: ret.status,
                              });
                              if (!ret.id) {
                                toast({
                                  title: 'Xatolik',
                                  description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                  variant: 'destructive',
                                });
                                return;
                              }
                              navigate(`/returns/${ret.id}/edit`, {
                                state: createBackNavigationState(location),
                              });
                            }}
                            title="Qaytarishni tahrirlash"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            console.log('[RETURNS] Print button clicked:', {
                              id: ret.id,
                              return_number: ret.return_number,
                            });
                            if (!ret.id) {
                              toast({
                                title: 'Xatolik',
                                description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                variant: 'destructive',
                              });
                              return;
                            }
                            handlePrint(ret.id);
                          }}
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
