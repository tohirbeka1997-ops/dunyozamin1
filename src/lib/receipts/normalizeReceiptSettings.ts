import type { ReceiptSettings } from '@/types/database';

export const RECEIPT_SETTINGS_DEFAULTS: ReceiptSettings = {
  auto_print: true,
  header_text: '',
  middle_text: '',
  footer_text: '',
  show_logo: true,
  show_cashier: true,
  show_customer: true,
  show_sku: true,
  paper_size: '78mm',
};

const VALID_PAPER = new Set<ReceiptSettings['paper_size']>(['58mm', '78mm', '80mm']);

const toBool = (v: unknown, fb: boolean): boolean => {
  if (v === undefined || v === null || v === '') return fb;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fb;
};

const safeText = (v: unknown, fb: string): string => {
  if (v === undefined || v === null) return fb;
  return String(v).slice(0, 500);
};

export function normalizeReceiptSettings(
  raw: Record<string, unknown> | ReceiptSettings | null | undefined,
): ReceiptSettings {
  const r = raw || {};
  const paper_size = VALID_PAPER.has(r.paper_size as ReceiptSettings['paper_size'])
    ? (r.paper_size as ReceiptSettings['paper_size'])
    : RECEIPT_SETTINGS_DEFAULTS.paper_size;
  return {
    auto_print: toBool(r.auto_print, RECEIPT_SETTINGS_DEFAULTS.auto_print),
    header_text: safeText(r.header_text, RECEIPT_SETTINGS_DEFAULTS.header_text),
    middle_text: safeText(r.middle_text, RECEIPT_SETTINGS_DEFAULTS.middle_text),
    footer_text: safeText(r.footer_text, RECEIPT_SETTINGS_DEFAULTS.footer_text),
    show_logo: toBool(r.show_logo, RECEIPT_SETTINGS_DEFAULTS.show_logo),
    show_cashier: toBool(r.show_cashier, RECEIPT_SETTINGS_DEFAULTS.show_cashier),
    show_customer: toBool(r.show_customer, RECEIPT_SETTINGS_DEFAULTS.show_customer),
    show_sku: toBool(r.show_sku, RECEIPT_SETTINGS_DEFAULTS.show_sku),
    paper_size,
  };
}

/** Default ON when setting is missing (fresh DB has no receipt.auto_print row). */
export function shouldAutoPrintReceipt(settings: ReceiptSettings | null | undefined): boolean {
  if (!settings) return true;
  return settings.auto_print !== false;
}
