'use strict';

const { randomUUID } = require('crypto');
const CustomersService = require('../../electron/services/customersService.cjs');
const { normalizePhoneUz, formatPhoneUz } = require('../../electron/lib/phoneNormalize.cjs');

function toLatinName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(nomalum|noma'lum|unknown|неизвестно|номаълум)$/i.test(raw)) return '';
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e',
    ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
  };
  return raw
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const out = map[lower];
      if (out == null) return ch;
      return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function marketplaceFullName(profile) {
  const firstName = toLatinName(profile?.first_name) || 'Onlayn';
  const lastName = toLatinName(profile?.last_name);
  return `${firstName} ${lastName}`.trim();
}

function ensureRegistrationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_customer_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_customer_id INTEGER NOT NULL UNIQUE,
      pos_customer_id TEXT NOT NULL,
      loyalty_card_code TEXT NOT NULL UNIQUE,
      qr_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_customer_bindings_pos
      ON marketplace_customer_bindings(pos_customer_id);
  `);
}

function updatePosCustomerFromMarketplaceProfile(db, posCustomerId, profile) {
  if (!posCustomerId || !profile) return;
  const fullName = marketplaceFullName(profile);
  const phone = formatPhoneUz(profile.phone);
  const phoneNormalized = normalizePhoneUz(profile.phone);
  const cols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => String(c.name));
  const sets = [
    'name = COALESCE(NULLIF(?, \'\'), name)',
    'phone = COALESCE(?, phone)',
    'updated_at = datetime(\'now\')',
  ];
  const vals = [fullName, phone];
  if (cols.includes('phone_normalized')) {
    sets.splice(2, 0, 'phone_normalized = COALESCE(?, phone_normalized)');
    vals.splice(2, 0, phoneNormalized);
  }
  vals.push(posCustomerId);
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Persist checkout phone/address on marketplace_customers before order processing.
 */
function persistMarketplaceCheckoutContact(db, marketplaceCustomerId, data = {}) {
  const mcId = Number.parseInt(String(marketplaceCustomerId), 10);
  if (!Number.isFinite(mcId) || mcId <= 0) return;

  const sets = [];
  const vals = [];
  const phone = formatPhoneUz(data.phone);
  if (phone) {
    sets.push('phone = ?');
    vals.push(phone);
  }
  const address =
    data.address != null
      ? String(data.address).trim()
      : data.delivery_address != null
        ? String(data.delivery_address).trim()
        : '';
  if (address && address !== "O'zi olib ketish") {
    sets.push('address = ?');
    vals.push(address);
  }
  if (!sets.length) return;

  vals.push(mcId);
  db.prepare(`UPDATE marketplace_customers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function ensurePosCustomerForMarketplace(db, profile) {
  const fullName = marketplaceFullName(profile);
  const phone = formatPhoneUz(profile?.phone);
  if (!phone && !fullName) return null;

  const customers = new CustomersService(db);
  if (phone) {
    const customer = customers.findOrCreateByPhone({
      name: fullName || 'Onlayn mijoz',
      phone: profile.phone,
      type: 'individual',
      status: 'active',
      allow_debt: false,
      pricing_tier: 'retail',
      bonus_points: 0,
    });
    updatePosCustomerFromMarketplaceProfile(db, customer.id, profile);
    return customer.id;
  }

  const created = customers.create({
    name: fullName || 'Onlayn mijoz',
    phone: null,
    type: 'individual',
    status: 'active',
    allow_debt: false,
    pricing_tier: 'retail',
    bonus_points: 0,
  });
  return created.id;
}

/**
 * Refresh linked POS customer name/phone from marketplace profile.
 * @returns {string|null} pos_customer_id
 */
function syncPosCustomerFromMarketplace(db, marketplaceCustomerId) {
  const mcId = Number.parseInt(String(marketplaceCustomerId), 10);
  if (!Number.isFinite(mcId) || mcId <= 0) return null;

  ensureRegistrationSchema(db);
  const mc = db
    .prepare(`SELECT id, telegram_id, first_name, last_name, phone FROM marketplace_customers WHERE id = ?`)
    .get(mcId);
  if (!mc) return null;

  const binding = db
    .prepare(`SELECT pos_customer_id FROM marketplace_customer_bindings WHERE marketplace_customer_id = ?`)
    .get(mcId);
  if (binding?.pos_customer_id) {
    updatePosCustomerFromMarketplaceProfile(db, binding.pos_customer_id, mc);
    return binding.pos_customer_id;
  }

  return linkMarketplaceCustomerToPos(db, mcId);
}

/**
 * Link Telegram marketplace buyer to POS customers table (best-effort).
 * @returns {string|null} pos_customer_id
 */
function linkMarketplaceCustomerToPos(db, marketplaceCustomerId) {
  const mcId = Number.parseInt(String(marketplaceCustomerId), 10);
  if (!Number.isFinite(mcId) || mcId <= 0) return null;

  ensureRegistrationSchema(db);

  const existing = db
    .prepare(`SELECT pos_customer_id FROM marketplace_customer_bindings WHERE marketplace_customer_id = ?`)
    .get(mcId);
  if (existing?.pos_customer_id) {
    const mc = db
      .prepare(`SELECT first_name, last_name, phone FROM marketplace_customers WHERE id = ?`)
      .get(mcId);
    if (mc) updatePosCustomerFromMarketplaceProfile(db, existing.pos_customer_id, mc);
    return existing.pos_customer_id;
  }

  const mc = db
    .prepare(`SELECT id, telegram_id, first_name, last_name, phone FROM marketplace_customers WHERE id = ?`)
    .get(mcId);
  if (!mc) return null;

  const posCustomerId = ensurePosCustomerForMarketplace(db, mc);
  if (!posCustomerId) return null;

  const loyaltyCardCode = `LC-${String(mc.telegram_id || mcId)}-${String(mcId)}`;
  const qrPayload = `LOYALTY:${loyaltyCardCode}`;
  db.prepare(
    `
    INSERT INTO marketplace_customer_bindings (
      marketplace_customer_id, pos_customer_id, loyalty_card_code, qr_payload
    ) VALUES (?, ?, ?, ?)
  `,
  ).run(mcId, posCustomerId, loyaltyCardCode, qrPayload);

  return posCustomerId;
}

function hasTable(db, name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  } catch {
    return false;
  }
}

/**
 * Record completed online order on linked POS customer card (idempotent per web order).
 * Called when web order reaches delivered — updates total_sales/stats + customer_ledger.
 */
function recordWebOrderCustomerSale(db, webOrderId) {
  if (!hasTable(db, 'customer_ledger') || !hasTable(db, 'customers')) {
    return { ok: false, skipped: true, reason: 'no_customer_tables' };
  }

  const wid = Number.parseInt(String(webOrderId), 10);
  if (!Number.isFinite(wid)) {
    return { ok: false, skipped: true, reason: 'invalid_order_id' };
  }

  const refId = `web:${wid}`;
  const existing = db
    .prepare(`SELECT id FROM customer_ledger WHERE ref_id = ? AND type = 'sale' LIMIT 1`)
    .get(refId);
  if (existing) return { ok: true, skipped: true, reason: 'already_recorded' };

  const wo = db
    .prepare(
      `SELECT id, order_number, customer_id, total_amount, payment_method, payment_status, status
       FROM web_orders WHERE id = ?`,
    )
    .get(wid);
  if (!wo || String(wo.status || '').toLowerCase() !== 'delivered') {
    return { ok: false, skipped: true, reason: 'not_delivered' };
  }

  let posCustomerId = null;
  if (wo.customer_id) {
    try {
      posCustomerId = syncPosCustomerFromMarketplace(db, wo.customer_id);
    } catch {
      posCustomerId = null;
    }
  }
  if (!posCustomerId) {
    return { ok: false, skipped: true, reason: 'no_pos_customer' };
  }

  const total = Math.round(Number(wo.total_amount || 0));
  const now = new Date().toISOString();
  const paymentMethod = wo.payment_method != null ? String(wo.payment_method) : null;
  const note = `Onlayn buyurtma: ${wo.order_number || wid} (${total.toLocaleString('uz-UZ')} so'm)`;

  const tx = db.transaction(() => {
    const cust = db
      .prepare(`SELECT balance, total_sales, total_orders FROM customers WHERE id = ?`)
      .get(posCustomerId);
    if (!cust) return;

    const balanceAfter = Number(cust.balance || 0);
    const customerCols = db.prepare(`PRAGMA table_info(customers)`).all().map((c) => c.name);
    const sets = [
      'total_sales = COALESCE(total_sales, 0) + ?',
      'total_orders = COALESCE(total_orders, 0) + 1',
      'updated_at = ?',
    ];
    const updateVals = [total, now];
    if (customerCols.includes('last_order_date')) {
      sets.splice(2, 0, 'last_order_date = ?');
      updateVals.push(now);
    }
    updateVals.push(posCustomerId);
    db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...updateVals);

    const ledgerCols = db.prepare(`PRAGMA table_info(customer_ledger)`).all().map((c) => c.name);
    const cols = ['id', 'customer_id', 'type', 'ref_id', 'ref_no', 'amount', 'balance_after', 'note'];
    const vals = [
      randomUUID(),
      posCustomerId,
      'sale',
      refId,
      wo.order_number || `WEB-${wid}`,
      0,
      balanceAfter,
      note,
    ];
    if (ledgerCols.includes('currency')) {
      cols.push('currency');
      vals.push('UZS');
    }
    if (ledgerCols.includes('method') && paymentMethod) {
      cols.push('method');
      vals.push(paymentMethod);
    }
    cols.push('created_at');
    vals.push(now);
    db.prepare(
      `INSERT INTO customer_ledger (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...vals);
  });
  tx();
  return { ok: true, skipped: false, pos_customer_id: posCustomerId };
}

module.exports = {
  linkMarketplaceCustomerToPos,
  ensurePosCustomerForMarketplace,
  persistMarketplaceCheckoutContact,
  syncPosCustomerFromMarketplace,
  recordWebOrderCustomerSale,
  marketplaceFullName,
  normalizePhoneUz,
  formatPhoneUz,
};
