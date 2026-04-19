import type { ReceiptTemplate } from '@/types/database';

const nowIso = () => new Date().toISOString();

const makeId = (suffix: string) => `rtpl-${suffix}-${Date.now().toString(36)}`;

export const defaultReceiptTemplates = (): ReceiptTemplate[] => {
  const base = {
    paperWidth: 80 as const,
    sectionsOrder: ['header', 'orderInfo', 'products', 'totals', 'payments', 'footer', 'barcode'] as const,
  };

  return [
    {
      id: makeId('basic'),
      name: 'Oddiy chek',
      paperWidth: base.paperWidth,
      sectionsOrder: [...base.sectionsOrder],
      updatedAt: nowIso(),
      sections: {
        header: {
          enabled: true,
          align: 'center',
          fontSize: 14,
          bold: true,
          showStoreName: true,
          showBranchName: false,
          showAddress: true,
          showPhone: true,
          showLogo: false,
          branchName: '',
        },
        orderInfo: {
          enabled: true,
          layout: 'two-column',
          dateFormat: 'dd/MM/yyyy HH:mm',
          showCashier: true,
          showCustomer: true,
        },
        products: {
          enabled: true,
          showSku: true,
          wrapMode: 'wrap',
          lineSpacing: 1,
        },
        totals: {
          enabled: true,
          showSubtotal: true,
          showDiscount: true,
          showTax: true,
          boldTotal: true,
          largerTotal: true,
        },
        payments: {
          enabled: true,
        },
        footer: {
          enabled: true,
          text: 'Xaridingiz uchun rahmat!',
          align: 'center',
          fontSize: 12,
          bold: false,
        },
        barcode: {
          enabled: false,
          type: 'order_id',
          align: 'center',
          size: 96,
        },
      },
    },
    {
      id: makeId('minimal'),
      name: 'Minimal',
      paperWidth: 80,
      sectionsOrder: ['header', 'products', 'totals', 'footer', 'barcode'],
      updatedAt: nowIso(),
      sections: {
        header: {
          enabled: true,
          align: 'left',
          fontSize: 13,
          bold: true,
          showStoreName: true,
          showBranchName: false,
          showAddress: false,
          showPhone: false,
          showLogo: false,
          branchName: '',
        },
        orderInfo: {
          enabled: false,
          layout: 'single',
          dateFormat: 'dd/MM/yyyy HH:mm',
          showCashier: false,
          showCustomer: false,
        },
        products: {
          enabled: true,
          showSku: false,
          wrapMode: 'wrap',
          lineSpacing: 1,
        },
        totals: {
          enabled: true,
          showSubtotal: true,
          showDiscount: false,
          showTax: false,
          boldTotal: true,
          largerTotal: false,
        },
        payments: {
          enabled: false,
        },
        footer: {
          enabled: true,
          text: 'Rahmat!',
          align: 'left',
          fontSize: 12,
          bold: false,
        },
        barcode: {
          enabled: false,
          type: 'order_id',
          align: 'left',
          size: 96,
        },
      },
    },
    {
      id: makeId('logo-qr'),
      name: 'Logo + QR',
      paperWidth: 80,
      sectionsOrder: ['header', 'orderInfo', 'products', 'totals', 'payments', 'footer', 'barcode'],
      updatedAt: nowIso(),
      sections: {
        header: {
          enabled: true,
          align: 'center',
          fontSize: 14,
          bold: true,
          showStoreName: true,
          showBranchName: false,
          showAddress: true,
          showPhone: true,
          showLogo: true,
          branchName: '',
        },
        orderInfo: {
          enabled: true,
          layout: 'single',
          dateFormat: 'dd/MM/yyyy HH:mm',
          showCashier: true,
          showCustomer: true,
        },
        products: {
          enabled: true,
          showSku: true,
          wrapMode: 'wrap',
          lineSpacing: 1,
        },
        totals: {
          enabled: true,
          showSubtotal: true,
          showDiscount: true,
          showTax: true,
          boldTotal: true,
          largerTotal: true,
        },
        payments: {
          enabled: true,
        },
        footer: {
          enabled: true,
          text: 'Chekni QR orqali tekshiring',
          align: 'center',
          fontSize: 12,
          bold: false,
        },
        barcode: {
          enabled: true,
          type: 'qr',
          align: 'center',
          size: 120,
        },
      },
    },
  ];
};
