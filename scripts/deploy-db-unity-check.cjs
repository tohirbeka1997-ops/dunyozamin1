#!/usr/bin/env node
/**
 * Deploy / DB unity checklist — dual-DB va stale :3333 egasini erta ushlash.
 *
 * Serverda (tavsiya):
 *   node scripts/deploy-db-unity-check.cjs
 *
 * Muhit (ixtiyoriy):
 *   POS_HOST_DATA_DIR=/var/lib/pos
 *   POS_RPC_HEALTH_URL=http://127.0.0.1:3333/health
 *   PUBLIC_API_HEALTH_URL=http://127.0.0.1:3334/health
 *   DEPLOY_DB_UNITY_STRICT=1   — WARN ni FAIL qiladi
 *
 * Sirlar chop etilmaydi.
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const STRICT = process.env.DEPLOY_DB_UNITY_STRICT === '1';
const DATA_DIR = process.env.POS_HOST_DATA_DIR || process.env.POS_DATA_DIR || '/var/lib/pos';
const RPC_HEALTH = process.env.POS_RPC_HEALTH_URL || 'http://127.0.0.1:3333/health';
const API_HEALTH = process.env.PUBLIC_API_HEALTH_URL || 'http://127.0.0.1:3334/health';

const results = [];

function log(line) {
  console.log(line);
}

function record(name, status, detail) {
  results.push({ name, status, detail: detail || '' });
  const mark = status === 'OK' ? '✓' : status === 'WARN' ? '!' : '✗';
  log(`  ${mark} [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return (e.stdout || e.stderr || e.message || '').toString().trim();
  }
}

function fetchJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + u.search,
          method: 'GET',
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(body);
            } catch {
              /* ignore */
            }
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, body });
          });
        }
      );
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function dockerAvailable() {
  const r = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  return r.status === 0;
}

async function main() {
  log('\n=== DEPLOY DB UNITY CHECK ===\n');
  log(`Data dir: ${DATA_DIR}`);
  log(`RPC health: ${RPC_HEALTH}`);
  log(`API health: ${API_HEALTH}\n`);

  // 1) Host data dir + pos.db
  const dbPath = path.join(DATA_DIR, 'pos.db');
  if (fs.existsSync(DATA_DIR)) {
    record('host_data_dir', 'OK', DATA_DIR);
  } else {
    record('host_data_dir', 'WARN', `missing ${DATA_DIR} (dev machine?)`);
  }
  if (fs.existsSync(dbPath)) {
    const st = fs.statSync(dbPath);
    record('host_pos_db', 'OK', `pos.db ${(st.size / (1024 * 1024)).toFixed(2)} MB`);
  } else {
    record('host_pos_db', 'WARN', `no ${dbPath}`);
  }

  // 2) Single :3333 owner — docker XOR systemd
  let dockerOwns = false;
  let systemdOwns = false;
  if (dockerAvailable()) {
    const names = sh("docker ps --format '{{.Names}}'");
    dockerOwns = /\bpos-server\b/.test(names);
    record('docker_pos_server', dockerOwns ? 'OK' : 'WARN', dockerOwns ? 'running' : 'not running');

    if (dockerOwns) {
      const mounts = sh('docker inspect pos-server --format "{{json .Mounts}}"');
      const bindOk =
        mounts.includes(`"Source":"${DATA_DIR}"`) ||
        mounts.includes(`"Source": "${DATA_DIR}"`) ||
        (mounts.includes(DATA_DIR) && mounts.includes('/var/lib/pos') && mounts.includes('bind'));
      const namedVol = /pos-data|"Name":"pos-data"/.test(mounts) && !bindOk;
      if (bindOk) {
        record('docker_bind_mount', 'OK', `${DATA_DIR} → /var/lib/pos`);
      } else if (namedVol) {
        record(
          'docker_bind_mount',
          'FAIL',
          'named volume pos-data — dual DB risk; use docker-compose.prod.yaml bind-mount'
        );
      } else {
        record('docker_bind_mount', 'WARN', 'could not confirm bind-mount (inspect Mounts)');
      }
    }
  } else {
    record('docker_pos_server', 'WARN', 'docker not available');
  }

  const sysActive = (() => {
    const r = spawnSync('systemctl', ['is-active', 'pos-rpc'], { encoding: 'utf8' });
    if (r.error || r.status == null) return '';
    return String(r.stdout || '').trim();
  })();
  systemdOwns = sysActive === 'active';
  if (systemdOwns) {
    record('systemd_pos_rpc', 'OK', 'active');
  } else if (!sysActive) {
    record('systemd_pos_rpc', 'WARN', 'systemctl unavailable');
  } else {
    record('systemd_pos_rpc', 'WARN', sysActive);
  }

  if (dockerOwns && systemdOwns) {
    record('port_3333_owner', 'FAIL', 'BOTH docker pos-server AND systemd pos-rpc active (EADDRINUSE / dual brain)');
  } else if (dockerOwns || systemdOwns) {
    record('port_3333_owner', 'OK', dockerOwns ? 'docker only' : 'systemd only');
  } else {
    record('port_3333_owner', 'WARN', 'neither docker nor systemd pos-rpc detected');
  }

  // 3) Health + version (no secrets)
  const rpc = await fetchJson(RPC_HEALTH);
  if (rpc.ok) {
    const ver = rpc.json?.version || rpc.json?.build || rpc.json?.appVersion || null;
    record('rpc_health', 'OK', ver ? `version=${ver}` : '200 (no version field)');
  } else {
    record('rpc_health', 'WARN', rpc.error || `HTTP ${rpc.status || '?'}`);
  }

  const api = await fetchJson(API_HEALTH);
  if (api.ok) {
    const ver = api.json?.version || api.json?.build || null;
    record('public_api_health', 'OK', ver ? `version=${ver}` : '200');
  } else {
    record('public_api_health', 'WARN', api.error || `HTTP ${api.status || '?'}`);
  }

  // 4) PUBLIC_API_DB_PATH hint (env only if set — path only, no secrets)
  const pubDb = process.env.PUBLIC_API_DB_PATH || '';
  if (pubDb) {
    const same =
      path.resolve(pubDb) === path.resolve(dbPath) ||
      path.resolve(pubDb) === path.resolve(path.join(DATA_DIR, 'tenants', 'default', 'pos.db'));
    record(
      'public_api_db_path',
      same || pubDb.startsWith(DATA_DIR) ? 'OK' : 'WARN',
      pubDb.startsWith(DATA_DIR) ? 'under POS data dir' : `check aligns with ${DATA_DIR}`
    );
  } else {
    record('public_api_db_path', 'WARN', 'PUBLIC_API_DB_PATH unset (ok if POS_DATA_DIR used)');
  }

  log('\n--- Checklist (manual) ---');
  log('  [ ] docker-compose.prod.yaml (yoki bind overlay) — named volume emas');
  log('  [ ] Faqat bitta :3333 egasi (docker XOR pos-rpc)');
  log('  [ ] curl :3333/health va :3334/health — version/ok');
  log('  [ ] public-api va pos-server bir xil pos.db');
  log('');

  const failed = results.filter((r) => r.status === 'FAIL');
  const warns = results.filter((r) => r.status === 'WARN');
  if (failed.length) {
    log(`DB unity check FAILED (${failed.length} fail, ${warns.length} warn).\n`);
    process.exit(1);
  }
  if (STRICT && warns.length) {
    log(`DB unity check FAILED under STRICT (${warns.length} warn).\n`);
    process.exit(1);
  }
  log(`DB unity check PASSED (${warns.length} warn).\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
