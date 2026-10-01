'use strict';

/**
 * Nakladnoy (supplier invoice photo) draft matching.
 * Exact barcode / SKU / article / normalized name may preselect.
 * Fuzzy name hits are candidates only — never auto-linked.
 */

const UNIT_ALIASES = {
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

const FORBIDDEN_PRODUCT_NAMES = new Set([
  'nomalum',
  'unknown',
  'n/a',
  'na',
  '-',
  '—',
]);

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeCode(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]/g, '');
}

function stripLeadingZeros(value) {
  const code = normalizeCode(value);
  if (!/^\d+$/.test(code)) return code;
  return code.replace(/^0+/, '') || '0';
}

function codesEqual(a, b) {
  const left = normalizeCode(a);
  const right = normalizeCode(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) return false;
  return stripLeadingZeros(left) === stripLeadingZeros(right);
}

function canonicalUnit(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, '');
  if (key === 'l') return 'L';
  if (key === 'ml') return 'mL';
  return UNIT_ALIASES[key] || key;
}

function unitsEquivalent(a, b) {
  const left = canonicalUnit(a);
  const right = canonicalUnit(b);
  if (!left || !right) return false;
  return left === right;
}

function isForbiddenProductName(name) {
  const normalized = normalizeName(name).replace(/\s+/g, '');
  if (!normalized) return true;
  return FORBIDDEN_PRODUCT_NAMES.has(normalized);
}

function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function textOrNull(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

function parseInvoiceAiPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('AI javobi bo‘sh');
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('AI javobi JSON emas');
  }
  const obj = JSON.parse(body.slice(start, end + 1));
  const linesIn = Array.isArray(obj.lines) ? obj.lines : Array.isArray(obj.items) ? obj.items : [];
  const currencyRaw = String(obj.currency || '').trim().toUpperCase();
  const lines = linesIn
    .map((row) => {
      const name = String(row?.name || row?.product_name || row?.title || '').trim();
      if (!name) return null;
      const qty = num(row?.qty ?? row?.quantity ?? row?.miqdor);
      const unitPrice = num(row?.unit_price ?? row?.price ?? row?.unitPrice ?? row?.narx);
      const lineTotalRaw = row?.line_total ?? row?.total ?? row?.summa;
      const lineTotal = lineTotalRaw == null || lineTotalRaw === '' ? qty * unitPrice : num(lineTotalRaw);
      return {
        name,
        qty,
        unit: String(row?.unit || row?.birlik || '').trim(),
        unit_price: unitPrice,
        line_total: lineTotal,
        barcode: textOrNull(row?.barcode || row?.shtrix || row?.ean),
        sku: textOrNull(row?.sku || row?.code),
        article: textOrNull(row?.article || row?.artikul || row?.articul),
      };
    })
    .filter(Boolean);

  return {
    invoice_number: textOrNull(obj.invoice_number || obj.invoiceNumber || obj.number || obj.nakladnoy),
    invoice_date: textOrNull(obj.invoice_date || obj.date),
    supplier_name: textOrNull(obj.supplier_name || obj.supplier),
    currency: currencyRaw === 'USD' || currencyRaw === 'UZS' ? currencyRaw : null,
    lines,
  };
}

function productPublic(product) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || null,
    unit: product.unit || 'pcs',
  };
}

function uniqueHits(products, predicate) {
  const hits = [];
  for (const product of products) {
    if (predicate(product)) hits.push(product);
  }
  return hits;
}

function matchInvoiceLines(lines, products) {
  const catalog = Array.isArray(products) ? products : [];
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const barcodeHits = line.barcode
      ? uniqueHits(catalog, (p) => codesEqual(p.barcode, line.barcode))
      : [];
    const skuHits = line.sku ? uniqueHits(catalog, (p) => codesEqual(p.sku, line.sku)) : [];
    const articleHits = line.article
      ? uniqueHits(catalog, (p) => codesEqual(p.article, line.article))
      : [];
    const nameHits = uniqueHits(catalog, (p) => normalizeName(p.name) === normalizeName(line.name) && normalizeName(line.name));

    let selected = null;
    let matchKind = null;
    const exactPools = [
      ['barcode', barcodeHits],
      ['sku', skuHits],
      ['article', articleHits],
      ['name', nameHits],
    ];
    for (const [kind, hits] of exactPools) {
      if (hits.length === 1) {
        selected = hits[0];
        matchKind = kind;
        break;
      }
      if (hits.length > 1) break;
    }

    const candidateMap = new Map();
    const addCandidate = (product, reason) => {
      if (!product?.id || candidateMap.has(product.id)) return;
      candidateMap.set(product.id, { ...productPublic(product), reason });
    };
    for (const [kind, hits] of exactPools) {
      if (hits.length > 1) {
        for (const hit of hits) addCandidate(hit, kind);
      }
    }
    const needle = normalizeName(line.name);
    if (!selected && needle.length >= 4) {
      for (const product of catalog) {
        if (candidateMap.size >= 5) break;
        const hay = normalizeName(product.name);
        if (!hay || hay === needle) continue;
        if (hay.includes(needle) || needle.includes(hay)) addCandidate(product, 'fuzzy');
      }
    }

    const productUnit = selected?.unit || null;
    return {
      name: line.name,
      qty: Number(line.qty) || 0,
      unit: line.unit || '',
      unit_price: Number(line.unit_price) || 0,
      line_total: Number(line.line_total) || 0,
      barcode: line.barcode || null,
      sku: line.sku || null,
      article: line.article || null,
      product_id: selected?.id || null,
      product_name: selected?.name || null,
      product_sku: selected?.sku || null,
      product_unit: productUnit,
      match_kind: matchKind,
      units_match: selected ? unitsEquivalent(line.unit, productUnit) : null,
      candidates: [...candidateMap.values()].slice(0, 8),
    };
  });
}

function buildInvoiceAttachmentNote({ imageUrl, rawAi, invoiceNumber }) {
  let raw = '';
  try {
    raw = JSON.stringify(rawAi ?? null);
  } catch {
    raw = '';
  }
  if (raw.length > 8000) raw = `${raw.slice(0, 8000)}…`;
  return [
    'Nakladnoydan xarid',
    invoiceNumber ? `Nakladnoy raqami: ${invoiceNumber}` : null,
    imageUrl ? `Rasm: ${imageUrl}` : null,
    raw ? `AI JSON: ${raw}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  canonicalUnit,
  unitsEquivalent,
  normalizeName,
  codesEqual,
  isForbiddenProductName,
  parseInvoiceAiPayload,
  matchInvoiceLines,
  buildInvoiceAttachmentNote,
};
