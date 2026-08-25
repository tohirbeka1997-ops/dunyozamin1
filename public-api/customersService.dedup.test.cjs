'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const CustomersService = require('../electron/services/customersService.cjs');
const { normalizePhoneUz } = require('../electron/lib/phoneNormalize.cjs');
const { ERROR_CODES } = require('../electron/lib/errors.cjs');

const CANONICAL = '998912828308';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      phone_normalized TEXT,
      email TEXT,
      address TEXT,
      type TEXT DEFAULT 'individual',
      company_name TEXT,
      tax_number TEXT,
      pricing_tier TEXT DEFAULT 'retail',
      credit_limit REAL DEFAULT 0,
      allow_debt INTEGER DEFAULT 0,
      allow_credit INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      notes TEXT,
      bonus_points REAL DEFAULT 0,
      total_sales REAL DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_customers_phone_normalized_unique
      ON customers(phone_normalized)
      WHERE phone_normalized IS NOT NULL AND phone_normalized != '';
  `);
  return db;
}

test('normalizePhoneUz canonicalizes +998 / 998 / 9-digit local formats', () => {
  assert.equal(normalizePhoneUz('+998912828308'), CANONICAL);
  assert.equal(normalizePhoneUz('998912828308'), CANONICAL);
  assert.equal(normalizePhoneUz('912828308'), CANONICAL);
});

test('normalizePhoneUz accepts all UZ operator prefixes (88/77/33/55/20)', () => {
  const cases = [
    ['+998881234567', '998881234567'],
    ['998771234567', '998771234567'],
    ['331234567', '998331234567'],
    ['551234567', '998551234567'],
    ['201234567', '998201234567'],
    ['8 88 123 45 67', '998881234567'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizePhoneUz(input), expected, `failed for ${input}`);
  }
});

test('create deduplicates 88-prefix numbers across formats', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const first = svc.create({ name: 'Beeline', phone: '+998881112233' });

  for (const phone of ['998881112233', '881112233', '8 88 111 22 33']) {
    assert.throws(
      () => svc.create({ name: 'Duplicate', phone }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.DUPLICATE_PHONE);
        assert.equal(err.details?.existing_id, first.id);
        return true;
      },
    );
  }
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM customers`).get().c, 1);
});

test('create throws DUPLICATE_PHONE for manual duplicate', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  svc.create({ name: 'Ali', phone: '+998901112233' });

  assert.throws(
    () => svc.create({ name: 'Vali', phone: '998901112233' }),
    (err) => err.code === ERROR_CODES.DUPLICATE_PHONE,
  );
});

test('create rejects all three UZ phone formats as duplicates', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const first = svc.create({ name: 'tohir', phone: '+998912828308' });

  for (const phone of ['998912828308', '912828308']) {
    assert.throws(
      () => svc.create({ name: 'tohirbek', phone }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.DUPLICATE_PHONE);
        assert.equal(err.details?.existing_id, first.id);
        return true;
      },
    );
  }

  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM customers`).get().c, 1);
});

test('create rejects duplicate when legacy row has NULL phone_normalized', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const legacyId = 'legacy-001';
  db.prepare(
    `INSERT INTO customers (id, code, name, phone, phone_normalized, created_at, updated_at)
     VALUES (?, 'CUST-0001', 'tohir', '998912828308', NULL, '2026-01-01', '2026-01-01')`,
  ).run(legacyId);

  assert.throws(
    () => svc.create({ name: 'tohirbek', phone: '912828308' }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.DUPLICATE_PHONE);
      assert.equal(err.details?.existing_id, legacyId);
      return true;
    },
  );

  const backfilled = db
    .prepare(`SELECT phone_normalized FROM customers WHERE id = ?`)
    .get(legacyId);
  assert.equal(backfilled.phone_normalized, CANONICAL);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM customers`).get().c, 1);
});

test('findOrCreateByPhone returns existing customer for alternate format', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const first = svc.create({ name: 'Ali', phone: '+998901112233' });
  const second = svc.findOrCreateByPhone({ name: 'Ali Updated', phone: '901112233' });

  assert.equal(second.id, first.id);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM customers`).get().c, 1);
});

test('findByPhone resolves alternate formats to same customer', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const created = svc.create({ name: 'tohir', phone: '+998912828308' });

  assert.equal(svc.findByPhone('998912828308')?.id, created.id);
  assert.equal(svc.findByPhone('912828308')?.id, created.id);
});

test('create sets phone_normalized on INSERT', () => {
  const db = createTestDb();
  const svc = new CustomersService(db);
  const created = svc.create({ name: 'Ali', phone: '912828308' });

  const row = db
    .prepare(`SELECT phone_normalized FROM customers WHERE id = ?`)
    .get(created.id);
  assert.equal(row.phone_normalized, CANONICAL);
});
