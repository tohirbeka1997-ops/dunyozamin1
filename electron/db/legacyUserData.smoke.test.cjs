'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  shouldAdoptLegacy,
  maybeAdoptLegacyDatabase,
  countProducts,
} = require('./legacyUserData.cjs');
const { clearCache } = require('./dbPath.cjs');

function makeApp(appData, userData) {
  return {
    getPath(name) {
      if (name === 'appData') return appData;
      if (name === 'userData') return userData;
      throw new Error(`unsupported getPath(${name})`);
    },
  };
}

function makeDbWithProducts(filePath, productCount) {
  const db = new Database(filePath);
  db.exec('CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT)');
  const insert = db.prepare('INSERT INTO products (id, name) VALUES (?, ?)');
  for (let i = 0; i < productCount; i += 1) {
    insert.run(`p${i}`, `Product ${i}`);
  }
  db.close();
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-userdata-'));
  const appData = path.join(root, 'Roaming');
  const legacyUserData = path.join(appData, 'miaoda-react-admin');
  const currentUserData = path.join(appData, 'pos-tizimi');
  fs.mkdirSync(legacyUserData, { recursive: true });
  fs.mkdirSync(currentUserData, { recursive: true });

  const legacyDb = path.join(legacyUserData, 'pos.db');
  const targetDb = path.join(currentUserData, 'pos.db');

  makeDbWithProducts(legacyDb, 5);
  makeDbWithProducts(targetDb, 0);

  assert.strictEqual(countProducts(legacyDb), 5);
  assert.strictEqual(countProducts(targetDb), 0);
  assert.strictEqual(shouldAdoptLegacy(targetDb, legacyDb), true);

  const app = makeApp(appData, currentUserData);
  const result = maybeAdoptLegacyDatabase(app, targetDb);
  assert.strictEqual(result.adopted, true);
  assert.strictEqual(countProducts(targetDb), 5);

  const again = maybeAdoptLegacyDatabase(app, targetDb);
  assert.strictEqual(again.adopted, false);

  clearCache();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('legacyUserData.smoke.test.cjs: OK');
}

run();
