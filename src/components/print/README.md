# Print Components

Professional print-ready components for receipts and barcode labels.

## Components

### ReceiptPrintView
Thermal receipt printer component (80mm width) for POS systems.

**Features:**
- Company header with logo support
- Order information (number, date, cashier, customer)
- Product table with thermal-style layout
- Totals section with discounts
- Payment method display
- Custom header/footer text support
- Print-optimized CSS

**Usage:**
```tsx
<ReceiptPrintView
  order={orderWithDetails}
  company={companySettings}
  settings={receiptSettings}
/>
```

### BarcodeLabel
Barcode/QR code label component for product stickers.

**Features:**
- Supports CODE128, EAN13, and QR code types
- Multiple copies printing
- Product name and SKU display
- Optional price display
- Print-optimized grid layout

**Usage:**
```tsx
<BarcodeLabel
  product={{ name: 'Product', sku: 'SKU123', sale_price: 10000 }}
  type="CODE128"
  value="1234567890123"
  copies={4}
  showPrice={false}
/>
```

## Installing Barcode Libraries (Optional)

For full barcode rendering support, install:

```bash
npm install react-barcode
npm install @types/react-barcode --save-dev
```

Then update `BarcodeLabel.tsx`:

```tsx
import Barcode from 'react-barcode';

// In BarcodeVisual function:
if (type === 'QR') {
  // Keep QRCodeDataUrl as is
}
// Replace CODE128/EAN13 placeholder with:
return <Barcode value={value} format={type} width={2} height={50} displayValue={true} />;
```

## Print Styles

Both components include print-optimized CSS that:
- Sets proper page margins for thermal printers (80mm)
- Prevents page breaks inside labels/receipts
- Uses black/white colors for thermal printing
- Sets appropriate paper sizes






