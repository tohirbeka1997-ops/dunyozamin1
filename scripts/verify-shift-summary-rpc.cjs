#!/usr/bin/env node
/**
 * Haqiqiy SQLite + services bilan RPC args normalizatsiyasini tekshiradi:
 *   - pos:shifts:getSummary — args massiv emas, to'g'ridan-to'g'ri { shiftId } (HTTP xato shakli)
 *   - pos:shifts:list — LIMIT/OFFSET bilan .all(...params)
 *
 * Ishlatish: POS_SERVER_MODE=1 POS_DATA_DIR=... node scripts/verify-shift-summary-rpc.cjs
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.POS_SERVER_MODE = '1';
require('../electron/config/loadRootEnv.cjs').loadRootEnv();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-shift-verify-'));
// .env dagi POS_DATA_DIR ustidan — tekshiruv uchun faqat vaqtinchalik katalog
process.env.POS_DATA_DIR = tmp;

const { open } = require('../electron/db/open.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { createSessionStore } = require('../electron/net/sessions.cjs');
const { createRpcDispatcher } = require('../electron/net/rpcDispatch.cjs');

async function main() {
  const db = open();
  const services = createServices(db);
  const sessions = createSessionStore({ db });
  const dispatch = createRpcDispatcher({ services, db, sessions });

  const uid = randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
  ).run(uid, `u_${uid.slice(0, 8)}`, 'x');

  const opened = services.shifts.openShift({
    cashier_id: uid,
    user_id: uid,
    opening_cash: 100,
  });
  const shiftId = opened?.id;
  if (!shiftId) throw new Error('openShift did not return id');

  const meta = { adminBypass: true, authContext: null, ip: '127.0.0.1' };

  // Old bug: args object without [] — must not throw "Too few parameter values"
  const sum = await dispatch('pos:shifts:getSummary', { shiftId }, meta);
  if (!sum || typeof sum.expectedCash !== 'number') {
    throw new Error('getSummary missing expectedCash: ' + JSON.stringify(sum));
  }

  const sumTypo = await dispatch('pos:shift:getSummary', { shiftId }, meta);
  if (sumTypo.expectedCash !== sum.expectedCash) {
    throw new Error('pos:shift:getSummary mismatch');
  }

  const listed = await dispatch('pos:shifts:list', { limit: 10, status: 'open' }, meta);
  if (!Array.isArray(listed)) throw new Error('list did not return array');

  console.log('[verify-shift-summary-rpc] OK', {
    tmp,
    shiftId,
    expectedCash: sum.expectedCash,
    shiftsListed: listed.length,
  });
}

main().catch((e) => {
  console.error('[verify-shift-summary-rpc] FAIL', e.message);
  process.exit(1);
});
