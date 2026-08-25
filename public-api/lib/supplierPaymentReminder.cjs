'use strict';

const SettingsService = require('../../electron/services/settingsService.cjs');
const { sendTelegramText } = require('./telegramNotify.cjs');
const { logger } = require('./logger.cjs');

const REMINDER_SPECS = [
  { type: 'due_minus_1', dueOffsetDays: 1 },
  { type: 'due_today', dueOffsetDays: 0 },
];

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function supplierReminderSchemaReady(db) {
  return (
    hasTable(db, 'supplier_payment_reminders') &&
    hasColumn(db, 'purchase_orders', 'payment_scheme')
  );
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

function getSupplierReminderSettings(db) {
  return {
    enabled: readSetting(db, 'supplier.reminder.enabled', true) !== false,
    telegramEnabled: readSetting(db, 'supplier.reminder.telegram_enabled', true) !== false,
    storeName: String(readSetting(db, 'company_name', '') || readSetting(db, 'company.name', '') || 'Do\'kon').trim(),
  };
}

function todayLocalDate(db) {
  const row = db.prepare(`SELECT date('now', 'localtime') AS d`).get();
  return row?.d || new Date().toISOString().slice(0, 10);
}

function dbDateOffset(baseDate, offsetDays) {
  const d = new Date(`${baseDate}T12:00:00`);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatUzDate(isoDate) {
  const d = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

function formatAmount(amount, currency) {
  const n = Number(amount) || 0;
  if (String(currency || '').toUpperCase() === 'USD') {
    return `${n.toFixed(2)} USD`;
  }
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function parseAdminTelegramIds() {
  const raw = String(process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number.parseInt(String(s).trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function poSettlementTotal(po) {
  const cur = String(po.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
  return cur === 'USD' ? Number(po.total_usd || 0) : Number(po.total_amount || 0);
}

function poPaidSettlement(db, po) {
  const cur = String(po.currency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
  if (cur === 'USD') {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) AS paid FROM supplier_payments WHERE purchase_order_id = ?`
      )
      .get(po.id);
    let paid = Number(row?.paid || 0);
    if (paid <= 0) {
      const uzs = db
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE purchase_order_id = ?`)
        .get(po.id);
      const fx = Number(po.fx_rate || 0);
      if (fx > 0) paid = Number(uzs?.paid || 0) / fx;
    }
    return paid;
  }
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE purchase_order_id = ?`)
    .get(po.id);
  return Number(row?.paid || 0);
}

function poRemainingDebt(db, po) {
  const total = poSettlementTotal(po);
  const paid = poPaidSettlement(db, po);
  return Math.max(0, total - paid);
}

function buildReminderText({ po, supplierName, amount, dueDate, reminderType, storeName }) {
  const label =
    reminderType === 'due_minus_1'
      ? 'Ertaga'
      : reminderType === 'due_today'
        ? 'Bugun'
        : 'Muddat';
  return (
    `${label}: yetkazib beruvchiga to'lov\n` +
    `Do'kon: ${storeName}\n` +
    `PO: ${po.po_number}\n` +
    `Ta'minotchi: ${supplierName || '-'}\n` +
    `Qarz: ${formatAmount(amount, po.currency)}\n` +
    `Muddat: ${formatUzDate(dueDate)}`
  );
}

function findPosForReminder(db, reminderType, dueDate) {
  if (!supplierReminderSchemaReady(db)) return [];
  const rows = [];

  const partialRows = db
    .prepare(
      `
    SELECT po.id, po.po_number, po.supplier_id, po.currency, po.total_amount, po.total_usd, po.fx_rate,
           po.payment_scheme, po.payment_due_date,
           s.name AS supplier_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status != 'cancelled'
      AND COALESCE(po.payment_scheme, 'full') = 'partial'
      AND po.payment_due_date IS NOT NULL
      AND date(po.payment_due_date) = date(?)
      AND NOT EXISTS (
        SELECT 1 FROM supplier_payment_reminders spr
        WHERE spr.po_id = po.id AND spr.reminder_type = ?
      )
  `
    )
    .all(dueDate, reminderType);

  for (const po of partialRows) {
    const debt = poRemainingDebt(db, po);
    if (debt > 0.01) rows.push({ ...po, due_date: po.payment_due_date, debt_amount: debt });
  }

  if (hasTable(db, 'po_payment_schedule')) {
    const instRows = db
      .prepare(
        `
      SELECT po.id, po.po_number, po.supplier_id, po.currency, po.total_amount, po.total_usd, po.fx_rate,
             po.payment_scheme, po.payment_due_date,
             s.name AS supplier_name,
             ps.due_date, ps.amount, ps.amount_usd, ps.seq
      FROM po_payment_schedule ps
      INNER JOIN purchase_orders po ON po.id = ps.purchase_order_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status != 'cancelled'
        AND COALESCE(po.payment_scheme, 'full') = 'installment'
        AND ps.status = 'pending'
        AND date(ps.due_date) = date(?)
        AND NOT EXISTS (
          SELECT 1 FROM supplier_payment_reminders spr
          WHERE spr.po_id = po.id AND spr.reminder_type = ?
        )
    `
      )
      .all(dueDate, reminderType);

    const seen = new Set();
    for (const row of instRows) {
      if (seen.has(row.id)) continue;
      const debt = poRemainingDebt(db, row);
      if (debt <= 0.01) continue;
      seen.add(row.id);
      const amt =
        String(row.currency || 'UZS').toUpperCase() === 'USD'
          ? Number(row.amount_usd ?? row.amount ?? 0)
          : Number(row.amount ?? 0);
      rows.push({ ...row, due_date: row.due_date, debt_amount: amt > 0 ? amt : debt });
    }
  }

  return rows.slice(0, 50);
}

async function deliverSupplierReminder({ db, po, reminderType, settings, botToken }) {
  const adminIds = parseAdminTelegramIds();
  if (!settings.telegramEnabled || !botToken || !adminIds.length) {
    return { ok: false, skipped: true, reason: 'no_channel' };
  }

  const text = buildReminderText({
    po,
    supplierName: po.supplier_name,
    amount: po.debt_amount,
    dueDate: po.due_date,
    reminderType,
    storeName: settings.storeName,
  });

  let anySent = false;
  for (const tgId of adminIds) {
    // eslint-disable-next-line no-await-in-loop
    const out = await sendTelegramText({ botToken, telegramId: tgId, text });
    if (out?.ok) anySent = true;
  }

  if (anySent) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO supplier_payment_reminders (po_id, reminder_type, channel, status, sent_at)
         VALUES (?, ?, 'telegram', 'sent', ?)`
      ).run(po.id, reminderType, new Date().toISOString());
    } catch (e) {
      logger.warn({ err: e?.message || e, poId: po.id }, '[supplier-reminder] dedup write failed');
    }
  }

  return { ok: anySent, channel: anySent ? 'telegram' : null };
}

async function runSupplierPaymentReminderTick(db, options = {}) {
  if (!supplierReminderSchemaReady(db)) {
    return { processed: 0, sent: 0, skipped: true, reason: 'schema_not_ready' };
  }

  const settings = getSupplierReminderSettings(db);
  if (!settings.enabled && !options.force) {
    return { processed: 0, sent: 0, skipped: true, reason: 'disabled' };
  }

  const botToken = String(options.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const today = todayLocalDate(db);
  let processed = 0;
  let sent = 0;

  for (const spec of REMINDER_SPECS) {
    const dueDate = dbDateOffset(today, spec.dueOffsetDays);
    const pos = findPosForReminder(db, spec.type, dueDate);
    for (const po of pos) {
      processed += 1;
      // eslint-disable-next-line no-await-in-loop
      const out = await deliverSupplierReminder({
        db,
        po,
        reminderType: spec.type,
        settings,
        botToken,
      });
      if (out.ok) sent += 1;
    }
  }

  return { processed, sent, skipped: false };
}

module.exports = {
  REMINDER_SPECS,
  buildReminderText,
  findPosForReminder,
  getSupplierReminderSettings,
  poRemainingDebt,
  runSupplierPaymentReminderTick,
  supplierReminderSchemaReady,
  todayLocalDate,
};
