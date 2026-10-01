'use strict';

/**
 * Daily public store marketing poster → TELEGRAM_MARKETING_CHANNEL_ID only.
 * Content-type rotation (product / tip / life hack / …) + weekday rubrics +
 * Gemini/OpenAI captions + image (fallback: product photo or text-only).
 * Never posts to TELEGRAM_REPORTS_CHAT_ID.
 */

const fs = require('fs');
const path = require('path');
const SettingsService = require('../../electron/services/settingsService.cjs');
const { tryAcquireSchedulerLock } = require('./schedulerLock.cjs');
const { sendTelegramText, sendTelegramPhoto } = require('./telegramNotify.cjs');
const {
  extractProductImageFileName,
  getProductImageDir,
  resolveCatalogImageUrl,
} = require('./productImageUrl.cjs');
const {
  toBool,
  normalizeScheduleTime,
  getReportTelegramSettings,
} = require('./reportNotify.cjs');
const {
  resolveOpenAiConfig,
  resolveGeminiTextConfig,
  ensureOpenAiEnvLoaded,
  buildStoreSnapshot,
} = require('./storeAiAnalysis.cjs');

const LOCK_NAME = 'telegram_daily_poster';
const EVENT_DAILY_POSTER = 'daily_poster';
const DEFAULT_POSTER_TIME = '10:00';
/** Telegram hard cap is 1024; keep headroom for HTML entities. */
const CAPTION_MAX = 900;
/** Social-media target: short, scannable posts (not essays). */
const CAPTION_SOFT_MAX = 700;
const CAPTION_MIN = 90;
const CAPTION_AI_TARGET_MIN = 180;
const CAPTION_AI_TARGET_MAX = 650;
const EMOJI_MAX = 6;
const RECENT_PRODUCTS_KEY = 'reports.telegram.daily_poster_recent_products';
const RECENT_PRODUCT_LIMIT = 14;
const RECENT_CONTENT_TYPES_KEY = 'reports.telegram.daily_poster_recent_content_types';
const RECENT_CONTENT_TYPE_LIMIT = 10;
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
/** OpenAI Images API fallback when Gemini image hits 429 / fails. */
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
const GEMINI_IMAGE_MODEL_FALLBACKS = Object.freeze([
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
  'imagen-3.0-generate-002',
]);

/**
 * Marketing content formats — not only product sales.
 * kind=product → price + product required; kind=edu → tip/lifehack (product soft-mention optional).
 */
const CONTENT_TYPES = Object.freeze([
  {
    id: 'product_showcase',
    kind: 'product',
    title: 'Mahsulot vitrinasi',
    emoji: '🛍',
    hashtagExtra: '#tavsiya',
    vibe:
      'QISQA social post: hook + 1–2 foyda + aniq narx + yumshoq CTA. ' +
      'Essay/ma’ruza YO‘Q. Professional emoji (3–6). Reklama shovqinisiz.',
    openingHint: 'Mahsulot nomi yoki aniq ishlatish joyidan boshla.',
    imageStyle:
      'photoreal product showcase on clean surface, hardware retail mood, no text overlays',
  },
  {
    id: 'useful_tip',
    kind: 'edu',
    title: 'Foydali maslahat',
    emoji: '💡',
    hashtagExtra: '#maslahat',
    vibe:
      'QISQA tip post: hook + 3–4 bullet + (ixtiyoriy) 1 qator yumshoq CTA. ' +
      'Uzun ma’ruza YO‘Q. Soft sell faqat mavzuga mos bo‘lsa (LED→yoritish, quvur→santexnika); ' +
      'mos kelmasa — promo yo‘q. Hard sell YO‘Q.',
    openingHint: 'Qisqa hook + emoji; keyin bulletlar.',
    imageStyle:
      'clean illustrated how-to scene for home plumbing or lighting tip, educational, no readable text, no logos',
    topicHints: [
      'PPR/metalloplastik quvur ulashda o‘lchamni tekshirish',
      'LED lenta yoki lampani almashtirishda xavfsizlik',
      'Kran/smesitel o‘rnatishda lenta va germetik',
      'Rozetka/patron montajida simni to‘g‘ri mahkamlash',
      'Devorga dublon/vint tanlash',
      'Bosimli suvda klapan joylashishini rejalashtirish',
      'Hammomda yoritishni qatlamlab (asosiy + aksent) tanlash',
      'Quvur izolyatsiyasini qachon qo‘yish kerak',
    ],
  },
  {
    id: 'life_hack',
    kind: 'edu',
    title: 'Life hack',
    emoji: '⚡',
    hashtagExtra: '#lifehack',
    vibe:
      'Qisqa life hack: 1 hiyla + 2–3 bullet. Yumor yumshoq. Essay YO‘Q. Soft sell faqat mavzuga mos.',
    openingHint: '«Life hack:» yoki «Tez yechim:» + qisqa hook.',
    imageStyle:
      'clever practical DIY life-hack visual for home repair, bright simple composition, no text',
    topicHints: [
      'Eski lenta qoldig‘ini olib tashlashning oson usuli',
      'Quvur o‘lchamini tezkor aniqlash',
      'Qorong‘i shkafda LED bilan yoritishni soddalashtirish',
      'Tomchilab turgan joyda vaqtinchalik hermetik',
      'Kalit/instrumentni yo‘qotmaslik uchun joylash',
      'Sim uchlarini chalkashtirmaslik uchun rang belgilash',
      'Devorga burg‘ulashdan oldin kabel/quvur izini tekshirish',
      'Kichik qismlarni banka/magnit bilan yo‘qotmaslik',
    ],
  },
  {
    id: 'myth_fact',
    kind: 'edu',
    title: 'Afsona vs haqiqat',
    emoji: '❓',
    hashtagExtra: '#savol',
    vibe:
      '1 afsona/savol + 2–3 qisqa haqiqat bullet. Suhbat ohangi, essay YO‘Q. Soft sell faqat mavzuga mos.',
    openingHint: '«Afsona:» / «Ko‘p so‘raladi:» bilan qisqa hook.',
    imageStyle:
      'friendly FAQ / myth-vs-fact educational visual for home improvement, minimal, no text',
    topicHints: [
      '«Arzon fiting ham bir xil» — haqiqatmi?',
      'LED lampalar elektr tejaydimi?',
      'Lenta o‘rniga faqat germetik yetadimi?',
      'Katta o‘lchamli quvur har doim yaxshiroqmi?',
      'Issiq suv uchun oddiy PVC yetadimi?',
      'Yorqinroq lampa = yaxshiroq yoritishmi?',
      '«Bir marta mahkamlab qo‘ysa — umrbod» — rostmi?',
    ],
  },
  {
    id: 'seasonal_care',
    kind: 'edu',
    title: 'Mavsumiy parvarish',
    emoji: '🌿',
    hashtagExtra: '#parvarish',
    vibe:
      'Mavsumiy 3–4 bullet maslahat. G‘amxo‘rlik ohangi, qisqa. Soft sell faqat mavzuga mos.',
    openingHint: 'Mavsum + qisqa hook.',
    imageStyle:
      'seasonal home care mood for plumbing or lighting maintenance, calm photoreal, no text',
    topicHints: [
      'Qish oldidan tashqi kran/quvurlarni himoya',
      'Yozda yoritishni tejash',
      'Nam faslda rozetka/elektr xavfsizligi',
      'Changli mavsumda ventilyatsiya/filtr eslatmasi',
      'Bahorda tashqi yoritish va kabelni tekshirish',
      'Kuzda tomchi/sizib chiqishni oldindan topish',
    ],
  },
  {
    id: 'behind_shop',
    kind: 'edu',
    title: 'Sifat checklist',
    emoji: '✅',
    hashtagExtra: '#sifat',
    vibe:
      '3–4 punktli checklist. Professional, qisqa. Soft sell faqat mavzuga mos. Hard sell YO‘Q.',
    openingHint: '«Tanlashda 3 narsa:» yoki checklist hook.',
    imageStyle:
      'organized hardware shop quality checklist mood, tidy shelves tools fittings, no text logos',
    topicHints: [
      'Fiting tanlashda 3 belgi',
      'Yoritish mahsulotida etiketi o‘qish',
      'Kafolat va brendni tekshirish',
      'O‘lcham/standart mosligi',
      'Ip/rezba va qalinlikni ko‘zdan kechirish',
      'Paket ichida to‘liq komplekt borligini tekshirish',
    ],
  },
  {
    id: 'combo_bundle',
    kind: 'product',
    title: 'Birga oling',
    emoji: '🧩',
    hashtagExtra: '#birga',
    vibe:
      'Qisqa: asosiy + 1–2 mos qo‘shimcha + narx. Yolg‘on chegirma yo‘q. Essay YO‘Q.',
    openingHint: '«Birga oling» + qo‘shimcha nomlari bilan boshla.',
    imageStyle:
      'product bundle flat-lay: main item plus matching accessories, photoreal, no text',
  },
]);

/** Weekday default content type (still overridden by anti-repeat rotation). */
const WEEKDAY_CONTENT_TYPE_IDS = Object.freeze([
  'behind_shop', // 0 Yakshanba
  'product_showcase', // 1 Dushanba
  'useful_tip', // 2 Seshanba
  'product_showcase', // 3 Chorshanba
  'combo_bundle', // 4 Payshanba
  'life_hack', // 5 Juma
  'myth_fact', // 6 Shanba
]);

/** Index = SQLite/JS weekday: 0 Yakshanba … 6 Shanba */
const RUBRICS = Object.freeze([
  {
    id: 'sunday_quality',
    weekday: 0,
    weekdayName: 'Yakshanba',
    title: 'Sifat va ishonch',
    emoji: '🛡',
    vibe:
      'Qisqa: mustahkamlik/ishonch + 1–2 foyda + narx. Premium, sokin. Essay YO‘Q.',
    templatePitch: 'Mustahkam o‘tirish — uzoq muddat xotirjam ishlash uchun.',
    openingHint: 'Ishonch / kafolat ohangi bilan boshla (lekin «sifatli tanlov» dema).',
    prefer: 'stock_image',
  },
  {
    id: 'monday_new_stock',
    weekday: 1,
    weekdayName: 'Dushanba',
    title: 'Yangi kelganlar',
    emoji: '✨',
    vibe: 'Qisqa: yangi vitrina kayfiyati + nima ekanligi + narx. Ombor soni YO‘Q.',
    templatePitch: 'Yangi partiya vitrinada — o‘lchamni tanlab, ishni kechiktirmang.',
    openingHint: '«Vitrinaga keldi / yangi partiyadan» uslubida boshla.',
    prefer: 'stock_image',
  },
  {
    id: 'tuesday_pro_tip',
    weekday: 2,
    weekdayName: 'Seshanba',
    title: 'Usta uchun maslahat',
    emoji: '🔧',
    vibe: 'Qisqa tip ohangi: qayerda ishlatiladi + 1 amaliy maslahat. Essay YO‘Q.',
    templatePitch: 'Avval o‘lchov — to‘g‘ri fiting tanlansa, qayta ish kamayadi.',
    openingHint: 'To‘g‘ridan-to‘g‘ri maslahat yoki «Usta uchun:» bilan boshla.',
    prefer: 'category',
  },
  {
    id: 'wednesday_value',
    weekday: 3,
    weekdayName: 'Chorshanba',
    title: 'Narx–sifat tanlov',
    emoji: '⚖️',
    vibe: 'Qisqa: narx–qiymat + aniq narx. «Eng arzon» dema. Essay YO‘Q.',
    templatePitch: 'Byudjetni saqlab, montaj sifatini boy bermang — narx aniq.',
    openingHint: 'Narx–qiymat muvozanati (taqiqlangan sloganlarsiz) bilan boshla.',
    prefer: 'mid_price',
  },
  {
    id: 'thursday_bundle',
    weekday: 4,
    weekdayName: 'Payshanba',
    title: 'Birga oling',
    emoji: '🧩',
    vibe: 'Qisqa: asosiy + 1–2 mos qo‘shimcha. Yolg‘on chegirma YO‘Q.',
    templatePitch: 'Asosiy detal + mufta/lenta — bir safarda montajni yoping.',
    openingHint: '«Birga oling» + aniq qo‘shimcha nomlari bilan boshla.',
    prefer: 'category',
  },
  {
    id: 'friday_deal',
    weekday: 5,
    weekdayName: 'Juma',
    title: 'Hafta yakuni urg‘usi',
    emoji: '🏁',
    vibe: 'Qisqa yumshoq urg‘u: bugun tanlang. Foizli yolg‘on chegirma TAQIQLANGAN.',
    templatePitch: 'Kerakli detal qo‘lingizda — dam oldan oldin ishni yopish osonroq.',
    openingHint: 'Vaqt urg‘usi / «bugun tanlang» (foizsiz).',
    prefer: 'fast',
  },
  {
    id: 'saturday_faq',
    weekday: 6,
    weekdayName: 'Shanba',
    title: 'Mijoz savoli',
    emoji: '❓',
    vibe: 'Qisqa FAQ: 1 savol + 2–3 qator javob. Essay YO‘Q.',
    templatePitch: 'Qayerda kerak? Quvur ulanish yoki yoritish nuqtasida — o‘lchamga qarab.',
    openingHint: 'Savol belgisidan yoki «Ko‘p so‘raladi:» dan boshla.',
    prefer: 'mid_price',
  },
]);

const FORBIDDEN_RE =
  /\b(viagra|casino|porn|xxx|onlyfans|crypto\s*pump|guaranteed\s*profit)\b|https?:\/\/t\.me\/\+|bit\.ly\//i;
const INTERNAL_CAPTION_RE =
  /\b(qarz|nasiya|hisobot|foyda|zarar|smena|kassir|dead\s*stock|debit|ombor\s*qoldig|qoldiq\s*\d+)\b/i;
const BANNED_SLOGAN_RE =
  /sifatli\s+tanlov\s*[—\-–]\s*kunni\s+chiroyliroq\s+qiladi|kunni\s+chiroyliroq\s+qiladi|eng\s+arzon\s+narx|100%\s*kafolat|super\s*aksiya|bomba\s*narx/i;
const GARBAGE_NAME_RE =
  /^(test|asdf|qwe+|xxx+|noma.?lum|unknown|product|item|товар|товар\d+|sku|artikul|артикул)[\s\-_]*\d*$/i;

function readSetting(db, key, fallback = null) {
  try {
    const settings = new SettingsService(db);
    const val = settings.get(key);
    return val == null ? fallback : val;
  } catch {
    return fallback;
  }
}

function writeSetting(db, key, value, type = 'string') {
  try {
    const settings = new SettingsService(db);
    settings.set(key, value, type);
  } catch {
    // best-effort
  }
}

function readRecentProductIds(db) {
  try {
    const raw = readSetting(db, RECENT_PRODUCTS_KEY, '[]');
    const arr = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, RECENT_PRODUCT_LIMIT);
  } catch {
    return [];
  }
}

function pushRecentProductId(db, productId) {
  const id = String(productId || '').trim();
  if (!id || !db) return;
  const prev = readRecentProductIds(db).filter((x) => x !== id);
  const next = [id, ...prev].slice(0, RECENT_PRODUCT_LIMIT);
  writeSetting(db, RECENT_PRODUCTS_KEY, JSON.stringify(next), 'string');
}

function readRecentContentTypeIds(db) {
  try {
    const raw = readSetting(db, RECENT_CONTENT_TYPES_KEY, '[]');
    const arr = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, RECENT_CONTENT_TYPE_LIMIT);
  } catch {
    return [];
  }
}

function pushRecentContentTypeId(db, contentTypeId) {
  const id = String(contentTypeId || '').trim();
  if (!id || !db) return;
  const prev = readRecentContentTypeIds(db).filter((x) => x !== id);
  const next = [id, ...prev].slice(0, RECENT_CONTENT_TYPE_LIMIT);
  writeSetting(db, RECENT_CONTENT_TYPES_KEY, JSON.stringify(next), 'string');
}

function getContentTypeById(id) {
  const needle = String(id || '').trim();
  if (!needle) return null;
  return CONTENT_TYPES.find((c) => c.id === needle) || null;
}

function contentTypeKind(ct) {
  return String(ct?.kind || '') === 'edu' ? 'edu' : 'product';
}

/**
 * Pick content format for today.
 * Weekday default + anti-repeat: avoid consecutive product-sales clones and same type twice.
 */
function pickContentType(weekdayOrOptions, options = {}) {
  const opts =
    weekdayOrOptions && typeof weekdayOrOptions === 'object' && !Array.isArray(weekdayOrOptions)
      ? { ...weekdayOrOptions, ...options }
      : { ...options, weekday: weekdayOrOptions };

  if (opts.contentTypeId) {
    const forced = getContentTypeById(opts.contentTypeId);
    if (forced) return forced;
  }

  const weekday = normalizeWeekday(opts.weekday != null ? opts.weekday : 0);
  const preferredId = WEEKDAY_CONTENT_TYPE_IDS[weekday] || 'product_showcase';
  let preferred = getContentTypeById(preferredId) || CONTENT_TYPES[0];

  const recentIds = Array.isArray(opts.recentContentTypeIds)
    ? opts.recentContentTypeIds.map((x) => String(x))
    : opts.db
      ? readRecentContentTypeIds(opts.db)
      : [];
  const lastId = recentIds[0] || null;
  const lastCt = getContentTypeById(lastId);
  const lastKind = lastCt ? contentTypeKind(lastCt) : null;

  // Same type twice in a row → rotate
  if (lastId && lastId === preferred.id) {
    preferred = nextContentType(preferred, recentIds, { preferKind: null });
  }
  // Two product posts in a row (or last was product and today defaults to product) → edu
  else if (contentTypeKind(preferred) === 'product' && lastKind === 'product') {
    preferred = nextContentType(preferred, recentIds, { preferKind: 'edu' });
  }
  // Avoid 3 product-kind in last 3 if today would be 4th product-ish streak
  else if (contentTypeKind(preferred) === 'product') {
    const last3 = recentIds.slice(0, 3)
      .map((id) => getContentTypeById(id))
      .filter(Boolean);
    if (last3.length >= 2 && last3.every((c) => contentTypeKind(c) === 'product')) {
      preferred = nextContentType(preferred, recentIds, { preferKind: 'edu' });
    }
  }

  return preferred;
}

function nextContentType(from, recentIds, options = {}) {
  const avoid = new Set([String(from?.id || ''), ...(recentIds || []).slice(0, 2).map(String)]);
  const preferKind = options.preferKind || null;
  const pool = CONTENT_TYPES.filter((c) => {
    if (avoid.has(c.id)) return false;
    if (preferKind && contentTypeKind(c) !== preferKind) return false;
    return true;
  });
  if (pool.length) return pool[0];
  const edu = CONTENT_TYPES.find((c) => contentTypeKind(c) === 'edu' && c.id !== from?.id);
  return edu || CONTENT_TYPES.find((c) => c.id !== from?.id) || CONTENT_TYPES[0];
}

function pickEduTopic(contentType, options = {}) {
  const hints = Array.isArray(contentType?.topicHints) ? contentType.topicHints : [];
  if (!hints.length) {
    return 'Uy santexnika/yoritish bo‘yicha amaliy maslahat';
  }
  const seed =
    (Number(options.dayOfYear) || 1) * 17 +
    (Number(options.weekday) || 0) * 11 +
    String(contentType.id || '').length * 5 +
    (Number(String(options.date || '').replace(/\D/g, '').slice(-3)) || 0);
  return hints[Math.abs(seed) % hints.length];
}

function inferUseCaseHint(product) {
  const blob = `${product?.name || ''} ${product?.category_name || ''} ${product?.description || ''}`.toLowerCase();
  if (/atvod|отвод|poliatvod|полиотвод|fiting|фитинг|mufta|муфт|quill|truba|труба|santex|сантех|quvur|koleno|угол/.test(blob)) {
    return 'Santexnika: quvur ulanish, o‘lcham mosligi.';
  }
  if (/lamp|led|svetil|ёorit|yorug|патрон|patron|sim|кабел|kabel|lyustra|люстр|rozetka|розет/.test(blob)) {
    return 'Yoritish/elektr: xavfsiz montaj, qulay almashtirish.';
  }
  if (/kran|кран|smesitel|смесит|ventil|вентил|klapan|клапан/.test(blob)) {
    return 'Suv armatura: tomchilamas ulanish.';
  }
  if (/bolt|гайка|gayka|vint|шуруп|dubl|дюбел|instrument|инструмент/.test(blob)) {
    return 'Montaj: mustahkam o‘rnatish.';
  }
  return 'Qurilish/ta’mir uchun aniq vazifa.';
}

/** Domain tags for topic↔product soft-sell matching. */
function inferTopicDomain(text) {
  const blob = String(text || '').toLowerCase();
  if (/led|lamp|yorit|ёorit|svetil|sim|kabel|кабел|rozetka|розет|patron|патрон|elektr|ток|avtomat/.test(blob)) {
    return 'lighting';
  }
  if (
    /quvur|truba|труба|fiting|фитинг|santex|сантех|kran|кран|smesitel|klapan|клапан|ppr|mufta|муфт|atvod|poliatvod|germetik|lenta|sizib|tomchi/.test(
      blob,
    )
  ) {
    return 'plumbing';
  }
  if (/dubl|дюбел|vint|шуруп|bolt|гайка|burg|инструмент|instrument|devor/.test(blob)) {
    return 'fastener';
  }
  return 'general';
}

function productMatchesTopic(product, topic) {
  if (!product || !isPublishableProductName(product.name)) return false;
  const topicDom = inferTopicDomain(topic);
  const prodDom = inferTopicDomain(
    `${product.name || ''} ${product.category_name || ''} ${product.description || ''}`,
  );
  if (topicDom === 'general' || prodDom === 'general') return false;
  return topicDom === prodDom;
}

function softPromoLine(product, topic) {
  if (!productMatchesTopic(product, topic)) return '';
  const name = String(product.name || '').trim();
  if (!name) return '';
  const dom = inferTopicDomain(topic);
  if (dom === 'lighting') {
    return `🛒 Kerak bo‘lsa — yoritish/sim detalini do‘kondan tanlang («${escapeHtml(name)}»).`;
  }
  if (dom === 'plumbing') {
    return `🛒 Kerak bo‘lsa — santexnika detalini do‘kondan tanlang («${escapeHtml(name)}»).`;
  }
  return `🛒 Kerak bo‘lsa — «${escapeHtml(name)}» ni do‘kondan ko‘ring.`;
}

/** Short bullet lines for template edu captions (topic-aware, not essays). */
function buildEduTipBullets(topic, contentTypeId) {
  const t = String(topic || '').toLowerCase();
  const id = String(contentTypeId || '');

  if (/led|lamp|yorit|elektr|sim|rozetka|patron|avtomat/.test(t)) {
    return [
      '• Avtomatni o‘chirib ishlang 🔌',
      '• Indikator bilan tokni tekshiring',
      '• Izolyatsiyalangan asbob + lenta',
    ];
  }
  if (/quvur|ppr|fiting|santex|kran|smesitel|klapan|germetik|lenta|o‘lcham|olcham/.test(t)) {
    return [
      '• Avval o‘lchamni ikki marta o‘lchang 📏',
      '• Mos fiting/lenta tayyorlab qo‘ying',
      '• Germetikni quritib, keyin oching',
    ];
  }
  if (/dubl|vint|devor|burg/.test(t)) {
    return [
      '• Devor turini aniqlang (beton/gips)',
      '• To‘g‘ri dublon/vint tanlang',
      '• Burg‘ulashdan oldin kabel izini tekshiring',
    ];
  }
  if (id === 'myth_fact') {
    return [
      '• Arzon ≠ bir xil sifat',
      '• O‘lcham/standartni tekshiring',
      '• Ishonchli brend + kafolat muhim',
    ];
  }
  if (id === 'behind_shop') {
    return [
      '• O‘lcham va standart mosligi',
      '• Material/qalinlikni ko‘ring',
      '• Paket to‘liqligini tekshiring',
    ];
  }
  return [
    '• Vaziyatni aniqlang ✅',
    '• O‘lcham va moslikni tekshiring',
    '• Asbobni oldindan tayyorlang',
  ];
}

function eduEngagementQuestion(contentTypeId) {
  const id = String(contentTypeId || '');
  if (id === 'life_hack') return 'Sizda qanday tez yechim bor? 👇';
  if (id === 'myth_fact') return 'Bu haqda nima deb o‘ylagansiz? 👇';
  if (id === 'seasonal_care') return 'Uyingizda nima birinchi tekshiriladi? 👇';
  if (id === 'behind_shop') return 'Tanlashda nima muhimroq? 👇';
  return 'Siz birinchi navbatda nimaga e’tibor berasiz? 👇';
}

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasColumn(db, table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => String(r.name) === column);
  } catch {
    return false;
  }
}

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

function ensureEnvLoaded(options = {}) {
  if (options.skipEnvLoad) return;
  try {
    require('../../electron/config/loadRootEnv.cjs').loadRootEnv();
  } catch {
    // ignore
  }
}

function localTimeParts(db) {
  try {
    const row = db
      .prepare(
        `SELECT date('now', 'localtime') AS d,
                cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
                cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m,
                cast(strftime('%j', 'now', 'localtime') AS INTEGER) AS doy,
                cast(strftime('%w', 'now', 'localtime') AS INTEGER) AS dow`,
      )
      .get();
    return {
      date: row?.d || new Date().toISOString().slice(0, 10),
      hour: Number(row?.h) || 0,
      minute: Number(row?.m) || 0,
      dayOfYear: Number(row?.doy) || 1,
      weekday: Number(row?.dow) || 0,
    };
  } catch {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = Math.floor((now - start) / 86400000);
    return {
      date: now.toISOString().slice(0, 10),
      hour: now.getHours(),
      minute: now.getMinutes(),
      dayOfYear: doy || 1,
      weekday: now.getDay(),
    };
  }
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function isPublishableProductName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 4) return false;
  if (n.length > 80) return false;
  if (GARBAGE_NAME_RE.test(n)) return false;
  if (/^[\d\s\-_.\/#]+$/.test(n)) return false;
  if (/^\d{8,}$/.test(n.replace(/\s/g, ''))) return false;
  if (/\b(sku|артикул|barcode|штрих)\b/i.test(n)) return false;
  const letters = (n.match(/[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ\u0400-\u04FF]/g) || []).length;
  if (letters < 3) return false;
  const digits = (n.match(/\d/g) || []).length;
  if (digits > letters * 2 && digits >= 6) return false;
  return true;
}

function sameTelegramChat(a, b) {
  const sa = stripEnvQuotes(a);
  const sb = stripEnvQuotes(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const na = Number.parseInt(sa, 10);
  const nb = Number.parseInt(sb, 10);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function resolveMarketingCredentials(options = {}) {
  ensureEnvLoaded(options);
  const botToken = stripEnvQuotes(
    options.botToken ||
      process.env.TELEGRAM_MARKETING_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      '',
  );
  const channelId = stripEnvQuotes(
    options.channelId || process.env.TELEGRAM_MARKETING_CHANNEL_ID || '',
  );
  const reportsChat = stripEnvQuotes(process.env.TELEGRAM_REPORTS_CHAT_ID || '');
  const blocked = Boolean(channelId && reportsChat && sameTelegramChat(channelId, reportsChat));
  return {
    botToken,
    channelId,
    blockedReportsChannel: blocked,
    hasCredentials: Boolean(botToken && channelId && !blocked),
  };
}

function resolveGeminiConfig(options = {}) {
  ensureEnvLoaded(options);
  const apiKey = stripEnvQuotes(options.geminiApiKey || process.env.GEMINI_API_KEY || '');
  const model =
    stripEnvQuotes(options.geminiImageModel || process.env.GEMINI_IMAGE_MODEL || '') ||
    DEFAULT_GEMINI_IMAGE_MODEL;
  return { apiKey, model, hasApiKey: apiKey.length > 0 };
}

function resolveOpenAiImageConfig(options = {}) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  const model =
    stripEnvQuotes(options.openaiImageModel || process.env.OPENAI_IMAGE_MODEL || '') ||
    DEFAULT_OPENAI_IMAGE_MODEL;
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model,
    hasApiKey: Boolean(cfg.apiKey),
  };
}

function normalizeWeekday(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return ((Math.trunc(n) % 7) + 7) % 7;
}

function getDailyPosterSettings(db) {
  const base = getReportTelegramSettings(db);
  const creds = resolveMarketingCredentials({ skipEnvLoad: true });
  const raw = readSetting(db, 'reports.telegram.daily_poster', null);
  let enabled;
  if (raw == null || raw === '') {
    enabled = creds.hasCredentials;
  } else {
    enabled = toBool(raw, creds.hasCredentials);
  }
  const envTime = stripEnvQuotes(process.env.DAILY_POSTER_TIME || '');
  const parts = localTimeParts(db);
  const todayRubric = pickRubric(parts.weekday);
  const todayContentType = pickContentType(parts.weekday, { db });
  return {
    storeName: base.storeName || "Do'kon",
    enabled: Boolean(enabled),
    scheduleTime: normalizeScheduleTime(
      readSetting(db, 'reports.telegram.daily_poster_time', envTime || DEFAULT_POSTER_TIME) ||
        envTime ||
        DEFAULT_POSTER_TIME,
    ),
    lastRunDate: String(readSetting(db, 'reports.telegram.daily_poster_last_run_date', '') || '').slice(
      0,
      10,
    ),
    weekday: parts.weekday,
    todayRubric: {
      id: todayRubric.id,
      title: todayRubric.title,
      emoji: todayRubric.emoji,
      weekdayName: todayRubric.weekdayName,
    },
    todayContentType: {
      id: todayContentType.id,
      title: todayContentType.title,
      emoji: todayContentType.emoji,
      kind: todayContentType.kind,
    },
  };
}

function pickRubric(weekdayOrDayOfYear, options = {}) {
  if (options.rubricId) {
    const found = RUBRICS.find((r) => r.id === options.rubricId);
    if (found) return found;
  }
  // Prefer explicit weekday (0–6). Legacy callers may pass day-of-year; still map via % 7.
  const idx = normalizeWeekday(
    options.weekday != null ? options.weekday : weekdayOrDayOfYear,
  );
  return RUBRICS[idx] || RUBRICS[0];
}

function shouldRunDailyPoster(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced', today: localTimeParts(db).date };
  const parts = localTimeParts(db);
  if (settings.lastRunDate && settings.lastRunDate === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  const [sh, sm] = String(settings.scheduleTime || DEFAULT_POSTER_TIME)
    .split(':')
    .map((x) => Number.parseInt(x, 10));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 10) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

function claimNotifyDedup(db, eventKey, refId) {
  if (!hasTable(db, 'report_notify_log')) return true;
  const key = String(eventKey || '').trim();
  const ref = String(refId || '').trim();
  if (!key || !ref) return true;
  try {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO report_notify_log (event_key, ref_id, sent_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(key, ref);
    return Number(r?.changes || 0) > 0;
  } catch {
    return true;
  }
}

function listCandidateProducts(db, limit = 40) {
  if (!hasTable(db, 'products')) return [];
  const hasActive = hasColumn(db, 'products', 'is_active');
  const hasCat = hasTable(db, 'categories');
  const hasSku = hasColumn(db, 'products', 'sku');
  const hasBrand = hasColumn(db, 'products', 'brand');
  const hasDesc = hasColumn(db, 'products', 'description');
  const hasArticle = hasColumn(db, 'products', 'article');
  const catJoin = hasCat ? 'LEFT JOIN categories c ON c.id = p.category_id' : '';
  const catSelect = hasCat ? ', c.name AS category_name' : ', NULL AS category_name';
  const skuSelect = hasSku ? ', p.sku' : ', NULL AS sku';
  const brandSelect = hasBrand ? ', p.brand' : ', NULL AS brand';
  const descSelect = hasDesc ? ', p.description' : ', NULL AS description';
  const articleSelect = hasArticle ? ', p.article' : ', NULL AS article';
  const activeClause = hasActive ? 'AND COALESCE(p.is_active, 1) = 1' : '';
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.sale_price, p.current_stock, p.image_url, p.category_id
                ${catSelect}${skuSelect}${brandSelect}${descSelect}${articleSelect}
         FROM products p
         ${catJoin}
         WHERE COALESCE(p.current_stock, 0) > 0
           ${activeClause}
           AND COALESCE(p.sale_price, 0) > 0
         ORDER BY
           CASE WHEN p.image_url IS NOT NULL AND TRIM(p.image_url) != '' THEN 0 ELSE 1 END,
           p.current_stock DESC
         LIMIT ?`,
      )
      .all(Math.max(limit * 3, 80));
    return rows.filter((p) => isPublishableProductName(p.name)).slice(0, limit);
  } catch {
    return [];
  }
}

function scoreProduct(p, rubric, snapshot) {
  let score = 0;
  const stock = Number(p.current_stock) || 0;
  const price = Number(p.sale_price) || 0;
  const hasImg = Boolean(String(p.image_url || '').trim());
  if (hasImg) score += 5;
  if (stock > 0) score += 2;

  const fastIds = new Set(
    (snapshot?.fast_movers_top || []).map((x) => String(x.id || x.product_id || '')),
  );
  const id = String(p.id || '');

  switch (rubric.prefer) {
    case 'fast':
      if (fastIds.has(id)) score += 12;
      score += Math.min(8, stock / 10);
      break;
    case 'low_stock':
      if (stock > 0 && stock <= 5) score += 14;
      else if (stock <= 15) score += 6;
      break;
    case 'mid_price':
      if (price >= 20_000 && price <= 500_000) score += 8;
      break;
    case 'category':
      if (p.category_name) score += 6;
      break;
    case 'stock_image':
    default:
      if (hasImg) score += 8;
      score += Math.min(6, stock / 5);
      break;
  }
  score += (id.charCodeAt(0) || 0) % 3;
  return score;
}

function selectProductForRubric(db, rubric, options = {}) {
  const snapshot =
    options.snapshot ||
    buildStoreSnapshot(db, {
      date: options.date,
      storeName: options.storeName,
      topN: 10,
    });
  const candidates = listCandidateProducts(db, options.candidateLimit || 60);
  if (!candidates.length) return { product: null, snapshot };

  const recentIds = options.ignoreRecent === true ? [] : readRecentProductIds(db);
  const skipIds = new Set(
    [...(options.skipProductIds || []), ...recentIds].map((id) => String(id)),
  );
  let ranked = candidates
    .map((p) => ({ p, score: scoreProduct(p, rubric, snapshot) }))
    .filter((x) => !skipIds.has(String(x.p.id)))
    .sort((a, b) => b.score - a.score);

  // If recent-history filtered everything, allow a wider pool (still honor explicit skips).
  if (!ranked.length) {
    const hardSkip = new Set((options.skipProductIds || []).map((id) => String(id)));
    ranked = candidates
      .map((p) => ({ p, score: scoreProduct(p, rubric, snapshot) }))
      .filter((x) => !hardSkip.has(String(x.p.id)))
      .sort((a, b) => b.score - a.score);
  }

  if (!ranked.length) return { product: null, snapshot, rankedCount: 0 };

  const poolSize = Math.min(12, ranked.length);
  const top = ranked.slice(0, poolSize);
  const dateKey = String(options.date || '')
    .replace(/\D/g, '')
    .slice(-6);
  const seed =
    (Number(options.dayOfYear) || 1) * 37 +
    (Number(rubric?.weekday) || 0) * 19 +
    (Number(dateKey) || 0) +
    skipIds.size * 3;
  const pickIdx = Math.abs(seed) % top.length;
  return {
    product: top[pickIdx].p,
    snapshot,
    rankedCount: ranked.length,
    skippedRecent: recentIds.length,
  };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTemplateCaption({ storeName, product, rubric, contentType, topic }) {
  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const store = String(storeName || "Do'kon").trim();
  const extraTag = ct.hashtagExtra || '#tavsiya';
  const tags = `#Dunyozamin #News ${extraTag}`.trim();

  if (isEdu) {
    const title = ct.title || 'Foydali maslahat';
    const tip =
      String(topic || '').trim() ||
      pickEduTopic(ct, {}) ||
      'O‘lcham va moslikni oldindan tekshiring';
    const bullets = buildEduTipBullets(tip, ct.id).join('\n');
    const soft = softPromoLine(product, tip);
    return [
      `${ct.emoji} <b>${escapeHtml(title)}</b>`,
      '',
      escapeHtml(tip),
      '',
      bullets,
      soft ? '' : null,
      soft || null,
      '',
      eduEngagementQuestion(ct.id),
      `📍 ${escapeHtml(store)}`,
      tags,
    ]
      .filter((x) => x != null && x !== '')
      .join('\n')
      .slice(0, CAPTION_SOFT_MAX);
  }

  const name = String(product?.name || '').trim();
  const price = formatSumma(product?.sale_price);
  const cat = String(product?.category_name || '').trim();
  const brandName = String(product?.brand || '').trim();
  const useCase = inferUseCaseHint(product);
  const pitch =
    String(ct.templatePitch || rubric?.templatePitch || '').trim() ||
    'Ishonchli detal — ishingizni osonlashtiradi.';
  const heading = ct.id === 'combo_bundle' ? ct.title : rubric?.title || ct.title;
  const emoji = ct.id === 'combo_bundle' ? ct.emoji : rubric?.emoji || ct.emoji;
  const metaBits = [cat, brandName].filter(Boolean);
  const lines = [
    `${emoji} <b>${escapeHtml(heading)}</b>`,
    '',
    `<b>${escapeHtml(name)}</b>`,
    metaBits.length ? escapeHtml(metaBits.join(' · ')) : null,
    '',
    `✅ ${escapeHtml(pitch)}`,
    `🔧 ${escapeHtml(useCase)}`,
    `💰 <b>${escapeHtml(price)} so'm</b>`,
    '',
    'Kelib ko‘ring yoki yozing — o‘lchamni birga aniqlaymiz 👇',
    `📍 ${escapeHtml(store)}`,
    tags,
  ].filter((x) => x != null);
  return lines.join('\n').slice(0, CAPTION_SOFT_MAX);
}

function captionSystemPrompt(rubric, contentType) {
  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const weekday = rubric?.weekdayName || '';
  const extraTag = ct.hashtagExtra || '#tavsiya';

  const styleRules =
    "Professional social media agent ohangi: qisqa, aniq, ijodiy. " +
    "UZUN ESSAY / MA’RUZA / «devor matn» TAQIQLANGAN. " +
    "4–8 qisqa qator. Har qator yangi qatordan. Bulletlar «• » bilan. " +
    `Emoji ${3}–${EMOJI_MAX} ta, mavzuga mos, spam emas. ` +
    "Faqat o‘zbek tili. HTML: faqat <b>. " +
    "Taqiqlangan: qarz, nasiya, ombor qoldig‘i, foyda/zarar, kassir, smena, dead stock, " +
    "«Sifatli tanlov — kunni chiroyliroq qiladi», hard sell, yolg‘on chegirma.";

  if (isEdu) {
    return (
      "Sen «Dunyo Zamin» (Dunyozamin_News) — qurilish, santexnika, yoritish do‘koni " +
      "Telegram News kanali professional SMM copywriterisan. Auditoriyasi: ustalar, uy egalari. " +
      `Bugungi KONTENT TURI majburiy: «${ct.title}» (${ct.id}). Bu MAHSULOT REKLAMASI EMAS. ` +
      `Ohang: ${ct.vibe || ''} Ochilish: ${ct.openingHint || 'Qisqa hook.'} ` +
      `${styleRules} ` +
      "Tuzilma MAJBURIY: (1) emoji + sarlavha hook, (2) 3–4 qisqa bullet tip, " +
      "(3) ixtiyoriy 1 qator yumshoq CTA FAQAT mavzu do‘kon assortimentiga MOS bo‘lsa " +
      "(LED tip → yoritish/sim; quvur tip → santexnika). Mavzu–mahsulot mos kelmasa — promo YO‘Q, " +
      "elektrdan santexnikaga «sakrash» TAQIQLANGAN. (4) 1 qator engagement savol, " +
      `(5) #Dunyozamin #News ${extraTag}. ` +
      `Uzunlik: ${CAPTION_AI_TARGET_MIN}–${CAPTION_AI_TARGET_MAX} belgi (yumshoq max ${CAPTION_SOFT_MAX}, hard ${CAPTION_MAX}). ` +
      "Faqat caption matnini qaytar."
    );
  }

  const title = ct.id === 'combo_bundle' ? ct.title : rubric?.title || ct.title;
  const opening =
    ct.openingHint || rubric?.openingHint || 'Har safar boshqa ochilish uslubidan foydalan.';
  const vibe = ct.vibe || rubric?.vibe || '';
  return (
    "Sen «Dunyo Zamin» (Dunyozamin_News) — qurilish, santexnika, yoritish do‘koni " +
    "Telegram News kanali professional SMM copywriterisan. Auditoriyasi: ustalar, uy egalari. " +
    `Kontent turi: «${ct.title}». Rubrika: «${title}» (${weekday}). ${vibe} ` +
    `Ochilish: ${opening} ` +
    `${styleRules} ` +
    "Tuzilma: emoji sarlavha + mahsulot nomi + 2–3 qisqa foyda qatori + aniq narx + yumshoq CTA + " +
    `#Dunyozamin #News ${extraTag}. ` +
    "Mahsulot nomi, kategoriya/brend (bo‘lsa) va narxdan foydalan. " +
    "Atvod/fiting: o‘lcham/ulanish. LED/lampa: xona/xavfsizlik. " +
    `Uzunlik: ${CAPTION_AI_TARGET_MIN}–${CAPTION_AI_TARGET_MAX} belgi (yumshoq max ${CAPTION_SOFT_MAX}, hard ${CAPTION_MAX}). ` +
    "Faqat caption matnini qaytar."
  );
}

function captionUserPayload({ storeName, product, rubric, contentType, topic }) {
  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const extraTag = ct.hashtagExtra || '#tavsiya';
  const desc = product
    ? String(product.description || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220)
    : null;
  const topicHint = topic || pickEduTopic(ct, {});
  const softOk = productMatchesTopic(product, topicHint);

  if (isEdu) {
    return {
      store_name: storeName,
      channel: 'Dunyozamin_News',
      audience: 'mijozlar + ustalar (public News)',
      weekday: rubric?.weekdayName || null,
      content_type: {
        id: ct.id,
        title: ct.title,
        emoji: ct.emoji,
        kind: 'edu',
        vibe: ct.vibe || '',
        opening_hint: ct.openingHint || '',
      },
      topic_hint: topicHint,
      optional_soft_product:
        softOk && product
          ? {
              name: product.name,
              category: product.category_name || null,
              brand: product.brand || null,
              note:
                'Faqat 1 qator yumshoq eslatma; narx majburiy emas. Mavzu mos — OK. Mos kelmasa — yozma.',
            }
          : null,
      soft_promo_allowed: softOk,
      writing_rules: {
        min_chars: CAPTION_AI_TARGET_MIN,
        max_chars: CAPTION_AI_TARGET_MAX,
        soft_max_chars: CAPTION_SOFT_MAX,
        style: 'short_social_media',
        lines: '4-8',
        bullets: '3-4',
        emoji_min: 3,
        emoji_max: EMOJI_MAX,
        vary_opening: true,
        educational: true,
        no_hard_sell: true,
        no_essay: true,
        no_generic_slogans: true,
        match_promo_to_topic: true,
      },
      must_include: {
        soft_cta: softOk,
        engagement_question: true,
        hashtags: ['#Dunyozamin', '#News', extraTag],
      },
      avoid: [
        'Sifatli tanlov — kunni chiroyliroq qiladi',
        'kunni chiroyliroq qiladi',
        'hozir sotib oling',
        'yolg‘on chegirma foizi',
        'emoji spam',
        'uzun ma’ruza / essay',
        'devor matn (wall of text)',
        'elektr tipidan santexnika soft-sellga sakrash',
        'ombor qoldig‘i',
        'foyda / zarar / smena',
      ],
    };
  }

  return {
    store_name: storeName,
    channel: 'Dunyozamin_News',
    audience: 'mijozlar + ustalar (public News)',
    weekday: rubric?.weekdayName || null,
    content_type: {
      id: ct.id,
      title: ct.title,
      emoji: ct.emoji,
      kind: 'product',
      vibe: ct.vibe || '',
    },
    rubric: {
      id: rubric?.id,
      title: rubric?.title,
      emoji: rubric?.emoji,
      vibe: rubric?.vibe || '',
      opening_hint: rubric?.openingHint || ct.openingHint || '',
    },
    product: {
      name: product.name,
      price_formatted: `${formatSumma(product.sale_price)} so'm`,
      category: product.category_name || null,
      brand: product.brand || null,
      sku: product.sku || null,
      article: product.article || null,
      description_excerpt: desc || null,
      use_case_hint: inferUseCaseHint(product),
    },
    writing_rules: {
      min_chars: CAPTION_AI_TARGET_MIN,
      max_chars: CAPTION_AI_TARGET_MAX,
      soft_max_chars: CAPTION_SOFT_MAX,
      style: 'short_social_media',
      lines: '4-8',
      pitch_lines: '2-3',
      emoji_min: 3,
      emoji_max: EMOJI_MAX,
      vary_opening: true,
      must_mention_real_use_case: true,
      no_generic_slogans: true,
      no_essay: true,
    },
    must_include: {
      product_name: true,
      exact_price: true,
      soft_cta: true,
      hashtags: ['#Dunyozamin', '#News', extraTag],
    },
    avoid: [
      'Sifatli tanlov — kunni chiroyliroq qiladi',
      'kunni chiroyliroq qiladi',
      'bir xil umumiy sloganlar',
      'yolg‘on chegirma foizi',
      'emoji spam',
      'uzun essay',
      'faqat 1 qisqa umumiy jumla',
      'ombor qoldig‘i',
      'foyda / zarar / smena',
    ],
  };
}

function countEmojis(text) {
  const matches = String(text || '').match(
    /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu,
  );
  return matches ? matches.length : 0;
}

function qualityCheckCaption(caption, product, options = {}) {
  const text = String(caption || '').trim();
  const minLen = Number(options.minLength) > 0 ? Number(options.minLength) : CAPTION_MIN;
  const softMax =
    Number(options.softMaxLength) > 0 ? Number(options.softMaxLength) : CAPTION_SOFT_MAX;
  const contentType = options.contentType || null;
  const isEdu = contentTypeKind(contentType) === 'edu';
  if (!text) return { ok: false, reason: 'empty_caption' };
  if (text.length < minLen) return { ok: false, reason: 'too_short' };
  if (text.length > CAPTION_MAX) return { ok: false, reason: 'too_long' };
  if (text.length > softMax) return { ok: false, reason: 'too_long_soft' };
  if (FORBIDDEN_RE.test(text) || INTERNAL_CAPTION_RE.test(text)) {
    return { ok: false, reason: 'forbidden_content' };
  }
  if (BANNED_SLOGAN_RE.test(text)) {
    return { ok: false, reason: 'banned_slogan' };
  }
  if (countEmojis(text) > EMOJI_MAX) {
    return { ok: false, reason: 'emoji_spam' };
  }
  if (!/#Dunyozamin/i.test(text) || !/#News\b/i.test(text)) {
    return { ok: false, reason: 'missing_hashtags' };
  }

  if (isEdu) {
    // Price and product name optional for educational posts.
    return { ok: true };
  }

  if (!/\d/.test(text)) return { ok: false, reason: 'no_price_digits' };
  const name = String(product?.name || '').trim();
  if (!isPublishableProductName(name)) return { ok: false, reason: 'junk_product_name' };
  if (name.length >= 4) {
    const needle = name.slice(0, Math.min(12, name.length)).toLowerCase();
    if (!text.toLowerCase().includes(needle.slice(0, 6))) {
      return { ok: false, reason: 'product_name_missing' };
    }
  }
  return { ok: true };
}

function fetchImpl(options) {
  return options.fetchFn || options.fetchFn || globalThis.fetch;
}

async function generateCaptionWithOpenAi(
  { storeName, product, rubric, contentType, topic },
  options = {},
) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_api_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const temperature = options.temperatureBoost ? 0.95 : 0.88;
  try {
    const res = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        max_tokens: 520,
        messages: [
          { role: 'system', content: captionSystemPrompt(rubric, contentType) },
          {
            role: 'user',
            content: JSON.stringify(
              captionUserPayload({ storeName, product, rubric, contentType, topic }),
            ),
          },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 40_000),
    });
    if (!res.ok) return { ok: false, reason: `openai_http_${res.status}` };
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, reason: 'empty_response' };
    return { ok: true, text: text.slice(0, CAPTION_MAX), provider: 'openai' };
  } catch (e) {
    return { ok: false, reason: 'openai_error', detail: String(e?.message || e).slice(0, 80) };
  }
}

async function generateCaptionWithGemini(
  { storeName, product, rubric, contentType, topic },
  options = {},
) {
  const cfg = resolveGeminiTextConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_gemini_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const prompt = [
    captionSystemPrompt(rubric, contentType),
    '',
    JSON.stringify(captionUserPayload({ storeName, product, rubric, contentType, topic })),
  ].join('\n');

  const models = [
    cfg.model,
    process.env.GEMINI_TEXT_MODEL,
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
  ]
    .map((m) => String(m || '').trim())
    .filter((m, i, arr) => m && arr.indexOf(m) === i);

  const temperature = options.temperatureBoost ? 1.05 : 0.95;
  let lastReason = 'empty_response';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cfg.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 650 },
        }),
        signal: AbortSignal.timeout(options.timeoutMs || 40_000),
      });
      if (!res.ok) {
        lastReason = `gemini_http_${res.status}`;
        // Try next model on 404/not found
        if (res.status === 404 || res.status === 400) continue;
        return { ok: false, reason: lastReason, model };
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .map((p) => String(p?.text || ''))
        .join('\n')
        .trim();
      if (!text) {
        lastReason = 'empty_response';
        continue;
      }
      return { ok: true, text: text.slice(0, CAPTION_MAX), provider: 'gemini', model };
    } catch (e) {
      lastReason = 'gemini_error';
      if (String(e?.name || '').includes('Timeout') || /aborted|timeout/i.test(String(e?.message || ''))) {
        continue;
      }
      return { ok: false, reason: lastReason, detail: String(e?.message || e).slice(0, 80), model };
    }
  }
  return { ok: false, reason: lastReason };
}

async function generateCaption(ctx, options = {}) {
  const geminiText = await generateCaptionWithGemini(ctx, options);
  if (geminiText.ok) return geminiText;
  const openai = resolveOpenAiConfig(options);
  if (openai.hasApiKey) {
    const out = await generateCaptionWithOpenAi(ctx, options);
    if (out.ok) return out;
  }
  return { ok: false, reason: geminiText.reason || 'no_caption_llm' };
}

function buildImagePrompt({ storeName, product, rubric, contentType, topic }) {
  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const style = ct.imageStyle || 'clean retail photography, no text';
  const moodBits = [
    'eye-catching but professional',
    'warm daylight + soft fill',
    'hardware retail aesthetic',
    'single clear focal subject',
  ];

  if (isEdu) {
    return (
      `Create one striking educational visual for a Central Asian hardware / plumbing / lighting ` +
      `Telegram News channel (Dunyo Zamin / Dunyozamin_News). ${style}. ` +
      `Content type: ${ct.title}. Topic mood: ${topic || ct.title}. ` +
      `Scene should feel useful and human — tools, fittings, or lighting in a real home/workshop context. ` +
      `${moodBits.join(', ')}. ` +
      `No readable text, no watermarks, no logos, no price tags, no collages, no UI mockups, no flags. ` +
      `Store aesthetic: ${storeName}. Square 1:1, magazine quality.`
    );
  }

  return (
    `Professional commercial product photograph for a hardware, plumbing fittings, ` +
    `lighting and home-improvement retail Telegram News channel (Dunyo Zamin / Dunyozamin_News). ` +
    `No text, no watermarks, no logos, no price tags, no collages. ` +
    `Subject: ${product?.name || 'hardware product'}. Category mood: ${product?.category_name || 'building materials / fittings'}. ` +
    `Story: ${ct.title} — ${rubric?.title || ''} — ${style}. ` +
    `${moodBits.join(', ')}. Store aesthetic: ${storeName}. ` +
    `Photoreal, shallow depth of field, square 1:1, magazine quality.`
  );
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function generatePosterImageGemini(
  { storeName, product, rubric, contentType, topic },
  options = {},
) {
  const cfg = resolveGeminiConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_gemini_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const prompt = buildImagePrompt({ storeName, product, rubric, contentType, topic });
  const models = [cfg.model, ...GEMINI_IMAGE_MODEL_FALLBACKS]
    .map((m) => String(m || '').trim())
    .filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastReason = 'gemini_no_image';
  let lastDetail = '';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cfg.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          signal: AbortSignal.timeout(options.timeoutMs || 90_000),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          lastReason = `gemini_http_${res.status}`;
          lastDetail = t.slice(0, 120);
          if (res.status === 429 || res.status === 503) {
            await sleepMs(1200 * (attempt + 1));
            continue;
          }
          // Model missing / bad request → try next model
          if (res.status === 404 || res.status === 400) break;
          return { ok: false, reason: lastReason, detail: lastDetail, model };
        }
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          const inline = part.inlineData || part.inline_data;
          if (inline?.data) {
            const buf = Buffer.from(String(inline.data), 'base64');
            if (buf.length > 500) {
              const mime = String(inline.mimeType || inline.mime_type || 'image/jpeg');
              const ext = mime.includes('png') ? 'png' : 'jpg';
              return {
                ok: true,
                buffer: buf,
                filename: `poster.${ext}`,
                mime,
                provider: 'gemini',
                model,
              };
            }
          }
        }
        lastReason = 'gemini_no_image';
        break;
      } catch (e) {
        lastReason = 'gemini_error';
        lastDetail = String(e?.message || e).slice(0, 80);
        if (
          String(e?.name || '').includes('Timeout') ||
          /aborted|timeout/i.test(String(e?.message || ''))
        ) {
          continue;
        }
        return { ok: false, reason: lastReason, detail: lastDetail, model };
      }
    }
  }
  return { ok: false, reason: lastReason, detail: lastDetail };
}

async function generatePosterImageOpenAi(
  { storeName, product, rubric, contentType, topic },
  options = {},
) {
  const cfg = resolveOpenAiImageConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_openai_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const prompt = buildImagePrompt({ storeName, product, rubric, contentType, topic });
  const model = cfg.model || DEFAULT_OPENAI_IMAGE_MODEL;
  const isDalle3 = /^dall-e-3$/i.test(model);

  const body = isDalle3
    ? {
        model: 'dall-e-3',
        prompt: prompt.slice(0, 3900),
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }
    : {
        model,
        prompt: prompt.slice(0, 3900),
        n: 1,
        size: '1024x1024',
      };

  try {
    const res = await fetchFn(`${cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs || 120_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      // Retry once with dall-e-3 if gpt-image model unavailable
      if (!isDalle3 && (res.status === 404 || res.status === 400)) {
        return generatePosterImageOpenAi(
          { storeName, product, rubric, contentType, topic },
          { ...options, openaiImageModel: 'dall-e-3' },
        );
      }
      return { ok: false, reason: `openai_http_${res.status}`, detail: t.slice(0, 120), model };
    }
    const data = await res.json();
    const item = Array.isArray(data?.data) ? data.data[0] : null;
    if (item?.b64_json) {
      const buf = Buffer.from(String(item.b64_json), 'base64');
      if (buf.length > 500) {
        return {
          ok: true,
          buffer: buf,
          filename: 'poster.png',
          mime: 'image/png',
          provider: 'openai',
          model,
        };
      }
    }
    if (item?.url && /^https?:\/\//i.test(String(item.url))) {
      const imgRes = await fetchFn(String(item.url), {
        method: 'GET',
        signal: AbortSignal.timeout(options.timeoutMs || 60_000),
      });
      if (!imgRes.ok) {
        return { ok: false, reason: `openai_image_fetch_${imgRes.status}`, model };
      }
      const ab = await imgRes.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length > 500) {
        return {
          ok: true,
          buffer: buf,
          filename: 'poster.jpg',
          mime: 'image/jpeg',
          provider: 'openai',
          model,
        };
      }
    }
    return { ok: false, reason: 'openai_no_image', model };
  } catch (e) {
    return {
      ok: false,
      reason: 'openai_error',
      detail: String(e?.message || e).slice(0, 80),
      model,
    };
  }
}

/**
 * Prefer Gemini image → OpenAI Images → (caller) product photo / text-only.
 */
async function generatePosterImage(ctx, options = {}) {
  const gemini = await generatePosterImageGemini(ctx, options);
  if (gemini.ok && gemini.buffer) {
    return { ...gemini, source: 'gemini' };
  }
  const openai = await generatePosterImageOpenAi(ctx, options);
  if (openai.ok && openai.buffer) {
    return { ...openai, source: 'openai', fallbackFrom: gemini.reason };
  }
  return {
    ok: false,
    reason: openai.reason || gemini.reason || 'no_image',
    geminiReason: gemini.reason || null,
    openaiReason: openai.reason || null,
  };
}

function resolveProductPhoto(product) {
  const raw = String(product?.image_url || '').trim();
  if (!raw) return { ok: false, reason: 'no_image_url' };
  if (/^https?:\/\//i.test(raw)) return { ok: true, photoUrl: raw };

  const fileName = extractProductImageFileName(raw);
  if (fileName) {
    const filePath = path.join(getProductImageDir(), fileName);
    try {
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        if (buffer.length > 100) return { ok: true, photoBuffer: buffer, filename: fileName };
      }
    } catch {
      // fall through
    }
  }

  const base =
    stripEnvQuotes(process.env.VITE_APP_PUBLIC_URL || '') ||
    stripEnvQuotes(process.env.PUBLIC_API_PUBLIC_URL || '') ||
    stripEnvQuotes(process.env.TELEGRAM_WEB_APP_URL || '');
  if (base) {
    const host = base.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const fakeReq = {
      headers: {
        host,
        'x-forwarded-proto': base.startsWith('https') ? 'https' : 'http',
      },
    };
    const resolved = resolveCatalogImageUrl(raw, fakeReq);
    if (resolved && /^https?:\/\//i.test(resolved)) return { ok: true, photoUrl: resolved };
  }
  return { ok: false, reason: 'image_unresolved' };
}

async function composePoster(db, options = {}) {
  const settings = getDailyPosterSettings(db);
  const parts = localTimeParts(db);
  const today = String(options.date || parts.date).slice(0, 10);
  const weekday = options.weekday != null ? normalizeWeekday(options.weekday) : parts.weekday;
  const rubric = pickRubric(weekday, options);
  const contentType = pickContentType(weekday, {
    ...options,
    db,
    weekday,
  });
  const isEdu = contentTypeKind(contentType) === 'edu';
  const topic = isEdu
    ? options.topic ||
      pickEduTopic(contentType, {
        dayOfYear: parts.dayOfYear,
        weekday,
        date: today,
      })
    : null;

  let product = null;
  let snapshot = options.snapshot || null;
  if (!isEdu || options.softProduct !== false) {
    const selected = selectProductForRubric(db, rubric, {
      date: today,
      storeName: settings.storeName,
      dayOfYear: parts.dayOfYear,
      snapshot: options.snapshot,
      skipProductIds: options.skipProductIds,
    });
    product = selected.product;
    snapshot = selected.snapshot;
  }

  if (!isEdu && (!product || !isPublishableProductName(product.name))) {
    return { ok: false, reason: 'no_products', rubric, contentType, today };
  }

  // Soft product only if name is publishable; otherwise pure tip.
  if (isEdu && product && !isPublishableProductName(product.name)) {
    product = null;
  }

  const captionCtx = {
    storeName: settings.storeName,
    product,
    rubric,
    contentType,
    topic,
    snapshot,
  };

  let caption = null;
  let captionSource = 'template';
  const llm = await generateCaption(captionCtx, options);
  if (llm.ok) {
    caption = llm.text;
    captionSource = llm.provider || 'llm';
  } else {
    caption = buildTemplateCaption(captionCtx);
  }

  let qc = qualityCheckCaption(caption, product, {
    minLength: captionSource === 'template' ? CAPTION_MIN : CAPTION_AI_TARGET_MIN,
    softMaxLength: CAPTION_SOFT_MAX,
    contentType,
  });
  if (!qc.ok) {
    if (captionSource !== 'template') {
      qc = qualityCheckCaption(caption, product, {
        minLength: CAPTION_MIN,
        softMaxLength: CAPTION_SOFT_MAX,
        contentType,
      });
      if (!qc.ok) {
        const again = await generateCaption(captionCtx, { ...options, temperatureBoost: true });
        if (again.ok) {
          caption = again.text;
          captionSource = again.provider || 'llm';
          qc = qualityCheckCaption(caption, product, {
            minLength: CAPTION_MIN,
            softMaxLength: CAPTION_SOFT_MAX,
            contentType,
          });
        }
      }
    }
    if (!qc.ok) {
      caption = buildTemplateCaption(captionCtx);
      captionSource = 'template';
      qc = qualityCheckCaption(caption, product, {
        minLength: CAPTION_MIN,
        softMaxLength: CAPTION_SOFT_MAX,
        contentType,
      });
    }
  }

  if (!qc.ok) {
    return {
      ok: false,
      reason: 'quality_failed',
      qualityReason: qc.reason,
      rubric,
      contentType,
      product,
      today,
    };
  }

  const skipImage = options.skipImage === true;
  let image = { ok: false, reason: 'skipped' };
  if (!skipImage) {
    const generated = await generatePosterImage(captionCtx, options);
    if (generated.ok && generated.buffer) {
      image = {
        ok: true,
        photoBuffer: generated.buffer,
        filename: generated.filename || 'poster.jpg',
        source: generated.source || generated.provider || 'ai',
        model: generated.model || null,
        fallbackFrom: generated.fallbackFrom || null,
      };
    } else if (!isEdu && product) {
      const fallback = resolveProductPhoto(product);
      image = {
        ...fallback,
        fallbackFrom: generated.reason,
        geminiReason: generated.geminiReason || null,
        openaiReason: generated.openaiReason || null,
        source: fallback.ok ? 'product' : 'none',
      };
    } else {
      // Edu without AI image → text-only last resort.
      image = {
        ok: false,
        reason: generated.reason || 'edu_text_only',
        geminiReason: generated.geminiReason || null,
        openaiReason: generated.openaiReason || null,
        source: 'none',
      };
    }
  }

  return {
    ok: true,
    today,
    weekday,
    rubric,
    contentType: {
      id: contentType.id,
      title: contentType.title,
      emoji: contentType.emoji,
      kind: contentType.kind,
    },
    topic: topic || null,
    product: product
      ? {
          id: product.id,
          name: product.name,
          sale_price: product.sale_price,
          current_stock: product.current_stock,
          category_name: product.category_name || null,
          brand: product.brand || null,
          sku: product.sku || null,
          image_url: product.image_url || null,
        }
      : null,
    caption,
    captionSource,
    image,
    storeName: settings.storeName,
  };
}

async function postComposedPoster(composed, options = {}) {
  const creds = resolveMarketingCredentials(options);
  if (!creds.botToken) return { ok: false, sent: 0, failed: 0, reason: 'no_bot_token' };
  if (!creds.channelId) return { ok: false, sent: 0, failed: 0, reason: 'no_channel_id' };
  if (creds.blockedReportsChannel) {
    return { ok: false, sent: 0, failed: 0, reason: 'blocked_reports_channel' };
  }

  const caption = String(composed.caption || '').slice(0, CAPTION_MAX);
  const img = composed.image || {};

  if (img.ok && (img.photoBuffer || img.photoUrl)) {
    const out = await sendTelegramPhoto({
      botToken: creds.botToken,
      telegramId: creds.channelId,
      photoBuffer: img.photoBuffer || null,
      photoUrl: img.photoUrl || null,
      filename: img.filename || 'poster.jpg',
      caption,
      parseMode: 'HTML',
    });
    if (out.ok) return { ok: true, sent: 1, failed: 0, method: 'sendPhoto' };
  }

  const outText = await sendTelegramText({
    botToken: creds.botToken,
    telegramId: creds.channelId,
    text: caption,
    parseMode: 'HTML',
  });
  if (outText.ok) return { ok: true, sent: 1, failed: 0, method: 'sendMessage' };
  return { ok: false, sent: 0, failed: 1, reason: outText.reason || 'send_failed' };
}

async function runDailyPosterTick(db, options = {}) {
  ensureEnvLoaded(options);
  const settings = getDailyPosterSettings(db);
  const creds = resolveMarketingCredentials(options);

  if (creds.blockedReportsChannel) {
    return { ok: false, skipped: true, reason: 'blocked_reports_channel' };
  }
  if (!settings.enabled && !options.force) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!creds.hasCredentials && !options.force) {
    return { ok: false, skipped: true, reason: 'no_credentials' };
  }

  const gate = shouldRunDailyPoster(db, settings, options);
  if (!gate.ok) {
    return { ok: false, skipped: true, reason: gate.reason, today: gate.today };
  }

  if (!options.skipLock) {
    const owner = tryAcquireSchedulerLock(db, {
      name: LOCK_NAME,
      ttlMs: options.lockTtlMs || 180_000,
    });
    if (!owner) {
      return { ok: false, skipped: true, reason: 'lock_held', today: gate.today };
    }
  }

  let composed = await composePoster(db, { ...options, date: gate.today });
  if (!composed.ok && composed.reason === 'quality_failed') {
    // Same content type + weekday rubric, try another product (not another day's tone).
    composed = await composePoster(db, {
      ...options,
      date: gate.today,
      rubricId: composed.rubric?.id,
      contentTypeId: composed.contentType?.id,
      skipProductIds: composed.product?.id ? [composed.product.id] : [],
    });
  }

  if (!composed.ok) {
    return {
      ok: false,
      skipped: false,
      reason: composed.reason || 'compose_failed',
      qualityReason: composed.qualityReason || null,
      today: gate.today,
      rubric: composed.rubric?.id || null,
      rubricTitle: composed.rubric?.title || null,
      contentType: composed.contentType?.id || null,
      contentTypeTitle: composed.contentType?.title || null,
    };
  }

  const out = await postComposedPoster(composed, options);
  if (out.ok || out.sent > 0) {
    if (!options.sampleOnly && !options.skipMarkRun) {
      writeSetting(db, 'reports.telegram.daily_poster_last_run_date', gate.today, 'string');
      claimNotifyDedup(db, EVENT_DAILY_POSTER, gate.today);
    }
    if (composed.product?.id) pushRecentProductId(db, composed.product.id);
    if (composed.contentType?.id) pushRecentContentTypeId(db, composed.contentType.id);
  }

  return {
    ...out,
    today: gate.today,
    weekday: composed.weekday,
    rubric: composed.rubric?.id,
    rubricTitle: composed.rubric?.title || null,
    contentType: composed.contentType?.id || null,
    contentTypeTitle: composed.contentType?.title || null,
    contentKind: composed.contentType?.kind || null,
    topic: composed.topic || null,
    productId: composed.product?.id,
    productName: composed.product?.name || null,
    captionSource: composed.captionSource,
    captionLen: composed.caption ? String(composed.caption).length : 0,
    imageSource: composed.image?.source || 'none',
    kind: 'daily_poster',
    sampleOnly: Boolean(options.sampleOnly),
  };
}

async function sendDailyPosterNow(db, options = {}) {
  return runDailyPosterTick(db, { ...options, force: true, skipLock: options.skipLock !== false });
}

module.exports = {
  LOCK_NAME,
  EVENT_DAILY_POSTER,
  DEFAULT_POSTER_TIME,
  DEFAULT_GEMINI_IMAGE_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
  RUBRICS,
  CONTENT_TYPES,
  WEEKDAY_CONTENT_TYPE_IDS,
  CAPTION_MIN,
  CAPTION_SOFT_MAX,
  CAPTION_AI_TARGET_MIN,
  CAPTION_AI_TARGET_MAX,
  EMOJI_MAX,
  formatSumma,
  isPublishableProductName,
  resolveMarketingCredentials,
  resolveGeminiConfig,
  resolveOpenAiImageConfig,
  getDailyPosterSettings,
  pickRubric,
  pickContentType,
  getContentTypeById,
  contentTypeKind,
  pickEduTopic,
  normalizeWeekday,
  shouldRunDailyPoster,
  listCandidateProducts,
  selectProductForRubric,
  readRecentProductIds,
  pushRecentProductId,
  readRecentContentTypeIds,
  pushRecentContentTypeId,
  inferUseCaseHint,
  productMatchesTopic,
  softPromoLine,
  buildEduTipBullets,
  buildTemplateCaption,
  buildImagePrompt,
  qualityCheckCaption,
  generateCaptionWithOpenAi,
  generateCaptionWithGemini,
  generateCaption,
  generatePosterImageGemini,
  generatePosterImageOpenAi,
  generatePosterImage,
  resolveProductPhoto,
  composePoster,
  postComposedPoster,
  runDailyPosterTick,
  sendDailyPosterNow,
};
