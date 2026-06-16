#!/usr/bin/env node
'use strict';

/**
 * Build sales-mobile web export for VPS / Telegram WebApp deploy.
 *
 * Usage (repo root):
 *   node scripts/build-staff-web.cjs
 *
 * Output: sales-mobile/dist/
 * Deploy: rsync to server STAFF_WEB_DIR (default: sales-mobile/dist next to public-api)
 *         or set STAFF_WEB_DIR in server .env
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const salesMobile = path.join(root, 'sales-mobile');
const distDir = path.join(salesMobile, 'dist');
const indexHtml = path.join(distDir, 'index.html');

function run(cmd, args, cwd, useEnv) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: useEnv ?? process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Production VPS/Telegram WebApp uses same-origin API (staff.dunyozamin.com/v1/…).
// Never bake dev tunnel URLs (cloudflared/ngrok) or localhost into the bundle.
const exportEnv = { ...process.env };
delete exportEnv.EXPO_PUBLIC_STAFF_API_URL;

console.log('[build-staff-web] export-web in sales-mobile/ …');
run('npm', ['run', 'export-web'], salesMobile, exportEnv);

if (!fs.existsSync(indexHtml)) {
  console.error(`[build-staff-web] ERROR: ${indexHtml} not found after export`);
  process.exit(1);
}

console.log('');
console.log('[build-staff-web] OK:', distDir);
console.log('');
console.log('Next steps:');
console.log('  1. Copy dist/ to server, e.g. /opt/pos/sales-mobile/dist');
console.log('  2. Set STAFF_WEB_APP_URL=https://your-staff-domain/ in server .env');
console.log('  3. Set STAFF_BOT_TOKEN, STAFF_JWT_SECRET, PUBLIC_API_DB_PATH');
console.log('  4. Restart public-api: sudo systemctl restart public-api');
console.log('  5. See deploy/STAFF-MOBILE-DEPLOY.md for nginx + Telegram setup');
