'use strict';
const Database = require('better-sqlite3');
const AuthService = require('../electron/services/authService.cjs');

const dbPath = process.argv[2] || '/var/lib/pos/pos.db';
const user = process.argv[3] || 'sotuvchi';
const pass = process.argv[4] || 'Sotuvchi#2026';

const db = new Database(dbPath, { readonly: true });
const row = db.prepare('SELECT username, email FROM users WHERE LOWER(username)=? OR LOWER(email)=?').get(user, user);
console.log('user row:', row);
const auth = new AuthService(db);
const result = auth.login(user, pass);
console.log('login:', result.success, result.error || result.user?.username);
db.close();
