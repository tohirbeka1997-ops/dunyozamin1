import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import { getCustomerDebtOperations, getProfiles } from '@/db/api';
import type { Profile } from '@/types/database';
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime, todayYMD } from '@/lib/datetime';
import { getPaymentMethodLabel } from '@/lib/paymentMethodLabels';
import {
  getDebtOpKindLabel,
  type CustomerDebtOperationRow,
  type CustomerDebtOperationsSummary,
} from '@/lib/customerDebtOperations';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { useToast } from '@/hooks/use-toast';
import SearchableCombobox from '@/components/common/SearchableCombobox';

const EMPTY_SUMMARY: CustomerDebtOperationsSummary = {
  debt_collected: 0,
  debt_collected_count: 0,
  credit_issued: 0,
  credit_issued_count: 0,
  advance_received: 0,
  advance_received_count: 0,
  net: 0,
};

function kindBadgeClass(kind: string): string {
  if (kind === 'debt_payment') return 'bg-success text-white';
  if (kind === 'credit_sale') return 'bg-amber-500 text-white';
  if (kind === 'loan_issued') return 'bg-orange-500 text-white';
  if (kind === 'advance') return 'bg-sky-600 text-white';
  return '';
}

export default function CustomerDebtOperationsReport() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.debt-operations.filters.query',
    trackedKeys: ['dateFrom', 'dateTo', 'type', 'cashier'],
  });

  const dateFrom = searchParams.get('dateFrom') || todayYMD();
  const dateTo = searchParams.get('dateTo') || todayYMD();
  const typeFilter = searchParams.get('type') || 'all';
  const cashierFilter = searchParams.get('cashier') || 'all';

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CustomerDebtOperationRow[]>([]);
  const [summary, setSummary] = useState<CustomerDebtOperationsSummary>(EMPTY_SUMMARY);
  const [cashiers, setCashiers] = useState<Profile[]>([]);

  const cashierOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_cashiers', 'Barcha kassirlar') },
      ...cashiers.map((cashier) => ({
        value: cashier.id,
        label: cashier.username || cashier.full_name || cashier.email || cashier.id,
        keywords: [cashier.full_name, cashier.email].filter(Boolean).join(' '),
      })),
    ],
    [cashiers, t]
  );

  async function loadData() {
    try {
      setLoading(true);
      const [report, profiles] = await Promise.all([
        getCustomerDebtOperations({
          date_from: dateFrom,
          date_to: dateTo,
          cashier_id: cashierFilter !== 'all' ? cashierFilter : null,
          op_type: typeFilter !== 'all' ? typeFilter : 'all',
          warehouse_id: 'ALL',
        }),
        getProfiles(),
      ]);
      setRows((report?.rows || []) as CustomerDebtOperationRow[]);
      setSummary({ ...EMPTY_SUMMARY, ...(report?.summary || {}) });
      setCashiers(profiles || []);
    } catch {
      toast({
        title: t('common.error', 'Xatolik'),
        description: t('reports.debt_operations_page.errors.load_failed', 'Qarz amaliyotlarini yuklab bo‘lmadi'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, typeFilter, cashierFilter]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/reports/sales')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="page-heading">
            {t('reports.debt_operations_page.title', 'Qarz to‘lovlari va nasiya')}
          </h1>
          <p className="page-heading-sub">
            {t(
              'reports.debt_operations_page.subtitle',
              'Bugun yoki tanlangan davrda kim qarzini to‘ladi va kimga nasiya berildi'
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Card className="gap-0 py-2">
          <CardContent className="px-3 py-0">
            <p className="text-xs leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.debt_collected', 'Qarz yig‘ildi')}
            </p>
            <div className="text-sm font-bold leading-tight text-success">{formatMoneyUZS(summary.debt_collected)}</div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.count', '{{count}} ta amaliyot', {
                count: summary.debt_collected_count,
              })}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-2">
          <CardContent className="px-3 py-0">
            <p className="text-xs leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.credit_issued', 'Nasiya berildi')}
            </p>
            <div className="text-sm font-bold leading-tight text-amber-600">{formatMoneyUZS(summary.credit_issued)}</div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.count', '{{count}} ta amaliyot', {
                count: summary.credit_issued_count,
              })}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-2">
          <CardContent className="px-3 py-0">
            <p className="text-xs leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.advance_received', 'Avans')}
            </p>
            <div className="text-sm font-bold leading-tight">{formatMoneyUZS(summary.advance_received)}</div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.count', '{{count}} ta amaliyot', {
                count: summary.advance_received_count,
              })}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-2">
          <CardContent className="px-3 py-0">
            <p className="text-xs leading-tight text-muted-foreground">
              {t('reports.debt_operations_page.summary.net', 'Net (yig‘ilgan − nasiya)')}
            </p>
            <div className={`text-sm font-bold leading-tight ${summary.net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(summary.net)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 py-3">
        <CardContent className="px-3 py-0">
          <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
            <div className="min-w-[8.75rem] flex-1 basis-[8.75rem]">
              <label className="text-xs text-muted-foreground">
                {t('reports.debt_operations_page.filters.from', 'Boshlanish sanasi')}
              </label>
              <Input
                type="date"
                className="h-8"
                value={dateFrom}
                onChange={(e) => updateParams({ dateFrom: e.target.value })}
              />
            </div>
            <div className="min-w-[8.75rem] flex-1 basis-[8.75rem]">
              <label className="text-xs text-muted-foreground">
                {t('reports.debt_operations_page.filters.to', 'Tugash sanasi')}
              </label>
              <Input
                type="date"
                className="h-8"
                value={dateTo}
                onChange={(e) => updateParams({ dateTo: e.target.value })}
              />
            </div>
            <div className="min-w-[8.75rem] flex-1 basis-[8.75rem]">
              <label className="text-xs text-muted-foreground">
                {t('reports.debt_operations_page.filters.type', 'Turi')}
              </label>
              <Select value={typeFilter} onValueChange={(value) => updateParams({ type: value })}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('reports.debt_operations_page.filters.all_types', 'Barcha turlar')}</SelectItem>
                  <SelectItem value="debt_payment">{getDebtOpKindLabel('debt_payment', t)}</SelectItem>
                  <SelectItem value="credit_sale">{getDebtOpKindLabel('credit_sale', t)}</SelectItem>
                  <SelectItem value="loan_issued">{getDebtOpKindLabel('loan_issued', t)}</SelectItem>
                  <SelectItem value="advance">{getDebtOpKindLabel('advance', t)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[8.75rem] flex-1 basis-[8.75rem]">
              <label className="text-xs text-muted-foreground">
                {t('reports.debt_operations_page.filters.cashier', 'Kassir')}
              </label>
              <SearchableCombobox
                value={cashierFilter}
                onValueChange={(value) => updateParams({ cashier: value })}
                options={cashierOptions}
                placeholder={t('combobox.all_cashiers', 'Barcha kassirlar')}
                searchPlaceholder={t('combobox.search_employee', "Nom yoki email bo'yicha qidirish...")}
                emptyMessage={t('combobox.no_employee', 'Xodim topilmadi')}
                className="h-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {t(
                  'reports.debt_operations_page.empty',
                  'Tanlangan davrda qarz to‘lovi yoki nasiya amaliyoti topilmadi'
                )}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.debt_operations_page.table.datetime', 'Sana / vaqt')}</TableHead>
                  <TableHead>{t('reports.debt_operations_page.table.customer', 'Mijoz')}</TableHead>
                  <TableHead>{t('reports.debt_operations_page.table.type', 'Turi')}</TableHead>
                  <TableHead className="text-right">{t('reports.debt_operations_page.table.amount', 'Summa')}</TableHead>
                  <TableHead>{t('reports.debt_operations_page.table.method', 'Usul')}</TableHead>
                  <TableHead>{t('reports.debt_operations_page.table.cashier', 'Kassir')}</TableHead>
                  <TableHead>{t('reports.debt_operations_page.table.ref', 'Hujjat')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatOrderDateTime(row.occurred_at)}</TableCell>
                    <TableCell className="font-medium">{row.customer_name || row.customer_id}</TableCell>
                    <TableCell>
                      <Badge className={kindBadgeClass(String(row.kind))}>
                        {getDebtOpKindLabel(row.kind, t)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatMoneyUZS(row.amount_uzs)}</TableCell>
                    <TableCell>{getPaymentMethodLabel(row.payment_method, t)}</TableCell>
                    <TableCell>{row.cashier_name || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{row.order_number || row.ref_no || '—'}</TableCell>
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
