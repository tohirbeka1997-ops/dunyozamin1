'use strict';

/**
 * Deploy dailyStorePoster + trigger, restart public-api, send tip + lifehack samples.
 * Does not print secrets.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function expandIdentity(raw) {
  if (!raw || !String(raw).trim()) return '';
  let p = String(raw).trim();
  p = p.replace(/%USERPROFILE%/gi, os.homedir());
  if (p.startsWith('~')) p = os.homedir() + p.slice(1);
  return p.replace(/\\/g, '/');
}

function run(label, cmd, args, opts = {}) {
  console.log(`[poster-deploy] ${label}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    shell: false,
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`[poster-deploy] fail ${label} exit=${r.status}`);
    process.exit(r.status || 1);
  }
}

const env = {
  ...parseEnv(path.join(ROOT, '.env')),
  ...parseEnv(path.join(ROOT, 'deploy', 'deploy.env')),
};

const server = String(env.DEPLOY_SERVER || '').trim();
const appPath = String(env.DEPLOY_APP_PATH || env.REMOTE_PATH || '/opt/pos').replace(/\/+$/, '') || '/opt/pos';
const identity = expandIdentity(env.SSH_IDENTITY_FILE || env.DEPLOY_SSH_IDENTITY || '');

if (!server) {
  console.error('[poster-deploy] DEPLOY_SERVER missing');
  process.exit(1);
}

const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
if (identity) sshArgs.push('-i', identity);

console.log(
  JSON.stringify({
    step: 'start',
    server: server.replace(/.*@/, ''),
    app: appPath,
    has_identity: Boolean(identity),
  }),
);

const files = [
  'public-api/lib/dailyStorePoster.cjs',
  'public-api/lib/dailyStorePoster.smoke.test.cjs',
  'scripts/trigger-daily-poster.cjs',
];

for (const rel of files) {
  const local = path.join(ROOT, rel);
  if (!fs.existsSync(local)) {
    console.error('[poster-deploy] missing', rel);
    process.exit(1);
  }
  const remoteDir = `${appPath}/${path.posix.dirname(rel.replace(/\\/g, '/'))}`;
  run(`mkdir ${rel}`, 'ssh', [...sshArgs, server, `mkdir -p ${JSON.stringify(remoteDir)}`]);
  run(`scp ${rel}`, 'scp', [...sshArgs, local, `${server}:${appPath}/${rel.replace(/\\/g, '/')}`]);
}

run(
  'restart public-api',
  'ssh',
  [
    ...sshArgs,
    server,
    `sudo -n systemctl restart public-api 2>/dev/null || systemctl restart public-api 2>/dev/null || true; sleep 2; systemctl is-active public-api 2>/dev/null || echo public-api-status-unknown`,
  ],
);

function triggerRemote(type) {
  const remoteCmd = [
    `cd ${JSON.stringify(appPath)}`,
    `&& node scripts/trigger-daily-poster.cjs --type=${type} --sample`,
  ].join(' ');
  console.log(`[poster-deploy] trigger ${type}`);
  const r = spawnSync('ssh', [...sshArgs, server, remoteCmd], {
    encoding: 'utf8',
    shell: false,
  });
  const out = String(r.stdout || '').trim();
  const err = String(r.stderr || '').trim();
  if (out) console.log(out.slice(0, 2000));
  if (err) console.error(err.slice(0, 500));
  if (r.status !== 0) {
    console.error(`[poster-deploy] trigger ${type} exit=${r.status}`);
    process.exit(r.status || 1);
  }
  return out;
}

const tipOut = triggerRemote('useful_tip');
const hackOut = triggerRemote('life_hack');

console.log(
  JSON.stringify({
    step: 'done',
    tip_ok: /"ok":\s*true/.test(tipOut),
    lifehack_ok: /"ok":\s*true/.test(hackOut),
  }),
);
