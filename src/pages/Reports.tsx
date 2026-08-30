import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp,
  DollarSign,
  Package,
  ShoppingCart,
  Users,
  UserCheck,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type ReportCategory = {
  title: string;
  description: string;
  icon: typeof TrendingUp;
  color: string;
  bgColor: string;
  path: string;
  allowedRoles: Array<'admin' | 'manager' | 'cashier'>;
};

const CATEGORIES: ReportCategory[] = [
  {
    title: 'Sotuv',
    description: 'Kunlik savdo, mahsulotlar bo‘yicha, mijozlar bo‘yicha',
    icon: TrendingUp,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    path: '/reports/sales',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Moliyaviy',
    description: 'Akt sverka, P&L, pul oqimi, to‘lov usullari, aging, kassa tafovuti',
    icon: DollarSign,
    color: 'text-accent',
    bgColor: 'bg-accent/10',
    path: '/reports/financial',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Ombor',
    description: 'Qoldiq, harakatlar, ombor qiymati, traceability, akt sverka',
    icon: Package,
    color: 'text-success',
    bgColor: 'bg-success/10',
    path: '/reports/inventory',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Xarid & yetkazib beruvchi',
    description: 'Xaridlar xulosasi, yetkazib beruvchi tahlili, narxlar tarixi',
    icon: ShoppingCart,
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    path: '/reports/purchase',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Mijozlar (CRM)',
    description: 'VIP, yo‘qolgan mijozlar, rentabellik, akt sverka',
    icon: Users,
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    path: '/reports/customer',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Xodimlar & nazorat',
    description: 'Kassir, smena, xatolar, firibgarlik signallari',
    icon: UserCheck,
    color: 'text-info',
    bgColor: 'bg-info/10',
    path: '/reports/employee',
    allowedRoles: ['admin', 'manager'],
  },
  {
    title: 'Texnik & audit',
    description: 'Audit log, qurilma holati, narx o‘zgarishlari',
    icon: Settings,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    path: '/reports/system',
    allowedRoles: ['admin', 'manager'],
  },
];

export default function Reports() {
  const { user } = useAuth();
  const role = String(user?.role || '').toLowerCase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading">Hisobotlar</h1>
        <p className="text-muted-foreground">
          Kerakli bo‘limni tanlang — keyingi sahifada hisobotlar guruhlangan holda chiqadi
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const allowed = c.allowedRoles.includes(role as 'admin' | 'manager' | 'cashier');
          if (!allowed) {
            return (
              <Card
                key={c.path}
                className="opacity-60"
                data-testid={`reports-hub-card-denied-${c.path}`}
                aria-disabled="true"
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-lg ${c.bgColor}`}>
                      <Icon className={`h-6 w-6 ${c.color}`} />
                    </div>
                    <div>
                      <CardTitle>{c.title}</CardTitle>
                      <CardDescription>{c.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">No permission</p>
                </CardContent>
              </Card>
            );
          }

          return (
            <Link
              key={c.path}
              to={c.path}
              data-testid={`reports-hub-card-${c.path}`}
              className={cn(
                'block rounded-xl outline-none transition-shadow',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-lg ${c.bgColor}`}>
                      <Icon className={`h-6 w-6 ${c.color}`} />
                    </div>
                    <div>
                      <CardTitle>{c.title}</CardTitle>
                      <CardDescription>{c.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground">
                    Hisobotlarni ko‘rish →
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
