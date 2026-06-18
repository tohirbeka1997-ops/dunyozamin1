'use strict';

/**
 * Unit tests for serviceRuntime rebind (no native SQLite required).
 * Run: node electron/lib/serviceRuntime.test.cjs
 */
const assert = require('assert');

function makeMockDb(label = 'db') {
  let open = true;
  return {
    label,
    close() {
      open = false;
    },
    prepare(sql) {
      if (!open) {
        throw new Error('The database connection is not open');
      }
      return {
        get: () => ({ ok: 1 }),
        all: () => [],
        run: () => ({ changes: 0 }),
      };
    },
    exec() {
      if (!open) {
        throw new Error('The database connection is not open');
      }
    },
  };
}

function run() {
  const serviceRuntime = require('./serviceRuntime.cjs');
  serviceRuntime.resetForTests();

  const dbA = makeMockDb('A');
  const dbB = makeMockDb('B');

  let hookCalls = 0;
  let hookServices = null;
  let hookDb = null;
  serviceRuntime.setAfterRebindHook((svc, db) => {
    hookCalls += 1;
    hookServices = svc;
    hookDb = db;
  });

  const servicesA = {
    couriers: {
      _db: dbA,
      list() {
        return this._db.prepare('SELECT 1').all();
      },
    },
  };

  serviceRuntime.init(servicesA, dbA);
  assert.doesNotThrow(() => servicesA.couriers.list());

  dbA.close();
  assert.throws(() => servicesA.couriers.list(), /database connection is not open/i);

  const openPath = require.resolve('../db/open.cjs');
  const indexPath = require.resolve('../services/index.cjs');
  const originalOpen = require(openPath);
  const originalIndex = require(indexPath);

  require.cache[openPath] = {
    id: openPath,
    filename: openPath,
    loaded: true,
    exports: {
      open: () => dbB,
      getDb: () => dbB,
      close: () => {
        dbB.close();
      },
      isOpen: () => true,
    },
  };

  const servicesB = {
    couriers: {
      _db: dbB,
      list() {
        return this._db.prepare('SELECT 1').all();
      },
    },
  };

  require.cache[indexPath] = {
    id: indexPath,
    filename: indexPath,
    loaded: true,
    exports: {
      createServices: () => servicesB,
    },
  };

  const result = serviceRuntime.rebindAfterDbReplace();
  assert.strictEqual(result.services, servicesB);
  assert.strictEqual(result.db, dbB);
  assert.strictEqual(serviceRuntime.getServices(), servicesB);
  assert.strictEqual(hookCalls, 1);
  assert.strictEqual(hookServices, servicesB);
  assert.strictEqual(hookDb, dbB);
  assert.doesNotThrow(() => serviceRuntime.getServices().couriers.list());

  delete require.cache[openPath];
  delete require.cache[indexPath];
  serviceRuntime.resetForTests();
  console.log('serviceRuntime.test.cjs: all assertions passed');
}

run();
