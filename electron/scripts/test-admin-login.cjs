'use strict';
const { app } = require('electron');
app.setName('miaoda-react-admin');
const Database = require('better-sqlite3');
const { getDbPath, clearCache } = require('../db/dbPath.cjs');
const AuthService = require('../services/authService.cjs');
function run() {
  clearCache();
  const db = new Database(getDbPath(app));
  const auth = new AuthService(db);
  for (const u of ['admin', 'Administrator', 'admin@pos.co']) {
    const r = auth.login(u, '12345');
    console.log(u, r.success ? 'OK' : r.error);
  }
  db.close();
  setTimeout(() => app.quit(), 100);
}
if (app.isReady()) run(); else app.once('ready', run);
