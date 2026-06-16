/**
 * Full production deploy orchestrator (Windows-friendly).
 *
 * Ketma-ketlik:
 *   1) deploy:preflight (SKIP_DEPLOY_CHECKS=1 bo'lsa o'tkaziladi)
 *   2) deploy:server  — kod + npm + systemd restart
 *   3) deploy:mini-app — mijoz Telegram Mini App
 *   4) deploy:staff   — sotuvchi POS WebApp
 *   5) deploy:web     — admin SPA (ixtiyoriy, DEPLOY_SKIP_WEB=1)
 *
 * deploy/deploy.env da DEPLOY_SERVER va SSH kalit kerak.
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function run(label, cmd) {
  console.log(`\n[deploy:full] === ${label} ===\n`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, env: process.env });
}

function main() {
  const skipChecks = boolEnv('SKIP_DEPLOY_CHECKS', false);
  const skipWeb = boolEnv('DEPLOY_SKIP_WEB', false);
  const skipMini = boolEnv('DEPLOY_SKIP_MINI_APP', false);
  const skipStaff = boolEnv('DEPLOY_SKIP_STAFF', false);

  if (!skipChecks) {
    run('preflight', 'npm run deploy:preflight');
  } else {
    console.log('[deploy:full] SKIP_DEPLOY_CHECKS=1 — preflight o\'tkazildi');
  }

  run('server', 'npm run deploy:server');

  if (!skipMini) {
    run('mini-app', 'npm run deploy:mini-app');
  } else {
    console.log('[deploy:full] DEPLOY_SKIP_MINI_APP=1');
  }

  if (!skipStaff) {
    run('staff web', 'npm run deploy:staff');
  } else {
    console.log('[deploy:full] DEPLOY_SKIP_STAFF=1');
  }

  if (!skipWeb) {
    run('admin web', 'npm run deploy:web');
  } else {
    console.log('[deploy:full] DEPLOY_SKIP_WEB=1');
  }

  console.log('\n[deploy:full] Barcha bosqichlar yakunlandi.');
  console.log('[deploy:full] Serverda tekshiring:');
  console.log('  curl -fsS http://127.0.0.1:3334/health');
  console.log('  curl -fsS https://<staff-domain>/health');
  console.log('  curl -fsS https://<app-domain>/health');
}

main();
