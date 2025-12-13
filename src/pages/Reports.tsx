import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  TrendingUp, 
  Package, 
  ShoppingCart, 
  Users, 
  DollarSign, 
  FileDown,
  BarChart3,
  PieChart,
  Activity,
  FileText,
  Truck,
  UserCheck
} from 'lucide-react';

export default function Reports() {
  const navigate = useNavigate();

  const reportSections = [
    {
      title: 'Sotuv hisobotlari',
      description: 'Sotuv samaradorligi, daromad va foydani kuzatish',
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      reports: [
        { name: 'Kunlik sotuv hisobotlari', path: '/reports/sales/daily', icon: BarChart3 },
        { name: 'Mahsulotlar bo\'yicha sotuvlar', path: '/reports/sales/products', icon: Package },
        { name: 'Mijozlar bo\'yicha sotuvlar', path: '/reports/sales/customers', icon: Users },
      ],
    },
    {
      title: 'Ombor hisobotlari',
      description: 'Ombor qoldig\'i, harakatlar va baholashni kuzatish',
      icon: Package,
      color: 'text-success',
      bgColor: 'bg-success/10',
      reports: [
        { name: 'Ombor qoldiq hisobotlari', path: '/reports/inventory/stock-levels', icon: Package },
        { name: 'Tovar harakatlari hisobotlari', path: '/reports/inventory/movements', icon: Activity },
        // FIXED: Baholash hisobotlari navigation path - ensures it navigates to valuation report
        { name: 'Baholash hisobotlari', path: '/reports/inventory/valuation', icon: DollarSign },
      ],
    },
    {
      title: 'Xarid hisobotlari',
      description: 'Xarid buyurtmalari va yetkazib beruvchilar faoliyatini tahlil qilish',
      icon: ShoppingCart,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      reports: [
        { name: 'Xarid buyurtmalari umumiy hisobot', path: '/reports/purchase/summary', icon: FileText },
        { name: 'Yetkazib beruvchilar samaradorligi', path: '/reports/purchase/suppliers', icon: Truck },
      ],
    },
    {
      title: 'Xodimlar hisobotlari',
      description: 'Xodimlarning faoliyati va samaradorligini ko\'rib chiqish',
      icon: Users,
      color: 'text-info',
      bgColor: 'bg-info/10',
      reports: [
        { name: 'Kassir faoliyati', path: '/reports/employee/cashier', icon: UserCheck },
        { name: 'Tizimga kirishlar jurnali', path: '/reports/employee/activity', icon: Activity },
      ],
    },
    {
      title: 'Moliyaviy hisobotlar',
      description: 'Foyda va zarar, to\'lov tafsilotlarini ko\'rish',
      icon: DollarSign,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
      reports: [
        { name: 'Foyda va zarar hisobotlari', path: '/reports/financial/profit-loss', icon: PieChart },
        { name: 'To\'lov usullari bo\'yicha tahlil', path: '/reports/financial/payment-methods', icon: DollarSign },
      ],
    },
    {
      title: 'Eksport markazi',
      description: 'Barcha hisobotlarni Excel, PDF yoki CSV formatida eksport qilish',
      icon: FileDown,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      reports: [
        { name: 'Eksport boshqaruvchisi', path: '/reports/export', icon: FileDown },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Hisobotlar</h1>
        <p className="text-muted-foreground">
          Biznesingiz uchun keng qamrovli tahlil va hisobotlar
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {reportSections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-lg ${section.bgColor}`}>
                    <Icon className={`h-6 w-6 ${section.color}`} />
                  </div>
                  <div>
                    <CardTitle>{section.title}</CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {section.reports.map((report) => {
                    const ReportIcon = report.icon;
                    return (
                      <button
                        key={report.name}
                        // Navigation handler - uses report.path which is '/reports/inventory/valuation' for Baholash hisobotlari
                        onClick={() => navigate(report.path)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                      >
                        <ReportIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{report.name}</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
