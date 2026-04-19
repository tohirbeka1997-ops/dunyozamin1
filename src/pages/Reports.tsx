import { useNavigate } from 'react-router-dom';
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

export default function Reports() {
  const navigate = useNavigate();

  const categories = [
    {
      title: 'Sotuv',
      description: 'Kunlik savdo, mahsulotlar bo‘yicha, mijozlar bo‘yicha',
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      path: '/reports/sales',
    },
    {
      title: 'Moliyaviy',
      description: 'P&L, pul oqimi, to‘lov usullari, aging, kassa tafovuti',
      icon: DollarSign,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
      path: '/reports/financial',
    },
    {
      title: 'Ombor',
      description: 'Qoldiq, harakatlar, ombor qiymati, traceability, akt sverka',
      icon: Package,
      color: 'text-success',
      bgColor: 'bg-success/10',
      path: '/reports/inventory',
    },
    {
      title: 'Xarid & yetkazib beruvchi',
      description: 'Xaridlar xulosasi, yetkazib beruvchi tahlili, narxlar tarixi',
      icon: ShoppingCart,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      path: '/reports/purchase',
    },
    {
      title: 'Mijozlar (CRM)',
      description: 'VIP, yo‘qolgan mijozlar, rentabellik, akt sverka',
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
      path: '/reports/customer',
    },
    {
      title: 'Xodimlar & nazorat',
      description: 'Kassir, smena, xatolar, firibgarlik signallari',
      icon: UserCheck,
      color: 'text-info',
      bgColor: 'bg-info/10',
      path: '/reports/employee',
    },
    {
      title: 'Texnik & audit',
      description: 'Audit log, qurilma holati, narx o‘zgarishlari',
      icon: Settings,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
      path: '/reports/system',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Hisobotlar</h1>
        <p className="text-muted-foreground">
          Kerakli bo‘limni tanlang — keyingi sahifada hisobotlar guruhlangan holda chiqadi
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {categories.map((c) => {
          const Icon = c.icon;
          return (
            <Card
              key={c.path}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => navigate(c.path)}
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
                <p className="text-sm text-muted-foreground">Hisobotlarni ko‘rish →</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
