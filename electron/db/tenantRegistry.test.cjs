/* eslint-disable no-console */
// =============================================================================
// tenantRegistry.test.cjs — unit tests for the multi-tenant registry
// =============================================================================
// Style: single-process, zero framework, same convention as the other
// electron/net/*.test.cjs files (so `npm run test:tenantRegistry` just works).
// =============================================================================
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { createTenantRegistry } = require('./tenantRegistry.cjs');

// Minimal "migrate" stub mirroring the users table the real migrations emit.
function fakeMigrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'cashier',
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      full_name     TEXT,
      email         TEXT
    );
  `);
  return { applied: 1, skipped: 0 };
}

function mkTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pos-tr-'));
}

const results = [];
function run(name, fn) {
  const dir = mkTempDir();
  let reg = null;
  try {
    reg = createTenantRegistry({ dataDir: dir, migrate: fakeMigrate });
    fn(reg, dir);
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  ✗ ${name}\n     ${e.message}`);
  } finally {
    try { if (reg) reg.close(); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

run('initializes master DB with schema', (reg, dir) => {
  assert.ok(fs.existsSync(path.join(dir, 'master.db')));
  const tables = reg.master.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  ).all().map((r) => r.name);
  assert.ok(tables.includes('tenants'));
  assert.ok(tables.includes('master_users'));
  assert.ok(tables.includes('master_sessions'));
});

run('createTenant creates DB file and records row', (reg) => {
  const t = reg.createTenant({ slug: 'store1', display_name: 'Store One' });
  assert.strictEqual(t.slug, 'store1');
  assert.strictEqual(t.is_active, 1);
  assert.ok(fs.existsSync(t.db_path));
  const db = reg.openTenantDb(t.id);
  assert.strictEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get()?.name,
    'users',
  );
});

run('invalid slug is rejected before any filesystem work', (reg, dir) => {
  for (const bad of ['A', 'master', '', '_leading', 'too-long-slug-that-exceeds-forty-chars-limit-here']) {
    assert.throws(() => reg.createTenant({ slug: bad, display_name: 'X' }), /invalid|reserved/);
  }
  const tenantsDir = path.join(dir, 'tenants');
  const leftovers = fs.existsSync(tenantsDir) ? fs.readdirSync(tenantsDir) : [];
  assert.strictEqual(leftovers.length, 0, 'no tenant dirs must be created for invalid slugs');
});

run('createTenant refuses duplicate slug', (reg) => {
  reg.createTenant({ slug: 'dup', display_name: 'First' });
  assert.throws(
    () => reg.createTenant({ slug: 'dup', display_name: 'Second' }),
    /already exists/,
  );
});

run('disableTenant drops cache and blocks openTenantDb', (reg) => {
  const t = reg.createTenant({ slug: 't1', display_name: 'T1' });
  reg.openTenantDb(t.id); // prime cache
  reg.disableTenant(t.id);
  assert.throws(() => reg.openTenantDb(t.id), /disabled/);
  reg.enableTenant(t.id);
  assert.ok(reg.openTenantDb(t.id));
});

run('adoptExistingDb imports a pre-existing DB as a tenant', (reg, dir) => {
  const legacyPath = path.join(dir, 'pos.db');
  const legacy = new Database(legacyPath);
  fakeMigrate(legacy);
  legacy.prepare('INSERT INTO users(id, username, password_hash) VALUES (?, ?, ?)')
    .run('u1', 'legacyAdmin', 'legacyHash');
  legacy.close();

  const t = reg.adoptExistingDb({
    slug: 'default', display_name: 'Default',
    sourceDbPath: legacyPath, move: false,
  });
  assert.strictEqual(t.slug, 'default');
  assert.ok(fs.existsSync(t.db_path));
  const db = reg.openTenantDb(t.id);
  assert.strictEqual(
    db.prepare('SELECT username FROM users WHERE id=?').get('u1').username,
    'legacyAdmin',
  );
  // Idempotent.
  const again = reg.adoptExistingDb({
    slug: 'default', display_name: 'Default', sourceDbPath: legacyPath,
  });
  assert.strictEqual(again.id, t.id);
});

run('createTenant rolls back DB + registry if migrate() throws', (reg, dir) => {
  // Override the registry with a failing migrate to simulate a bad migration.
  reg.close();
  const failReg = createTenantRegistry({
    dataDir: dir, migrate: () => { throw new Error('migrate boom'); },
  });
  try {
    assert.throws(() => failReg.createTenant({ slug: 'broken', display_name: 'B' }), /boom/);
    assert.strictEqual(failReg.getTenantBySlug('broken'), null);
    assert.strictEqual(
      fs.existsSync(path.join(dir, 'tenants', 'broken', 'pos.db')),
      false,
    );
  } finally { failReg.close(); }
});

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
console.log('\nOK — tenantRegistry unit tests passed');
