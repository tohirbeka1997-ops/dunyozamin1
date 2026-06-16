'use strict';

// Run with: node electron/lib/ipcAuth.test.cjs
// Uses a plain mock db (no better-sqlite3) so it runs under stock Node.

const assert = require('node:assert');
const { setCurrentUserId } = require('./currentUser.cjs');
const { getCurrentUserRole, requireAdmin, requireRole } = require('./ipcAuth.cjs');

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

function makeDb({ joinRole = null, legacyRole = null, throwJoin = false, throwLegacy = false } = {}) {
  return {
    prepare(sql) {
      const isJoin = /user_roles/.test(sql);
      return {
        get() {
          if (isJoin) {
            if (throwJoin) throw new Error('no such table: user_roles');
            return joinRole ? { code: joinRole } : undefined;
          }
          if (throwLegacy) throw new Error('no such column: role');
          return legacyRole ? { role: legacyRole } : undefined;
        },
      };
    },
  };
}

// 1) Canonical RBAC via user_roles is the primary source.
setCurrentUserId('u1');
check(getCurrentUserRole(makeDb({ joinRole: 'Admin', legacyRole: 'cashier' })) === 'admin',
  'role resolved from user_roles join (lowercased), ignoring stale users.role');

// 2) Falls back to legacy users.role when join yields nothing.
check(getCurrentUserRole(makeDb({ joinRole: null, legacyRole: 'Manager' })) === 'manager',
  'falls back to legacy users.role when no user_roles row');

// 3) Falls back when the user_roles join throws (schema without those tables).
check(getCurrentUserRole(makeDb({ throwJoin: true, legacyRole: 'cashier' })) === 'cashier',
  'falls back to legacy users.role when join query throws');

// 4) Null when neither source has a role.
check(getCurrentUserRole(makeDb({})) === null, 'returns null when no role anywhere');

// 5) Null when no current user is set.
setCurrentUserId(null);
check(getCurrentUserRole(makeDb({ joinRole: 'admin' })) === null, 'returns null when no current user id');

// 6) requireAdmin / requireRole enforce correctly.
setCurrentUserId('u1');
let threw = false;
try {
  requireAdmin(makeDb({ joinRole: 'cashier' }));
} catch {
  threw = true;
}
check(threw, 'requireAdmin throws for non-admin role');

check(requireAdmin(makeDb({ joinRole: 'admin' })) === 'admin', 'requireAdmin passes for admin');
check(requireRole(makeDb({ joinRole: 'manager' }), ['admin', 'manager']) === 'manager',
  'requireRole allows listed role');

setCurrentUserId(null);
console.log(`\nipcAuth role resolution: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
