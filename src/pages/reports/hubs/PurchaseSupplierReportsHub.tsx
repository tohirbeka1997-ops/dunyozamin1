import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, ChevronDown, ChevronUp, ShoppingCart, Truck, LineChart, Percent, FileText, CheckCircle2, Package } from 'lucide-react';

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

export default function PurchaseSupplierReportsHub() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const mainReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Xarid buyurtmalari xulosasi',
        description: 'Xaridlar bo‘yicha umumiy xulosa',
        path: '/reports/purchase/summary',
        icon: <ShoppingCart className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Yetkazib beruvchi samaradorligi',
        description: 'Yetkazib beruvchilar kesimida tahlil',
        path: '/reports/purchase/suppliers',
        icon: <Truck className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Narxlar tarixi',
        description: 'Yetkazib beruvchi narxlari dinamikasi',
        path: '/reports/supplier/price-history',
        icon: <LineChart className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Supplier → mahsulot sotuvlari',
        description: 'Yetkazib beruvchi kesimida sotuv miqdori',
        path: '/reports/supplier/product-sales',
        icon: <Package className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  const advancedReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Yetkazib berish aniqligi',
        description: 'Yetkazib berish sifati va aniqligi',
        path: '/reports/supplier/delivery-accuracy',
        icon: <CheckCircle2 className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Xarid–sotuv farqi',
        description: 'Marja/spreaddan tahlil',
        path: '/reports/supplier/purchase-sale-spread',
        icon: <Percent className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Akt sverka (yetkazib beruvchi)',
        description: 'Yetkazib beruvchi bo‘yicha akt sverka',
        path: '/reports/supplier/act-sverka',
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
          <h1 className="text-3xl font-bold">Xarid & yetkazib beruvchi</h1>
          <p className="text-muted-foreground">Xaridlar va yetkazib beruvchilar bo‘yicha hisobotlar</p>
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

