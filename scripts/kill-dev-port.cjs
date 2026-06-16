#!/usr/bin/env node
/**
 * Dev port (default 5173) ni band qilgan jarayonni to‘xtatish (Windows).
 * npm run dev:kill-port
 */
'use strict';

const { execSync } = require('child_process');

const port = String(process.env.VITE_DEV_PORT || 5173);

if (process.platform !== 'win32') {
  console.log(`[dev:kill-port] ${port} — Linux/mac: lsof -ti :${port} | xargs kill`);
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
    console.log(`[dev:kill-port] ${port} port bo‘sh`);
    process.exit(0);
  }
  for (const pid of pids) {
    console.log(`[dev:kill-port] PID ${pid} to‘xtatilmoqda...`);
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
    } catch {
      /* ignore */
    }
  }
  console.log('[dev:kill-port] Tayyor. npm run electron:dev');
} catch {
  console.log(`[dev:kill-port] ${port} port bo‘sh yoki netstat topilmadi`);
}
