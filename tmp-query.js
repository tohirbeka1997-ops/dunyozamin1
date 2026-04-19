const Database = require("better-sqlite3");
const db = new Database("test_pos.db");
const po = "PO-1768892064276";
const rows = db.prepare("SELECT id, payment_number, purchase_order_id, amount, amount_usd, currency, payment_method, paid_at, created_at, note FROM supplier_payments WHERE purchase_order_id = ? OR purchase_order_id = (SELECT id FROM purchase_orders WHERE po_number = ?) ORDER BY datetime(created_at) DESC").all(po, po);
console.log(JSON.stringify(rows,null,2));
