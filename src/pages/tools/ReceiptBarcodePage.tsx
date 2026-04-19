import { useState, useEffect, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { getOrders, searchProducts, getSettingsByCategory } from '@/db/api';
import type { OrderWithDetails, Product, CompanySettings, ReceiptSettings } from '@/types/database';
import { format } from 'date-fns';
import { Check, ChevronsUpDown, FileText, QrCode, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReceiptPrintView from '@/components/print/ReceiptPrintView';
import BarcodeLabel from '@/components/print/BarcodeLabel';
import { formatMoneyUZS } from '@/lib/format';
import { makeEan13, parseScaleEan13, suggestEan13FromSku } from '@/lib/barcode';

export default function ReceiptBarcodePage() {
  const { toast } = useToast();
  
  // Receipt Generator State
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);
  const [orderSearchValue, setOrderSearchValue] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  
  // Barcode Generator State
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchValue, setProductSearchValue] = useState('');
  const [barcodeType, setBarcodeType] = useState<'CODE128' | 'EAN13' | 'QR'>('CODE128');
  const [barcodeValue, setBarcodeValue] = useState('');
  const [copies, setCopies] = useState(1);
  const barcodeRef = useRef<HTMLDivElement>(null);

  // Barcode Tools (EAN-13 / Scale parse)
  const [ean12Base, setEan12Base] = useState('');
  const [ean13Result, setEan13Result] = useState<string | null>(null);
  const [eanSku, setEanSku] = useState('');
  const [eanFromSkuResult, setEanFromSkuResult] = useState<string | null>(null);
  const [scaleBarcodeRaw, setScaleBarcodeRaw] = useState('');
  const [scaleParsed, setScaleParsed] = useState<ReturnType<typeof parseScaleEan13> | null>(null);


  // Print handlers
  const handleReceiptPrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: `Chek-${selectedOrder?.order_number || 'test'}`,
  });

  const handleBarcodePrint = useReactToPrint({
    content: () => barcodeRef.current,
    documentTitle: `Shtrix-kod-${barcodeValue || 'test'}`,
  });

  // Load orders and settings
  useEffect(() => {
    const loadData = async () => {
      try {
        const [ordersData, companyData, receiptData] = await Promise.all([
          getOrders(100),
          getSettingsByCategory('company'),
          getSettingsByCategory('receipt'),
        ]);
        setOrders(ordersData);
        setCompanySettings(companyData as CompanySettings);
        setReceiptSettings(receiptData as ReceiptSettings);
      } catch (error) {
        toast({
          title: 'Xatolik',
          description: 'Ma\'lumotlarni yuklab bo\'lmadi',
          variant: 'destructive',
        });
      }
    };
    loadData();
  }, [toast]);

  // Search products
  useEffect(() => {
    const searchProductsHandler = async () => {
      if (productSearchValue.length < 2) {
        setProducts([]);
        return;
      }
      try {
        const results = await searchProducts(productSearchValue);
        setProducts(results);
      } catch (error) {
        console.error('Error searching products:', error);
      }
    };

    const timeoutId = setTimeout(searchProductsHandler, 300);
    return () => clearTimeout(timeoutId);
  }, [productSearchValue]);

  // When product is selected, prefill barcode value
  useEffect(() => {
    if (selectedProduct) {
      setBarcodeValue(selectedProduct.barcode || selectedProduct.sku || '');
    }
  }, [selectedProduct]);

  // Live parse for scale barcodes
  useEffect(() => {
    const raw = String(scaleBarcodeRaw || '').trim();
    if (!raw) {
      setScaleParsed(null);
      return;
    }
    setScaleParsed(parseScaleEan13(raw));
  }, [scaleBarcodeRaw]);

  // Filter orders for search
  const filteredOrders = orders.filter((order) => {
    const searchLower = orderSearchValue.toLowerCase();
    return (
      order.order_number.toLowerCase().includes(searchLower) ||
      order.customer?.full_name?.toLowerCase().includes(searchLower) ||
      order.customer?.phone?.toLowerCase().includes(searchLower)
    );
  });

  const formatOrderOption = (order: OrderWithDetails) => {
    const date = format(new Date(order.created_at), 'dd/MM/yyyy HH:mm');
    const customer = order.customer?.full_name || 'Walk-in Customer';
    return `${order.order_number} – ${formatMoneyUZS(order.total_amount)} – ${customer} – ${date}`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Cheklar va shtrix-kodlar</h1>
        <p className="text-muted-foreground">
          Chek yaratish va shtrix-kod generatsiya qilish vositalari
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Receipt Generator Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Chek yaratish
            </CardTitle>
            <CardDescription>
              Buyurtmalar bo'yicha test chek chiqarish va shablonni ko'rish.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Order Select */}
            <div className="space-y-2">
              <Label>Buyurtma</Label>
              <Popover open={orderSearchOpen} onOpenChange={setOrderSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={orderSearchOpen}
                    className="w-full justify-between"
                  >
                    {selectedOrder
                      ? formatOrderOption(selectedOrder)
                      : 'Buyurtmani tanlang'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
                  <Command>
                    <CommandInput
                      placeholder="Buyurtma qidirish..."
                      value={orderSearchValue}
                      onValueChange={setOrderSearchValue}
                    />
                    <CommandList>
                      <CommandEmpty>Buyurtma topilmadi</CommandEmpty>
                      <CommandGroup>
                        {filteredOrders.slice(0, 20).map((order) => (
                          <CommandItem
                            key={order.id}
                            value={order.order_number}
                            onSelect={() => {
                              setSelectedOrder(order);
                              setOrderSearchOpen(false);
                              setOrderSearchValue('');
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedOrder?.id === order.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {formatOrderOption(order)}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="receipt-note">Izoh (ixtiyoriy)</Label>
              <Textarea
                id="receipt-note"
                placeholder="Chekka qo'shimcha izoh yozing"
                value={receiptNote}
                onChange={(e) => setReceiptNote(e.target.value)}
                rows={3}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleReceiptPrint}
                disabled={!selectedOrder}
                className="flex-1"
              >
                <FileText className="h-4 w-4 mr-2" />
                Test uchun chek chiqarish
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  // TODO: Implement PDF export
                  toast({
                    title: 'Kutilmoqda',
                    description: 'PDF eksport qilish funksiyasi tez orada qo\'shiladi',
                  });
                }}
                disabled={!selectedOrder}
              >
                PDF sifatida saqlash
              </Button>
            </div>

            {/* Receipt Preview */}
            <div className="border-t pt-4">
              <div className="mb-4 text-sm font-medium">Chek ko'rinishi:</div>
              {selectedOrder ? (
                <div ref={receiptRef} className="print:bg-white">
                  <ReceiptPrintView
                    order={selectedOrder}
                    company={companySettings || undefined}
                    settings={receiptSettings || undefined}
                  />
                </div>
              ) : (
                <div className="w-full max-w-xs mx-auto p-8 bg-gray-50 border border-gray-300 rounded text-center text-gray-500">
                  <FileText className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                  <p>Buyurtma tanlang</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Barcode Generator Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Shtrix-kod yaratish
            </CardTitle>
            <CardDescription>
              Mahsulotlar uchun shtrix-kod yoki QR-kod yaratish va chop etish.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Product Select */}
            <div className="space-y-2">
              <Label>Mahsulot</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={productSearchOpen}
                    className="w-full justify-between"
                  >
                    {selectedProduct
                      ? selectedProduct.name
                      : 'Mahsulotni tanlang'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
                  <Command>
                    <CommandInput
                      placeholder="Mahsulot qidirish..."
                      value={productSearchValue}
                      onValueChange={setProductSearchValue}
                    />
                    <CommandList>
                      <CommandEmpty>Mahsulot topilmadi</CommandEmpty>
                      <CommandGroup>
                        {products.slice(0, 20).map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.name}
                            onSelect={() => {
                              setSelectedProduct(product);
                              setProductSearchOpen(false);
                              setProductSearchValue('');
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedProduct?.id === product.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {product.name} ({product.sku})
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Barcode Type */}
            <div className="space-y-2">
              <Label htmlFor="barcode-type">Shtrix-kod turi</Label>
              <Select value={barcodeType} onValueChange={(value: 'CODE128' | 'EAN13' | 'QR') => setBarcodeType(value)}>
                <SelectTrigger id="barcode-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CODE128">CODE128</SelectItem>
                  <SelectItem value="EAN13">EAN13</SelectItem>
                  <SelectItem value="QR">QR</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Layout mode */}
            {/* Barcode design removed by request */}

            {/* Barcode Value */}
            <div className="space-y-2">
              <Label htmlFor="barcode-value">Shtrix-kod qiymati</Label>
              <Input
                id="barcode-value"
                placeholder="Masalan, 4780001234567"
                value={barcodeValue}
                onChange={(e) => setBarcodeValue(e.target.value)}
              />
            </div>

            {/* Copies */}
            <div className="space-y-2">
              <Label htmlFor="copies">Nusxa soni</Label>
              <Input
                id="copies"
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 1 && val <= 100) {
                    setCopies(val);
                  }
                }}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  // Force re-render by updating state
                  setBarcodeValue((prev) => prev + '');
                  setTimeout(() => setBarcodeValue((prev) => prev.slice(0, -1) || prev), 0);
                }}
                variant="outline"
                className="flex-1"
              >
                Shtrix-kodni yangilash
              </Button>
              <Button
                onClick={handleBarcodePrint}
                disabled={!barcodeValue.trim()}
                className="flex-1"
              >
                Yorliqni chop etish
              </Button>
            </div>

            {/* Barcode Preview */}
            <div className="border-t pt-4">
              <div className="mb-4 text-sm font-medium">Yorliq ko'rinishi:</div>
              <div ref={barcodeRef} className="print:bg-white">
                <BarcodeLabel
                  product={
                    selectedProduct
                      ? {
                          name: selectedProduct.name,
                          sku: selectedProduct.sku,
                          barcode: selectedProduct.barcode || undefined,
                          sale_price: Number(selectedProduct.sale_price),
                        }
                      : undefined
                  }
                  type={barcodeType}
                  value={barcodeValue}
                  copies={copies}
                  showPrice={false}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barcode Tools (shows src/lib/barcode.ts capabilities) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Barcode Tools (EAN-13 / Taroz)
          </CardTitle>
          <CardDescription>
            EAN-13 hisoblash va taroz (scale) shtrix-kodini parse qilish.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ean12">EAN-13 (12 raqam + checksum)</Label>
              <div className="flex gap-2">
                <Input
                  id="ean12"
                  value={ean12Base}
                  onChange={(e) => setEan12Base(e.target.value)}
                  placeholder="12 raqam (masalan: 200000900265)"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    try {
                      const code = makeEan13(ean12Base);
                      setEan13Result(code);
                      setBarcodeType('EAN13');
                      setBarcodeValue(code);
                      toast({ title: 'Tayyor', description: `EAN-13: ${code}` });
                    } catch (e: any) {
                      setEan13Result(null);
                      toast({
                        title: 'Xatolik',
                        description: e?.message || 'EAN-13 hisoblab bo‘lmadi',
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  Hisoblash
                </Button>
              </div>
              {ean13Result ? (
                <div className="text-sm">
                  Natija: <span className="font-mono">{ean13Result}</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ean-sku">EAN-13 (SKU’dan taklif)</Label>
              <div className="flex gap-2">
                <Input
                  id="ean-sku"
                  value={eanSku}
                  onChange={(e) => setEanSku(e.target.value)}
                  placeholder="SKU (masalan: SKU-20260111-001)"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const suggested = suggestEan13FromSku(eanSku);
                    setEanFromSkuResult(suggested);
                    if (suggested) {
                      setBarcodeType('EAN13');
                      setBarcodeValue(suggested);
                      toast({ title: 'Tayyor', description: `EAN-13: ${suggested}` });
                    } else {
                      toast({
                        title: 'Topilmadi',
                        description: 'SKU ichida raqam yo‘q (EAN-13 taklif qilinmadi)',
                      });
                    }
                  }}
                >
                  Taklif
                </Button>
              </div>
              {eanFromSkuResult ? (
                <div className="text-sm">
                  Natija: <span className="font-mono">{eanFromSkuResult}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scale-barcode">Taroz shtrix-kodi (EAN-13) parse</Label>
              <Input
                id="scale-barcode"
                value={scaleBarcodeRaw}
                onChange={(e) => setScaleBarcodeRaw(e.target.value)}
                placeholder="Masalan: 2000009002652"
                className="font-mono"
              />
              {scaleParsed ? (
                <div className="text-sm space-y-1">
                  <div>
                    Barcode: <span className="font-mono">{scaleParsed.barcode}</span>
                  </div>
                  <div>
                    Prefix: <span className="font-mono">{scaleParsed.prefix}</span>
                  </div>
                  <div>
                    PLU: <span className="font-mono">{scaleParsed.plu}</span>
                  </div>
                  <div>
                    Weight: <span className="font-mono">{scaleParsed.weightKg.toFixed(3)}</span> kg
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Mos taroz formati topilmadi (yoki checksum noto‘g‘ri).
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

