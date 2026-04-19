import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, ChevronDown, ChevronUp, Package, Activity, DollarSign, FileText, BarChart3 } from 'lucide-react';

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

export default function InventoryReportsHub() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const mainReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Ombor qoldiqlari',
        description: 'Mahsulot qoldig‘i va min/max nazorat',
        path: '/reports/inventory/stock-levels',
        icon: <Package className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Bozorga borish hisoboti',
        description: 'Yetishmovchilik va tavsiya buyurtma (real sotuv asosida)',
        path: '/reports/inventory/purchase-planning',
        icon: <BarChart3 className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Ombor harakatlari',
        description: 'Kirim/chiqim harakatlar tarixi',
        path: '/reports/inventory/movements',
        icon: <Activity className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Ombor qiymati',
        description: 'Qoldiqning qiymati (valuation)',
        path: '/reports/inventory/valuation',
        icon: <DollarSign className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  const advancedReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Ombor tahlili (kengaytirilgan)',
        description: 'Dead stock va qo‘shimcha tahlillar',
        path: '/reports/inventory/advanced',
        icon: <BarChart3 className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Mahsulot tarixi (Traceability)',
        description: 'Mahsulotning kirim-chiqim timeline',
        path: '/reports/inventory/traceability',
        icon: <FileText className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Akt sverka (partiya)',
        description: 'Partiya bo‘yicha akt sverka (FIFO)',
        path: '/reports/act-sverka',
        icon: <FileText className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  const canSeeAdvanced = role === 'admin' || role === 'manager';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Ombor</h1>
          <p className="text-muted-foreground">Ombor qoldig‘i va harakatlar bo‘yicha hisobotlar</p>
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

      {canSeeAdvanced && (
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

