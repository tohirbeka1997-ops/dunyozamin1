#!/usr/bin/env node
/**
 * electron:dev — avval Vite, keyin Electron (Windows-da wait-on http-get osilib qolmasligi uchun).
 */
'use strict';

const { execSync, spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const START_PORT = Number(process.env.VITE_DEV_PORT || 5173);
const MAX_TRIES = 30;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (let port = START_PORT; port < START_PORT + MAX_TRIES; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`Bo‘sh port topilmadi. npm run dev:kill-port`);
}

function waitForPort(port, timeoutMs = 120_000) {
  console.log(`[electron:dev] Vite port kutilyapti: ${port}...`);
  execSync(`npx wait-on "tcp:127.0.0.1:${port}" -t ${timeoutMs}`, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
}

function assertElectronDeps() {
  let electronBin;
  try {
    electronBin = require('electron');
  } catch (e) {
    console.error('[electron:dev] Electron paketi topilmadi. Ishga tushiring:');
    console.error('  npm install');
    console.error('  npm run postinstall');
    throw e;
  }
  if (!electronBin || !require('fs').existsSync(electronBin)) {
    console.error('[electron:dev] electron.exe yo‘q:', electronBin);
    console.error('  npm install electron --save-dev');
    console.error('  npm run postinstall');
    throw new Error('electron binary missing');
  }
  try {
    require('better-sqlite3');
  } catch (e) {
    console.error('[electron:dev] better-sqlite3 yuklanmadi:', e.message);
    console.error('  npm run rebuild:electron');
    throw e;
  }
}

async function main() {
  const withMiaoda = process.argv.includes('--miaoda');
  const kassaLite = process.argv.includes('--kassa');

  assertElectronDeps();

  console.log('[electron:dev] electron:build...');
  execSync('npm run electron:build', { cwd: ROOT, stdio: 'inherit' });

  const port = await pickPort();
  const devUrl = `http://localhost:${port}`;
  console.log(`[electron:dev] Dev URL: ${devUrl}`);

  const viteEnv = {
    ...process.env,
    ...(withMiaoda ? {} : { VITE_DISABLE_MIAODA: '1' }),
    ...(kassaLite ? { VITE_KASSA_LITE: '1', KASSA_LITE: '1' } : {}),
  };

  const viteArgs = withMiaoda
    ? ['vite', '--port', String(port), '--host', '127.0.0.1', '--strictPort']
    : ['cross-env', 'VITE_DISABLE_MIAODA=1', 'vite', '--port', String(port), '--host', '127.0.0.1', '--strictPort'];

  const vite = spawn('npx', viteArgs, {
    cwd: ROOT,
    env: viteEnv,
    stdio: 'inherit',
    shell: true,
  });

  let electronProc = null;

  const shutdown = (code) => {
    try {
      if (electronProc && !electronProc.killed) electronProc.kill();
    } catch { /* ignore */ }
    try {
      if (vite && !vite.killed) vite.kill();
    } catch { /* ignore */ }
    process.exit(code ?? 0);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  vite.on('error', (err) => {
    console.error('[electron:dev] Vite xato:', err);
    shutdown(1);
  });

  vite.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[electron:dev] Vite to‘xtadi (code ${code})`);
      shutdown(code);
    }
  });

  await new Promise((r) => setTimeout(r, 800));
  try {
    waitForPort(port);
  } catch (e) {
    console.error('[electron:dev] Vite tayyor emas:', e.message || e);
    shutdown(1);
    return;
  }

  console.log('[electron:dev] Electron oynasi ochilmoqda...');
  const electronEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl,
    ...(withMiaoda ? {} : { VITE_DISABLE_MIAODA: '1' }),
    ...(kassaLite ? { VITE_KASSA_LITE: '1', KASSA_LITE: '1' } : {}),
  };

  if (kassaLite) {
    console.log('[electron:dev] Kassa Lite — /kassa.html ochiladi');
  }

  const electronBin = require('electron');
  electronProc = spawn(electronBin, ['.'], {
    cwd: ROOT,
    env: electronEnv,
    stdio: 'inherit',
  });

  electronProc.on('error', (err) => {
    console.error('[electron:dev] Electron xato:', err);
    shutdown(1);
  });

  electronProc.on('exit', (code) => {
    shutdown(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[electron:dev]', err.message || err);
  process.exit(1);
});
