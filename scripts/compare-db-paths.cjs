#!/usr/bin/env node
'use strict';
const Database = require('better-sqlite3');
const paths = [
  '/var/lib/pos/pos.db',
  '/var/lib/docker/volumes/pos-data/_data/pos.db',
];
for (const p of paths) {
  try {
    const db = new Database(p, { readonly: true });
    const n = db.prepare('SELECT COUNT(*) AS n FROM web_orders').get().n;
    const rows = db.prepare('SELECT id, order_number, status FROM web_orders ORDER BY id DESC LIMIT 3').all();
    console.log(p, 'web_orders=', n, JSON.stringify(rows));
    db.close();
  } catch (e) {
    console.log(p, 'ERR', e.message);
  }
}
