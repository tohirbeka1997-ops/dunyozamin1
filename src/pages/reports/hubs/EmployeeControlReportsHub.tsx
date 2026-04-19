import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, ChevronDown, ChevronUp, UserCheck, Zap, XCircle, Activity, Shield } from 'lucide-react';

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

export default function EmployeeControlReportsHub() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const mainReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Kassir samaradorligi',
        description: 'Kassirlar kesimida ko‘rsatkichlar',
        path: '/reports/employee/cashier',
        icon: <UserCheck className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Smena tahlili',
        description: 'Smena unumdorligi va tahlil',
        path: '/reports/employee/shift-productivity',
        icon: <Zap className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Xatolar',
        description: 'Kassir xatolari va muammolar',
        path: '/reports/employee/errors',
        icon: <XCircle className="h-4 w-4 opacity-90" />,
      },
    ],
    []
  );

  const advancedReports = useMemo<ReportLink[]>(
    () => [
      {
        title: 'Kirishlar tarixi',
        description: 'Xodimlar activity log',
        path: '/reports/employee/activity',
        icon: <Activity className="h-4 w-4 opacity-90" />,
      },
      {
        title: 'Firibgarlik signallari',
        description: 'Nazorat va anomaliyalar',
        path: '/reports/employee/fraud-signals',
        icon: <Shield className="h-4 w-4 opacity-90" />,
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
          <h1 className="text-3xl font-bold">Xodimlar & nazorat</h1>
          <p className="text-muted-foreground">Xodimlar, smena va nazorat hisobotlari</p>
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

