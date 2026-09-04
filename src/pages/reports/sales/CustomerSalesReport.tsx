import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCustomerSalesReport, getWarehouses } from '@/db/api';
import type { Warehouse } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatCustomerBalance, formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface CustomerSalesData {
  customer_id: string;
  customer_name: string;
  total_purchases: number;
  order_count: number;
  average_order_value: number;
  /** Legacy net UZS: < 0 debt, > 0 prepaid (customers.balance). UI shows cashier signed (+ owes). */
  balance: number;
  /** Legacy net USD bucket (customers.balance_usd) */
  balance_usd: number;
}

type CustomerSalesSortKey =
  | 'customer_name'
  | 'total_purchases'
  | 'order_count'
  | 'average_order_value'
  | 'balance';

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CustomerSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [customerSales, setCustomerSales] = useState<CustomerSalesData[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(30));
  const [dateTo, setDateTo] = useState(() => todayYMD());
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<CustomerSalesSortKey>(
    'total_purchases',
    'desc'
  );

  const warehouseOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
      })),
    ],
    [warehouses, t]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await getCustomerSalesReport({
        date_from: dateFrom,
        date_to: dateTo,
        warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
      });

      setCustomerSales(
        (rows || []).map((r: any) => ({
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          total_purchases: Number(r.total_purchases) || 0,
          order_count: Number(r.order_count) || 0,
          average_order_value: Number(r.average_order_value) || 0,
          balance: Number(r.balance) || 0,
          balance_usd: Number(r.balance_usd) || 0,
        }))
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: `${t(
          'reports.customer_sales_page.errors.load_failed',
          "Mijozlar bo'yicha sotuv ma'lumotlarini yuklab bo'lmadi"
        )}${msg ? ` (${msg})` : ''}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, warehouseId, toast, t]);

  useEffect(() => {
    (async () => {
      try {
        const w = await getWarehouses();
        setWarehouses((w as Warehouse[]) || []);
      } catch {
        // ignore lookup failures
      }
    })();
  }, []);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredCustomers = useMemo(() => {
    return customerSales.filter((customer) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return customer.customer_name.toLowerCase().includes(search);
    });
  }, [customerSales, searchTerm]);

  const sortedCustomers = useMemo(() => {
    const list = [...filteredCustomers];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      switch (key) {
        case 'customer_name':
          return compareScalar(a.customer_name.toLowerCase(), b.customer_name.toLowerCase(), ord);
        case 'total_purchases':
          return compareScalar(a.total_purchases, b.total_purchases, ord);
        case 'order_count':
          return compareScalar(a.order_count, b.order_count, ord);
        case 'average_order_value':
          return compareScalar(a.average_order_value, b.average_order_value, ord);
        case 'balance':
          return compareScalar(a.balance, b.balance, ord);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredCustomers, sortKey, sortOrder]);

  const totals = useMemo(() => {
    return filteredCustomers.reduce(
      (acc, c) => {
        acc.revenue += c.total_purchases;
        acc.orders += c.order_count;
        if (c.balance < 0) acc.debtUzs += Math.abs(c.balance);
        if (c.balance_usd < 0) acc.debtUsd += Math.abs(c.balance_usd);
        return acc;
      },
      { revenue: 0, orders: 0, debtUzs: 0, debtUsd: 0 }
    );
  }, [filteredCustomers]);

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (sortedCustomers.length === 0) {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t(
          'reports.customer_sales_page.export.no_data',
          "Eksport qilish uchun ma'lumot yo'q"
        ),
        variant: 'destructive',
      });
      return;
    }

    try {
      setExporting(true);
      const fileSuffix = dateFrom === dateTo ? dateFrom : `${dateFrom}_${dateTo}`;
      const headers = [
        t('reports.customer_sales_page.table.customer', 'Mijoz'),
        t('reports.customer_sales_page.table.purchases', 'Umumiy xarid (UZS ekv.)'),
        t('reports.customer_sales_page.table.orders', 'Buyurtmalar soni'),
        t('reports.customer_sales_page.table.avg_order', "O'rtacha buyurtma (UZS ekv.)"),
        t('reports.customer_sales_page.table.balance', 'Qoldiq (UZS)'),
        t('reports.customer_sales_page.table.balance_usd', 'Qoldiq (USD)'),
      ];
      const rows = sortedCustomers.map((c) => [
        c.customer_name,
        c.total_purchases,
        c.order_count,
        Math.round(c.average_order_value * 100) / 100,
        c.balance,
        c.balance_usd,
      ]);

      if (format === 'excel') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
          [t('reports.customer_sales_page.title', "Mijozlar bo'yicha sotuv hisobotlari")],
          [
            t('reports.customer_sales_page.export.period', 'Davr'),
            `${dateFrom} — ${dateTo}`,
          ],
          [],
          headers,
          ...rows,
        ]);
        ws['!cols'] = [
          { wch: 28 },
          { wch: 18 },
          { wch: 14 },
          { wch: 18 },
          { wch: 14 },
          { wch: 14 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Hisobot');
        XLSX.writeFile(wb, `customer-sales-report_${fileSuffix}.xlsx`);
      } else {
        const doc = new jsPDF('landscape', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text(
          t('reports.customer_sales_page.title', "Mijozlar bo'yicha sotuv hisobotlari"),
          14,
          15
        );
        doc.setFontSize(10);
        doc.text(`${dateFrom} — ${dateTo}`, 14, 22);
        autoTable(doc, {
          head: [headers],
          body: rows.map((r) => [
            String(r[0]),
            formatMoneyUZS(Number(r[1])),
            String(r[2]),
            formatMoneyUZS(Number(r[3])),
            formatMoneyUZS(Number(r[4])),
            String(Number(r[5]).toFixed(2)),
          ]),
          startY: 28,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202], textColor: 255 },
        } as any);
        doc.save(`customer-sales-report_${fileSuffix}.pdf`);
      }

      toast({
        title: t('reports.customer_sales_page.export.success_title', 'Muvaffaqiyatli'),
        description: t(
          'reports.customer_sales_page.export.success',
          '{{format}} formatida eksport qilindi',
          { format: format.toUpperCase() }
        ),
      });
    } catch (error) {
      console.error('Customer sales export error:', error);
      toast({
        title: t('common.error', 'Xatolik'),
        description: t(
          'reports.customer_sales_page.export.failed',
          'Eksportda xatolik yuz berdi'
        ),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

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
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/sales')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">
              {t('reports.customer_sales_page.title', "Mijozlar bo'yicha sotuv hisobotlari")}
            </h1>
            <p className="text-muted-foreground">
              {t(
                'reports.customer_sales_page.subtitle',
                "Mijozlarning xarid qilish odatlari va sodiqligini tahlil qilish"
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExport('excel')}
            disabled={exporting}
          >
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.customer_sales_page.export.excel', 'Excel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
          >
            <FileDown className="h-4 w-4 mr-2" />
            {t('reports.customer_sales_page.export.pdf', 'PDF')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.customer_sales_page.scope_hint',
              "Hisob: yakunlangan sotuvlarning gross summasi (UZS ekv.), shu jumladan nasiya. POS savat qaytarishlari chiqarib tashlanadi. Qoldiq qarz — joriy ochiq buyurtma qarzi + qarz berish (computeCustomerPosition), xom customers.balance emas."
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.customer_sales_page.filters.from', 'Boshlanish sanasi')}
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.customer_sales_page.filters.to', 'Tugash sanasi')}
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.customer_sales_page.filters.warehouse', 'Ombor')}
              </label>
              <SearchableCombobox
                value={warehouseId}
                onValueChange={setWarehouseId}
                options={warehouseOptions}
                placeholder={t('combobox.all_warehouses', 'Barcha omborlar')}
                searchPlaceholder={t(
                  'combobox.search_warehouse',
                  "Ombor nomi bo'yicha qidirish..."
                )}
                emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">
                {t('reports.customer_sales_page.filters.search', 'Mijozni qidirish')}
              </label>
              <Input
                placeholder={t(
                  'reports.customer_sales_page.filters.search_ph',
                  "Mijoz ismi bo'yicha qidirish..."
                )}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.customer_sales_page.summary.revenue', 'Umumiy tushum (UZS ekv.)')}
            </p>
            <p className="text-2xl font-bold mt-1">{formatMoneyUZS(totals.revenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('reports.customer_sales_page.summary.customers', '{{count}} ta mijoz', {
                count: filteredCustomers.length,
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.customer_sales_page.summary.orders', 'Umumiy buyurtmalar')}
            </p>
            <p className="text-2xl font-bold mt-1">{totals.orders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('reports.customer_sales_page.summary.debt', 'Qoldiq qarz')}
            </p>
            <p className="text-2xl font-bold text-warning mt-1">
              {formatMoneyUZS(totals.debtUzs)}
            </p>
            {totals.debtUsd > 0.0001 && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('reports.customer_sales_page.summary.debt_usd', '+ {{amount}} USD qarz', {
                  amount: totals.debtUsd.toFixed(2),
                })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {sortedCustomers.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-muted-foreground">
                {t(
                  'reports.customer_sales_page.table.empty',
                  "Tanlangan davrda mijoz sotuvi topilmadi. Standart — oxirgi 30 kun; sana oralig'ini kengaytiring yoki omborni o'zgartiring."
                )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="customer_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    {t('reports.customer_sales_page.table.customer', 'Mijoz')}
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="total_purchases"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t(
                      'reports.customer_sales_page.table.purchases',
                      'Umumiy xarid (UZS ekv.)'
                    )}
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="order_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.customer_sales_page.table.orders', 'Buyurtmalar soni')}
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="average_order_value"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t(
                      'reports.customer_sales_page.table.avg_order',
                      "O'rtacha buyurtma (UZS ekv.)"
                    )}
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="balance"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    {t('reports.customer_sales_page.table.balance', 'Qoldiq qarz')}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCustomers.map((customer) => (
                  <TableRow key={customer.customer_id}>
                    <TableCell className="font-medium">{customer.customer_name}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(customer.total_purchases)}
                    </TableCell>
                    <TableCell className="text-right">{customer.order_count}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(customer.average_order_value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {customer.balance !== 0 || customer.balance_usd !== 0 ? (
                        Math.abs(customer.balance) > 0.0001 ? (
                          <Badge
                            className={
                              customer.balance < 0
                                ? 'bg-destructive text-white'
                                : 'bg-success text-white'
                            }
                          >
                            {formatCustomerBalance(customer.balance, 'UZS').label}
                          </Badge>
                        ) : (
                          <Badge
                            className={
                              customer.balance_usd < 0
                                ? 'bg-destructive text-white'
                                : 'bg-success text-white'
                            }
                          >
                            {formatCustomerBalance(customer.balance_usd, 'USD').label}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground">{formatMoneyUZS(0)}</span>
                      )}
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
