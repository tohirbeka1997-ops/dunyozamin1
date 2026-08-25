#!/usr/bin/env node
/**
 * Deploy oldidan mahalliy tekshiruvlar (kod + biznes smoke).
 * Ishga tushirish: npm run deploy:preflight
 *
 * Muhit:
 *   PREFLIGHT_SKIP_POS=1     — Electron POS smoke o‘tkazib yuborish (tez)
 *   PREFLIGHT_SKIP_BUILD=1   — vite build o‘tkazib yuborish (xotira cheklangan mashinalar)
 *   NODE_OPTIONS=--max-old-space-size=8192 — katta build uchun tavsiya
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const skipPos = process.env.PREFLIGHT_SKIP_POS === '1';
const skipBuild = process.env.PREFLIGHT_SKIP_BUILD === '1';

const steps = [
  { name: 'electron:build', cmd: 'npm run electron:build', skip: false },
  { name: 'test:public-api', cmd: 'npm run test:public-api', skip: false },
  { name: 'test:barcode', cmd: 'npm run test:barcode', skip: false },
  { name: 'test:print-agent', cmd: 'npm run test:print-agent', skip: false },
  {
    name: 'test:pos-smoke',
    cmd: 'npm run test:pos-smoke',
    skip: skipPos,
  },
  { name: 'vite build', cmd: 'npm run build', skip: skipBuild },
];

const results = [];

function runStep(step) {
  if (step.skip) {
    results.push({ name: step.name, status: 'SKIP' });
    console.log(`  ⊘ ${step.name} (skipped)`);
    return;
  }
  console.log(`\n▶ ${step.name}`);
  const t0 = Date.now();
  try {
    execSync(step.cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
    const ms = Date.now() - t0;
    results.push({ name: step.name, status: 'OK', ms });
    console.log(`  ✓ ${step.name} (${(ms / 1000).toFixed(1)}s)`);
  } catch (e) {
    const ms = Date.now() - t0;
    results.push({ name: step.name, status: 'FAIL', ms });
    console.error(`  ✗ ${step.name} (${(ms / 1000).toFixed(1)}s)`);
    throw e;
  }
}

console.log('\n=== DEPLOY PREFLIGHT ===\n');
console.log('Root:', ROOT);
if (skipPos) console.log('Note: PREFLIGHT_SKIP_POS=1 — POS smoke skipped');
if (skipBuild) console.log('Note: PREFLIGHT_SKIP_BUILD=1 — vite build skipped');

try {
  for (const step of steps) {
    runStep(step);
  }
} catch {
  console.log('\n--- Summary ---');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(5)} ${r.name}${r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : ''}`);
  }
  console.log('\nPreflight FAILED. Deploy qilmang — xatolarni tuzating.\n');
  process.exit(1);
}

console.log('\n--- Summary ---');
for (const r of results) {
  console.log(`  ${r.status.padEnd(5)} ${r.name}${r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : ''}`);
}
console.log('\nPreflight PASSED. Keyingi: deploy checklist va server health.\n');
console.log('Serverda tavsiya: node scripts/deploy-db-unity-check.cjs');
console.log('  (bind-mount, yagona :3333 egasi, /health version)\n');
process.exit(0);
