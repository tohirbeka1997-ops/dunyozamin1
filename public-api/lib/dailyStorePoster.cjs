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
const CAPTION_MAX = 1020;
/** Soft floor — AI captions should be richer; templates must still clear this. */
const CAPTION_MIN = 110;
const CAPTION_AI_TARGET_MIN = 220;
const RECENT_PRODUCTS_KEY = 'reports.telegram.daily_poster_recent_products';
const RECENT_PRODUCT_LIMIT = 14;
const RECENT_CONTENT_TYPES_KEY = 'reports.telegram.daily_poster_recent_content_types';
const RECENT_CONTENT_TYPE_LIMIT = 10;
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

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
      'Mahsulotni aniq va ishonchli taqdim et: nomi, qo‘llanish joyi, 2–4 jumlalik pitch, aniq narx. ' +
      'Reklama shovqinisiz, usta/uy egasi uchun foydali.',
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
      'Qurilish/santexnika/yoritish bo‘yicha 1 ta amaliy maslahat. Qadam-baqadam yoki «nima qilish kerak». ' +
      'Hard sell YO‘Q. Ixtiyoriy: oxirida yumshoq mahsulot eslatmasi (narxsiz ham bo‘lishi mumkin).',
    openingHint: '«Maslahat:» yoki to‘g‘ridan-to‘g‘ri foydali gap bilan boshla.',
    imageStyle:
      'clean illustrated how-to scene for home plumbing or lighting tip, educational, no readable text, no logos',
    topicHints: [
      'PPR/metalloplastik quvur ulashda o‘lchamni tekshirish',
      'LED lenta yoki lampani almashtirishda xavfsizlik',
      'Kran/smesitel o‘rnatishda lenta va germetik',
      'Rozetka/patron montajida simni to‘g‘ri mahkamlash',
      'Devorga dublon/vint tanlash',
    ],
  },
  {
    id: 'life_hack',
    kind: 'edu',
    title: 'Life hack',
    emoji: '⚡',
    hashtagExtra: '#lifehack',
    vibe:
      'Qisqa, amaliy «hayot hack»: uy/usta uchun 1 ta oddiy hiyla (vaqt/tejam/xavfsizlik). ' +
      'Yumor yumshoq bo‘lishi mumkin, lekin jiddiy foyda bo‘lsin. Hard sell yo‘q.',
    openingHint: '«Life hack:» yoki «Tez yechim:» bilan boshla.',
    imageStyle:
      'clever practical DIY life-hack visual for home repair, bright simple composition, no text',
    topicHints: [
      'Eski lenta qoldig‘ini olib tashlashning oson usuli',
      'Quvur o‘lchamini tezkor aniqlash',
      'Qorong‘i shkafda LED bilan yoritishni soddalashtirish',
      'Tomchilab turgan joyda vaqtinchalik hermetik',
      'Kalit/instrumentni yo‘qotmaslik uchun joylash',
    ],
  },
  {
    id: 'myth_fact',
    kind: 'edu',
    title: 'Afsona vs haqiqat',
    emoji: '❓',
    hashtagExtra: '#savol',
    vibe:
      '1 ta keng tarqalgan noto‘g‘ri fikr YOKI mijoz savoli + aniq, qisqa haqiqiy javob. ' +
      'Suhbat ohangi. Mahsulot faqat yumshoq eslatma sifatida.',
    openingHint: '«Afsona:» / «Ko‘p so‘raladi:» yoki savol belgisidan boshla.',
    imageStyle:
      'friendly FAQ / myth-vs-fact educational visual for home improvement, minimal, no text',
    topicHints: [
      '«Arzon fiting ham bir xil» — haqiqatmi?',
      'LED lampalar elektr tejaydimi?',
      'Lenta o‘rniga faqat germetik yetadimi?',
      'Katta o‘lchamli quvur har doim yaxshiroqmi?',
    ],
  },
  {
    id: 'seasonal_care',
    kind: 'edu',
    title: 'Mavsumiy parvarish',
    emoji: '🌿',
    hashtagExtra: '#parvarish',
    vibe:
      'Mavsumga mos uy/santexnika/yoritish parvarishi yoki oldini olish maslahati. ' +
      'Sotuv urg‘usiz, g‘amxo‘rlik ohangi.',
    openingHint: 'Mavsum yoki «uyingizni tayyorlang» uslubida boshla.',
    imageStyle:
      'seasonal home care mood for plumbing or lighting maintenance, calm photoreal, no text',
    topicHints: [
      'Qish oldidan tashqi kran/quvurlarni himoya',
      'Yozda yoritishni tejash',
      'Nam faslda rozetka/elektr xavfsizligi',
      'Changli mavsumda ventilyatsiya/filtr eslatmasi',
    ],
  },
  {
    id: 'behind_shop',
    kind: 'edu',
    title: 'Sifat checklist',
    emoji: '✅',
    hashtagExtra: '#sifat',
    vibe:
      'Do‘kon ortidagi sifat / tanlash checklisti: mijoz nimalarga e’tibor bersin. ' +
      'Hard sell yo‘q — ishonch va professionalizm.',
    openingHint: '«Sifat checklist:» yoki «Tanlashda 3 narsa:» bilan boshla.',
    imageStyle:
      'organized hardware shop quality checklist mood, tidy shelves tools fittings, no text logos',
    topicHints: [
      'Fiting tanlashda 3 belgi',
      'Yoritish mahsulotida etiketi o‘qish',
      'Kafolat va brendni tekshirish',
      'O‘lcham/standart mosligi',
    ],
  },
  {
    id: 'combo_bundle',
    kind: 'product',
    title: 'Birga oling',
    emoji: '🧩',
    hashtagExtra: '#birga',
    vibe:
      'Asosiy mahsulot + 1–2 mos qo‘shimcha g‘oya (mufta, lenta, sim…). Yolg‘on chegirma yo‘q. Aniq narx.',
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
      'Sifat, kafolat hissi, brend ishonchi. Qurilish/santexnika/yorug‘lik do‘koni ohangi. ' +
      'Mahsulotning mustahkamligi yoki uzoq muddatli foydasini ta’kidla. Premium, sokin, ishonchli.',
    templatePitch:
      'Mustahkam material va barqaror o‘tirish — uy yoki ofisda uzoq muddat xotirjam ishlash uchun.',
    openingHint: 'Ishonch / kafolat ohangi bilan boshla (lekin «sifatli tanlov» dema).',
    prefer: 'stock_image',
  },
  {
    id: 'monday_new_stock',
    weekday: 1,
    weekdayName: 'Dushanba',
    title: 'Yangi kelganlar',
    emoji: '✨',
    vibe:
      'Yangi kelgan / vitrinada bor. Yangilik hissi, lekin ombor sonini yozma. ' +
      'Mahsulot nima ekanini aniq ayt, yangi yetkazilgan kayfiyat + aniq ishlatish joyi.',
    templatePitch:
      'Yangi partiya vitrinada: kerakli o‘lcham va turdagi detalni hozir tanlab, ishni kechiktirmasdan boshlash mumkin.',
    openingHint: '«Vitrinaga keldi / yangi partiyadan» uslubida boshla.',
    prefer: 'stock_image',
  },
  {
    id: 'tuesday_pro_tip',
    weekday: 2,
    weekdayName: 'Seshanba',
    title: 'Usta uchun maslahat',
    emoji: '🔧',
    vibe:
      'Usta / montajchi uchun: qayerda ishlatiladi, qanday vazifaga mos, 1 ta amaliy maslahat. ' +
      'Santexnika/yoritish kontekstida aniq yoz. Reklama shovqinisiz.',
    templatePitch:
      'Usta uchun maslahat: o‘lchovni oldindan tekshiring — to‘g‘ri fiting/armatura tanlansa, qayta ish va sizib chiqish kamayadi.',
    openingHint: 'To‘g‘ridan-to‘g‘ri maslahat yoki «Usta uchun:» bilan boshla.',
    prefer: 'category',
  },
  {
    id: 'wednesday_value',
    weekday: 3,
    weekdayName: 'Chorshanba',
    title: 'Narx–sifat tanlov',
    emoji: '⚖️',
    vibe:
      'Narx-sifat muvozanati, tejamkor aqlli tanlov. Narxni aniq yoz, ' +
      'lekin “eng arzon” deb maqtama — qiymat, chidamlilik va ish natijasi muhim.',
    templatePitch:
      'Byudjetni saqlab, ish sifatini boy bermaslik: narx aniq, natija esa montajda va kundalik ishonchda seziladi.',
    openingHint: 'Narx–qiymat muvozanati yoki «aqlli tanlov» (lekin taqiqlangan sloganlarsiz) bilan boshla.',
    prefer: 'mid_price',
  },
  {
    id: 'thursday_bundle',
    weekday: 4,
    weekdayName: 'Payshanba',
    title: 'Birga oling',
    emoji: '🧩',
    vibe:
      'To‘plam / birga olish g‘oyasi: bu mahsulot bilan qanday qo‘shimcha (mufta, lenta, sim, patron, kalit…) ' +
      'olinsa ish to‘liq bo‘ladi. Yolg‘on “komplekt chegirmasi” uydirma. Aniq 1–2 qo‘shimcha taklif.',
    templatePitch:
      'Birga oling: asosiy detal + mufta/lenta yoki mos o‘tkazgich — bir safar bilan montajni to‘liqroq yopasiz.',
    openingHint: '«Birga oling» + aniq qo‘shimcha nomlari bilan boshla.',
    prefer: 'category',
  },
  {
    id: 'friday_deal',
    weekday: 5,
    weekdayName: 'Juma',
    title: 'Hafta yakuni urg‘usi',
    emoji: '🏁',
    vibe:
      'Hafta yakuni urg‘usi. Agar real chegirma yo‘q bo‘lsa — yumshoq CTA: ' +
      'bugun tanlang, dam olishdan oldin ish rejasini yoping. Foizli yolg‘on chegirma TAQIQLANGAN.',
    templatePitch:
      'Hafta yakuniga qadar tanlovni kechiktirmang: kerakli detal qo‘lingizda bo‘lsa, dam oldan oldin ishni yopish osonroq.',
    openingHint: 'Vaqt urg‘usi / «bugun tanlang» uslubida boshla (foizsiz).',
    prefer: 'fast',
  },
  {
    id: 'saturday_faq',
    weekday: 6,
    weekdayName: 'Shanba',
    title: 'Mijoz savoli',
    emoji: '❓',
    vibe:
      'FAQ uslubi: 1 ta mijoz savoli + aniq, mahsulotga xos javob (qayerda/qanday ishlatiladi). ' +
      'Suhbat ohangi, sodda, foydali. Umumiy reklama sloganlarisiz.',
    templatePitch:
      'Savol: bu detal qayerda kerak? Javob: quvur burilishi, ulanish yoki yoritish nuqtasida — o‘lchamga qarab tanlanadi.',
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
    return 'Santexnika: quvur burilishi/ulanish, sizib chiqishni kamaytirish, o‘lcham mosligi.';
  }
  if (/lamp|led|svetil|ёorit|yorug|патрон|patron|sim|кабел|kabel|lyustra|люстр|rozetka|розет/.test(blob)) {
    return 'Yoritish/elektr: xona yoki koridorda montaj, xavfsiz ulanish, qulay almashtirish.';
  }
  if (/kran|кран|smesitel|смесит|ventil|вентил|klapan|клапан/.test(blob)) {
    return 'Suv armatura: oshxona/hammomda oqim boshqaruvi, tomchilamas ulanish.';
  }
  if (/bolt|гайка|gayka|vint|шуруп|dubl|дюбел|instrument|инструмент/.test(blob)) {
    return 'Montaj/mahkamlash: devor yoki konstruktsiyada mustahkam o‘rnatish.';
  }
  return 'Qurilish/ta’mir: usta yoki uy egasi uchun aniq vazifa va o‘rnatish joyini ayt.';
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
      'O‘lcham va moslikni oldindan tekshiring — qayta ish kamayadi.';
    const soft =
      product && isPublishableProductName(product.name)
        ? `\nKerak bo‘lsa, do‘konda «${escapeHtml(String(product.name).trim())}» turini ko‘rib chiqish mumkin.`
        : '';
    const body =
      escapeHtml(tip) +
      '\n\n' +
      'Amaliy eslatma: ishni boshlashdan oldin o‘lcham, moslik va xavfsizlikni birga tekshiring — ' +
      'qayta montaj va ortiqcha xarajat kamayadi.';
    return [
      `${ct.emoji} <b>${escapeHtml(title)}</b>`,
      '',
      body,
      soft,
      '',
      'Savol bo‘lsa — yozing, birga aniqlaymiz.',
      `📍 ${escapeHtml(store)}`,
      tags,
    ]
      .filter((x) => x != null && x !== '')
      .join('\n')
      .slice(0, CAPTION_MAX);
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
    escapeHtml(pitch),
    escapeHtml(useCase),
    `💰 <b>${escapeHtml(price)} so'm</b>`,
    '',
    'Do‘konga keling yoki bog‘laning — o‘lcham va mosligini birga aniqlaymiz.',
    `📍 ${escapeHtml(store)}`,
    tags,
  ].filter((x) => x != null);
  return lines.join('\n').slice(0, CAPTION_MAX);
}

function captionSystemPrompt(rubric, contentType) {
  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const weekday = rubric?.weekdayName || '';
  const extraTag = ct.hashtagExtra || '#tavsiya';

  if (isEdu) {
    return (
      "Sen «Dunyo Zamin» (Dunyozamin_News) — qurilish, santexnika, yoritish do‘koni " +
      "Telegram News kanali copywriterisan. Auditoriyasi: ustalar, uy egalari. " +
      `Bugungi KONTENT TURI majburiy: «${ct.title}» (${ct.id}). Bu MAHSULOT REKLAMASI EMAS — ta’limiy/foydali post. ` +
      `Ohang: ${ct.vibe || ''} Ochilish: ${ct.openingHint || 'Turli ochilish.'} ` +
      "HAR SAFAR YANGI matn. «Sifatli tanlov — kunni chiroyliroq qiladi» va shunga o‘xshash eski sloganlar TAQIQLANGAN. " +
      "Hard sell / «hozir sotib oling» / yolg‘on chegirma YO‘Q. " +
      "Agar mahsulot berilgan bo‘lsa — faqat yumshoq eslatma (ixtiyoriy); narx majburiy EMAS. Mahsulot mos kelmasa — sof maslahat yoz. " +
      "Taqiqlangan: qarz, nasiya, ombor qoldig‘i, foyda/zarar, kassir, smena, dead stock. " +
      "Faqat o‘zbek tili. HTML: faqat <b>. Emoji 1–3 ta. " +
      `Tuzilma: «${ct.title}» sarlavha + 3–6 foydali jumla + yumshoq CTA (savol/yordam) + #Dunyozamin #News ${extraTag}. ` +
      `Maqsad uzunlik ${CAPTION_AI_TARGET_MIN}-${CAPTION_MAX} belgi (kamida ${CAPTION_MIN}). Faqat caption matnini qaytar.`
    );
  }

  const title = ct.id === 'combo_bundle' ? ct.title : rubric?.title || ct.title;
  const opening =
    ct.openingHint || rubric?.openingHint || 'Har safar boshqa ochilish uslubidan foydalan.';
  const vibe = ct.vibe || rubric?.vibe || '';
  return (
    "Sen «Dunyo Zamin» (Dunyozamin_News) — qurilish, santexnika, yoritish va uy-ro‘zg‘or jihozlari do‘koni " +
    "uchun Telegram News kanali copywriterisan. Auditoriyasi: ustalar, uy egalari, ta’mir qiluvchilar. " +
    "Maqsad: ijodiy, ishonchli, MAHSULOTGA XOS post — ICHKI hisobot EMAS. " +
    `Kontent turi: «${ct.title}». Rubrika/ohang: «${title}» (${weekday}). ${vibe} ` +
    `Ochilish: ${opening} ` +
    "HAR SAFAR YANGI matn: bir xil slogan, bir xil jumla yoki «Sifatli tanlov — kunni chiroyliroq qiladi» TAQIQLANGAN. " +
    "Qisqa umumiy gaplar («ishonchli detal», «sifatli tanlov», «eng yaxshi narx») O‘RNIGA: " +
    "mahsulot nomi + aniq qo‘llanish joyi (santexnika/yoritish/montaj) + 2–4 jumlalik pitch yoz. " +
    "Atvod/poliatvod/fiting bo‘lsa: o‘lcham, burilish/ulanish, sizib chiqishni kamaytirish haqida yoz. " +
    "LED/lampa/sim bo‘lsa: xona, montaj, xavfsizlik haqida yoz. " +
    "Mahsulotning haqiqiy nomi, kategoriyasi, brendi (bo‘lsa) va narxidan foydalan. " +
    "SKU/artikulni faqat mijozga foydali bo‘lsa qisqa eslat, «SKU:» deb yozma. " +
    "Taqiqlangan so‘z/mavzu: qarz, nasiya, ombor qoldig‘i soni, foyda (buxgalteriya), zarar, kassir, smena, dead stock, uydirma chegirma foizi. " +
    "Faqat o‘zbek tili. HTML: faqat <b>. Emoji KO‘P BO‘LMASIN: jami 1–3 ta (sarlavha uchun 1 ta yetarli). " +
    `Tuzilma: sarlavha + mahsulot nomi + 2–4 mahsulotga xos jumla + aniq narx + yumshoq CTA + #Dunyozamin #News ${extraTag}. ` +
    `Maqsad uzunlik ${CAPTION_AI_TARGET_MIN}-${CAPTION_MAX} belgi (kamida ${CAPTION_MIN}). Faqat caption matnini qaytar.`
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
      topic_hint: topic || pickEduTopic(ct, {}),
      optional_soft_product: product
        ? {
            name: product.name,
            category: product.category_name || null,
            brand: product.brand || null,
            price_formatted: `${formatSumma(product.sale_price)} so'm`,
            note: 'Faqat yumshoq eslatma; narx majburiy emas. Mos kelmasa — mahsulotsiz yoz.',
          }
        : null,
      writing_rules: {
        min_chars: CAPTION_AI_TARGET_MIN,
        max_chars: CAPTION_MAX,
        emoji_max: 3,
        vary_opening: true,
        educational: true,
        no_hard_sell: true,
        no_generic_slogans: true,
      },
      must_include: {
        soft_cta: true,
        hashtags: ['#Dunyozamin', '#News', extraTag],
      },
      avoid: [
        'Sifatli tanlov — kunni chiroyliroq qiladi',
        'kunni chiroyliroq qiladi',
        'hozir sotib oling',
        'yolg‘on chegirma foizi',
        'emoji spam',
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
      max_chars: CAPTION_MAX,
      sentences_in_pitch: '2-4',
      emoji_max: 3,
      vary_opening: true,
      must_mention_real_use_case: true,
      no_generic_slogans: true,
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
  const contentType = options.contentType || null;
  const isEdu = contentTypeKind(contentType) === 'edu';
  if (!text) return { ok: false, reason: 'empty_caption' };
  if (text.length < minLen) return { ok: false, reason: 'too_short' };
  if (text.length > CAPTION_MAX) return { ok: false, reason: 'too_long' };
  if (FORBIDDEN_RE.test(text) || INTERNAL_CAPTION_RE.test(text)) {
    return { ok: false, reason: 'forbidden_content' };
  }
  if (BANNED_SLOGAN_RE.test(text)) {
    return { ok: false, reason: 'banned_slogan' };
  }
  if (countEmojis(text) > 5) {
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

async function generatePosterImageGemini(
  { storeName, product, rubric, contentType, topic },
  options = {},
) {
  const cfg = resolveGeminiConfig(options);
  if (!cfg.apiKey) return { ok: false, reason: 'no_gemini_key' };
  const fetchFn = fetchImpl(options);
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'no_fetch' };

  const ct = contentType || getContentTypeById('product_showcase');
  const isEdu = contentTypeKind(ct) === 'edu';
  const style = ct.imageStyle || 'clean retail photography, no text';

  let prompt;
  if (isEdu) {
    prompt =
      `Educational visual for a hardware, plumbing fittings, lighting Telegram News channel ` +
      `(Dunyo Zamin / Dunyozamin_News). ${style}. ` +
      `Content type: ${ct.title}. Topic mood: ${topic || ct.title}. ` +
      `No readable text, no watermarks, no logos, no price tags, no collages, no UI mockups. ` +
      `Store aesthetic: ${storeName}. Square 1:1, magazine quality, useful and friendly.`;
  } else {
    prompt =
      `Professional commercial product photograph for a hardware, plumbing fittings, ` +
      `lighting and home-improvement retail Telegram News channel (Dunyo Zamin). ` +
      `No text, no watermarks, no logos, no price tags, no collages. ` +
      `Subject: ${product?.name || 'hardware product'}. Category mood: ${product?.category_name || 'building materials / fittings'}. ` +
      `Story: ${ct.title} — ${rubric?.title || ''} — ${style}. ` +
      `Store aesthetic: ${storeName}. ` +
      `Photoreal, soft studio light, shallow depth of field, square 1:1, magazine quality.`;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
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
      return { ok: false, reason: `gemini_http_${res.status}`, detail: t.slice(0, 120) };
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
          return { ok: true, buffer: buf, filename: `poster.${ext}`, mime };
        }
      }
    }
    return { ok: false, reason: 'gemini_no_image' };
  } catch (e) {
    return { ok: false, reason: 'gemini_error', detail: String(e?.message || e).slice(0, 80) };
  }
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
    contentType,
  });
  if (!qc.ok) {
    if (captionSource !== 'template') {
      qc = qualityCheckCaption(caption, product, { minLength: CAPTION_MIN, contentType });
      if (!qc.ok) {
        const again = await generateCaption(captionCtx, { ...options, temperatureBoost: true });
        if (again.ok) {
          caption = again.text;
          captionSource = again.provider || 'llm';
          qc = qualityCheckCaption(caption, product, { minLength: CAPTION_MIN, contentType });
        }
      }
    }
    if (!qc.ok) {
      caption = buildTemplateCaption(captionCtx);
      captionSource = 'template';
      qc = qualityCheckCaption(caption, product, { minLength: CAPTION_MIN, contentType });
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
    const gemini = await generatePosterImageGemini(captionCtx, options);
    if (gemini.ok && gemini.buffer) {
      image = {
        ok: true,
        photoBuffer: gemini.buffer,
        filename: gemini.filename || 'poster.jpg',
        source: 'gemini',
      };
    } else if (!isEdu && product) {
      const fallback = resolveProductPhoto(product);
      image = { ...fallback, fallbackFrom: gemini.reason, source: fallback.ok ? 'product' : 'none' };
    } else {
      // Edu without Gemini image → text-only is OK (working solution).
      image = { ok: false, reason: gemini.reason || 'edu_text_only', source: 'none' };
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
  RUBRICS,
  CONTENT_TYPES,
  WEEKDAY_CONTENT_TYPE_IDS,
  CAPTION_MIN,
  CAPTION_AI_TARGET_MIN,
  formatSumma,
  isPublishableProductName,
  resolveMarketingCredentials,
  resolveGeminiConfig,
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
  buildTemplateCaption,
  qualityCheckCaption,
  generateCaptionWithOpenAi,
  generateCaptionWithGemini,
  generateCaption,
  generatePosterImageGemini,
  resolveProductPhoto,
  composePoster,
  postComposedPoster,
  runDailyPosterTick,
  sendDailyPosterNow,
};
