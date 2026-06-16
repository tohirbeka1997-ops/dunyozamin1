'use strict';

// Run with: node electron/services/authService.resetCode.test.cjs
// Verifies password-reset code is returned by default (IPC + web RPC on-screen flow)
// and can be withheld when includeCode:false is passed explicitly.
// Uses a plain mock db so it runs under stock Node (no better-sqlite3).

const assert = require('node:assert');
const AuthService = require('./authService.cjs');

let pass = 0;
let fail = 0;
function check(cond, label) {
  if (cond) {
    pass += 1;
    console.log(`  ok - ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL - ${label}`);
  }
}

function makeDb() {
  const inserts = [];
  return {
    _inserts: inserts,
    prepare(sql) {
      return {
        get() {
          // user lookup in requestPasswordReset
          if (/FROM users/.test(sql)) {
            return { id: 'u1', username: 'admin@pos.com', phone: null, is_active: 1 };
          }
          return undefined;
        },
        run(...args) {
          if (/INSERT INTO password_reset_tokens/.test(sql)) {
            inserts.push(args);
          }
          return { changes: 1 };
        },
      };
    },
  };
}

const svc = new AuthService(makeDb());

// Default (IPC + web RPC): code IS returned for on-screen display.
const local = svc.requestPasswordReset('admin@pos.com');
check(local.ok === true, 'default request succeeds');
check(typeof local.data.code === 'string' && local.data.code.length === 6, 'default response includes 6-digit code');
check(local.data.code_delivered === true, 'default response marks code_delivered=true');
check(!!local.data.token_id, 'default response includes token_id');

// Explicit opt-out: code can be withheld when caller passes includeCode:false.
const remoteDb = makeDb();
const remoteSvc = new AuthService(remoteDb);
const remote = remoteSvc.requestPasswordReset('admin@pos.com', { includeCode: false });
check(remote.ok === true, 'opt-out request still creates a token');
check(remote.data.code === undefined, 'opt-out response does NOT include the code');
check(remote.data.code_delivered === false, 'opt-out response marks code_delivered=false');
check(!!remote.data.token_id, 'opt-out response still returns token_id');
check(remoteDb._inserts.length === 1, 'opt-out request still persists a reset token row');

console.log(`\nauthService reset-code exposure: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
