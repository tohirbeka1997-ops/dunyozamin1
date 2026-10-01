'use strict';

const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 8_000_000;

function stripEnvQuotes(raw) {
  const t = String(raw || '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function imageDir() {
  if (process.env.POS_DATA_DIR && String(process.env.POS_DATA_DIR).trim()) {
    return path.join(path.resolve(String(process.env.POS_DATA_DIR).trim()), 'product-images');
  }
  try {
    const { getUserDataDir } = require('./runtime.cjs');
    return path.join(getUserDataDir(), 'product-images');
  } catch {
    return path.join(process.cwd(), 'product-images');
  }
}

function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function readInvoiceImage(payload = {}) {
  const b64 = String(payload.image_base64 || payload.imageBase64 || '').trim();
  if (b64) {
    const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleaned, 'base64');
    if (!buffer.length) {
      throw new Error('Rasm bo‘sh');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('Rasm juda katta (8 MB dan oshmasin)');
    }
    const mime = String(payload.mime_type || payload.mime || 'image/jpeg');
    return {
      buffer,
      mime: mime.startsWith('image/') ? mime : 'image/jpeg',
      publicPath: payload.image_url || null,
    };
  }

  const rawUrl = String(payload.image_url || payload.imageUrl || '').trim();
  if (!rawUrl) {
    throw new Error('Nakladnoy rasmi yuklanmagan');
  }
  let pathname = rawUrl;
  try {
    if (/^https?:\/\//i.test(rawUrl)) pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  const fileName = path.basename(pathname.split('?')[0]);
  if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('..')) {
    throw new Error('Rasm manzili noto‘g‘ri');
  }
  const filePath = path.join(imageDir(), fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error('Yuklangan rasm serverda topilmadi. Qayta yuklang.');
  }
  const buffer = fs.readFileSync(filePath);
  if (!buffer.length) throw new Error('Rasm bo‘sh');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Rasm juda katta (8 MB dan oshmasin)');
  return { buffer, mime: mimeFromName(fileName), publicPath: `/product-images/${fileName}` };
}

const INVOICE_PROMPT = [
  'Read this supplier delivery note / invoice photo (nakladnoy).',
  'Return ONLY a JSON object, no markdown:',
  '{',
  '  "invoice_number": string or null,',
  '  "invoice_date": string or null,',
  '  "supplier_name": string or null,',
  '  "currency": "UZS" or "USD" or null,',
  '  "lines": [',
  '    {',
  '      "name": string,',
  '      "qty": number,',
  '      "unit": string,',
  '      "unit_price": number,',
  '      "line_total": number,',
  '      "barcode": string or null,',
  '      "sku": string or null,',
  '      "article": string or null',
  '    }',
  '  ]',
  '}',
  'Rules:',
  '- One object per printed product line. Do not invent rows.',
  '- Keep the unit exactly as printed (dona, metr, kg, quti, pachka, and so on).',
  '- Do not convert boxes to pieces.',
  '- qty and unit_price are numbers. If a number is unreadable, use 0 and still keep the name.',
  '- currency is UZS or USD only when the whole document uses that one currency; otherwise null.',
  '- Do not mix currencies inside lines.',
].join('\n');

function geminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .join('\n')
    .trim();
}

async function callGemini(image, apiKey, options) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const models = [
    options.geminiModel,
    process.env.GEMINI_TEXT_MODEL,
    'gemini-2.5-flash',
    'gemini-flash-latest',
  ]
    .map((m) => stripEnvQuotes(m))
    .filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastReason = 'gemini_empty';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: INVOICE_PROMPT },
              { inlineData: { mimeType: image.mime, data: image.buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 45_000),
    });
    if (!res.ok) {
      lastReason = `gemini_http_${res.status}`;
      if (res.status === 404 || res.status === 400) continue;
      return { ok: false, reason: lastReason, provider: 'gemini', model };
    }
    const data = await res.json();
    const text = geminiText(data);
    if (!text) {
      lastReason = 'gemini_empty';
      continue;
    }
    return { ok: true, text, provider: 'gemini', model };
  }
  return { ok: false, reason: lastReason, provider: 'gemini' };
}

async function callOpenAi(image, apiKey, options) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const model = stripEnvQuotes(options.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini') || 'gpt-4o-mini';
  const base = stripEnvQuotes(options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: INVOICE_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}` },
          },
        ],
      },
    ],
  };
  const res = await fetchFn(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs || 45_000),
  });
  if (!res.ok) {
    return { ok: false, reason: `openai_http_${res.status}`, provider: 'openai', model };
  }
  const data = await res.json();
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) return { ok: false, reason: 'openai_empty', provider: 'openai', model };
  return { ok: true, text, provider: 'openai', model };
}

function missingKeyMessage() {
  return 'AI kaliti yo‘q: serverda GEMINI_API_KEY va OPENAI_API_KEY bo‘sh. Qo‘lda xarid formasidan foydalaning.';
}

async function extractInvoiceWithVision(image, options = {}) {
  const geminiKey = stripEnvQuotes(options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '');
  const openaiKey = stripEnvQuotes(options.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '');
  if (!geminiKey && !openaiKey) {
    return { ok: false, reason: 'no_api_key', message: missingKeyMessage() };
  }
  if (!image?.buffer?.length) {
    return { ok: false, reason: 'no_image', message: 'Nakladnoy rasmi yo‘q. Qo‘lda xarid formasidan foydalaning.' };
  }

  let vision = null;
  if (geminiKey) {
    try {
      vision = await callGemini(image, geminiKey, options);
    } catch (err) {
      vision = { ok: false, reason: 'gemini_network_error', message: err?.message };
    }
  }
  if ((!vision || !vision.ok) && openaiKey) {
    try {
      const openai = await callOpenAi(image, openaiKey, options);
      if (openai.ok) vision = openai;
      else if (!vision?.ok) vision = openai;
    } catch (err) {
      if (!vision?.ok) vision = { ok: false, reason: 'openai_network_error', message: err?.message };
    }
  }
  if (!vision?.ok) {
    const reason = vision?.reason || 'vision_failed';
    return {
      ok: false,
      reason,
      message: `Nakladnoyni o‘qib bo‘lmadi (${reason}). Qo‘lda xarid formasidan foydalaning.`,
    };
  }

  try {
    const { parseInvoiceAiPayload } = require('./invoicePurchase.cjs');
    const parsed = parseInvoiceAiPayload(vision.text);
    return {
      ok: true,
      parsed,
      raw_text: vision.text,
      provider: vision.provider,
      model: vision.model || null,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'bad_json',
      message: `AI javobi o‘qilmadi. Qo‘lda xarid formasidan foydalaning. (${err?.message || 'bad_json'})`,
    };
  }
}

module.exports = {
  readInvoiceImage,
  extractInvoiceWithVision,
  missingKeyMessage,
};
