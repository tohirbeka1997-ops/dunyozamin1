/**
 * Barcode utilities
 *
 * We generate internal EAN-13 codes for products that arrive without barcodes.
 * Scanner devices can read these numeric codes reliably, and the app can search by exact match.
 */

export function ean13ChecksumDigit(base12: string): number {
  const digits = String(base12 || '').replace(/[^\d]/g, '');
  if (digits.length !== 12) {
    throw new Error('EAN-13 base must be exactly 12 digits');
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits[i]);
    // Positions are 1-based in the spec: odd positions weight 1, even positions weight 3.
    const weight = (i % 2 === 0) ? 1 : 3;
    sum += d * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function makeEan13(base12: string): string {
  const clean = String(base12 || '').replace(/[^\d]/g, '');
  const base = clean.slice(0, 12);
  if (base.length !== 12) {
    throw new Error('EAN-13 base must be 12 digits');
  }
  const check = ean13ChecksumDigit(base);
  return `${base}${check}`;
}

function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

export function suggestEan13FromSku(sku: string): string | null {
  const skuDigits = String(sku || '').replace(/[^\d]/g, '');
  if (!skuDigits) return null;
  // Internal prefix "30" + last/padded 10 digits of note/SKU => 12 digits
  const body10 = skuDigits.padStart(10, '0').slice(-10);
  const base12 = `30${body10}`;
  return makeEan13(base12);
}

export function generateUniqueEan13(opts: { sku?: string; isUsed: (ean13: string) => boolean }): string {
  const skuCandidate = opts.sku ? suggestEan13FromSku(opts.sku) : null;
  if (skuCandidate && !opts.isUsed(skuCandidate)) return skuCandidate;

  // Fallback: random internal EAN-13 with prefix "30"
  for (let i = 0; i < 200; i++) {
    const base12 = `30${randomDigits(10)}`;
    const code = makeEan13(base12);
    if (!opts.isUsed(code)) return code;
  }
  throw new Error('Could not generate a unique barcode (too many collisions)');
}

// ----------------------------------------------------------------------------
// Scale / variable-weight barcode parsing (EAN-13)
// ----------------------------------------------------------------------------

export type ParsedScaleBarcode = {
  /** Full scanned EAN-13 */
  barcode: string;
  /** PLU or item code encoded by the scale (usually 5 digits after the prefix) */
  plu: string;
  /** Weight in kilograms (usually encoded as grams with 3 decimals) */
  weightKg: number;
  /** Prefix (first 2 digits), e.g. "20" */
  prefix: string;
};

/**
 * Parses common scale EAN-13 format:
 *   PP + (PLU 5 digits) + (WEIGHT 5 digits) + (CHECK 1 digit)
 *
 * Example:
 *   2000009002652
 *   prefix=20, plu=00009, weight=00265 => 0.265kg
 */
export function parseScaleEan13(barcodeRaw: string, opts?: { weightDivisor?: number; allowedPrefixes?: string[] }): ParsedScaleBarcode | null {
  const barcode = String(barcodeRaw || '').replace(/[^\d]/g, '');
  if (barcode.length !== 13) return null;

  const base12 = barcode.slice(0, 12);
  const check = Number(barcode[12]);
  try {
    const expected = ean13ChecksumDigit(base12);
    if (Number.isFinite(check) && expected !== check) {
      // If checksum fails, treat as not a scale barcode (avoid false positives)
      return null;
    }
  } catch {
    return null;
  }

  const prefix = barcode.slice(0, 2);
  const allowed = opts?.allowedPrefixes || ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];
  if (!allowed.includes(prefix)) return null;

  const m = barcode.match(/^(\d{2})(\d{5})(\d{5})\d$/);
  if (!m) return null;

  const plu = m[2];
  const weightRaw = Number.parseInt(m[3], 10);
  if (!Number.isFinite(weightRaw) || weightRaw <= 0) return null;

  const divisor = Number.isFinite(Number(opts?.weightDivisor)) ? Number(opts?.weightDivisor) : 1000; // grams => kg
  const weightKg = weightRaw / divisor;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  return { barcode, prefix, plu, weightKg };
}





















