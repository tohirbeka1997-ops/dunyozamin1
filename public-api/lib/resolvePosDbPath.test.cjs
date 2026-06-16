'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolvePosDbPath } = require('../../electron/lib/resolvePosDbPath.cjs');

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

test('resolvePosDbPath honors PUBLIC_API_DB_PATH', () => {
  withEnv(
    {
      PUBLIC_API_DB_PATH: '/tmp/custom/pos.db',
      POS_DATA_DIR: '/ignored',
      POS_MULTI_TENANT: '1',
    },
    () => {
      assert.equal(resolvePosDbPath(), path.resolve('/tmp/custom/pos.db'));
    },
  );
});

test('resolvePosDbPath uses legacy pos.db in single-tenant mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-db-resolve-'));
  withEnv(
    {
      PUBLIC_API_DB_PATH: null,
      POS_DATA_DIR: dir,
      POS_MULTI_TENANT: '0',
    },
    () => {
      assert.equal(resolvePosDbPath(), path.join(dir, 'pos.db'));
    },
  );
});

test('resolvePosDbPath prefers tenant DB when multi-tenant is enabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-db-mt-'));
  const tenantDir = path.join(dir, 'tenants', 'default');
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(path.join(tenantDir, 'pos.db'), '');
  withEnv(
    {
      PUBLIC_API_DB_PATH: null,
      POS_DATA_DIR: dir,
      POS_MULTI_TENANT: '1',
    },
    () => {
      assert.equal(resolvePosDbPath(), path.join(tenantDir, 'pos.db'));
    },
  );
});

test('resolvePosDbPath auto-detects tenant DB via master.db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-db-master-'));
  const tenantDir = path.join(dir, 'tenants', 'default');
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'master.db'), '');
  fs.writeFileSync(path.join(tenantDir, 'pos.db'), '');
  withEnv(
    {
      PUBLIC_API_DB_PATH: null,
      POS_DATA_DIR: dir,
      POS_MULTI_TENANT: null,
    },
    () => {
      assert.equal(resolvePosDbPath(), path.join(tenantDir, 'pos.db'));
    },
  );
});
