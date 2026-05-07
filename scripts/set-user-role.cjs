#!/usr/bin/env node
/**
 * Foydalanuvchini rolga bog'lash (users + user_roles).
 *
 * Ishlatish:
 *   node scripts/set-user-role.cjs tohir admin
 *   node scripts/set-user-role.cjs --data-dir=D:\\path\\to\\data admin@pos.com admin
 *
 * Env: POS_SERVER_MODE=1, POS_DATA_DIR (server yoki `.env` orqali) — ma'lumotlar bazasi yo'li.
 */
'use strict';

const path = require('path');

function parseArgs(argv) {
  let dataDir = null;
  const rest = [];
  for (const a of argv) {
    if (a.startsWith('--data-dir=')) {
      dataDir = a.slice('--data-dir='.length).trim();
    } else {
      rest.push(a);
    }
  }
  return { dataDir, rest };
}

async function main() {
  const { dataDir, rest } = parseArgs(process.argv.slice(2));
  const username = rest[0];
  const role = (rest[1] || 'admin').trim().toLowerCase();

  if (!username) {
    console.error('Usage: node scripts/set-user-role.cjs <username_or_login> [role_code]');
    console.error('Example: node scripts/set-user-role.cjs tohir admin');
    process.exit(1);
  }

  process.env.POS_SERVER_MODE = '1';
  require(path.join(__dirname, '../electron/config/loadRootEnv.cjs')).loadRootEnv();
  if (dataDir) {
    process.env.POS_DATA_DIR = path.resolve(dataDir);
  }

  const { open } = require('../electron/db/open.cjs');
  const UsersService = require('../electron/services/usersService.cjs');

  const db = open();
  const users = new UsersService(db);

  const needle = String(username).trim();
  const row = db
    .prepare(
      `
    SELECT id, username, full_name
    FROM users
    WHERE lower(trim(username)) = lower(trim(?))
       OR lower(trim(COALESCE(full_name, ''))) = lower(trim(?))
    LIMIT 2
  `,
    )
    .all(needle, needle);

  if (row.length === 0) {
    console.error(`User topilmadi: "${needle}" (username yoki to'liq ism bo'yicha qidirdim).`);
    process.exit(1);
  }
  if (row.length > 1) {
    console.error('Bir nechta mos kelish topildi, aniqroq login kiriting:');
    row.forEach((r) => console.error(' ', r.id, r.username, r.full_name));
    process.exit(1);
  }

  const u = row[0];
  users.update(u.id, { role });

  const after = users.get(u.id);
  console.log('[set-user-role] OK', {
    id: u.id,
    username: after.username,
    full_name: after.full_name,
    role: after.role,
  });
  console.log('Agar dastur ochiq bo‘lsa, chiqib qayta kiring — token ichidagi rol yangilanadi.');
}

main().catch((e) => {
  console.error('[set-user-role] Xato:', e.message);
  process.exit(1);
});
