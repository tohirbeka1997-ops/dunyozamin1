import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Crown, UserX, DollarSign, FileText, Gift } from 'lucide-react';

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

export default function CrmReportsHub() {
  const navigate = useNavigate();

  const reports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Akt sverka (mijoz)',
        description: 'Bitta mijoz bo‘yicha tranzaksiyalar timeline',
        path: '/reports/customer/act-sverka',
        icon: <FileText className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'VIP mijozlar',
        description: 'Eng faol va foydali mijozlar',
        path: '/reports/customer/vip',
        icon: <Crown className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Bonus ball hisoboti',
        description: 'Yig‘ish / ishlatish / top balanslar',
        path: '/reports/customer/loyalty',
        icon: <Gift className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Yo‘qolgan mijozlar',
        description: 'So‘nggi davrda kelmay qolgan mijozlar',
        path: '/reports/customer/lost',
        icon: <UserX className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Mijoz rentabelligi',
        description: 'Mijoz kesimida foyda va tahlil',
        path: '/reports/customer/profitability',
        icon: <DollarSign className="h-4 w-4 opacity-90" />,
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
          <h1 className="text-3xl font-bold">Mijozlar (CRM)</h1>
          <p className="text-muted-foreground">Mijozlar bo‘yicha tahlil va hisobotlar</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hisobotlar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reports.map((r) => (
            <ReportButton key={r.path} report={r} onOpen={(p) => navigate(p)} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

