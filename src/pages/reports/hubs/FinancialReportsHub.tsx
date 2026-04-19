import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, ChevronDown, ChevronUp, DollarSign, FileDown, AlertTriangle, Clock, TrendingDown } from 'lucide-react';

type ReportLink = { title: string; description: string; path: string; icon: React.ReactNode };

function ReportButton({ report, onOpen }: { report: ReportLink; onOpen: (path: string) => void }) {
  return (
    <Button variant="outline" className="w-full justify-start h-auto py-3" onClick={() => onOpen(report.path)}>
      <span className="mr-3 shrink-0">{report.icon}</span>
      <span className="flex flex-col items-start">
        <span className="font-medium">{report.title}</span>
        <span className="text-xs opacity-80">{report.description}</span>
      </span>
    </Button>
  );
}

export default function FinancialReportsHub() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const mainReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Foyda va zarar (P&L)',
        description: 'Daromad, xarajat va foyda',
        path: '/reports/financial/profit-loss',
        icon: <DollarSign className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Pul oqimi',
        description: 'Kirim/chiqim pul oqimi',
        path: '/reports/financial/cash-flow',
        icon: <TrendingDown className="h-4 w-4 opacity-90" />,
      },
      {
        title: "To‘lov usullari bo‘yicha",
        description: 'Naqd/karta/terminal va boshqalar',
        path: '/reports/financial/payment-methods',
        icon: <DollarSign className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Qarzdorlik (Aging)',
        description: 'Mijoz va yetkazib beruvchi qarzdorligi',
        path: '/reports/financial/aging',
        icon: <Clock className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Kassa tafovuti',
        description: 'Kassadagi farqlar va sabablar',
        path: '/reports/financial/cash-discrepancies',
        icon: <AlertTriangle className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  const advancedReports = useMemo<ReportLink[]>(
    () => [
      ...(role === 'admin'
        ? [
            {
              title: 'Boshqaruv dashboard (KPI)',
              description: 'Rahbariyat uchun KPI va trendlar',
              path: '/reports/executive/dashboard',
              icon: <DollarSign className="h-4 w-4 opacity-90" />,
            } as ReportLink,
          ]
        : []),
      {
        title: 'Eksport boshqaruvi',
        description: 'CSV/Excel eksport (agar mavjud bo‘lsa)',
        path: '/reports/export',
        icon: <FileDown className="h-4 w-4 opacity-90" />,
      },
    ],
    [role]
  );

  const canSeeAdvanced = role === 'admin' || role === 'manager';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Moliyaviy</h1>
          <p className="text-muted-foreground">Moliyaviy ko‘rsatkichlar va nazorat hisobotlari</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Asosiy hisobotlar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {mainReports.map((r) => (
            <ReportButton key={r.path} report={r} onOpen={(p) => navigate(p)} />
          ))}
        </CardContent>
      </Card>

      {canSeeAdvanced && advancedReports.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Qo‘shimcha (Advanced)</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? (
                <>
                  Yashirish <ChevronUp className="ml-2 h-4 w-4" />
                </>
              ) : (
                <>
                  Ko‘rsatish <ChevronDown className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </CardHeader>
          {showAdvanced && (
            <CardContent className="space-y-3">
              {advancedReports.map((r) => (
                <ReportButton key={r.path} report={r} onOpen={(p) => navigate(p)} />
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

