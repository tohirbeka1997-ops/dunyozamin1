'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  verifyInternalSecret,
  getActiveCourier,
  MIN_BOT_INTERNAL_SECRET_LEN,
} = require('./routes/bot.cjs');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runSecret({ secret, header }) {
  const prev = process.env.TELEGRAM_BOT_INTERNAL_SECRET;
  if (secret === undefined) delete process.env.TELEGRAM_BOT_INTERNAL_SECRET;
  else process.env.TELEGRAM_BOT_INTERNAL_SECRET = secret;
  try {
    const req = { headers: {} };
    if (header !== undefined) req.headers['x-telegram-bot-secret'] = header;
    const res = mockRes();
    let nextCalled = false;
    verifyInternalSecret(req, res, () => {
      nextCalled = true;
    });
    return { res, nextCalled };
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_INTERNAL_SECRET;
    else process.env.TELEGRAM_BOT_INTERNAL_SECRET = prev;
  }
}

const GOOD_SECRET = 'x'.repeat(MIN_BOT_INTERNAL_SECRET_LEN);

test('verifyInternalSecret accepts the correct secret', () => {
  const { res, nextCalled } = runSecret({ secret: GOOD_SECRET, header: GOOD_SECRET });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('verifyInternalSecret rejects a wrong secret', () => {
  const { res, nextCalled } = runSecret({ secret: GOOD_SECRET, header: 'y'.repeat(MIN_BOT_INTERNAL_SECRET_LEN) });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('verifyInternalSecret rejects an empty/missing header', () => {
  const { res, nextCalled } = runSecret({ secret: GOOD_SECRET, header: '' });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('verifyInternalSecret treats an unset secret as misconfigured (503)', () => {
  const { res, nextCalled } = runSecret({ secret: undefined, header: GOOD_SECRET });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
});

test('verifyInternalSecret rejects a too-short configured secret (503)', () => {
  const short = 'abc';
  const { res, nextCalled } = runSecret({ secret: short, header: short });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'bot_internal_secret_missing');
});

// --- courier auto-bind --------------------------------------------------

function courierDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE marketplace_couriers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT COLLATE NOCASE UNIQUE,
      display_name TEXT,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('getActiveCourier no longer auto-binds telegram_id to a username-only row', () => {
  const db = courierDb();
  db.prepare(
    `INSERT INTO marketplace_couriers (telegram_id, username, display_name, active) VALUES (NULL, 'alice', 'Alice', 1)`,
  ).run();

  // A caller presenting an arbitrary telegram_id + the known username can be
  // authorized (matched by username) but MUST NOT have their id stamped onto
  // the courier row (account takeover).
  const courier = getActiveCourier(db, 999999, 'alice');
  assert.ok(courier, 'still authorized via username match');
  assert.equal(courier.username, 'alice');

  const row = db.prepare(`SELECT telegram_id FROM marketplace_couriers WHERE username = 'alice'`).get();
  assert.equal(row.telegram_id, null);
});

test('getActiveCourier still matches an admin-bound courier by telegram_id', () => {
  const db = courierDb();
  db.prepare(
    `INSERT INTO marketplace_couriers (telegram_id, username, display_name, active) VALUES (555, 'bob', 'Bob', 1)`,
  ).run();
  const courier = getActiveCourier(db, 555, '');
  assert.ok(courier);
  assert.equal(courier.telegram_id, 555);
});
