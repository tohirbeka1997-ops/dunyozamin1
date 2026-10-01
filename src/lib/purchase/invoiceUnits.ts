/** Keep in sync with electron/lib/invoicePurchase.cjs canonicalUnit / unitsEquivalent. */

const UNIT_ALIASES: Record<string, string> = {
  dona: 'pcs',
  pcs: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  sht: 'pcs',
  shtuka: 'pcs',
  'шт': 'pcs',
  'штука': 'pcs',
  metr: 'm',
  meter: 'm',
  metre: 'm',
  m: 'm',
  kg: 'kg',
  kilogramm: 'kg',
  kilogram: 'kg',
  kilo: 'kg',
  quti: 'box',
  box: 'box',
  korobka: 'box',
  korob: 'box',
  pachka: 'pack',
  pack: 'pack',
  upak: 'pack',
  upakovka: 'pack',
  g: 'g',
  gramm: 'g',
  gram: 'g',
  gr: 'g',
  l: 'L',
  litr: 'L',
  liter: 'L',
  litre: 'L',
  ml: 'mL',
  millilitr: 'mL',
  milliliter: 'mL',
};

export function canonicalInvoiceUnit(raw?: string | null): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, '');
  if (key === 'l') return 'L';
  if (key === 'ml') return 'mL';
  return UNIT_ALIASES[key] || key;
}

export function invoiceUnitsEquivalent(a?: string | null, b?: string | null): boolean {
  const left = canonicalInvoiceUnit(a);
  const right = canonicalInvoiceUnit(b);
  if (!left || !right) return false;
  return left === right;
}

const LABELS: Record<string, string> = {
  pcs: 'dona',
  kg: 'kg',
  g: 'g',
  m: 'metr',
  box: 'quti',
  pack: 'pachka',
  L: 'litr',
  mL: 'ml',
};

export function invoiceUnitLabel(raw?: string | null): string {
  const canonical = canonicalInvoiceUnit(raw);
  if (!canonical) return '';
  return LABELS[canonical] || String(raw || canonical);
}
