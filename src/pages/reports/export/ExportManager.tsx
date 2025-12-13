import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, FileDown, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import {
  exportDailySales,
  exportProductSales,
  exportCustomerSales,
  exportStockLevels,
  exportInventoryMovements,
  exportValuation,
  exportPurchaseOrderSummary,
  exportSupplierPerformance,
  exportCashierPerformance,
  exportLoginActivity,
  exportProfitLoss,
  exportPaymentMethods,
} from '@/lib/exportManager';

interface ExportOption {
  name: string;
  description: string;
  formats: ('excel' | 'pdf' | 'csv')[];
}

export default function ExportManager() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const exportOptions: ExportOption[] = [
    {
      name: 'Kunlik sotuv hisobotlari',
      description: 'Kunlik sotuvlar, daromad va foyda ma\'lumotlari',
      formats: ['excel', 'pdf', 'csv'],
    },
    {
      name: 'Mahsulotlar bo\'yicha sotuvlar',
      description: 'Mahsulotlar bo\'yicha batafsil sotuv ma\'lumotlari',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Mijozlar bo\'yicha sotuvlar',
      description: 'Mijozlar bo\'yicha xaridlar va balans ma\'lumotlari',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Ombor qoldiq hisobotlari',
      description: 'Ombordagi mahsulotlar va zaxira darajalari',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Tovar harakatlari hisobotlari',
      description: 'Ombordagi barcha harakatlar va o\'zgarishlar',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Baholash hisobotlari',
      description: 'Ombordagi mahsulotlarning umumiy qiymati',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Xarid buyurtmalari umumiy hisobot',
      description: 'Xarid buyurtmalari haqida umumiy ma\'lumot',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Yetkazib beruvchilar samaradorligi',
      description: 'Yetkazib beruvchilarning xaridlar bo\'yicha samaradorligi',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Kassir faoliyati',
      description: 'Kassirlarning sotuv samaradorligi',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Tizimga kirishlar jurnali',
      description: 'Xodimlarning tizimga kirish va chiqishlari',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'Foyda va zarar hisobotlari',
      description: 'Foyda va zarar, soliqlar va xarajatlar',
      formats: ['excel', 'pdf'],
    },
    {
      name: 'To\'lov usullari bo\'yicha tahlil',
      description: 'To\'lov usullari bo\'yicha batafsil tahlil',
      formats: ['excel', 'pdf'],
    },
  ];

  const runExport = async (
    exportFn: () => Promise<void>,
    optionName: string,
    format: 'excel' | 'pdf' | 'csv',
    key: string
  ) => {
    // Prevent double-click
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportingKey(key);
      console.log('export start', format, optionName);

      await exportFn();

      console.log('export done');
      toast({
        title: 'Muvaffaqiyatli',
        description: `${optionName} ${format.toUpperCase()} formatida eksport qilindi`,
      });
    } catch (error) {
      console.error('export error', error);
      const errorMessage = error instanceof Error ? error.message : 'Eksportda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
      setExportingKey(null);
    }
  };

  const handleExport = (option: ExportOption, format: 'excel' | 'pdf' | 'csv') => {
    const key = `${option.name}_${format}`;
    
    // Map option names to export functions
    const exportMap: Record<string, () => Promise<void>> = {
      'Kunlik sotuv hisobotlari': () => exportDailySales(format),
      'Mahsulotlar bo\'yicha sotuvlar': () => exportProductSales(format),
      'Mijozlar bo\'yicha sotuvlar': () => exportCustomerSales(format),
      'Ombor qoldiq hisobotlari': () => exportStockLevels(format),
      'Tovar harakatlari hisobotlari': () => exportInventoryMovements(format),
      'Baholash hisobotlari': () => exportValuation(format),
      'Xarid buyurtmalari umumiy hisobot': () => exportPurchaseOrderSummary(format),
      'Yetkazib beruvchilar samaradorligi': () => exportSupplierPerformance(format),
      'Kassir faoliyati': () => exportCashierPerformance(format),
      'Tizimga kirishlar jurnali': () => exportLoginActivity(format),
      'Foyda va zarar hisobotlari': () => exportProfitLoss(format),
      'To\'lov usullari bo\'yicha tahlil': () => exportPaymentMethods(format),
    };

    const exportFn = exportMap[option.name];
    if (!exportFn) {
      toast({
        title: 'Xatolik',
        description: 'Bu hisobot uchun eksport funksiyasi topilmadi',
        variant: 'destructive',
      });
      return;
    }

    runExport(exportFn, option.name, format, key);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Eksport boshqaruvchisi</h1>
            <p className="text-muted-foreground">
              Barcha hisobotlarni Excel, PDF yoki CSV formatida eksport qilish
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {exportOptions.map((option, index) => (
          <Card key={index}>
            <CardHeader>
              <CardTitle className="text-lg">{option.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{option.description}</p>
              <div className="flex gap-2">
                {option.formats.includes('excel') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(option, 'excel')}
                    disabled={isExporting}
                  >
                    {isExporting && exportingKey === `${option.name}_excel` ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                        Yuklanmoqda...
                      </>
                    ) : (
                      <>
                        <FileDown className="h-4 w-4 mr-2" />
                        Excel
                      </>
                    )}
                  </Button>
                )}
                {option.formats.includes('pdf') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(option, 'pdf')}
                    disabled={isExporting}
                  >
                    {isExporting && exportingKey === `${option.name}_pdf` ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                        Yuklanmoqda...
                      </>
                    ) : (
                      <>
                        <FileDown className="h-4 w-4 mr-2" />
                        PDF
                      </>
                    )}
                  </Button>
                )}
                {option.formats.includes('csv') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(option, 'csv')}
                    disabled={isExporting}
                  >
                    {isExporting && exportingKey === `${option.name}_csv` ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                        Yuklanmoqda...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        CSV
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}





