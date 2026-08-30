'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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
const ROOT = path.resolve(__dirname, '..');
const env = { ...parseEnv(path.join(ROOT, '.env')), ...parseEnv(path.join(ROOT, 'deploy', 'deploy.env')) };
const args = ['-o', 'BatchMode=yes'];
const id = expand(env.SSH_IDENTITY_FILE);
if (id) args.push('-i', id);
args.push(
  env.DEPLOY_SERVER,
  'journalctl -u public-api -n 60 --no-pager; systemctl status public-api --no-pager -l | head -40',
);
spawnSync('ssh', args, { stdio: 'inherit' });
