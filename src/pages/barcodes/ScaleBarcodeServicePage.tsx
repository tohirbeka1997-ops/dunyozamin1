import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { requireElectron } from '@/utils/electron';
import { exportScaleCsv3, exportScaleLegacyTxt, exportScaleSharqTxt } from '@/db/api';
import { todayYMD } from '@/lib/datetime';

type ExportFormat = 'sharq_txt' | 'csv3' | 'legacy_txt';
type TextEncoding = 'utf8' | 'win1251';

export default function ScaleBarcodeServicePage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Default to legacy TXT because many deployments import this exact format in scale software.
  const [format, setFormat] = useState<ExportFormat>('legacy_txt');
  const [encoding, setEncoding] = useState<TextEncoding>('win1251');
  const [department, setDepartment] = useState('7');
  // Legacy scale import files commonly use prefix "20"
  const [prefix, setPrefix] = useState('20');
  const [group, setGroup] = useState('19');
  const [brand, setBrand] = useState('@SHARQUZB');
  const [saving, setSaving] = useState(false);

  const fileName = useMemo(() => {
    const d = todayYMD();
    if (format === 'sharq_txt') return `scale-sharq-${d}.txt`;
    if (format === 'legacy_txt') return `scale-legacy-${d}.txt`;
    return `scale-${d}.csv`;
  }, [format]);

  const onExport = async () => {
    setSaving(true);
    try {
      const api = requireElectron();

      const result =
        format === 'sharq_txt'
          ? await exportScaleSharqTxt({
              department: Number(department || 0) || 7,
              prefix: Number(prefix || 0) || 29,
              group: Number(group || 0) || 19,
              brand: String(brand || '@SHARQUZB').trim() || '@SHARQUZB',
            })
          : format === 'legacy_txt'
            ? await exportScaleLegacyTxt({
                department: Number(department || 0) || 7,
                prefix: Number(prefix || 0) || 20,
              })
            : await exportScaleCsv3();

      if (!result?.content) {
        toast({
          title: 'Eksport bo‘sh',
          description:
            'Kiloli (kg) mahsulot topilmadi yoki SKU’dan PLU (5 raqam) ajratib bo‘lmadi.',
          variant: 'destructive',
        });
        return;
      }

      await api.files.saveTextFile({
        defaultFileName: fileName,
        content: result.content,
        // Many scale import utilities expect ANSI/Windows-1251 (esp. Cyrillic).
        encoding,
      });

      toast({
        title: 'Tayyor',
        description: `Export: ${result.stats.exported} ta (total: ${result.stats.total})`,
      });
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Eksport qilib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const onExportBoth = async () => {
    setSaving(true);
    try {
      const api = requireElectron();
      const d = todayYMD();

      // 1) CSV (PLU,NAME,PRICE)
      const csv = await exportScaleCsv3();
      if (!csv?.content) {
        toast({
          title: 'CSV eksport bo‘sh',
          description: 'Kiloli (kg) mahsulot topilmadi yoki SKU’dan PLU ajratib bo‘lmadi.',
          variant: 'destructive',
        });
        return;
      }
      await api.files.saveTextFile({
        defaultFileName: `scale-${d}.csv`,
        content: csv.content,
        encoding,
      });

      // 2) Legacy TXT (Name;PLU;000PLU;Price;Dept;4;0;Prefix)
      const legacy = await exportScaleLegacyTxt({
        department: Number(department || 0) || 7,
        prefix: Number(prefix || 0) || 20,
      });
      if (!legacy?.content) {
        toast({
          title: 'Legacy TXT eksport bo‘sh',
          description: 'Kiloli (kg) mahsulot topilmadi yoki SKU’dan PLU ajratib bo‘lmadi.',
          variant: 'destructive',
        });
        return;
      }
      await api.files.saveTextFile({
        defaultFileName: `scale-legacy-${d}.txt`,
        content: legacy.content,
        encoding,
      });

      toast({
        title: 'Tayyor',
        description: `CSV: ${csv.stats.exported} ta, Legacy TXT: ${legacy.stats.exported} ta`,
      });
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Eksport qilib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Scale Barcode Service</h1>
          <p className="text-muted-foreground mt-2">
            Kiloli mahsulotlar uchun tarozi eksport formatlari.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/barcodes')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Orqaga
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Formatni tanlang va faylni saqlang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v: ExportFormat) => setFormat(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv3">CSV: PLU,NAME,PRICE</SelectItem>
                <SelectItem value="sharq_txt">TXT: Name KG #...;...;Prefix</SelectItem>
                <SelectItem value="legacy_txt">TXT (Legacy): Name;PLU;000PLU;Price;Dept;4;0;Prefix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Encoding</Label>
            <Select value={encoding} onValueChange={(v: TextEncoding) => setEncoding(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="win1251">ANSI (Windows-1251)</SelectItem>
                <SelectItem value="utf8">UTF-8</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Ko‘p tarozi import dasturlari Cyrillic uchun Windows-1251 talab qiladi.
            </div>
          </div>

          {format === 'sharq_txt' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Brand prefix</Label>
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="@SHARQUZB" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="7" />
              </div>
              <div className="space-y-2">
                <Label>Prefix</Label>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="29" />
              </div>
              <div className="space-y-2">
                <Label>Group</Label>
                <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="19" />
              </div>
            </div>
          )}

          {format === 'legacy_txt' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="7" />
              </div>
              <div className="space-y-2">
                <Label>Prefix</Label>
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="20" />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onExportBoth} disabled={saving}>
                <Download className="h-4 w-4 mr-2" />
                {saving ? 'Saqlanmoqda...' : '2 tasini export'}
              </Button>
              <Button onClick={onExport} disabled={saving}>
                <Download className="h-4 w-4 mr-2" />
                {saving ? 'Saqlanmoqda...' : 'Export & Save'}
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Eslatma: PLU SKU’dan olinadi (oxirgi 5 raqam). Unit `kg` bo‘lgan mahsulotlargina eksport qilinadi.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

