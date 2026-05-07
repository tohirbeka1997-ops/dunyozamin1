/**
 * Masofada pos-rpc.service o'rnatish (systemd). deploy/deploy.env + .env dan SSH.
 * Ishlatish: node scripts/install-pos-rpc-service-remote.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEPLOY_ENV_PATH = path.join(ROOT, 'deploy', 'deploy.env');
const ROOT_ENV_PATH = path.join(ROOT, '.env');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function expandSshIdentity(raw) {
  if (!raw || !String(raw).trim()) return '';
  let p = String(raw).trim();
  p = p.replace(/%USERPROFILE%/gi, os.homedir());
  if (p.startsWith('~') && (p.length === 1 || p[1] === '/' || p[1] === '\\')) {
    p = os.homedir() + p.slice(1);
  }
  return p.replace(/\\/g, '/');
}

function parseArgs(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function main() {
  const env = {
    ...parseEnvFile(ROOT_ENV_PATH),
    ...parseEnvFile(DEPLOY_ENV_PATH),
    ...process.env,
  };
  const server = env.DEPLOY_SERVER || env.SERVER;
  if (!server) {
    console.error('[install-pos-rpc] DEPLOY_SERVER yo‘q (.env / deploy/deploy.env)');
    process.exit(1);
  }
  const id = expandSshIdentity(env.SSH_IDENTITY_FILE || env.SSH_KEY || '');
  const sshOpts = parseArgs(env.SSH_OPTS || '');
  const sshBase = [
    ...(id ? ['-i', id] : []),
    ...sshOpts,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=20',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];

  const localFile = path.join(ROOT, 'deploy', 'pos-rpc.opt-pos.service.example');
  if (!fs.existsSync(localFile)) {
    console.error('[install-pos-rpc] yo‘q:', localFile);
    process.exit(1);
  }

  const remoteTmp = '/tmp/pos-rpc.service.unit';
  console.log('[install-pos-rpc] scp →', server, remoteTmp);
  const scp = spawnSync('scp', [...sshBase, localFile, `${server}:${remoteTmp}`], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (scp.status !== 0) {
    console.error('[install-pos-rpc] scp xato');
    process.exit(scp.status || 1);
  }

  const remoteScript = [
    'set -euo pipefail',
    `sudo cp "${remoteTmp}" /etc/systemd/system/pos-rpc.service`,
    'sudo systemctl daemon-reload',
    'sudo systemctl enable pos-rpc.service',
    'sudo systemctl restart pos-rpc.service',
    'sleep 1',
    'systemctl is-active pos-rpc.service || true',
    'systemctl status pos-rpc.service --no-pager -l | head -25 || true',
    `rm -f "${remoteTmp}"`,
  ].join('\n');

  console.log('[install-pos-rpc] systemd enable + restart...');
  const sh = spawnSync('ssh', [...sshBase, server, 'bash', '-s'], {
    input: remoteScript,
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (sh.status !== 0) {
    console.error('[install-pos-rpc] ssh/systemctl xato');
    process.exit(sh.status || 1);
  }
  console.log('[install-pos-rpc] tayyor');
}

function sshEnvBag() {
  const env = {
    ...parseEnvFile(ROOT_ENV_PATH),
    ...parseEnvFile(DEPLOY_ENV_PATH),
    ...process.env,
  };
  const server = env.DEPLOY_SERVER || env.SERVER;
  if (!server) {
    console.error('[install-pos-rpc] DEPLOY_SERVER yo‘q (.env / deploy/deploy.env)');
    process.exit(1);
  }
  const id = expandSshIdentity(env.SSH_IDENTITY_FILE || env.SSH_KEY || '');
  const sshBase = [
    ...(id ? ['-i', id] : []),
    ...parseArgs(env.SSH_OPTS || ''),
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=20',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  return { server, sshBase };
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'disable') {
    const { server, sshBase } = sshEnvBag();
    const remoteScript = [
      'sudo systemctl disable --now pos-rpc.service 2>/dev/null || true',
      'echo "enabled?"; systemctl is-enabled pos-rpc.service 2>&1 || true',
      'echo "active?"; systemctl is-active pos-rpc.service 2>&1 || true',
    ].join('\n');
    const r = spawnSync('ssh', [...sshBase, server, 'bash', '-s'], {
      input: remoteScript,
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: ROOT,
      encoding: 'utf8',
    });
    process.exit(r.status === 0 ? 0 : r.status || 1);
  }
  if (cmd === 'health-rpc') {
    const { server, sshBase } = sshEnvBag();
    const port = String(process.argv[3] || '3333').replace(/\D/g, '') || '3333';
    const r = spawnSync(
      'ssh',
      [...sshBase, server, `curl -sfS "http://127.0.0.1:${port}/health" && echo "[health-rpc] OK"`],
      { stdio: 'inherit', cwd: ROOT },
    );
    process.exit(r.status === 0 ? 0 : r.status || 1);
  }
  if (cmd === 'probe-port') {
    const port = String(process.argv[3] || '3333').replace(/\D/g, '') || '3333';
    const { server, sshBase } = sshEnvBag();
    const r = spawnSync(
      'ssh',
      [
        ...sshBase,
        server,
        `echo "=== listeners :${port} ==="; sudo ss -tlnp "sport = :${port}" || true; echo "=== lsof ==="; sudo lsof -nP -iTCP:${port} -sTCP:LISTEN || true`,
      ],
      { stdio: 'inherit', cwd: ROOT },
    );
    process.exit(r.status === 0 ? 0 : r.status || 1);
  }
  if (cmd === 'journal') {
    const lines = Math.max(10, Math.min(200, Number(process.argv[3]) || 80));
    const { server, sshBase } = sshEnvBag();
    const r = spawnSync(
      'ssh',
      [...sshBase, server, `journalctl -u pos-rpc.service -n ${lines} --no-pager`],
      { stdio: 'inherit', cwd: ROOT },
    );
    process.exit(r.status === 0 ? 0 : r.status || 1);
  }
  if (cmd === 'status') {
    const { server, sshBase } = sshEnvBag();
    const r = spawnSync(
      'ssh',
      [
        ...sshBase,
        server,
        'systemctl is-active pos-rpc.service || true; systemctl status pos-rpc.service --no-pager -l | head -50',
      ],
      { stdio: 'inherit', cwd: ROOT },
    );
    process.exit(r.status === 0 ? 0 : r.status || 1);
  }
  main();
}
