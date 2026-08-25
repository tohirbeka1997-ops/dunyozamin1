'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessDbPathSync } = require('./lib/dbPathSync.cjs');

function withEnv(overrides, fn) {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] == null) delete process.env[key];
    else process.env[key] = String(overrides[key]);
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('assessDbPathSync flags multi-tenant legacy path mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sync-mt-'));
  const tenantDir = path.join(dir, 'tenants', 'default');
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'master.db'), '');
  fs.writeFileSync(path.join(dir, 'pos.db'), '');
  fs.writeFileSync(path.join(tenantDir, 'pos.db'), '');

  withEnv(
    {
      POS_DATA_DIR: dir,
      PUBLIC_API_DB_PATH: path.join(dir, 'pos.db'),
      POS_MULTI_TENANT: null,
      POS_TENANT_SLUG: 'default',
    },
    () => {
      const sync = assessDbPathSync();
      assert.equal(sync.db_in_sync, false);
      assert.ok(
        sync.issues.some(
          (i) => i.includes('legacy pos.db') || i.includes('PUBLIC_API_DB_PATH override'),
        ),
      );
      assert.equal(sync.expected_pos_db_path, path.join(tenantDir, 'pos.db'));
    },
  );
});

test('assessDbPathSync ok when tenant DB is resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sync-ok-'));
  const tenantDir = path.join(dir, 'tenants', 'default');
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'master.db'), '');
  fs.writeFileSync(path.join(tenantDir, 'pos.db'), '');

  withEnv(
    {
      POS_DATA_DIR: dir,
      PUBLIC_API_DB_PATH: null,
      POS_MULTI_TENANT: '1',
      POS_TENANT_SLUG: 'default',
    },
    () => {
      const sync = assessDbPathSync();
      assert.equal(sync.db_in_sync, true);
      assert.equal(sync.db_path, path.join(tenantDir, 'pos.db'));
    },
  );
});

test('assessDbPathSync flags PUBLIC_API_DB_PATH override mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sync-override-'));
  fs.writeFileSync(path.join(dir, 'pos.db'), '');

  withEnv(
    {
      POS_DATA_DIR: dir,
      PUBLIC_API_DB_PATH: path.join(dir, 'other.db'),
      POS_MULTI_TENANT: '0',
    },
    () => {
      const sync = assessDbPathSync();
      assert.equal(sync.db_in_sync, false);
      assert.ok(sync.issues.some((i) => i.includes('PUBLIC_API_DB_PATH override')));
    },
  );
});
