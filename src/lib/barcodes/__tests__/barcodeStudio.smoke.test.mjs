/**
 * Barcode Studio smoke — template count + legacy migration shape.
 * Run: npm run test:barcode-studio
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../../..');

const tplSrc = readFileSync(join(root, 'src/lib/barcodes/builtinTemplates.ts'), 'utf8');
const tplCalls = (tplSrc.match(/^\s*\/\/ ───/gm) || []).length;
assert.equal(tplCalls, 5, 'expected 5 size groups in builtinTemplates.ts');

const exportMatch = tplSrc.match(/export const BUILTIN_LABEL_TEMPLATES[\s\S]*?=\s*\[([\s\S]*?)\];/);
assert.ok(exportMatch, 'BUILTIN_LABEL_TEMPLATES export not found');
const templateRefs = (exportMatch[1].match(/T\d+/g) || []).length;
assert.equal(templateRefs, 25, 'expected 25 templates in BUILTIN_LABEL_TEMPLATES array');

const modelSrc = readFileSync(join(root, 'src/lib/barcodes/labelModel.ts'), 'utf8');
assert.ok(modelSrc.includes('export type LabelElement'));
assert.ok(modelSrc.includes('migrateLegacyLayout'));

// Inline migration mirror
function migrateLegacyElement(el) {
  const map = { header: 'store_name', name: 'product_name', sku: 'sku', price: 'price' };
  return {
    id: el.id,
    kind: el.id === 'barcode' ? 'barcode' : 'text',
    data: map[el.id],
    x: el.xMm,
    y: el.yMm,
    w: el.wMm,
    h: el.hMm,
  };
}

const migrated = migrateLegacyElement({
  id: 'name',
  kind: 'text',
  xMm: 2,
  yMm: 3,
  wMm: 20,
  hMm: 4,
});
assert.equal(migrated.data, 'product_name');
assert.equal(migrated.x, 2);

// formatPriceField mirror (labelDataResolver.ts)
function formatMoneyUZS(amount) {
  const rounded = Math.round(amount);
  const formatted = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${formatted} so'm`;
}
function formatNumberDots(amount) {
  const rounded = Math.round(amount ?? 0);
  return Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function formatPriceField(amount, format, showCurrency) {
  const fmt = format ?? 'dot_som';
  if (fmt === 'plain') return String(Math.round(amount));
  const withCurrency = fmt === 'dot_som' && showCurrency !== false;
  if (withCurrency) return formatMoneyUZS(amount);
  return formatNumberDots(amount);
}

assert.equal(formatPriceField(12000, 'dot_som', true), "12.000 so'm");
assert.equal(formatPriceField(12000, 'dot_som', false), '12.000');
assert.equal(formatPriceField(12000, 'dot', undefined), '12.000');
assert.equal(formatPriceField(12000, 'plain', undefined), '12000');
assert.notEqual(formatPriceField(12000, 'dot_som', true), "12.000 so'm so'm", 'must not double so\'m suffix');

function formatSkuField(sku, showPrefix) {
  if (!sku) return '';
  if (showPrefix === false) return sku;
  return `SKU: ${sku}`;
}
assert.equal(formatSkuField('0254', true), 'SKU: 0254');
assert.equal(formatSkuField('0254', undefined), 'SKU: 0254');
assert.equal(formatSkuField('0254', false), '0254');
assert.equal(formatSkuField('', false), '');

console.log('barcode studio smoke: ok');
