'use strict';
const Database = require('better-sqlite3');
const p = '/var/lib/pos/pos.db';
try {
  const db = new Database(p, { readonly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM web_orders').get().n;
  const rows = db.prepare('SELECT id, order_number, status FROM web_orders ORDER BY id DESC LIMIT 5').all();
  console.log('docker path', p, 'web_orders=', n, JSON.stringify(rows));
  db.close();
} catch (e) {
  console.log('docker ERR', e.message);
}
