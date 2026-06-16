'use strict';

/**
 * Mutable runtime bag for HOST / pos-server mode.
 *
 * After a live DB file replace (pos:database:uploadFinalize), better-sqlite3
 * closes the old handle and opens a new one. Service instances keep a stale
 * `db` reference unless we rebind them here.
 */
let _services = null;
let _db = null;

function init(services, db) {
  if (!services || !db) {
    throw new Error('serviceRuntime.init requires services and db');
  }
  _services = services;
  _db = db;
}

function getServices() {
  return _services;
}

function getDb() {
  return _db;
}

function isInitialized() {
  return !!(_services && _db);
}

/**
 * Re-open pos.db (if needed) and rebuild the services layer in-place.
 * Preserves optional attachments such as backup runner on `services.backup`.
 */
function rebindAfterDbReplace() {
  const dbModule = require('../db/open.cjs');
  const freshDb = dbModule.getDb();
  const { createServices } = require('../services/index.cjs');
  const backup = _services?.backup;
  const next = createServices(freshDb);
  if (backup) next.backup = backup;
  _services = next;
  _db = freshDb;
  return { services: _services, db: _db };
}

function resetForTests() {
  _services = null;
  _db = null;
}

module.exports = {
  init,
  getServices,
  getDb,
  isInitialized,
  rebindAfterDbReplace,
  resetForTests,
};
