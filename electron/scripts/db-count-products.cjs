'use strict';

const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const pkg = require('../../package.json');
app.setName(pkg.name || 'pos-tizimi');

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'pos.db');
  if (!fs.existsSync(dbPath)) {
    console.log('MISSING', dbPath);
    app.exit(1);
    return;
  }
  const db = new Database(dbPath, { readonly: true });
  const products = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const categories = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  db.close();
  console.log('userData=' + userData);
  console.log('db=' + dbPath);
  console.log('products=' + products + ' categories=' + categories);
  console.log('size=' + fs.statSync(dbPath).size);
  app.exit(0);
});
