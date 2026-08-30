'use strict';

/**
 * Fix prod: upload deps missing after partial customersService sync + restart public-api.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function expand(raw) {
  if (!raw) return '';
  let p = String(raw).trim().replace(/%USERPROFILE%/gi, os.homedir());
  if (p.startsWith('~')) p = os.homedir() + p.slice(1);
  return p.replace(/\\/g, '/');
}

function run(label, cmd, args) {
  console.log(`[fix] ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const env = {
  ...parseEnv(path.join(ROOT, '.env')),
  ...parseEnv(path.join(ROOT, 'deploy', 'deploy.env')),
};
const server = env.DEPLOY_SERVER;
const app = env.DEPLOY_APP_PATH || '/opt/pos';
const id = expand(env.SSH_IDENTITY_FILE);
const ssh = ['-o', 'BatchMode=yes'];
if (id) ssh.push('-i', id);

const files = [
  'electron/lib/posHardening.cjs',
  'electron/lib/allocateOrderDiscount.cjs',
];

for (const rel of files) {
  const local = path.join(ROOT, rel);
  if (!fs.existsSync(local)) {
    console.warn('missing', rel);
    continue;
  }
  run(
    `mkdir ${rel}`,
    'ssh',
    [...ssh, server, `mkdir -p ${JSON.stringify(app + '/' + path.posix.dirname(rel))}`],
  );
  run(`scp ${rel}`, 'scp', [...ssh, local, `${server}:${app}/${rel}`]);
}

run('restart-api', 'ssh', [
  ...ssh,
  server,
  'systemctl restart public-api.service; sleep 3; systemctl is-active public-api.service telegram-customer-bot.service; journalctl -u public-api -n 20 --no-pager',
]);
