'use strict';

/**
 * Admin Telegram bot store reports (hisobot / AI tahlil / marketing).
 * Pure builders + keyboard helpers — no Telegraf dependency (unit-testable).
 */

const SettingsService = require('../../electron/services/settingsService.cjs');
const {
  buildDailyDigestSummary,
  buildDailyDigestText,
  getReportTelegramSettings,
  toBool,
} = require('./reportNotify.cjs');
const {
  buildStoreSnapshot,
  composeAiAnalysisMessage,
  composeWeeklyAnalysisMessage,
  splitTelegramText,
  getAiSettings,
} = require('./storeAiAnalysis.cjs');

const REPORT_KINDS = Object.freeze([
  'daily',
  'ai',
  'weekly',
  'dead_stock',
  'debt',
  'profit',
  'marketing',
]);

/** URL / callback aliases → canonical kind in REPORT_KINDS */
const REPORT_KIND_ALIASES = Object.freeze({
  marketing: 'marketing',
  assortiment: 'marketing',
  assortment: 'marketing',
  weekly_ai: 'weekly',
  haftalik: 'weekly',
});

const REPORT_MENU = Object.freeze({
  daily: '📊 Kunlik hisobot',
  ai: '🤖 AI tahlil',
  weekly: '📅 Haftalik AI',
  dead_stock: '🧊 Muzlab tovarlar',
  debt: '💰 Qarzdorlik',
  profit: '📈 Foyda qisqacha',
  marketing: '📣 Marketing tavsiya',
});

const REPORT_CALLBACK_PREFIX = 'store_report:';
/** Admin callback: send credit reminder for a customer (uuid). */
const CREDIT_REMIND_CALLBACK_PREFIX = 'cr_rem:';

/**
 * Normalize store-report kind (path param, callback suffix, or free text alias).
 * Accepts canonical kinds plus marketing aliases (assortiment / assortment).
 * @returns {string|null} canonical kind or null
 */
function normalizeReportKind(kind) {
  const raw = String(kind || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'menu') return 'menu';
  if (REPORT_KIND_ALIASES[raw]) return REPORT_KIND_ALIASES[raw];
  if (REPORT_KINDS.includes(raw)) return raw;
  return null;
}

function readSetting(db, key, fallback = null) {
  try {
    const settings = new SettingsService(db);
    const val = settings.get(key);
    return val == null ? fallback : val;
  } catch {
    return fallback;
  }
}

function formatSumma(amount) {
  return Math.round(Number(amount) || 0).toLocaleString('uz-UZ');
}

function isBotButtonsEnabled(db) {
  // Default on when reports are enabled; explicit false turns buttons off.
  const base = getReportTelegramSettings(db);
  const explicit = readSetting(db, 'reports.telegram.bot_buttons', null);
  if (explicit == null || explicit === '') {
    return !!base.enabled;
  }
  return toBool(explicit, !!base.enabled);
}

function isMarketingReportsEnabled(db) {
  try {
    return getAiSettings(db).aiMarketing !== false;
  } catch {
    return true;
  }
}

function parseAdminTelegramIds(envValue = process.env.TELEGRAM_ADMIN_IDS) {
  return String(envValue || '')
    .split(',')
    .map((s) => Number.parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function isAuthorizedReportAdmin(telegramId, envValue) {
  const id = Number(telegramId);
  if (!Number.isFinite(id)) return false;
  return parseAdminTelegramIds(envValue).includes(id);
}

function matchReportKindFromText(text) {
  const t = String(text || '').trim();
  for (const [kind, label] of Object.entries(REPORT_MENU)) {
    if (t === label) return kind;
  }
  // soft match without emoji
  const lower = t.toLowerCase();
  if (/kunlik\s*hisobot/.test(lower)) return 'daily';
  if (/haftalik\s*ai|📅/.test(lower)) return 'weekly';
  if (/ai\s*tahlil|🤖/.test(lower)) return 'ai';
  if (/muzlab/.test(lower)) return 'dead_stock';
  if (/qarzdorlik|qarz/.test(lower) && !/foyda/.test(lower)) return 'debt';
  if (/foyda/.test(lower)) return 'profit';
  if (/marketing|assortiment|📣/.test(lower)) return 'marketing';
  return null;
}

function matchReportKindFromCallback(data) {
  const raw = String(data || '');
  if (!raw.startsWith(REPORT_CALLBACK_PREFIX)) return null;
  const kind = raw.slice(REPORT_CALLBACK_PREFIX.length).trim().toLowerCase();
  return normalizeReportKind(kind);
}

function buildReportReplyKeyboardRows(db = null) {
  const showMarketing = !db || isMarketingReportsEnabled(db);
  const rows = [
    [REPORT_MENU.daily, REPORT_MENU.ai],
    [REPORT_MENU.weekly, REPORT_MENU.dead_stock],
    [REPORT_MENU.debt, REPORT_MENU.profit],
  ];
  if (showMarketing) {
    rows.push([REPORT_MENU.marketing]);
  }
  return rows;
}

function buildReportInlineKeyboardRows(db = null) {
  const showMarketing = !db || isMarketingReportsEnabled(db);
  const rows = [
    [
      { text: REPORT_MENU.daily, callback_data: `${REPORT_CALLBACK_PREFIX}daily` },
      { text: REPORT_MENU.ai, callback_data: `${REPORT_CALLBACK_PREFIX}ai` },
    ],
    [
      { text: REPORT_MENU.weekly, callback_data: `${REPORT_CALLBACK_PREFIX}weekly` },
      { text: REPORT_MENU.dead_stock, callback_data: `${REPORT_CALLBACK_PREFIX}dead_stock` },
    ],
    [
      { text: REPORT_MENU.debt, callback_data: `${REPORT_CALLBACK_PREFIX}debt` },
      { text: REPORT_MENU.profit, callback_data: `${REPORT_CALLBACK_PREFIX}profit` },
    ],
  ];
  if (showMarketing) {
    rows.push([
      {
        text: REPORT_MENU.marketing,
        callback_data: `${REPORT_CALLBACK_PREFIX}marketing`,
      },
    ]);
  }
  return rows;
}

function buildDeadStockText(snapshot) {
  const rows = snapshot.dead_stock_top || [];
  const lines = [
    `🧊 Muzlab tovarlar — ${snapshot.date}`,
    snapshot.store_name ? `Do'kon: ${snapshot.store_name}` : null,
    '',
  ];
  if (!rows.length) {
    lines.push('Hozircha muzlab tovar topilmadi (yoki ombor ma’lumoti yetarli emas).');
    return lines.filter((x) => x != null).join('\n');
  }
  rows.slice(0, 10).forEach((r, i) => {
    const days = r.days_since_last_sale != null ? `${r.days_since_last_sale} kun` : 'sotuv yo‘q';
    const pct =
      r.suggested_discount_pct != null
        ? r.suggested_discount_pct
        : null;
    const pctLabel = pct != null ? `, tavsiya −${pct}%` : '';
    lines.push(
      `${i + 1}. ${r.name} — zaxira ${r.stock}, qiymat ${formatSumma(r.frozen_value)} (${days}${pctLabel})`,
    );
  });
  const guide = snapshot.price_guidance?.discount_candidates || [];
  if (guide.length) {
    lines.push('');
    lines.push('🏷 Chegirma uchun ustuvor:');
    guide.slice(0, 5).forEach((g) => {
      const pct = g.suggested_discount_pct != null ? ` −${g.suggested_discount_pct}%` : '';
      lines.push(`• ${g.name} (${formatSumma(g.frozen_value)}${pct})`);
    });
  }
  return lines.filter((x) => x != null).join('\n');
}

function buildDebtText(snapshot) {
  const cust = snapshot.aging?.customers || {};
  const supp = snapshot.aging?.suppliers || {};
  const cs = cust.aging_simple || {};
  const ss = supp.aging_simple || {};
  const lines = [
    `💰 Qarzdorlik — ${snapshot.date}`,
    snapshot.store_name ? `Do'kon: ${snapshot.store_name}` : null,
    '',
    'Mijozlar:',
    `• Jami: ${formatSumma(cust.total)} so'm (${cust.count || 0} ta)`,
    `• Joriy (0–30): ${formatSumma(cs.current)}`,
    `• 31–60: ${formatSumma(cs['31_60'])}`,
    `• 61+: ${formatSumma(cs['61_plus'])}`,
  ];
  if (cust.top?.length) {
    lines.push('• Top:');
    cust.top.slice(0, 8).forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.name}: ${formatSumma(t.total)}`);
    });
  }
  lines.push('');
  lines.push('Ta’minotchilar:');
  lines.push(`• Jami: ${formatSumma(supp.total)} so'm (${supp.count || 0} ta)`);
  lines.push(`• Joriy: ${formatSumma(ss.current)} | 31–60: ${formatSumma(ss['31_60'])} | 61+: ${formatSumma(ss['61_plus'])}`);
  if (supp.top?.length) {
    lines.push('• Top:');
    supp.top.slice(0, 5).forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.name}: ${formatSumma(t.total)}`);
    });
  }
  return lines.filter((x) => x != null).join('\n');
}

function buildProfitText(snapshot) {
  const d = snapshot.daily || {};
  const p = snapshot.profit || {};
  const lines = [
    `📈 Foyda qisqacha — ${snapshot.date}`,
    snapshot.store_name ? `Do'kon: ${snapshot.store_name}` : null,
    '',
    `Savdo: ${formatSumma(d.total_sales)} so'm (${d.order_count || 0} ta)`,
    `Naqd / karta / nasiya: ${formatSumma(d.cash)} / ${formatSumma(d.card)} / ${formatSumma(d.credit)}`,
    d.returns_total > 0 ? `Qaytarish: ${formatSumma(d.returns_total)}` : null,
    p.gross_profit != null ? `Yalpi foyda: ${formatSumma(p.gross_profit)}` : null,
    p.net_profit != null ? `Sof foyda (taxmin): ${formatSumma(p.net_profit)}` : null,
    p.profit_margin != null ? `Marja: ${p.profit_margin}%` : null,
    `Xarajat: ${formatSumma(p.expenses ?? d.expenses)}`,
    snapshot.inventory_value != null
      ? `Ombor qiymati: ~${formatSumma(snapshot.inventory_value)}`
      : null,
    snapshot.shift ? `Smena: ${snapshot.shift.note}` : null,
  ];
  return lines.filter((x) => x != null).join('\n');
}

/**
 * Collect top debtors with POS customer id (for reminder buttons).
 */
function listTopDebtorsForReminders(snapshot, limit = 5) {
  const fromCollection = snapshot?.marketing?.collection_targets || [];
  const fromAging = snapshot?.aging?.customers?.top || [];
  const seen = new Set();
  const out = [];
  for (const src of [fromCollection, fromAging]) {
    for (const t of src) {
      const id = t?.id ? String(t.id).trim() : '';
      if (!id || seen.has(id)) continue;
      if (Number(t.total) <= 0) continue;
      seen.add(id);
      out.push({
        id,
        name: String(t.name || 'Mijoz').trim() || 'Mijoz',
        total: Number(t.total) || 0,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Inline buttons: "Eslatma yuborish" for top debtors with known Telegram link.
 * Callback data: cr_rem:{customerId} (Telegram limit 64 bytes).
 */
function buildDebtorReminderInlineKeyboard(db, snapshot, options = {}) {
  const limit = Math.min(5, Math.max(1, Number(options.limit) || 5));
  const debtors = listTopDebtorsForReminders(snapshot, limit);
  if (!debtors.length) return null;

  let getTelegramIdForCustomer;
  try {
    ({ getTelegramIdForCustomer } = require('./creditReminder.cjs'));
  } catch {
    return null;
  }

  const rows = [];
  for (const d of debtors) {
    let tg = null;
    try {
      tg = getTelegramIdForCustomer(db, d.id);
    } catch {
      tg = null;
    }
    if (tg == null) continue;
    const label = `📩 Eslatma: ${String(d.name).slice(0, 28)}`;
    const data = `${CREDIT_REMIND_CALLBACK_PREFIX}${d.id}`;
    if (data.length > 64) continue;
    rows.push([{ text: label, callback_data: data }]);
  }
  if (!rows.length) return null;
  return { inline_keyboard: rows };
}

function matchCreditRemindCustomerId(data) {
  const raw = String(data || '');
  if (!raw.startsWith(CREDIT_REMIND_CALLBACK_PREFIX)) return null;
  const id = raw.slice(CREDIT_REMIND_CALLBACK_PREFIX.length).trim();
  return id || null;
}

/**
 * Build one store report for bot/admin.
 * @returns {Promise<{ ok: boolean, kind: string, text: string, texts: string[], mode?: string, reason?: string }>}
 */
async function buildStoreReport(db, kind, options = {}) {
  const raw = String(kind || '').trim().toLowerCase();
  const k = normalizeReportKind(raw);
  if (!k || k === 'menu') {
    return { ok: false, kind: raw, text: '', texts: [], reason: 'invalid_kind' };
  }

  const settings = getReportTelegramSettings(db);
  const ymd =
    String(options.date || '').slice(0, 10) ||
    db.prepare(`SELECT date('now','localtime') AS d`).get()?.d ||
    new Date().toISOString().slice(0, 10);

  if (k === 'ai') {
    const composed = await composeAiAnalysisMessage(db, {
      ...options,
      date: ymd,
    });
    const texts =
      Array.isArray(composed.texts) && composed.texts.length
        ? composed.texts
        : splitTelegramText(composed.text);
    return {
      ok: true,
      kind: k,
      text: texts.join('\n\n'),
      texts,
      mode: composed.mode,
      fallbackReason: composed.fallbackReason || null,
      parseMode: 'HTML',
    };
  }

  if (k === 'weekly') {
    const composed = await composeWeeklyAnalysisMessage(db, {
      ...options,
      date: ymd,
    });
    const texts =
      Array.isArray(composed.texts) && composed.texts.length
        ? composed.texts
        : splitTelegramText(composed.text);
    return {
      ok: true,
      kind: k,
      text: texts.join('\n\n'),
      texts,
      mode: composed.mode || 'weekly',
      parseMode: 'HTML',
      comparison: composed.comparison,
    };
  }

  if (k === 'marketing') {
    if (!isMarketingReportsEnabled(db)) {
      return {
        ok: false,
        kind: k,
        text: '',
        texts: [],
        reason: 'marketing_disabled',
      };
    }
    const composed = await composeAiAnalysisMessage(db, {
      ...options,
      date: ymd,
      marketingOnly: true,
      includeMarketing: true,
    });
    const texts =
      Array.isArray(composed.texts) && composed.texts.length
        ? composed.texts
        : splitTelegramText(composed.text);
    const replyMarkup = buildDebtorReminderInlineKeyboard(db, composed.snapshot);
    return {
      ok: true,
      kind: k,
      text: texts.join('\n\n'),
      texts,
      mode: composed.mode,
      fallbackReason: composed.fallbackReason || null,
      parseMode: 'HTML',
      replyMarkup,
      snapshot: composed.snapshot,
    };
  }

  if (k === 'daily') {
    const summary = buildDailyDigestSummary(db, ymd);
    const text = buildDailyDigestText(summary, settings.storeName);
    const texts = splitTelegramText(text);
    return { ok: true, kind: k, text: texts.join('\n\n'), texts };
  }

  const snapshot = buildStoreSnapshot(db, {
    date: ymd,
    storeName: settings.storeName,
    topN: options.topN || 10,
  });

  let text = '';
  if (k === 'dead_stock') text = buildDeadStockText(snapshot);
  else if (k === 'debt') text = buildDebtText(snapshot);
  else if (k === 'profit') text = buildProfitText(snapshot);

  const texts = splitTelegramText(text);
  const replyMarkup =
    k === 'debt' ? buildDebtorReminderInlineKeyboard(db, snapshot) : null;
  return {
    ok: true,
    kind: k,
    text: texts.join('\n\n'),
    texts,
    snapshot,
    replyMarkup,
  };
}

module.exports = {
  REPORT_KINDS,
  REPORT_KIND_ALIASES,
  REPORT_MENU,
  REPORT_CALLBACK_PREFIX,
  CREDIT_REMIND_CALLBACK_PREFIX,
  normalizeReportKind,
  isBotButtonsEnabled,
  isMarketingReportsEnabled,
  parseAdminTelegramIds,
  isAuthorizedReportAdmin,
  matchReportKindFromText,
  matchReportKindFromCallback,
  matchCreditRemindCustomerId,
  buildReportReplyKeyboardRows,
  buildReportInlineKeyboardRows,
  buildDebtorReminderInlineKeyboard,
  listTopDebtorsForReminders,
  buildStoreReport,
  buildDeadStockText,
  buildDebtText,
  buildProfitText,
};
