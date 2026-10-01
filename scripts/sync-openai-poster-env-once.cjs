'use strict';

/**
 * Ensure OPENAI_API_KEY exists on remote /opt/pos/.env (from local .env).
 * Never prints secret values.
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

function expandIdentity(raw) {
  if (!raw || !String(raw).trim()) return '';
  let p = String(raw).trim();
  p = p.replace(/%USERPROFILE%/gi, os.homedir());
  if (p.startsWith('~')) p = os.homedir() + p.slice(1);
  return p.replace(/\\/g, '/');
}

const env = {
  ...parseEnv(path.join(ROOT, '.env')),
  ...parseEnv(path.join(ROOT, 'deploy', 'deploy.env')),
};

const server = String(env.DEPLOY_SERVER || '').trim();
const appPath = String(env.DEPLOY_APP_PATH || '/opt/pos').replace(/\/+$/, '') || '/opt/pos';
const identity = expandIdentity(env.SSH_IDENTITY_FILE || env.DEPLOY_SSH_IDENTITY || '');
const openaiKey = String(env.OPENAI_API_KEY || '').trim();
const openaiImageModel = String(env.OPENAI_IMAGE_MODEL || 'gpt-image-1').trim() || 'gpt-image-1';

if (!server) {
  console.error(JSON.stringify({ ok: false, error: 'no_DEPLOY_SERVER' }));
  process.exit(1);
}
if (!openaiKey) {
  console.error(JSON.stringify({ ok: false, error: 'local_OPENAI_API_KEY_missing' }));
  process.exit(1);
}

const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
if (identity) sshArgs.push('-i', identity);

const remoteScript = [
  `ENV_FILE=${JSON.stringify(appPath + '/.env')}`,
  'if [ ! -f "$ENV_FILE" ]; then echo missing_env; exit 2; fi',
  'if grep -qE "^[[:space:]]*OPENAI_API_KEY=" "$ENV_FILE"; then',
  '  cur=$(grep -E "^[[:space:]]*OPENAI_API_KEY=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\\r" | sed -e "s/^\\"//;s/\\"$//;s/^\'//;s/\'$//")',
  '  if [ -n "$cur" ]; then echo already_set_len_${#cur}; exit 0; fi',
  'fi',
  `KEY=${JSON.stringify(openaiKey)}`,
  `IMG=${JSON.stringify(openaiImageModel)}`,
  'tmp=$(mktemp)',
  'grep -vE "^[[:space:]]*OPENAI_API_KEY=|^[[:space:]]*OPENAI_IMAGE_MODEL=" "$ENV_FILE" > "$tmp" || true',
  'printf "\\n# Daily poster image fallback (synced)\\nOPENAI_API_KEY=%s\\nOPENAI_IMAGE_MODEL=%s\\n" "$KEY" "$IMG" >> "$tmp"',
  'mv "$tmp" "$ENV_FILE"',
  'chmod 600 "$ENV_FILE" 2>/dev/null || true',
  'echo synced_openai_image_env',
].join('\n');

const r = spawnSync('ssh', [...sshArgs, server, remoteScript], {
  encoding: 'utf8',
  shell: false,
});
const out = String(r.stdout || '').trim();
const err = String(r.stderr || '').trim();
console.log(
  JSON.stringify({
    ok: r.status === 0,
    exit: r.status,
    result: out.slice(0, 200),
    err: err.slice(0, 200) || null,
  }),
);
if (r.status !== 0) process.exit(r.status || 1);
