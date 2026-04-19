import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scale, Tag, FileText, Printer } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

function ServiceCard({
  title,
  description,
  status,
  icon,
  onOpen,
}: {
  title: string;
  description: string;
  status: 'active' | 'soon';
  icon: React.ReactNode;
  onOpen?: () => void;
}) {
  const isActive = status === 'active';
  return (
    <Card className={isActive ? '' : 'opacity-80'}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              {icon}
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
          </div>
          {isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Tez orada</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-end">
        <Button onClick={onOpen} disabled={!isActive}>
          Open
        </Button>
      </CardContent>
    </Card>
  );
}

export default function BarcodeCenterPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Barcode Center</h1>
        <p className="text-muted-foreground mt-2">
          Shtrix-kod xizmatlari: Product / Scale / Internal / Marketing.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ServiceCard
          title="Barcode Designer — Pro Mode"
          description="Erkin layout: drag, resize, font, align, show/hide."
          status="active"
          icon={<Tag className="h-5 w-5 text-primary" />}
          onOpen={() => navigate('/tools/barcode-designer')}
        />
        {isAdmin && (
          <ServiceCard
            title="Check (Receipt) Designer — Pro"
            description="Chek bloklari, tartibi va print formatini boshqarish."
            status="active"
            icon={<FileText className="h-5 w-5 text-primary" />}
            onOpen={() => navigate('/barcodes/receipt-designer')}
          />
        )}
        <ServiceCard
          title="Scale Barcode Service"
          description="Kiloli mahsulotlar (tarozi) uchun barcode logika va label."
          status="active"
          icon={<Scale className="h-5 w-5 text-primary" />}
          onOpen={() => navigate('/barcodes/scale')}
        />
        <ServiceCard
          title="Printer Settings"
          description="Printerga mos format va sozlamalar (tez orada)."
          status="soon"
          icon={<Printer className="h-5 w-5 text-primary" />}
        />
      </div>
    </div>
  );
}

