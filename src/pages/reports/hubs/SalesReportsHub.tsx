import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, BarChart3, Package, Users, Tag } from 'lucide-react';

type ReportLink = { title: string; description: string; path: string; icon: React.ReactNode };

function ReportButton({ report, onOpen }: { report: ReportLink; onOpen: (path: string) => void }) {
  return (
    <Button
      variant="outline"
      className="w-full justify-start h-auto py-3"
      onClick={() => onOpen(report.path)}
    >
      <span className="mr-3 shrink-0">{report.icon}</span>
      <span className="flex flex-col items-start">
        <span className="font-medium">{report.title}</span>
        <span className="text-xs opacity-80">{report.description}</span>
      </span>
    </Button>
  );
}

export default function SalesReportsHub() {
  const navigate = useNavigate();

  const mainReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Kunlik savdo',
        description: 'Kun bo‘yicha tushum va buyurtmalar',
        path: '/reports/sales/daily',
        icon: <BarChart3 className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Mahsulotlar bo‘yicha savdo',
        description: 'TOP mahsulotlar, miqdor va tushum',
        path: '/reports/sales/products',
        icon: <Package className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Mijozlar bo‘yicha savdo',
        description: 'Mijoz kesimida savdo statistikasi',
        path: '/reports/sales/customers',
        icon: <Users className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Aksiyalar bo‘yicha hisobot',
        description: 'Aksiya ishlatilishi va chegirma summasi',
        path: '/reports/sales/promotions',
        icon: <Tag className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Sotuv</h1>
          <p className="text-muted-foreground">Sotuv bo‘yicha asosiy hisobotlar</p>
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
    </div>
  );
}

