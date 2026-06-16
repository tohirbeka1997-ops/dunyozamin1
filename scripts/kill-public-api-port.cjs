#!/usr/bin/env node
/** Port 3334 (public-api) ni band qilgan jarayonni to'xtatish (Windows). */
'use strict';
const { execSync } = require('child_process');
const port = String(process.env.PUBLIC_API_PORT || 3334);
if (process.platform !== 'win32') {
  console.log(`[public-api:kill-port] ${port} — Linux/mac: lsof -ti :${port} | xargs kill`);
  process.exit(0);
}
try {
  const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  if (pids.size === 0) {
    console.log(`[public-api:kill-port] ${port} port bo'sh`);
    process.exit(0);
  }
  for (const pid of pids) {
    console.log(`[public-api:kill-port] PID ${pid} to'xtatilmoqda...`);
    try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' }); } catch { /* ignore */ }
  }
  console.log('[public-api:kill-port] Tayyor.');
} catch {
  console.log(`[public-api:kill-port] ${port} port bo'sh yoki netstat topilmadi`);
}
