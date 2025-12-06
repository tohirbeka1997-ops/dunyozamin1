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
      title: 'Sales Reports',
      description: 'Track sales performance, revenue, and profit',
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      reports: [
        { name: 'Daily Sales Report', path: '/reports/sales/daily', icon: BarChart3 },
        { name: 'Product Sales Report', path: '/reports/sales/products', icon: Package },
        { name: 'Customer Sales Report', path: '/reports/sales/customers', icon: Users },
      ],
    },
    {
      title: 'Inventory Reports',
      description: 'Monitor stock levels, movements, and valuation',
      icon: Package,
      color: 'text-success',
      bgColor: 'bg-success/10',
      reports: [
        { name: 'Stock Levels Report', path: '/reports/inventory/stock-levels', icon: Package },
        { name: 'Inventory Movement Report', path: '/reports/inventory/movements', icon: Activity },
        { name: 'Valuation Report', path: '/reports/inventory/valuation', icon: DollarSign },
      ],
    },
    {
      title: 'Purchase Reports',
      description: 'Analyze purchase orders and supplier performance',
      icon: ShoppingCart,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      reports: [
        { name: 'Purchase Order Summary', path: '/reports/purchase/summary', icon: FileText },
        { name: 'Supplier Performance', path: '/reports/purchase/suppliers', icon: Truck },
      ],
    },
    {
      title: 'Employee Reports',
      description: 'Review employee performance and activity',
      icon: Users,
      color: 'text-info',
      bgColor: 'bg-info/10',
      reports: [
        { name: 'Cashier Performance', path: '/reports/employee/cashier', icon: UserCheck },
        { name: 'Login Activity Log', path: '/reports/employee/activity', icon: Activity },
      ],
    },
    {
      title: 'Financial Reports',
      description: 'View profit & loss, payment breakdowns',
      icon: DollarSign,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
      reports: [
        { name: 'Profit & Loss Report', path: '/reports/financial/profit-loss', icon: PieChart },
        { name: 'Payment Method Breakdown', path: '/reports/financial/payment-methods', icon: DollarSign },
      ],
    },
    {
      title: 'Export Center',
      description: 'Export all reports to Excel, PDF, or CSV',
      icon: FileDown,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      reports: [
        { name: 'Export Manager', path: '/reports/export', icon: FileDown },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Comprehensive analytics and reporting for your business
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
