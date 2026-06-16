#!/bin/bash
set -e
cd /opt/pos 2>/dev/null || cd /var/www/pos 2>/dev/null || true
node <<'NODE'
const Database = require('better-sqlite3');
const paths = [
  '/var/lib/pos/pos.db',
  '/var/lib/pos/tenants/default/pos.db',
];
for (const p of paths) {
  try {
    const db = new Database(p, { readonly: true });
    const rows = db.prepare(
      'SELECT id, order_number, status, sales_channel, created_at FROM web_orders ORDER BY id DESC LIMIT 10'
    ).all();
    console.log('PATH:', p, 'COUNT:', rows.length, JSON.stringify(rows));
    db.close();
  } catch (e) {
    console.log('PATH:', p, 'ERR:', e.message);
  }
}
NODE
echo "=== pos-rpc logs ==="
journalctl -u pos-rpc -n 15 --no-pager 2>/dev/null || journalctl -u pos-server -n 15 --no-pager 2>/dev/null || true
echo "=== env ==="
grep -hE 'POS_DATA_DIR|PUBLIC_API|POS_MULTI|POS_TENANT' /opt/pos/.env /etc/pos/.env 2>/dev/null || true
