'use strict';

/**
 * Phase 1 — AI store analysis for Telegram reports.
 * Snapshot from reports/inventory → OpenAI (optional) → sendToReportChats.
 * Never includes phones, tokens, or API keys in the snapshot/prompt.
 */

const {
  getReportTelegramSettings,
  sendToReportChats,
  buildDailyDigestSummary,
  buildDailyDigestText,
  toBool,
  normalizeScheduleTime,
} = require('./reportNotify.cjs');
const SettingsService = require('../../electron/services/settingsService.cjs');
const { tryAcquireSchedulerLock } = require('./schedulerLock.cjs');

const LOCK_NAME = 'telegram_ai_analysis';
const MORNING_LOCK_NAME = 'telegram_morning_brief';
const WEEKLY_LOCK_NAME = 'telegram_weekly_ai';
const EVENT_AI_ANALYSIS = 'ai_analysis';
const EVENT_MORNING_BRIEF = 'morning_brief';
const EVENT_WEEKLY_AI = 'weekly_ai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.0-flash';
const DEFAULT_MORNING_BRIEF_TIME = '08:00';
const DEFAULT_WEEKLY_AI_TIME = '08:00';
/** 0=Sun … 6=Sat (SQLite %w). Default Monday. */
const DEFAULT_WEEKLY_AI_WEEKDAY = 1;
const WEEKDAY_LABELS_UZ = Object.freeze([
  'Yakshanba',
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
]);
const TOP_N = 10;
/** Telegram hard limit is 4096; keep headroom for UTF-8 / parse_mode. */
const TELEGRAM_SAFE_LIMIT = 3900;
const TELEGRAM_MAX_PARTS = 2;

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

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function normalizeWeekday(raw, fallback = DEFAULT_WEEKLY_AI_WEEKDAY) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 0 || n > 6) return fallback;
  return n;
}

function getAiSettings(db) {
  const base = getReportTelegramSettings(db);
  const aiEnabled = toBool(readSetting(db, 'reports.telegram.ai_enabled', false), false);
  // Default on (ships with AI); explicit false turns marketing sections/button off.
  const marketingRaw = readSetting(db, 'reports.telegram.ai_marketing', null);
  const aiMarketing =
    marketingRaw == null || marketingRaw === ''
      ? true
      : toBool(marketingRaw, true);
  const morningRaw = readSetting(db, 'reports.telegram.morning_brief', null);
  const morningBrief =
    morningRaw == null || morningRaw === ''
      ? true
      : toBool(morningRaw, true);
  const weeklyRaw = readSetting(db, 'reports.telegram.weekly_ai', null);
  const weeklyAi = weeklyRaw == null || weeklyRaw === '' ? false : toBool(weeklyRaw, false);
  const eveningRaw = readSetting(db, 'reports.telegram.evening_package', null);
  const eveningPackage =
    eveningRaw == null || eveningRaw === '' ? false : toBool(eveningRaw, false);
  return {
    ...base,
    aiEnabled,
    aiMarketing: Boolean(aiMarketing),
    morningBrief: Boolean(morningBrief),
    morningBriefTime: normalizeScheduleTime(
      readSetting(db, 'reports.telegram.morning_brief_time', DEFAULT_MORNING_BRIEF_TIME) ||
        DEFAULT_MORNING_BRIEF_TIME,
    ),
    morningBriefLastRunDate: String(
      readSetting(db, 'reports.telegram.morning_brief_last_run_date', '') || '',
    ).slice(0, 10),
    aiLastRunDate: String(readSetting(db, 'reports.telegram.ai_last_run_date', '') || '').slice(0, 10),
    scheduleTime: normalizeScheduleTime(
      readSetting(db, 'reports.telegram.schedule_time', base.scheduleTime || '21:00'),
    ),
    weeklyAi: Boolean(weeklyAi),
    weeklyAiTime: normalizeScheduleTime(
      readSetting(db, 'reports.telegram.weekly_ai_time', DEFAULT_WEEKLY_AI_TIME) ||
        DEFAULT_WEEKLY_AI_TIME,
    ),
    weeklyAiWeekday: normalizeWeekday(
      readSetting(db, 'reports.telegram.weekly_ai_weekday', DEFAULT_WEEKLY_AI_WEEKDAY),
      DEFAULT_WEEKLY_AI_WEEKDAY,
    ),
    weeklyAiLastRunWeek: String(
      readSetting(db, 'reports.telegram.weekly_ai_last_run_week', '') || '',
    ).trim(),
    /** Merge evening daily digest + AI into one Telegram message. */
    eveningPackage: Boolean(eveningPackage),
  };
}

function localTimeParts(db) {
  const row = db
    .prepare(
      `SELECT date('now', 'localtime') AS d,
              cast(strftime('%H', 'now', 'localtime') AS INTEGER) AS h,
              cast(strftime('%M', 'now', 'localtime') AS INTEGER) AS m`,
    )
    .get();
  return {
    date: row?.d || new Date().toISOString().slice(0, 10),
    hour: Number(row?.h) || 0,
    minute: Number(row?.m) || 0,
  };
}

function shouldRunAiAnalysis(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced', today: localTimeParts(db).date };
  const parts = localTimeParts(db);
  const [sh, sm] = String(settings.scheduleTime || '21:00')
    .split(':')
    .map((x) => Number(x));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 21) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  if (String(settings.aiLastRunDate || '').slice(0, 10) === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function safeName(raw, fallback = 'Nomaʼlum') {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 80);
  return s || fallback;
}

function marginPct(purchase, sale) {
  const p = Number(purchase);
  const s = Number(sale);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  return Math.round(((s - p) / s) * 1000) / 10;
}

function mapDeadStockRow(r) {
  const purchase = Number(r.purchase_price);
  const sale = Number(r.sale_price);
  let days = r.days_since_last_sale;
  if (days == null || days === '') {
    days = null;
  } else {
    const n = Number(days);
    days = Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
  }
  const frozen = roundMoney(r.frozen_value);
  return {
    name: safeName(r.product_name || r.name),
    sku: r.product_sku || r.sku || null,
    stock: roundMoney(r.current_stock),
    frozen_value: frozen,
    days_since_last_sale: days,
    margin_pct: marginPct(purchase, sale),
    suggested_discount_pct: suggestDiscountPct(days, frozen),
  };
}

function mapMoverRow(r) {
  const purchase = Number(r.purchase_price);
  const sale = Number(r.sale_price);
  return {
    name: safeName(r.product_name || r.name),
    sku: r.product_sku || r.sku || null,
    stock: roundMoney(r.current_stock),
    sold_qty: roundMoney(r.sold_qty_n ?? r.sold_qty),
    days_to_sell_out: r.days_to_sell_out == null ? null : Math.round(Number(r.days_to_sell_out)),
    stock_value: roundMoney(r.stock_value),
    speed: r.speed_label || null,
    margin_pct: marginPct(purchase, sale),
  };
}

function summarizeAgingSide(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const buckets = { d0_7: 0, d8_30: 0, d31_60: 0, d60_plus: 0, total: 0, count: 0 };
  for (const r of list) {
    buckets.d0_7 += Number(r._0_7 || 0) || 0;
    buckets.d8_30 += Number(r._8_30 || 0) || 0;
    buckets.d31_60 += Number(r._31_60 || 0) || 0;
    buckets.d60_plus += Number(r._60_plus || 0) || 0;
    buckets.total += Number(r.total || r.bucket_sum || 0) || 0;
    buckets.count += 1;
  }
  const current = buckets.d0_7 + buckets.d8_30;
  const top = [...list]
    .sort((a, b) => (Number(b.total || 0) || 0) - (Number(a.total || 0) || 0))
    .slice(0, 8)
    .map((r) => {
      const id = r.customer_id || r.supplier_id || null;
      const row = {
        name: safeName(r.customer_name || r.supplier_name || r.name),
        total: roundMoney(r.total || r.bucket_sum),
        d31_60: roundMoney(r._31_60),
        d61_plus: roundMoney(r._60_plus),
      };
      // Internal id for bot reminder buttons — never phone/telegram (assertNoSecrets).
      if (id && String(id) !== 'walk-in' && String(id) !== '__walkin__') {
        row.id = String(id);
      }
      return row;
    });
  return {
    count: buckets.count,
    total: roundMoney(buckets.total),
    buckets: {
      '0_7': roundMoney(buckets.d0_7),
      '8_30': roundMoney(buckets.d8_30),
      '31_60': roundMoney(buckets.d31_60),
      '60_plus': roundMoney(buckets.d60_plus),
    },
    /** Owner-friendly: current (0–30) / 31–60 / 61+ */
    aging_simple: {
      current: roundMoney(current),
      '31_60': roundMoney(buckets.d31_60),
      '61_plus': roundMoney(buckets.d60_plus),
    },
    top,
  };
}

function sumDayReturns(db, ymd) {
  const tables = ['sales_returns', 'sale_returns'];
  for (const table of tables) {
    if (!hasTable(db, table)) continue;
    try {
      const cols = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() || []).map((c) => c.name),
      );
      const amountCol = cols.has('total_amount')
        ? 'total_amount'
        : cols.has('refund_amount')
          ? 'refund_amount'
          : cols.has('amount')
            ? 'amount'
            : null;
      const dateCol = cols.has('return_date')
        ? 'return_date'
        : cols.has('created_at')
          ? 'created_at'
          : null;
      if (!amountCol || !dateCol) continue;
      const statusFilter = cols.has('status')
        ? `AND LOWER(COALESCE(status,'')) IN ('completed','done','paid')`
        : '';
      const row = db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(${amountCol}), 0) AS total
           FROM ${table}
           WHERE date(${dateCol}) = date(?)
             ${statusFilter}`,
        )
        .get(ymd);
      return {
        count: Number(row?.cnt || 0) || 0,
        total: roundMoney(row?.total),
      };
    } catch {
      // try next table name
    }
  }
  return { count: 0, total: 0 };
}

function loadOpenShiftHint(db) {
  if (!hasTable(db, 'shifts')) return null;
  try {
    const cols = new Set(
      (db.prepare(`PRAGMA table_info(shifts)`).all() || []).map((c) => c.name),
    );
    const cashCol = cols.has('opening_cash')
      ? 'opening_cash'
      : cols.has('expected_cash')
        ? 'expected_cash'
        : null;
    const row = db
      .prepare(
        `
        SELECT COUNT(*) AS open_count
               ${cashCol ? `, COALESCE(SUM(${cashCol}), 0) AS cash_hint` : ', NULL AS cash_hint'}
        FROM shifts
        WHERE LOWER(COALESCE(status,'')) = 'open'
          AND closed_at IS NULL
      `,
      )
      .get();
    const openCount = Number(row?.open_count || 0) || 0;
    if (openCount <= 0) {
      return { open_shifts: 0, note: 'Ochik smena yo‘q' };
    }
    return {
      open_shifts: openCount,
      cash_hint: row?.cash_hint != null ? roundMoney(row.cash_hint) : null,
      note: `${openCount} ta ochiq smena`,
    };
  } catch {
    return null;
  }
}

function buildPriceGuidance(deadStock, slowMovers) {
  const dead = Array.isArray(deadStock) ? deadStock : [];
  const slow = Array.isArray(slowMovers) ? slowMovers : [];
  const discountCandidates = [...dead]
    .filter((r) => Number(r.frozen_value || 0) > 0)
    .sort((a, b) => (Number(b.frozen_value) || 0) - (Number(a.frozen_value) || 0))
    .slice(0, 8)
    .map((r) => {
      const frozen = roundMoney(r.frozen_value);
      const days = r.days_since_last_sale;
      const pct =
        r.suggested_discount_pct != null
          ? Number(r.suggested_discount_pct)
          : suggestDiscountPct(days, frozen);
      return {
        name: r.name,
        frozen_value: frozen,
        days_since_last_sale: days,
        suggested_discount_pct: pct,
        advice: 'chegirma_yoki_aksiya',
      };
    });
  const lowMargin = [...dead, ...slow]
    .filter((r) => r.margin_pct != null && Number(r.margin_pct) < 15)
    .sort((a, b) => (Number(a.margin_pct) || 0) - (Number(b.margin_pct) || 0))
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      margin_pct: r.margin_pct,
      stock_value: roundMoney(r.frozen_value ?? r.stock_value),
      advice: 'narx_yoki_xarid_qayta_korish',
    }));
  return {
    discount_candidates: discountCandidates,
    low_margin: lowMargin,
  };
}

function extractNameToken(raw) {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  if (!s) return null;
  const parts = s.split(/[\s\-_/|,]+/).filter((w) => w.length >= 3);
  return safeName(parts[0] || s.slice(0, 24), null);
}

function suggestDiscountPct(days, frozenValue) {
  const d = days == null ? 45 : Number(days);
  const v = Number(frozenValue) || 0;
  if (d >= 90 || v >= 5_000_000) return 25;
  if (d >= 60 || v >= 2_000_000) return 20;
  if (d >= 45) return 15;
  return 10;
}

function buildSeasonalityHint(ymd) {
  const month = Number(String(ymd || '').slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  const map = {
    1: 'Qish / yangi yil — sovg‘a to‘plamlari va issiq ichimliklarga urg‘u',
    2: 'Fevral — romantik sovg‘a va aksessuar aksiyalari',
    3: 'Bahor boshi — tozalash / uy-ro‘zg‘or tovarlariga urg‘u',
    4: 'Aprel — mavsumiy kiyim-kechak va bog‘ anjomlari',
    5: 'May — bayram oldidan to‘plam chegirmalari',
    6: 'Yoz boshi — ichimlik, krem va yengil tovarlar',
    7: 'Iyul — issiq kunlar: suv / sovutish / yozgi assortiment',
    8: 'Avgust — maktab oldidan: daftar, sumka, o‘quv tovarlari',
    9: 'Sentabr — maktab davomi + kuzgi kiyim',
    10: 'Oktyabr — kuzgi aksessuar va issiq ichimliklar',
    11: 'Noyabr — qishga tayyorgarlik, to‘plam aksiyalari',
    12: 'Dekabr — bayram sovg‘alari va yakuniy clearance',
  };
  return { month, hint: map[month] || null };
}

/**
 * Category-level stats from internal catalog + movements (no external APIs).
 */
function loadCategoryStats(db, days = 30) {
  if (!hasTable(db, 'products')) return [];
  const d = Math.min(90, Math.max(7, Number(days) || 30));
  const sinceExpr = `-${Math.floor(d)} day`;
  const hasCat = hasTable(db, 'categories');
  const hasMov = hasTable(db, 'inventory_movements');
  const hasStockCol = (() => {
    try {
      const cols = new Set(
        (db.prepare(`PRAGMA table_info(products)`).all() || []).map((c) => c.name),
      );
      return cols.has('current_stock');
    } catch {
      return false;
    }
  })();

  try {
    const stockExpr = hasStockCol
      ? `COALESCE(p.current_stock, 0)`
      : hasMov
        ? `(SELECT COALESCE(SUM(im.quantity), 0) FROM inventory_movements im WHERE im.product_id = p.id)`
        : `0`;
    const catName = hasCat
      ? `COALESCE(NULLIF(TRIM(c.name), ''), 'Nomaʼlum')`
      : `'Nomaʼlum'`;
    const joinCat = hasCat ? `LEFT JOIN categories c ON c.id = p.category_id` : '';

    const baseRows = db
      .prepare(
        `
        SELECT
          ${catName} AS category_name,
          COUNT(*) AS sku_count,
          SUM(CASE WHEN ${stockExpr} > 0 THEN 1 ELSE 0 END) AS sku_in_stock,
          SUM(${stockExpr} * COALESCE(p.purchase_price, 0)) AS stock_value,
          AVG(
            CASE
              WHEN COALESCE(p.sale_price, 0) > 0
                THEN ((COALESCE(p.sale_price, 0) - COALESCE(p.purchase_price, 0)) * 100.0 / p.sale_price)
              ELSE NULL
            END
          ) AS avg_margin_pct
        FROM products p
        ${joinCat}
        WHERE COALESCE(p.is_active, 1) = 1
        GROUP BY ${catName}
      `,
      )
      .all();

    const salesByCat = new Map();
    if (hasMov) {
      const sold = db
        .prepare(
          `
          SELECT
            ${catName} AS category_name,
            COALESCE(SUM(ABS(im.quantity)), 0) AS sold_qty,
            COALESCE(SUM(ABS(im.quantity) * COALESCE(p.sale_price, 0)), 0) AS revenue
          FROM inventory_movements im
          INNER JOIN products p ON p.id = im.product_id
          ${joinCat}
          WHERE LOWER(COALESCE(im.movement_type, '')) = 'sale'
            AND im.created_at >= datetime('now', ?)
            AND COALESCE(p.is_active, 1) = 1
          GROUP BY ${catName}
        `,
        )
        .all(sinceExpr);
      for (const r of sold) {
        salesByCat.set(safeName(r.category_name), {
          sold_qty: roundMoney(r.sold_qty),
          revenue: roundMoney(r.revenue),
        });
      }
    }

    return (baseRows || []).map((r) => {
      const name = safeName(r.category_name);
      const sales = salesByCat.get(name) || { sold_qty: 0, revenue: 0 };
      const margin =
        r.avg_margin_pct == null || !Number.isFinite(Number(r.avg_margin_pct))
          ? null
          : Math.round(Number(r.avg_margin_pct) * 10) / 10;
      return {
        name,
        sku_count: Number(r.sku_count) || 0,
        sku_in_stock: Number(r.sku_in_stock) || 0,
        stock_value: roundMoney(r.stock_value),
        avg_margin_pct: margin,
        sold_qty: sales.sold_qty,
        revenue: sales.revenue,
      };
    });
  } catch {
    return [];
  }
}

function enrichRowsWithCategory(db, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || !hasTable(db, 'products')) return list;
  const hasCat = hasTable(db, 'categories');
  try {
    const stmt = hasCat
      ? db.prepare(
          `SELECT p.name AS pname, p.sku, COALESCE(NULLIF(TRIM(c.name), ''), 'Nomaʼlum') AS cname
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.sku = ? OR p.name = ? LIMIT 1`,
        )
      : db.prepare(
          `SELECT p.name AS pname, p.sku, 'Nomaʼlum' AS cname
           FROM products p WHERE p.sku = ? OR p.name = ? LIMIT 1`,
        );
    return list.map((r) => {
      if (r.category) return r;
      try {
        const hit = stmt.get(r.sku || '', r.name || '');
        return { ...r, category: safeName(hit?.cname || 'Nomaʼlum') };
      } catch {
        return { ...r, category: 'Nomaʼlum' };
      }
    });
  } catch {
    return list.map((r) => ({ ...r, category: r.category || 'Nomaʼlum' }));
  }
}

/**
 * Internal-data marketing snapshot block (gaps, dead stock by cat, hints, debtors, seasonality).
 */
function buildMarketingBlock(db, ctx = {}) {
  const days = 30;
  const ymd = ctx.date || localTimeParts(db).date;
  const dead = enrichRowsWithCategory(db, ctx.deadStock || []);
  const fast = enrichRowsWithCategory(db, ctx.fastMovers || []);
  const aging = ctx.aging || { customers: summarizeAgingSide([]) };
  const catStats = loadCategoryStats(db, days);

  const avgSku =
    catStats.length > 0
      ? catStats.reduce((s, c) => s + (Number(c.sku_count) || 0), 0) / catStats.length
      : 0;

  const categoryGaps = [...catStats]
    .filter((c) => {
      const highSales = Number(c.revenue) >= 100_000 || Number(c.sold_qty) >= 5;
      const highMargin = c.avg_margin_pct != null && Number(c.avg_margin_pct) >= 20;
      const lowSku = Number(c.sku_count) > 0 && Number(c.sku_count) <= Math.max(2, Math.floor(avgSku * 0.5));
      return (highSales || highMargin) && lowSku;
    })
    .sort(
      (a, b) =>
        (Number(b.revenue) || 0) + (Number(b.avg_margin_pct) || 0) * 1000 -
        ((Number(a.revenue) || 0) + (Number(a.avg_margin_pct) || 0) * 1000),
    )
    .slice(0, 6)
    .map((c) => ({
      category: c.name,
      sku_count: c.sku_count,
      revenue: c.revenue,
      avg_margin_pct: c.avg_margin_pct,
      reason: 'yuqori_savdo_yoki_marja_kam_sku',
    }));

  // Missing complements: top-seller categories with few SKUs vs peers
  if (categoryGaps.length < 3 && catStats.length) {
    const topRev = [...catStats].sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 3);
    for (const t of topRev) {
      if (categoryGaps.some((g) => g.category === t.name)) continue;
      if ((t.sku_count || 0) <= 3 && (t.revenue || 0) > 0) {
        categoryGaps.push({
          category: t.name,
          sku_count: t.sku_count,
          revenue: t.revenue,
          avg_margin_pct: t.avg_margin_pct,
          reason: 'top_sotuv_kam_assortiment',
        });
      }
      if (categoryGaps.length >= 5) break;
    }
  }

  const deadByCatMap = new Map();
  for (const r of dead) {
    const cat = safeName(r.category || 'Nomaʼlum');
    const prev = deadByCatMap.get(cat) || { category: cat, frozen_value: 0, sku_count: 0 };
    prev.frozen_value += Number(r.frozen_value) || 0;
    prev.sku_count += 1;
    deadByCatMap.set(cat, prev);
  }
  const deadStockByCategory = [...deadByCatMap.values()]
    .map((x) => ({ ...x, frozen_value: roundMoney(x.frozen_value) }))
    .sort((a, b) => (b.frozen_value || 0) - (a.frozen_value || 0))
    .slice(0, 8);

  const fastMoverHints = fast.slice(0, 8).map((r) => {
    const token = extractNameToken(r.name);
    const cat = safeName(r.category || 'Nomaʼlum');
    const daysOut = r.days_to_sell_out;
    return {
      name: r.name,
      category: cat,
      sold_qty: r.sold_qty,
      stock: r.stock,
      days_to_sell_out: daysOut,
      restock: daysOut != null && Number(daysOut) <= 14,
      similar_hint: token
        ? `${cat} ichida «${token}» tipidagi o‘xshash tez aylanuvchini olib keling`
        : `${cat} kategoriyasida o‘xshash tez aylanuvchini kengaytiring`,
    };
  });

  const stagnantCategories = [...catStats]
    .filter(
      (c) =>
        (Number(c.sold_qty) || 0) <= 0 &&
        (Number(c.stock_value) || 0) > 0 &&
        (Number(c.sku_in_stock) || 0) > 0,
    )
    .sort((a, b) => (b.stock_value || 0) - (a.stock_value || 0))
    .slice(0, 6)
    .map((c) => ({
      category: c.name,
      stock_value: c.stock_value,
      sku_in_stock: c.sku_in_stock,
      sold_qty: c.sold_qty,
    }));

  const collectionTargets = (aging.customers?.top || [])
    .filter((t) => Number(t.total) > 0)
    .slice(0, 6)
    .map((t) => {
      const row = {
        name: t.name,
        total: roundMoney(t.total),
        d31_60: roundMoney(t.d31_60),
        d61_plus: roundMoney(t.d61_plus),
        campaign: Number(t.d61_plus) > 0 ? '61+_undirish' : 'yumshoq_eslatma',
      };
      if (t.id) row.id = String(t.id);
      return row;
    });

  const seasonality = buildSeasonalityHint(ymd);

  const marketingActions = buildDeterministicMarketingActions({
    dead,
    fast,
    deadStockByCategory,
    collectionTargets,
    stagnantCategories,
    categoryGaps,
    seasonality,
    priceGuidance: ctx.priceGuidance,
  });

  const assortmentSuggestions = buildDeterministicAssortmentSuggestions({
    categoryGaps,
    fastMoverHints,
    stagnantCategories,
    catStats,
  });

  return {
    category_gaps: categoryGaps,
    dead_stock_by_category: deadStockByCategory,
    fast_mover_hints: fastMoverHints,
    stagnant_categories: stagnantCategories,
    collection_targets: collectionTargets,
    seasonality,
    marketing_actions: marketingActions,
    assortment_suggestions: assortmentSuggestions,
    category_stats_top: [...catStats]
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 8),
  };
}

function buildDeterministicMarketingActions(ctx = {}) {
  const actions = [];
  const dead = ctx.dead || [];
  const guide = ctx.priceGuidance || {};
  const collection = ctx.collectionTargets || [];
  const stagnant = ctx.stagnantCategories || [];
  const gaps = ctx.categoryGaps || [];
  const fast = ctx.fast || [];
  const seasonality = ctx.seasonality;

  const topDead = dead[0] || guide.discount_candidates?.[0];
  if (topDead) {
    const pct = suggestDiscountPct(topDead.days_since_last_sale, topDead.frozen_value);
    actions.push({
      action: `«${truncName(topDead.name, 28)}» ga ${pct}% chegirma / clearance`,
      channel: 'POS + Telegram',
      post_idea: `🔥 ${truncName(topDead.name, 40)} — bugun ${pct}% chegirma! Ombor tozalash.`,
    });
  }

  const deadCat = ctx.deadStockByCategory?.[0];
  if (deadCat && actions.length < 7) {
    actions.push({
      action: `${deadCat.category} kategoriyasida muzlab qolgan ${deadCat.sku_count} SKU — paket aksiya`,
      channel: 'do‘kon vitrina',
      post_idea: `📦 ${deadCat.category}: 2+1 yoki to‘plam chegirma — zaxirani eriting.`,
    });
  }

  for (const d of collection.slice(0, 2)) {
    if (actions.length >= 7) break;
    const tone = d.campaign === '61+_undirish' ? 'qat’iy undirish' : 'yumshoq eslatma';
    actions.push({
      action: `${d.name} — ${formatSumma(d.total)} qarz, ${tone} qo‘ng‘iroq`,
      channel: 'telefon / SMS',
      post_idea: null,
    });
  }

  const lowStockFast = fast.find((f) => f.restock || (f.days_to_sell_out != null && f.days_to_sell_out <= 14));
  if (lowStockFast && actions.length < 7) {
    actions.push({
      action: `Tez aylanuvchi «${truncName(lowStockFast.name, 28)}» ni zaxiralang (qolgan ~${lowStockFast.days_to_sell_out ?? '?'} kun)`,
      channel: 'ta’minotchi buyurtma',
      post_idea: `⚡ ${truncName(lowStockFast.name, 40)} tez ketmoqda — oldindan buyurtma bering!`,
    });
  }

  if (stagnant[0] && actions.length < 7) {
    actions.push({
      action: `${stagnant[0].category}: savdo 0, zaxira ~${formatSumma(stagnant[0].stock_value)} — flash aksiya`,
      channel: 'Telegram post',
      post_idea: `🏷 ${stagnant[0].category} — bugungi maxsus narxlar!`,
    });
  }

  if (gaps[0] && actions.length < 7) {
    actions.push({
      action: `${gaps[0].category} da SKU kam (${gaps[0].sku_count}) — push + yangi variant`,
      channel: 'assortiment',
      post_idea: null,
    });
  }

  if (seasonality?.hint && actions.length < 7) {
    actions.push({
      action: `Mavsum: ${seasonality.hint}`,
      channel: 'kontent-reja',
      post_idea: `📅 ${seasonality.hint}`,
    });
  }

  while (actions.length < 5) {
    const fillers = [
      {
        action: 'Top 3 tez aylanuvchini vitrinaga chiqaring',
        channel: 'do‘kon',
        post_idea: '🔥 Bugungi hitlar — cheklangan zaxira!',
      },
      {
        action: '61+ kunlik qarzdorlarga undirish kampaniyasi (3 qo‘ng‘iroq)',
        channel: 'qarz undirish',
        post_idea: null,
      },
      {
        action: 'Past marjali tovarlarda narx yoki xaridni qayta ko‘ring',
        channel: 'narx siyosati',
        post_idea: null,
      },
    ];
    const f = fillers[actions.length % fillers.length];
    if (actions.some((a) => a.action === f.action)) break;
    actions.push(f);
  }

  return actions.slice(0, 7);
}

function buildDeterministicAssortmentSuggestions(ctx = {}) {
  const suggestions = [];
  const gaps = ctx.categoryGaps || [];
  const hints = ctx.fastMoverHints || [];
  const stagnant = ctx.stagnantCategories || [];
  const catStats = ctx.catStats || [];

  for (const g of gaps.slice(0, 3)) {
    suggestions.push({
      text: `${g.category} kategoriyasida assortiment tor (faqat ${g.sku_count} SKU) — o‘xshash / qo‘shimcha turlar kerak`,
      basis: 'ichki_savdo_va_sku',
    });
  }

  for (const h of hints.slice(0, 3)) {
    if (suggestions.length >= 5) break;
    suggestions.push({
      text: h.similar_hint,
      basis: 'ichki_tez_aylanma',
    });
  }

  for (const s of stagnant.slice(0, 2)) {
    if (suggestions.length >= 5) break;
    suggestions.push({
      text: `${s.category} da zaxira bor lekin sotuv yo‘q — yangi hit o‘rniga clearance yoki almashtirish`,
      basis: 'ichki_nol_savdo',
    });
  }

  // Complements: high-revenue cats vs empty peers
  const top = [...catStats].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
  const weak = [...catStats]
    .filter((c) => (c.sku_count || 0) <= 1 && (c.revenue || 0) === 0)
    .slice(0, 1);
  if (top && weak[0] && suggestions.length < 5) {
    suggestions.push({
      text: `${top.name} yaxshi ketmoqda; ${weak[0].name} deyarli bo‘sh — bog‘liq / komplekt tovarlarni ko‘rib chiqing`,
      basis: 'ichki_kategoriya_taqqos',
    });
  }

  while (suggestions.length < 5) {
    suggestions.push({
      text: 'Tez aylanuvchi kategoriyada 1–2 yangi variant (rang/o‘lcham/brend) sinab ko‘ring',
      basis: 'ichki_umumiy',
    });
    if (suggestions.length >= 5) break;
  }

  return suggestions.slice(0, 5).map((s) => ({
    ...s,
    label: 'ichki ma’lumot asosida taxmin',
  }));
}

/**
 * Split long Telegram text into at most 2 parts under the safe limit.
 */
function splitTelegramText(text, limit = TELEGRAM_SAFE_LIMIT) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= limit) return [s];
  let cut = s.lastIndexOf('\n\n', limit);
  if (cut < Math.floor(limit * 0.35)) cut = s.lastIndexOf('\n', limit);
  if (cut < Math.floor(limit * 0.25)) cut = limit;
  const first = s.slice(0, cut).trimEnd();
  let second = s.slice(cut).trimStart();
  if (second.length > limit) {
    second = `${second.slice(0, limit - 20).trimEnd()}\n…`;
  }
  const parts = [first, second].filter(Boolean);
  return parts.slice(0, TELEGRAM_MAX_PARTS);
}

function assertNoSecrets(obj, path = 'snapshot') {
  const forbidden = /phone|telegram|password|secret|token|api[_-]?key|authorization/i;
  const walk = (v, p) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (forbidden.test(k)) {
          throw new Error(`Forbidden field in ${p}.${k}`);
        }
        walk(val, `${p}.${k}`);
      }
    }
  };
  walk(obj, path);
}

/**
 * Build a compact numeric snapshot for the LLM / fallback digest.
 * @returns {object}
 */
function buildStoreSnapshot(db, options = {}) {
  const ymd =
    String(options.date || '').slice(0, 10) ||
    localTimeParts(db).date;
  const topN = Math.min(20, Math.max(3, Number(options.topN) || TOP_N));
  const storeName = String(
    options.storeName ||
      getReportTelegramSettings(db).storeName ||
      "Do'kon",
  ).trim();

  const dailySummary = buildDailyDigestSummary(db, ymd);
  const returns = sumDayReturns(db, ymd);
  const shiftHint = loadOpenShiftHint(db);

  let profit = {
    revenue: dailySummary.totalSales,
    cogs: null,
    gross_profit: null,
    net_profit: dailySummary.netProfit,
    expenses: dailySummary.expensesTotal,
    profit_margin: null,
  };
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    const pnl = reports.getProfitAndLossSQL({ date_from: ymd, date_to: ymd });
    const s = pnl?.summary || {};
    profit = {
      revenue: roundMoney(s.net_sales ?? s.revenue ?? dailySummary.totalSales),
      cogs: s.cogs != null ? roundMoney(s.cogs) : null,
      gross_profit: s.gross_profit != null ? roundMoney(s.gross_profit) : null,
      net_profit: s.net_profit != null ? roundMoney(s.net_profit) : dailySummary.netProfit,
      expenses: roundMoney(s.expenses ?? dailySummary.expensesTotal),
      profit_margin: s.profit_margin != null ? Math.round(Number(s.profit_margin) * 10) / 10 : null,
      returns_revenue:
        s.returns_revenue != null ? roundMoney(s.returns_revenue) : returns.total || null,
    };
  } catch {
    // minimal DBs / missing tables
  }

  let inventoryValue = null;
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    const inv = reports.getInventoryValuationSummary({});
    inventoryValue = roundMoney(inv?.total_value ?? inv?.total_cost ?? inv?.value);
    if (!Number.isFinite(inventoryValue)) inventoryValue = null;
  } catch {
    inventoryValue = null;
  }

  let deadStock = [];
  let fastMovers = [];
  let slowMovers = [];
  try {
    const InventoryService = require('../../electron/services/inventoryService.cjs');
    const inv = new InventoryService(db);
    deadStock = (inv.getDeadStock({ days: 30 }) || []).slice(0, topN).map(mapDeadStockRow);
    const turnover = inv.getStockTurnover({ days: 30 }) || [];
    fastMovers = turnover
      .filter((r) => r.speed_label === 'fast')
      .slice(0, topN)
      .map(mapMoverRow);
    slowMovers = [...turnover]
      .filter((r) => r.speed_label === 'slow' || r.speed_label == null)
      .sort((a, b) => (Number(b.stock_value || 0) || 0) - (Number(a.stock_value || 0) || 0))
      .slice(0, topN)
      .map(mapMoverRow);
  } catch {
    // inventory optional in smoke DBs
  }

  let aging = { customers: summarizeAgingSide([]), suppliers: summarizeAgingSide([]) };
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    const rep = reports.getAging({ as_of_date: ymd });
    aging = {
      customers: summarizeAgingSide(rep?.customers),
      suppliers: summarizeAgingSide(rep?.suppliers),
    };
  } catch {
    // ignore
  }

  const priceGuidance = buildPriceGuidance(deadStock, slowMovers);
  const marketing = buildMarketingBlock(db, {
    date: ymd,
    deadStock,
    fastMovers,
    aging,
    priceGuidance,
  });

  const snapshot = {
    date: ymd,
    store_name: storeName,
    daily: {
      total_sales: roundMoney(dailySummary.totalSales),
      order_count: Number(dailySummary.orderCount || 0) || 0,
      cash: roundMoney(dailySummary.cashTotal),
      card: roundMoney(dailySummary.cardTotal),
      credit: roundMoney(dailySummary.creditTotal),
      returns_count: returns.count,
      returns_total: returns.total,
      expenses: roundMoney(dailySummary.expensesTotal),
      customer_debt_total: roundMoney(dailySummary.customerDebtTotal),
    },
    profit,
    inventory_value: inventoryValue,
    dead_stock_top: deadStock,
    fast_movers_top: fastMovers,
    slow_movers_top: slowMovers,
    aging,
    shift: shiftHint,
    price_guidance: priceGuidance,
    marketing,
  };

  assertNoSecrets(snapshot);
  return snapshot;
}

/** Thousands separated by regular spaces (Telegram-friendly). */
function formatSumma(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = String(Math.abs(n));
  return sign + abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Truncate product/customer names for monospace columns. */
function truncName(raw, max = 16) {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  if (!s) return '—';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Days cell for dead stock: null / NaN / &lt;1 → "—" (never-sold or bogus 0).
 */
function formatDaysCell(days) {
  if (days == null || days === '') return '—';
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1) return '—';
  return String(Math.round(n));
}

function padEndAscii(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function padStartAscii(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

/**
 * Build a monospace table body (no &lt;pre&gt; wrapper).
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {number[]} widths
 */
function buildMonoTable(headers, rows, widths) {
  const head = headers
    .map((h, i) => padEndAscii(h, widths[i] || 8))
    .join(' ')
    .trimEnd();
  const body = (rows || []).map((cols) =>
    cols
      .map((c, i) => {
        const w = widths[i] || 8;
        const val = String(c ?? '');
        // 2-col: label left / value right; wider tables: # + name left, numbers right
        const leftAlign = headers.length <= 2 ? i === 0 : i <= 1;
        return leftAlign ? padEndAscii(val, w) : padStartAscii(val, w);
      })
      .join(' ')
      .trimEnd(),
  );
  return [head, ...body].join('\n');
}

function wrapPre(inner) {
  return `<pre>${escapeHtml(inner)}</pre>`;
}

function sectionHeader(emoji, title) {
  return `${emoji} <b>${escapeHtml(title)}</b>`;
}

const FALLBACK_TOP3_ACTIONS = [
  '61+ kunlik qarzlarni bugun qo‘ng‘iroq qiling',
  'Eng katta muzlab tovarlarga chegirma/aksiya qo‘ying',
  'Tez aylanayotgan tovarlarni zaxirada ushlab turing',
];

/** Prefer marketing_actions; fall back to static store priorities. */
function pickTop3Actions(snapshot) {
  const fromMkt = (snapshot?.marketing?.marketing_actions || [])
    .map((a) => String(a?.action || '').trim())
    .filter(Boolean);
  if (fromMkt.length >= 3) return fromMkt.slice(0, 3);
  const merged = [...fromMkt];
  for (const f of FALLBACK_TOP3_ACTIONS) {
    if (merged.length >= 3) break;
    if (!merged.includes(f)) merged.push(f);
  }
  return merged.slice(0, 3);
}

/**
 * Short Telegram post templates from marketing actions / discount guidance.
 * Plain text lines suitable for copy-paste into a channel.
 */
function buildMarketingPostDrafts(snapshot, limit = 5) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const s = String(raw || '')
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 180);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  for (const a of snapshot?.marketing?.marketing_actions || []) {
    if (out.length >= limit) break;
    if (a?.post_idea) push(a.post_idea);
  }
  for (const g of snapshot?.price_guidance?.discount_candidates || []) {
    if (out.length >= limit) break;
    const pct = g.suggested_discount_pct != null ? g.suggested_discount_pct : 10;
    push(`🔥 ${truncName(g.name, 40)} — bugun ${pct}% chegirma! Ombor tozalash.`);
  }
  if (out.length < 2) {
    push('🔥 Bugungi hitlar — cheklangan zaxira!');
    push('🏷 Flash aksiya: tanlangan tovarlarga maxsus narx.');
  }
  return out.slice(0, limit);
}

/** Always rendered first in AI / marketing messages. */
function buildTop3ActionsHtml(snapshot) {
  const top3 = pickTop3Actions(snapshot);
  const lines = top3.map((a, i) => `${i + 1}) ${a}`);
  return [sectionHeader('✅', 'Top 3 amal'), escapeHtml(lines.join('\n'))].join('\n');
}

/**
 * Marketing + assortment HTML sections (deterministic from snapshot.marketing).
 * Top 3 amallar always lead the block.
 */
function buildMarketingSectionsHtml(snapshot, options = {}) {
  const m = snapshot.marketing || {};
  const actions = m.marketing_actions || [];
  const assortment = m.assortment_suggestions || [];
  const collection = m.collection_targets || [];
  const deadByCat = m.dead_stock_by_category || [];
  const seasonality = m.seasonality;
  const compact = options.compact === true;
  const top3First = options.top3First !== false;

  const top3 = pickTop3Actions(snapshot);
  const restActions = actions.slice(top3.length, 7);
  const restRows = restActions.map((a, i) => {
    const line = `${i + top3.length + 1}) ${a.action}`;
    const post = a.post_idea ? `\n   ✍ ${a.post_idea}` : '';
    const ch = a.channel ? ` [${a.channel}]` : '';
    return escapeHtml(`${line}${ch}${post}`);
  });

  const assortRows =
    assortment.length > 0
      ? buildMonoTable(
          ['#', 'Tavsiya'],
          assortment.slice(0, 5).map((s, i) => [
            String(i + 1),
            truncName(
              `${s.text} (${s.label || 'ichki ma’lumot asosida taxmin'})`,
              compact ? 48 : 56,
            ),
          ]),
          [2, compact ? 48 : 56],
        )
      : 'Ma’lumot yetarli emas';

  const collTable =
    collection.length > 0
      ? buildMonoTable(
          ['#', 'Mijoz', 'Qarz', 'Kamp.'],
          collection.slice(0, 5).map((c, i) => [
            String(i + 1),
            truncName(c.name, 12),
            formatSumma(c.total),
            c.campaign === '61+_undirish' ? '61+' : 'eslat',
          ]),
          [2, 12, 12, 5],
        )
      : null;

  const deadCatTable =
    deadByCat.length > 0
      ? buildMonoTable(
          ['#', 'Kategoriya', 'Muzlab', 'SKU'],
          deadByCat.slice(0, 5).map((c, i) => [
            String(i + 1),
            truncName(c.category, 12),
            formatSumma(c.frozen_value),
            String(c.sku_count || 0),
          ]),
          [2, 12, 12, 4],
        )
      : null;

  const parts = [];
  if (top3First) {
    parts.push(buildTop3ActionsHtml(snapshot), '');
  }
  parts.push(
    sectionHeader('📣', 'Marketing tavsiyalari'),
    escapeHtml('Ichki savdo/ombor/qarz asosida (tashqi bozor API yo‘q).'),
  );
  if (!top3First) {
    parts.push(buildTop3ActionsHtml(snapshot));
  }
  if (restRows.length) {
    parts.push(sectionHeader('📋', 'Qo‘shimcha amallar'), restRows.join('\n'));
  }

  const postDrafts = buildMarketingPostDrafts(snapshot);
  if (postDrafts.length) {
    parts.push(
      '',
      sectionHeader('✍️', 'TG post shablonlari (nusxa)'),
      escapeHtml('Qisqa matnlar — kanalga nusxa qilib yuboring:'),
      wrapPre(postDrafts.map((p, i) => `${i + 1}) ${p}`).join('\n\n')),
    );
  }

  parts.push(
    '',
    sectionHeader('🛒', 'Yangi mahsulot / assortiment'),
    escapeHtml('⚠️ Har bir qator — ichki ma’lumot asosida taxmin, tashqi market research emas.'),
    wrapPre(assortRows),
  );

  if (!compact) {
    if (deadCatTable) {
      parts.push('', sectionHeader('🧊', 'Muzlab qiymat (kategoriya)'), wrapPre(deadCatTable));
    }
    if (collTable) {
      parts.push('', sectionHeader('📞', 'Undirish kampaniyasi'), wrapPre(collTable));
    }
    if (seasonality?.hint) {
      parts.push('', sectionHeader('📅', 'Mavsum'), escapeHtml(seasonality.hint));
    }
  } else if (seasonality?.hint) {
    parts.push('', escapeHtml(`📅 ${seasonality.hint}`));
  }

  return parts.filter((x) => x != null).join('\n');
}

/**
 * Focused marketing-only Telegram message.
 * Top 3 amallar birinchi.
 */
function buildMarketingAnalysisText(snapshot, options = {}) {
  const title = options.aiTitle ? 'Marketing / assortiment' : 'Marketing tavsiya';
  const parts = [
    `📣 <b>${escapeHtml(title)} — ${escapeHtml(snapshot.date)}</b>`,
    snapshot.store_name ? `Do'kon: ${escapeHtml(snapshot.store_name)}` : null,
    '',
    buildMarketingSectionsHtml(snapshot, { compact: false, top3First: true }),
  ];
  if (options.reason) {
    parts.push('', escapeHtml(formatAiFallbackNotice(options.reason, options.status)));
  }
  return parts.filter((x) => x != null).join('\n');
}

/**
 * Guess simple health verdict from snapshot numbers (fallback only).
 */
function guessHealthVerdict(snapshot) {
  const d = snapshot.daily || {};
  const p = snapshot.profit || {};
  const cust = snapshot.aging?.customers || {};
  const custSimple = cust.aging_simple || {};
  const dead = snapshot.dead_stock_top || [];
  const sales = Number(d.total_sales) || 0;
  const profit = p.net_profit != null ? Number(p.net_profit) : null;
  const oldDebt = Number(custSimple['61_plus'] || 0) || 0;
  const deadValue = dead.reduce((s, r) => s + (Number(r.frozen_value) || 0), 0);

  if (sales <= 0 && (oldDebt > 0 || deadValue > 0)) {
    return "DIQQAT — savdo 0; qarz yoki muzlab tovar bor, raqamlarni tekshiring.";
  }
  if (oldDebt > 0 && (profit == null || profit <= 0)) {
    return "DIQQAT — 61+ qarz bor va foyda past/yo‘q.";
  }
  if (deadValue > sales * 2 && sales > 0) {
    return "O‘RTACHA — savdo bor, lekin muzlab tovar qiymati yuqori.";
  }
  if (sales > 0 && (profit == null || profit >= 0) && oldDebt <= 0) {
    return "YAXSHI — savdo bor, katta eski qarz ko‘rinmayapti.";
  }
  return "O‘RTACHA — raqamlarni qo‘lda tekshiring; AI kalit bo‘lmasa to‘liq maslahat cheklangan.";
}

/**
 * Uzbek user-facing fallback line (no secrets / no raw API bodies).
 * @param {string} reason
 * @param {number} [status]
 */
function formatAiFallbackNotice(reason, status) {
  const code = String(reason || 'unknown');
  switch (code) {
    case 'no_api_key':
      return "⚠️ AI izoh yo‘q: OPENAI_API_KEY yoki GEMINI_API_KEY .env da topilmadi. Pastdagi jadvallar to‘liq.";
    case 'no_gemini_key':
      return "⚠️ AI izoh yo‘q: GEMINI_API_KEY .env da topilmadi. Pastdagi jadvallar to‘liq.";
    case 'http_401':
      return "⚠️ AI izoh yo‘q: API kalit noto‘g‘ri yoki muddati o‘tgan (401). Jadvallar yuborildi.";
    case 'http_403':
      return "⚠️ AI izoh yo‘q: AI API ruxsat bermadi (403). Jadvallar yuborildi.";
    case 'billing':
      return "⚠️ AI izoh yo‘q: OpenAI hisobida kvota/to‘lov yetarli emas. Jadvallar yuborildi.";
    case 'rate_limit':
      return "⚠️ AI izoh yo‘q: AI so‘rov limiti (429). Jadvallar yuborildi.";
    case 'network_error':
    case 'gemini_network_error':
      return "⚠️ AI izoh yo‘q: tarmoq xatosi (internet yoki firewall). Jadvallar yuborildi.";
    case 'no_fetch':
      return "⚠️ AI izoh yo‘q: runtime da fetch yo‘q. Jadvallar yuborildi.";
    case 'empty_response':
    case 'bad_json':
      return "⚠️ AI izoh yo‘q: API javobi bo‘sh yoki noto‘g‘ri. Jadvallar yuborildi.";
    case 'bad_format':
      return "⚠️ AI izoh formati mos emas (eski ro‘yxat). Faqat jadvallar yuborildi.";
    case 'api_error': {
      const http = Number(status) > 0 ? ` (HTTP ${Number(status)})` : '';
      return `⚠️ AI izoh yo‘q: API xato${http}. Jadvallar yuborildi.`;
    }
    default:
      return "⚠️ AI izoh yo‘q (noma’lum sabab). Jadvallar yuborildi.";
  }
}

/** Reload root `.env` before every AI call (POS / public-api / bot). */
function ensureOpenAiEnvLoaded(options = {}) {
  if (options.skipEnvLoad) return;
  try {
    require('../../electron/config/loadRootEnv.cjs').loadRootEnv();
  } catch {
    // ignore
  }
}

/**
 * True when LLM returned the old unreadable numbered wall-of-text report.
 */
function looksLikeLegacyNumberedReport(text) {
  const t = String(text || '');
  if (/Sarlavha\s*:/i.test(t)) return true;
  if (/Bugungi\s+savdo/i.test(t)) return true;
  if (/1\)\s*Sarlavha/i.test(t)) return true;
  const numbered = t.match(/^\s*\d+\)\s+/gm);
  if (numbered && numbered.length >= 4 && !/<pre[\s>]/i.test(t)) {
    // Full multi-section report as 1) 2) 3) — reject; short Amallar-only lists are ok if < 4
    if (/Sog['‘’`]?lik|Muzlab|Foyda|Ombor|Qarz/i.test(t)) return true;
  }
  return false;
}

/**
 * Keep only a short plain-text Xulosa (reject free-form full reports).
 * @returns {string|null}
 */
function sanitizeAiCommentary(raw) {
  let t = String(raw || '').trim();
  if (!t) return null;
  if (looksLikeLegacyNumberedReport(t)) return null;
  t = t.replace(/```[\s\S]*?```/g, '').trim();
  t = t.replace(/<\/?(?:html|body|div|span|p|br|b|strong|i|em|pre|code)[^>]*>/gi, '');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (t.length > 900) t = `${t.slice(0, 880).trimEnd()}…`;
  if (t.length < 12) return null;
  return t;
}

function buildAiCommentarySection(commentary) {
  return [sectionHeader('📝', 'Xulosa'), escapeHtml(commentary)].join('\n');
}

/**
 * Classify OpenAI HTTP failures without leaking response secrets.
 * Uses status + safe error.code / type snippets only.
 */
function classifyOpenAiHttpError(status, bodyText) {
  const st = Number(status) || 0;
  const raw = String(bodyText || '').slice(0, 2500);
  let code = '';
  let type = '';
  try {
    const parsed = JSON.parse(raw);
    code = String(parsed?.error?.code || parsed?.code || '').toLowerCase();
    type = String(parsed?.error?.type || parsed?.type || '').toLowerCase();
  } catch {
    // non-JSON body — fall through on status/keywords
  }
  const blob = `${code} ${type} ${raw}`.toLowerCase();

  if (st === 401) return { ok: false, reason: 'http_401', status: st };
  if (st === 403) return { ok: false, reason: 'http_403', status: st };
  if (
    st === 402 ||
    code === 'insufficient_quota' ||
    type === 'insufficient_quota' ||
    /insufficient_quota|billing_not_active|payment.?required/.test(blob)
  ) {
    return { ok: false, reason: 'billing', status: st || 402 };
  }
  if (st === 429) {
    if (code === 'insufficient_quota' || /insufficient_quota/.test(blob)) {
      return { ok: false, reason: 'billing', status: st };
    }
    return { ok: false, reason: 'rate_limit', status: st };
  }
  return { ok: false, reason: 'api_error', status: st };
}

/**
 * Structured HTML fallback for Telegram (parse_mode=HTML).
 * Sections + &lt;pre&gt; monospace tables — readable on all clients.
 * Alias: formatNumericFallback.
 */
function buildNumericAnalysisText(snapshot, options = {}) {
  const d = snapshot.daily || {};
  const p = snapshot.profit || {};
  const dead = snapshot.dead_stock_top || [];
  const fast = snapshot.fast_movers_top || [];
  const cust = snapshot.aging?.customers || {};
  const supp = snapshot.aging?.suppliers || {};
  const custSimple = cust.aging_simple || {};
  const suppSimple = supp.aging_simple || {};
  const guide = snapshot.price_guidance || {};
  const shift = snapshot.shift;
  const includeNotice = options.includeNotice !== false && options.reason;
  const includeActions = options.includeActions !== false;
  const includeMarketing = options.includeMarketing !== false;
  const notice = includeNotice
    ? formatAiFallbackNotice(options.reason, options.status)
    : null;
  const titlePrefix = options.aiTitle ? 'AI tahlil' : "Do'kon raqamlari";
  const titleEmoji = options.aiTitle ? '🤖' : '📊';

  const salesTable = buildMonoTable(
    ['Ko‘rsatkich', 'Summa'],
    [
      ['Naqd', formatSumma(d.cash)],
      ['Karta', formatSumma(d.card)],
      ['Nasiya', formatSumma(d.credit)],
      ['Jami', formatSumma(d.total_sales)],
      ['Buyurtma', String(d.order_count || 0)],
      ...(d.returns_total > 0 || d.returns_count > 0
        ? [['Qaytarish', `${formatSumma(d.returns_total)} (${d.returns_count || 0})`]]
        : []),
    ],
    [12, 14],
  );

  const profitRows = [];
  if (p.gross_profit != null) profitRows.push(['Yalpi foyda', formatSumma(p.gross_profit)]);
  if (p.net_profit != null) profitRows.push(['Sof foyda', formatSumma(p.net_profit)]);
  if (p.profit_margin != null) profitRows.push(['Marja %', String(p.profit_margin)]);
  profitRows.push(['Xarajat', formatSumma(p.expenses ?? d.expenses)]);
  if (snapshot.inventory_value != null) {
    profitRows.push(['Ombor', `~${formatSumma(snapshot.inventory_value)}`]);
  }
  const profitTable = buildMonoTable(['Ko‘rsatkich', 'Summa'], profitRows, [12, 14]);

  const fastTable =
    fast.length > 0
      ? buildMonoTable(
          ['#', 'Mahsulot', 'Sotildi', 'Qiymat'],
          fast.slice(0, 8).map((x, i) => [
            String(i + 1),
            truncName(x.name, 14),
            String(x.sold_qty ?? '—'),
            formatSumma(x.stock_value),
          ]),
          [2, 14, 7, 12],
        )
      : 'Ma’lumot yetarli emas';

  const deadTable =
    dead.length > 0
      ? buildMonoTable(
          ['#', 'Mahsulot', 'Qiymat', 'Kun', '%'],
          dead.slice(0, 10).map((x, i) => [
            String(i + 1),
            truncName(x.name, 12),
            formatSumma(x.frozen_value),
            formatDaysCell(x.days_since_last_sale),
            `${x.suggested_discount_pct != null ? x.suggested_discount_pct : suggestDiscountPct(x.days_since_last_sale, x.frozen_value)}%`,
          ]),
          [2, 12, 11, 4, 4],
        )
      : 'Yo‘q yoki ma’lumot yetarli emas';

  const debtSummary = buildMonoTable(
    ['Bucket', 'Summa'],
    [
      ['Jami', `${formatSumma(cust.total)} (${cust.count || 0} ta)`],
      ['0–30', formatSumma(custSimple.current)],
      ['31–60', formatSumma(custSimple['31_60'])],
      ['61+', formatSumma(custSimple['61_plus'])],
    ],
    [8, 18],
  );
  const topDebtors =
    cust.top?.length > 0
      ? buildMonoTable(
          ['#', 'Mijoz', 'Qarz'],
          cust.top.slice(0, 5).map((x, i) => [
            String(i + 1),
            truncName(x.name, 14),
            formatSumma(x.total),
          ]),
          [2, 14, 12],
        )
      : null;

  const suppLines = [
    `Jami: ${formatSumma(supp.total)} (${supp.count || 0} ta)`,
    `Joriy: ${formatSumma(suppSimple.current)} | 31–60: ${formatSumma(suppSimple['31_60'])} | 61+: ${formatSumma(suppSimple['61_plus'])}`,
  ];

  const priceLines = [];
  if (guide.discount_candidates?.length) {
    priceLines.push(
      buildMonoTable(
        ['#', 'Chegirma', 'Qiymat', '%'],
        guide.discount_candidates.slice(0, 5).map((x, i) => [
          String(i + 1),
          truncName(x.name, 12),
          formatSumma(x.frozen_value),
          `${x.suggested_discount_pct != null ? x.suggested_discount_pct : suggestDiscountPct(x.days_since_last_sale, x.frozen_value)}%`,
        ]),
        [2, 12, 11, 4],
      ),
    );
  }
  if (guide.low_margin?.length) {
    priceLines.push(
      buildMonoTable(
        ['#', 'Past marja', 'Marja%'],
        guide.low_margin.slice(0, 5).map((x, i) => [
          String(i + 1),
          truncName(x.name, 14),
          `${x.margin_pct}%`,
        ]),
        [2, 14, 7],
      ),
    );
  }

  const extraActions = [
    '4) Kunlik xarajatlarni savdo bilan solishtiring',
    '5) Ochiq smena/naqdni kun oxirida tekshiring',
  ];

  const parts = [
    `${titleEmoji} <b>${escapeHtml(titlePrefix)} — ${escapeHtml(snapshot.date)}</b>`,
    snapshot.store_name ? `Do'kon: ${escapeHtml(snapshot.store_name)}` : null,
    '',
    // Top 3 amallar — doim birinchi (before tables).
    includeActions ? buildTop3ActionsHtml(snapshot) : null,
    includeActions ? '' : null,
    sectionHeader('💵', 'Savdo'),
    wrapPre(salesTable),
    '',
    sectionHeader('📈', 'Foyda / Xarajat / Ombor'),
    wrapPre(profitTable),
    '',
    sectionHeader('🩺', "Sog'lik"),
    escapeHtml(guessHealthVerdict(snapshot)),
    '',
    sectionHeader('🔥', 'Tez aylanma'),
    wrapPre(fastTable),
    '',
    sectionHeader('🧊', 'Muzlab tovarlar'),
    wrapPre(deadTable),
    '',
    sectionHeader('💰', 'Mijoz qarzi'),
    wrapPre(debtSummary),
    topDebtors ? `${sectionHeader('👤', 'Top qarzdorlar')}\n${wrapPre(topDebtors)}` : null,
    '',
    sectionHeader('🏭', 'Ta’minotchi qarzi'),
    escapeHtml(suppLines.join('\n')),
    shift
      ? `🧾 Smena: ${escapeHtml(
          `${shift.note}${
            shift.cash_hint != null ? ` (naqd hint: ${formatSumma(shift.cash_hint)})` : ''
          }`,
        )}`
      : null,
    '',
    sectionHeader('🏷', 'Narx yo‘riqnoma'),
    priceLines.length ? wrapPre(priceLines.join('\n\n')) : escapeHtml('Maxsus tavsiya yo‘q'),
    includeMarketing ? '' : null,
    // Avoid duplicate Top 3 when already shown at message start.
    includeMarketing
      ? buildMarketingSectionsHtml(snapshot, { compact: true, top3First: !includeActions })
      : null,
    includeActions ? '' : null,
    includeActions ? sectionHeader('📋', 'Qo‘shimcha amallar') : null,
    includeActions ? escapeHtml(extraActions.join('\n')) : null,
    notice ? '' : null,
    notice ? escapeHtml(notice) : null,
  ].filter((x) => x != null);

  return parts.join('\n');
}

/** @deprecated use buildNumericAnalysisText — kept for callers/tests */
const formatNumericFallback = buildNumericAnalysisText;

function buildSystemPrompt() {
  return [
    "Siz O‘zbekiston chakana do‘koni uchun marketing va assortiment maslahatchisisiz (POS / ichki ma’lumot).",
    "Javob FAQAT o'zbek tilida. Raqamlarni FAQAT snapshot JSON dan oling — uydirma yozmang.",
    'Telefon, API kalit, maxfiy ma’lumot yozmang.',
    'Tashqi bozor / Google Trends / raqobatchi narxlari HAQIDA gapirmang — faqat ichki snapshot.',
    '',
    'MUHIM: To‘liq hisobot / jadval / HTML YUQMA — jadvallarni (Marketing, Assortiment, Savdo…) tizim o‘zi yuboradi.',
    'Eski format TAQIQLANGAN: "1) Sarlavha: … 2) Bugungi savdo …" va shunga o‘xshash uzun ro‘yxat.',
    '',
    'FAQAT shu qisqa matn (oddiy tekst, HTML yo‘q):',
    "Xulosa: 2–3 jumla — sog‘lik (YAXSHI / O‘RTACHA / DIQQAT), 1 marketing ustuvorlik, 1 assortiment ogohlantirish.",
    'Keyin ixtiyoriy 3–5 qator amallar (har biri bitta qator).',
    '',
    'Maksimum ~800 belgi. Inglizcha so‘z ishlatmang.',
  ].join('\n');
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

function resolveOpenAiConfig(options = {}) {
  ensureOpenAiEnvLoaded(options);
  // Prefer non-empty explicit apiKey; otherwise fall back to process.env (after load).
  const fromOpt = stripEnvQuotes(options.apiKey || '');
  const fromEnv = stripEnvQuotes(process.env.OPENAI_API_KEY || '');
  const apiKey = fromOpt || fromEnv;
  const model =
    stripEnvQuotes(options.model || process.env.OPENAI_MODEL || DEFAULT_MODEL) || DEFAULT_MODEL;
  const baseUrl = stripEnvQuotes(options.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  return { apiKey, model, baseUrl, hasApiKey: apiKey.length > 0 };
}

/**
 * Gemini text model for analysis/captions when OpenAI is absent.
 * Uses GEMINI_API_KEY (+ optional GEMINI_TEXT_MODEL). Never returns the key.
 */
function resolveGeminiTextConfig(options = {}) {
  ensureOpenAiEnvLoaded(options);
  const fromOpt = stripEnvQuotes(options.geminiApiKey || '');
  const fromEnv = stripEnvQuotes(process.env.GEMINI_API_KEY || '');
  const apiKey = fromOpt || fromEnv;
  const model =
    stripEnvQuotes(
      options.geminiTextModel || process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_TEXT_MODEL,
    ) || DEFAULT_GEMINI_TEXT_MODEL;
  return { apiKey, model, hasApiKey: apiKey.length > 0 };
}

/**
 * Call OpenAI-compatible chat completions.
 * @returns {Promise<{ ok: boolean, text?: string, reason?: string, model?: string }>}
 */
async function callOpenAiAnalysis(snapshot, options = {}) {
  const { apiKey, model, baseUrl } = resolveOpenAiConfig(options);
  if (!apiKey) {
    return { ok: false, reason: 'no_api_key' };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, reason: 'no_fetch' };
  }

  const body = {
    model,
    temperature: 0.3,
    max_tokens: 500,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content:
          `Quyidagi JSON snapshot (ichki savdo/ombor/qarz/marketing) asosida FAQAT qisqa Xulosa (+ ixtiyoriy amallar) yozing. ` +
          `Jadval yoki "1) Sarlavha" hisobot YOZMA. Marketing/assortiment jadvallari allaqachon yuboriladi:\n${JSON.stringify(snapshot)}`,
      },
    ],
  };

  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(options.timeoutMs) || 45_000));
  let signal;
  try {
    signal = AbortSignal.timeout(timeoutMs);
  } catch {
    signal = undefined;
  }

  let res;
  try {
    res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: String(e?.message || e).slice(0, 120) };
  }

  if (!res.ok) {
    const classified = classifyOpenAiHttpError(res.status, await res.text().catch(() => ''));
    return { ...classified, model };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad_json' };
  }

  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    return { ok: false, reason: 'empty_response' };
  }
  return { ok: true, text, model, provider: 'openai' };
}

/**
 * Gemini generateContent for store analysis commentary.
 */
async function callGeminiAnalysis(snapshot, options = {}) {
  const { apiKey, model } = resolveGeminiTextConfig(options);
  if (!apiKey) {
    return { ok: false, reason: 'no_gemini_key' };
  }
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, reason: 'no_fetch' };
  }

  const prompt = [
    buildSystemPrompt(),
    '',
    `Quyidagi JSON snapshot asosida FAQAT qisqa Xulosa (+ ixtiyoriy amallar) yozing.`,
    `Jadval yoki "1) Sarlavha" hisobot YOZMA:`,
    JSON.stringify(snapshot),
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(options.timeoutMs) || 45_000));
  let signal;
  try {
    signal = AbortSignal.timeout(timeoutMs);
  } catch {
    signal = undefined;
  }

  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
      }),
      signal,
    });
  } catch (e) {
    return { ok: false, reason: 'gemini_network_error', detail: String(e?.message || e).slice(0, 120) };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, reason: `gemini_http_${res.status}`, detail: t.slice(0, 120), model };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'bad_json' };
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => String(p?.text || ''))
    .join('\n')
    .trim();
  if (!text) {
    return { ok: false, reason: 'empty_response' };
  }
  return { ok: true, text, model, provider: 'gemini' };
}

/**
 * Prefer OpenAI; if no OpenAI key, try Gemini text.
 */
async function callLlmAnalysis(snapshot, options = {}) {
  const openai = resolveOpenAiConfig(options);
  if (openai.hasApiKey) {
    return callOpenAiAnalysis(snapshot, options);
  }
  const gemini = resolveGeminiTextConfig(options);
  if (gemini.hasApiKey) {
    return callGeminiAnalysis(snapshot, options);
  }
  return { ok: false, reason: 'no_api_key' };
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

/**
 * Build message: always deterministic HTML tables; optional short AI Xulosa.
 * Returns `text` (joined) and `texts` (1–2 Telegram-safe parts).
 */
async function composeAiAnalysisMessage(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  const callOpts = {
    ...options,
    apiKey: cfg.apiKey,
    model: options.model || cfg.model,
    baseUrl: options.baseUrl || cfg.baseUrl,
  };

  const settings = getAiSettings(db);
  const ymd = String(options.date || localTimeParts(db).date).slice(0, 10);
  const snapshot = buildStoreSnapshot(db, {
    date: ymd,
    storeName: settings.storeName,
    topN: options.topN,
  });

  const includeMarketing =
    options.includeMarketing != null
      ? Boolean(options.includeMarketing)
      : settings.aiMarketing !== false;
  const marketingOnly = Boolean(options.marketingOnly);

  if (marketingOnly) {
    // Focused message: still try short AI Xulosa when key present; tables always deterministic.
    const llm = await callLlmAnalysis(snapshot, callOpts);
    let commentary = null;
    let fallbackReason = null;
    let fallbackStatus = llm.status || null;
    if (llm.ok && llm.text) {
      commentary = sanitizeAiCommentary(llm.text);
      if (!commentary) fallbackReason = 'bad_format';
    } else {
      fallbackReason = llm.reason || 'unknown';
    }
    const usedAi = Boolean(commentary);
    const body = buildMarketingAnalysisText(snapshot, {
      aiTitle: true,
      reason: usedAi ? null : fallbackReason,
      status: fallbackStatus,
    });
    const combined = usedAi ? `${body}\n\n${buildAiCommentarySection(commentary)}` : body;
    const texts = splitTelegramText(combined);
    return {
      text: texts.join('\n\n'),
      texts,
      mode: usedAi ? 'ai' : 'fallback',
      parseMode: 'HTML',
      snapshot,
      llm,
      commentary: usedAi ? commentary : null,
      fallbackReason: usedAi ? null : fallbackReason || 'unknown',
      fallbackStatus: usedAi ? null : fallbackStatus,
      marketingOnly: true,
    };
  }

  const llm = await callLlmAnalysis(snapshot, callOpts);
  let commentary = null;
  let fallbackReason = null;
  let fallbackStatus = llm.status || null;

  if (llm.ok && llm.text) {
    commentary = sanitizeAiCommentary(llm.text);
    if (!commentary) {
      fallbackReason = 'bad_format';
    }
  } else {
    fallbackReason = llm.reason || 'unknown';
  }

  const usedAi = Boolean(commentary);
  const numeric = buildNumericAnalysisText(snapshot, {
    aiTitle: true,
    reason: usedAi ? null : fallbackReason || 'unknown',
    status: fallbackStatus,
    includeNotice: !usedAi,
    includeActions: true,
    includeMarketing,
  });

  let body = usedAi ? `${numeric}\n\n${buildAiCommentarySection(commentary)}` : numeric;

  // Kechki paket: prepend short daily digest so one Telegram message covers both.
  const eveningPackage =
    options.eveningPackage != null
      ? Boolean(options.eveningPackage)
      : settings.eveningPackage === true;
  if (eveningPackage) {
    try {
      const summary = buildDailyDigestSummary(db, ymd);
      const digestPlain = buildDailyDigestText(summary, settings.storeName);
      const digestHtml = [
        `📦 <b>Kechki paket — ${escapeHtml(ymd)}</b>`,
        escapeHtml(digestPlain),
        '',
        '────────',
        '',
      ].join('\n');
      body = `${digestHtml}${body}`;
    } catch {
      // keep AI-only body
    }
  }

  const texts = splitTelegramText(body);
  return {
    text: texts.join('\n\n'),
    texts,
    mode: usedAi ? 'ai' : 'fallback',
    parseMode: 'HTML',
    snapshot,
    llm,
    commentary: usedAi ? commentary : null,
    fallbackReason: usedAi ? null : fallbackReason || 'unknown',
    fallbackStatus: usedAi ? null : fallbackStatus,
    eveningPackage: Boolean(eveningPackage),
  };
}

async function sendComposedAnalysis(db, composed, options = {}) {
  const parts =
    Array.isArray(composed.texts) && composed.texts.length
      ? composed.texts
      : splitTelegramText(composed.text);
  const parseMode = options.parseMode || composed.parseMode || 'HTML';
  let sent = 0;
  let failed = 0;
  let lastReason = null;
  for (const part of parts) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sendToReportChats(db, part, { ...options, parseMode });
    sent += Number(out.sent || 0) || 0;
    failed += Number(out.failed || 0) || 0;
    if (out.reason) lastReason = out.reason;
  }
  return {
    ok: failed === 0 && sent > 0,
    sent,
    failed,
    reason: sent > 0 ? null : lastReason || 'send_failed',
    parts: parts.length,
    mode: composed.mode,
    parseMode,
    fallbackReason: composed.fallbackReason || null,
    date: composed.snapshot?.date || null,
  };
}

function shouldRunMorningBrief(db, settings, options = {}) {
  if (options.force) return { ok: true, reason: 'forced', today: localTimeParts(db).date };
  const parts = localTimeParts(db);
  const [sh, sm] = String(settings.morningBriefTime || DEFAULT_MORNING_BRIEF_TIME)
    .split(':')
    .map((x) => Number(x));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 8) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  // Stop morning window once evening schedule starts (avoid double noise if missed).
  const [eh, em] = String(settings.scheduleTime || '21:00')
    .split(':')
    .map((x) => Number(x));
  const eveningMinutes = (Number.isFinite(eh) ? eh : 21) * 60 + (Number.isFinite(em) ? em : 0);
  if (nowMinutes >= eveningMinutes) {
    return { ok: false, reason: 'after_evening_window', today: parts.date };
  }
  if (String(settings.morningBriefLastRunDate || '').slice(0, 10) === parts.date) {
    return { ok: false, reason: 'already_ran_today', today: parts.date };
  }
  return { ok: true, reason: 'due', today: parts.date };
}

/**
 * Short morning "bugungi diqqat" — Top 3 + one debt / dead-stock highlight.
 * Plain HTML; no full evening tables.
 */
function buildMorningBriefText(snapshot, options = {}) {
  const top3 = pickTop3Actions(snapshot);
  const cust = snapshot.aging?.customers || {};
  const topDebtor = (cust.top || [])[0] || (snapshot.marketing?.collection_targets || [])[0];
  const dead = (snapshot.dead_stock_top || [])[0];
  const evening = options.eveningTime || '21:00';

  const parts = [
    `☀️ <b>Bugungi diqqat — ${escapeHtml(snapshot.date)}</b>`,
    snapshot.store_name ? `Do'kon: ${escapeHtml(snapshot.store_name)}` : null,
    '',
    buildTop3ActionsHtml(snapshot),
    '',
    sectionHeader('🩺', "Sog'lik"),
    escapeHtml(guessHealthVerdict(snapshot)),
  ];
  if (topDebtor) {
    parts.push(
      '',
      sectionHeader('💰', 'Qarz diqqati'),
      escapeHtml(
        `${truncName(topDebtor.name, 28)} — ${formatSumma(topDebtor.total)} so'm` +
          (Number(topDebtor.d61_plus) > 0 ? ' (61+)' : ''),
      ),
    );
  }
  if (dead) {
    parts.push(
      '',
      sectionHeader('🧊', 'Muzlab'),
      escapeHtml(
        `${truncName(dead.name, 28)} — ${formatSumma(dead.frozen_value)}` +
          (dead.days_since_last_sale != null ? ` (${formatDaysCell(dead.days_since_last_sale)} kun)` : ''),
      ),
    );
  }
  parts.push(
    '',
    escapeHtml(`Kechtagi to‘liq hisobot / AI ~${evening}`),
  );
  return parts.filter((x) => x != null).join('\n');
}

/**
 * Morning brief tick — own schedule (~08:00) + lock; separate from evening digest/AI.
 */
async function runMorningBriefTick(db, options = {}) {
  const settings = getAiSettings(db);
  if (!settings.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!settings.morningBrief && !options.force) {
    return { ok: false, skipped: true, reason: 'morning_brief_disabled' };
  }

  const gate = shouldRunMorningBrief(db, settings, options);
  if (!gate.ok) {
    return { ok: false, skipped: true, reason: gate.reason, today: gate.today };
  }

  if (!options.skipLock) {
    const owner = tryAcquireSchedulerLock(db, {
      name: MORNING_LOCK_NAME,
      ttlMs: options.lockTtlMs || 120_000,
    });
    if (!owner) {
      return { ok: false, skipped: true, reason: 'lock_held', today: gate.today };
    }
  }

  const snapshot = buildStoreSnapshot(db, {
    date: gate.today,
    storeName: settings.storeName,
    topN: options.topN || 8,
  });
  const text = buildMorningBriefText(snapshot, { eveningTime: settings.scheduleTime || '21:00' });
  const out = await sendToReportChats(db, text, { ...options, parseMode: 'HTML' });

  if (out.ok || out.sent > 0) {
    writeSetting(db, 'reports.telegram.morning_brief_last_run_date', gate.today, 'string');
    claimNotifyDedup(db, EVENT_MORNING_BRIEF, gate.today);
  }

  return {
    ...out,
    today: gate.today,
    parseMode: 'HTML',
    kind: 'morning_brief',
  };
}

/**
 * Scheduled tick — evening schedule_time (default ~21:00), own last_run_date.
 */
async function runAiAnalysisTick(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  const settings = getAiSettings(db);
  if (!settings.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!settings.aiEnabled && !options.force) {
    return { ok: false, skipped: true, reason: 'ai_disabled' };
  }

  const gate = shouldRunAiAnalysis(db, settings, options);
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

  const composed = await composeAiAnalysisMessage(db, {
    ...options,
    apiKey: cfg.apiKey,
    model: options.model || cfg.model,
    date: gate.today,
    eveningPackage: settings.eveningPackage,
  });
  const out = await sendComposedAnalysis(db, composed, options);

  if (out.ok || out.sent > 0) {
    writeSetting(db, 'reports.telegram.ai_last_run_date', gate.today, 'string');
    claimNotifyDedup(db, EVENT_AI_ANALYSIS, gate.today);
    // When kechki paket merged daily into AI, mark daily digest as sent too.
    if (settings.eveningPackage) {
      writeSetting(db, 'reports.telegram.last_run_date', gate.today, 'string');
      claimNotifyDedup(db, 'daily_digest', gate.today);
    }
  }

  return {
    ...out,
    today: gate.today,
    mode: composed.mode,
    fallbackReason: composed.fallbackReason || null,
    hasApiKey: cfg.hasApiKey,
    eveningPackage: Boolean(settings.eveningPackage),
  };
}

function addDaysYmd(db, ymd, deltaDays) {
  const d = Number(deltaDays) || 0;
  const sign = d >= 0 ? `+${d}` : String(d);
  try {
    const row = db.prepare(`SELECT date(?, ?) AS d`).get(String(ymd).slice(0, 10), `${sign} day`);
    return String(row?.d || ymd).slice(0, 10);
  } catch {
    const base = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
    base.setDate(base.getDate() + d);
    return base.toISOString().slice(0, 10);
  }
}

function localWeekday(db, ymd) {
  try {
    const row = db
      .prepare(`SELECT cast(strftime('%w', date(?)) AS INTEGER) AS w`)
      .get(String(ymd).slice(0, 10));
    const w = Number(row?.w);
    return Number.isFinite(w) ? w : 0;
  } catch {
    return new Date(`${String(ymd).slice(0, 10)}T12:00:00`).getDay();
  }
}

function weekKeyFromEnd(endYmd) {
  return `end:${String(endYmd).slice(0, 10)}`;
}

function rollingWeekWindows(db, endYmd) {
  const thisEnd = String(endYmd).slice(0, 10);
  const thisStart = addDaysYmd(db, thisEnd, -6);
  const lastEnd = addDaysYmd(db, thisStart, -1);
  const lastStart = addDaysYmd(db, lastEnd, -6);
  return {
    thisWeek: { start: thisStart, end: thisEnd },
    lastWeek: { start: lastStart, end: lastEnd },
  };
}

function pctChange(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  if (p === 0) {
    if (c === 0) return 0;
    return null;
  }
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

function formatDeltaLine(label, curr, prev, opts = {}) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  const delta = c - p;
  const pct = pctChange(c, p);
  const money = opts.money !== false;
  const curS = money ? formatSumma(c) : String(Math.round(c));
  const prevS = money ? formatSumma(p) : String(Math.round(p));
  const dS = money ? formatSumma(delta) : String(Math.round(delta));
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '→';
  const pctS = pct == null ? (c > 0 ? 'yangi' : '0%') : `${pct > 0 ? '+' : ''}${pct}%`;
  return `${label}: ${curS} (${arrow} ${dS} / ${pctS} vs ${prevS})`;
}

/**
 * Aggregate sales / profit / debt / dead-stock for a date range.
 * Dead stock is point-in-time (as of range end / now).
 */
function buildWeekMetrics(db, start, end, options = {}) {
  const from = String(start).slice(0, 10);
  const to = String(end).slice(0, 10);
  let totalSales = 0;
  let orderCount = 0;
  let cash = 0;
  let card = 0;
  let credit = 0;
  let netProfitSum = 0;
  let expenses = 0;
  let day = from;
  let guard = 0;
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    while (day <= to && guard < 14) {
      guard += 1;
      try {
        const daily = reports.getDailySales(day) || {};
        totalSales += Number(daily.total_sales || 0) || 0;
        orderCount += Number(daily.order_count || 0) || 0;
        cash += Number(daily.cash_total || 0) || 0;
        card += Number(daily.card_total || 0) || 0;
        credit += Number(daily.credit_total || 0) || 0;
        if (daily.net_profit != null) netProfitSum += Number(daily.net_profit) || 0;
      } catch {
        // skip day
      }
      try {
        const { buildDailyDigestSummary: dig } = require('./reportNotify.cjs');
        expenses += Number(dig(db, day).expensesTotal || 0) || 0;
      } catch {
        // ignore
      }
      day = addDaysYmd(db, day, 1);
    }
  } catch {
    // minimal DB
  }

  let netProfit = roundMoney(netProfitSum);
  let grossProfit = null;
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    const pnl = reports.getProfitAndLossSQL({ date_from: from, date_to: to });
    const s = pnl?.summary || pnl || {};
    if (s.net_profit != null) netProfit = roundMoney(s.net_profit);
    if (s.gross_profit != null) grossProfit = roundMoney(s.gross_profit);
    if (s.expenses != null || s.total_expenses != null) {
      expenses = roundMoney(s.expenses ?? s.total_expenses);
    }
  } catch {
    // keep sums
  }

  let debtTotal = 0;
  let debt61 = 0;
  try {
    const ReportsService = require('../../electron/services/reportsService.cjs');
    const reports = new ReportsService(db);
    const rep = reports.getAging({ as_of_date: to });
    const cust = summarizeAgingSide(rep?.customers);
    debtTotal = roundMoney(cust.total);
    debt61 = roundMoney(cust.aging_simple?.['61_plus']);
  } catch {
    try {
      const { buildDailyDigestSummary: dig } = require('./reportNotify.cjs');
      debtTotal = roundMoney(dig(db, to).customerDebtTotal);
    } catch {
      debtTotal = 0;
    }
  }

  let deadCount = 0;
  let deadValue = 0;
  let deadTop = [];
  try {
    const InventoryService = require('../../electron/services/inventoryService.cjs');
    const inv = new InventoryService(db);
    const rows = (inv.getDeadStock({ days: 30 }) || []).slice(0, options.topN || 8).map(mapDeadStockRow);
    deadTop = rows;
    deadCount = rows.length;
    deadValue = roundMoney(rows.reduce((s, r) => s + (Number(r.frozen_value) || 0), 0));
  } catch {
    // optional
  }

  return {
    start: from,
    end: to,
    total_sales: roundMoney(totalSales),
    order_count: orderCount,
    cash: roundMoney(cash),
    card: roundMoney(card),
    credit: roundMoney(credit),
    net_profit: netProfit,
    gross_profit: grossProfit,
    expenses: roundMoney(expenses),
    debt_total: debtTotal,
    debt_61_plus: debt61,
    dead_stock_count: deadCount,
    dead_stock_value: deadValue,
    dead_stock_top: deadTop,
  };
}

function buildWeeklyComparison(db, options = {}) {
  const settings = getAiSettings(db);
  const end =
    String(options.date || options.end || localTimeParts(db).date).slice(0, 10) ||
    localTimeParts(db).date;
  const windows = rollingWeekWindows(db, end);
  const thisWeek = buildWeekMetrics(db, windows.thisWeek.start, windows.thisWeek.end, options);
  const lastWeek = buildWeekMetrics(db, windows.lastWeek.start, windows.lastWeek.end, options);
  // Dead stock is current point-in-time — attach once (prefer this week snapshot).
  return {
    date: end,
    store_name: String(options.storeName || settings.storeName || "Do'kon").trim(),
    this_week: thisWeek,
    last_week: lastWeek,
    deltas: {
      sales: roundMoney(thisWeek.total_sales - lastWeek.total_sales),
      sales_pct: pctChange(thisWeek.total_sales, lastWeek.total_sales),
      profit: roundMoney((thisWeek.net_profit || 0) - (lastWeek.net_profit || 0)),
      profit_pct: pctChange(thisWeek.net_profit, lastWeek.net_profit),
      debt: roundMoney(thisWeek.debt_total - lastWeek.debt_total),
      debt_pct: pctChange(thisWeek.debt_total, lastWeek.debt_total),
      dead_value: roundMoney(thisWeek.dead_stock_value - lastWeek.dead_stock_value),
      dead_pct: pctChange(thisWeek.dead_stock_value, lastWeek.dead_stock_value),
    },
  };
}

function buildWeeklyAnalysisText(comparison, options = {}) {
  const c = comparison || {};
  const tw = c.this_week || {};
  const lw = c.last_week || {};
  const dead = tw.dead_stock_top || [];

  const cmpTable = buildMonoTable(
    ['Ko‘rsatkich', 'Shu 7', 'O‘tgan', 'Δ'],
    [
      [
        'Savdo',
        formatSumma(tw.total_sales),
        formatSumma(lw.total_sales),
        formatSumma((tw.total_sales || 0) - (lw.total_sales || 0)),
      ],
      [
        'Buyurtma',
        String(tw.order_count || 0),
        String(lw.order_count || 0),
        String((tw.order_count || 0) - (lw.order_count || 0)),
      ],
      [
        'Sof foyda',
        formatSumma(tw.net_profit),
        formatSumma(lw.net_profit),
        formatSumma((tw.net_profit || 0) - (lw.net_profit || 0)),
      ],
      [
        'Qarz',
        formatSumma(tw.debt_total),
        formatSumma(lw.debt_total),
        formatSumma((tw.debt_total || 0) - (lw.debt_total || 0)),
      ],
      [
        'Muzlab',
        formatSumma(tw.dead_stock_value),
        formatSumma(lw.dead_stock_value),
        formatSumma((tw.dead_stock_value || 0) - (lw.dead_stock_value || 0)),
      ],
    ],
    [10, 11, 11, 11],
  );

  const deadTable =
    dead.length > 0
      ? buildMonoTable(
          ['#', 'Mahsulot', 'Qiymat', '%'],
          dead.slice(0, 8).map((x, i) => [
            String(i + 1),
            truncName(x.name, 14),
            formatSumma(x.frozen_value),
            `${x.suggested_discount_pct != null ? x.suggested_discount_pct : suggestDiscountPct(x.days_since_last_sale, x.frozen_value)}%`,
          ]),
          [2, 14, 11, 4],
        )
      : 'Muzlab tovar kam yoki ma’lumot yetarli emas';

  const parts = [
    `📅 <b>Haftalik AI — ${escapeHtml(c.date || '')}</b>`,
    c.store_name ? `Do'kon: ${escapeHtml(c.store_name)}` : null,
    '',
    escapeHtml(
      `Shu 7 kun: ${tw.start || '—'} → ${tw.end || '—'} | O‘tgan: ${lw.start || '—'} → ${lw.end || '—'}`,
    ),
    '',
    sectionHeader('📊', 'Taqqoslash'),
    wrapPre(cmpTable),
    '',
    sectionHeader('📈', 'O‘zgarish'),
    escapeHtml(
      [
        formatDeltaLine('Savdo', tw.total_sales, lw.total_sales),
        formatDeltaLine('Foyda', tw.net_profit, lw.net_profit),
        formatDeltaLine('Qarz', tw.debt_total, lw.debt_total),
        formatDeltaLine('Muzlab', tw.dead_stock_value, lw.dead_stock_value),
        `61+ qarz: ${formatSumma(tw.debt_61_plus)} (o‘tgan ${formatSumma(lw.debt_61_plus)})`,
      ].join('\n'),
    ),
    '',
    sectionHeader('🧊', 'Muzlab + tavsiya chegirma %'),
    wrapPre(deadTable),
    '',
    escapeHtml('Eslatma: muzlab qiymat — joriy ombor holati (tarixiy snapshot yo‘q).'),
  ];
  if (options.reason) {
    parts.push('', escapeHtml(formatAiFallbackNotice(options.reason, options.status)));
  }
  return parts.filter((x) => x != null).join('\n');
}

function shouldRunWeeklyAi(db, settings, options = {}) {
  const parts = localTimeParts(db);
  if (options.force) {
    return {
      ok: true,
      reason: 'forced',
      today: parts.date,
      weekKey: weekKeyFromEnd(parts.date),
    };
  }
  const wantWd = normalizeWeekday(settings.weeklyAiWeekday, DEFAULT_WEEKLY_AI_WEEKDAY);
  const nowWd = localWeekday(db, parts.date);
  if (nowWd !== wantWd) {
    return { ok: false, reason: 'wrong_weekday', today: parts.date, weekday: nowWd, wantWd };
  }
  const [sh, sm] = String(settings.weeklyAiTime || DEFAULT_WEEKLY_AI_TIME)
    .split(':')
    .map((x) => Number(x));
  const scheduleMinutes = (Number.isFinite(sh) ? sh : 8) * 60 + (Number.isFinite(sm) ? sm : 0);
  const nowMinutes = parts.hour * 60 + parts.minute;
  if (nowMinutes < scheduleMinutes) {
    return { ok: false, reason: 'before_schedule', today: parts.date };
  }
  const weekKey = weekKeyFromEnd(parts.date);
  if (String(settings.weeklyAiLastRunWeek || '').trim() === weekKey) {
    return { ok: false, reason: 'already_ran_this_week', today: parts.date, weekKey };
  }
  return { ok: true, reason: 'due', today: parts.date, weekKey };
}

async function composeWeeklyAnalysisMessage(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const settings = getAiSettings(db);
  const ymd = String(options.date || localTimeParts(db).date).slice(0, 10);
  const comparison = buildWeeklyComparison(db, {
    date: ymd,
    storeName: settings.storeName,
    topN: options.topN || 8,
  });
  // Deterministic week report (optional short AI Xulosa reuse later if needed).
  const body = buildWeeklyAnalysisText(comparison, {
    reason: options.includeNotice ? options.reason : null,
    status: options.status,
  });
  const texts = splitTelegramText(body);
  return {
    text: texts.join('\n\n'),
    texts,
    mode: 'weekly',
    parseMode: 'HTML',
    comparison,
    snapshot: comparison,
  };
}

async function runWeeklyAiTick(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const settings = getAiSettings(db);
  if (!settings.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!settings.weeklyAi && !options.force) {
    return { ok: false, skipped: true, reason: 'weekly_ai_disabled' };
  }

  const gate = shouldRunWeeklyAi(db, settings, options);
  if (!gate.ok) {
    return {
      ok: false,
      skipped: true,
      reason: gate.reason,
      today: gate.today,
      weekKey: gate.weekKey || null,
    };
  }

  if (!options.skipLock) {
    const owner = tryAcquireSchedulerLock(db, {
      name: WEEKLY_LOCK_NAME,
      ttlMs: options.lockTtlMs || 180_000,
    });
    if (!owner) {
      return { ok: false, skipped: true, reason: 'lock_held', today: gate.today };
    }
  }

  const composed = await composeWeeklyAnalysisMessage(db, {
    ...options,
    date: gate.today,
  });
  const out = await sendComposedAnalysis(db, composed, options);

  if (out.ok || out.sent > 0) {
    const weekKey = gate.weekKey || weekKeyFromEnd(gate.today);
    writeSetting(db, 'reports.telegram.weekly_ai_last_run_week', weekKey, 'string');
    claimNotifyDedup(db, EVENT_WEEKLY_AI, weekKey);
  }

  return {
    ...out,
    today: gate.today,
    weekKey: gate.weekKey || weekKeyFromEnd(gate.today),
    mode: 'weekly',
    kind: 'weekly_ai',
  };
}

async function sendWeeklyAiNow(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const settings = getAiSettings(db);
  const { resolveReportDestination, NO_CHAT_ID_HINT } = require('./reportNotify.cjs');
  const dest = resolveReportDestination(db, options);
  const { chatIds, botToken } = dest;
  if (!botToken) return { ok: false, reason: 'no_bot_token' };
  if (!chatIds.length) {
    return {
      ok: false,
      reason: 'no_chat_id',
      hint: NO_CHAT_ID_HINT,
    };
  }
  const composed = await composeWeeklyAnalysisMessage(db, {
    ...options,
    date: options.date || localTimeParts(db).date,
  });
  const out = await sendComposedAnalysis(db, composed, { ...options, chatIds, botToken });
  return {
    ...out,
    mode: 'weekly',
    date: composed.comparison?.date,
    storeName: settings.storeName,
  };
}

/**
 * On-demand / settings test button — ignore schedule & ai_enabled gate.
 */
async function sendAiAnalysisNow(db, options = {}) {
  ensureOpenAiEnvLoaded(options);
  const cfg = resolveOpenAiConfig(options);
  const gemini = resolveGeminiTextConfig(options);
  const settings = getAiSettings(db);
  const { resolveReportDestination, NO_CHAT_ID_HINT } = require('./reportNotify.cjs');
  const dest = resolveReportDestination(db, options);
  const { chatIds, botToken } = dest;
  if (!botToken) return { ok: false, reason: 'no_bot_token' };
  if (!chatIds.length) {
    return {
      ok: false,
      reason: 'no_chat_id',
      hint: NO_CHAT_ID_HINT,
    };
  }

  const composed = await composeAiAnalysisMessage(db, {
    ...options,
    apiKey: cfg.apiKey,
    model: options.model || cfg.model,
    date: options.date || localTimeParts(db).date,
  });
  const out = await sendComposedAnalysis(db, composed, { ...options, chatIds, botToken });
  return {
    ...out,
    mode: composed.mode,
    fallbackReason: composed.fallbackReason || null,
    date: composed.snapshot?.date,
    storeName: settings.storeName,
    hasApiKey: Boolean(cfg.hasApiKey || gemini.hasApiKey),
    provider: composed.llm?.provider || (cfg.hasApiKey ? 'openai' : gemini.hasApiKey ? 'gemini' : null),
  };
}

module.exports = {
  LOCK_NAME,
  MORNING_LOCK_NAME,
  WEEKLY_LOCK_NAME,
  EVENT_AI_ANALYSIS,
  EVENT_MORNING_BRIEF,
  EVENT_WEEKLY_AI,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_MORNING_BRIEF_TIME,
  DEFAULT_WEEKLY_AI_TIME,
  DEFAULT_WEEKLY_AI_WEEKDAY,
  WEEKDAY_LABELS_UZ,
  TOP_N,
  TELEGRAM_SAFE_LIMIT,
  getAiSettings,
  shouldRunAiAnalysis,
  shouldRunMorningBrief,
  shouldRunWeeklyAi,
  buildStoreSnapshot,
  buildNumericAnalysisText,
  buildMarketingAnalysisText,
  buildMarketingSectionsHtml,
  buildMarketingBlock,
  buildMarketingPostDrafts,
  buildDeterministicMarketingActions,
  buildDeterministicAssortmentSuggestions,
  pickTop3Actions,
  buildTop3ActionsHtml,
  buildMorningBriefText,
  buildWeeklyComparison,
  buildWeeklyAnalysisText,
  buildWeekMetrics,
  suggestDiscountPct,
  formatNumericFallback,
  formatSumma,
  formatDaysCell,
  truncName,
  buildMonoTable,
  escapeHtml,
  formatAiFallbackNotice,
  classifyOpenAiHttpError,
  buildSystemPrompt,
  resolveOpenAiConfig,
  resolveGeminiTextConfig,
  ensureOpenAiEnvLoaded,
  looksLikeLegacyNumberedReport,
  sanitizeAiCommentary,
  callOpenAiAnalysis,
  callGeminiAnalysis,
  callLlmAnalysis,
  composeAiAnalysisMessage,
  composeWeeklyAnalysisMessage,
  splitTelegramText,
  runAiAnalysisTick,
  runMorningBriefTick,
  runWeeklyAiTick,
  sendAiAnalysisNow,
  sendWeeklyAiNow,
  assertNoSecrets,
};
