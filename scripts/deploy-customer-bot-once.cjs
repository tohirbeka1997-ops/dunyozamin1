'use strict';

/**
 * One-shot: set TELEGRAM_CUSTOMER_BOT_TOKEN on production .env + sync customer bot files.
 * Does not print the token.
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
  console.log(`[cust-deploy] ${label}`);
  const r = spawnSync(cmd, args, {
    stdio: opts.input != null ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    encoding: 'utf8',
    input: opts.input,
    shell: false,
  });
  if (r.status !== 0) {
    console.error(`[cust-deploy] fail ${label} exit=${r.status}`);
    process.exit(r.status || 1);
  }
}

const env = {
  ...parseEnv(path.join(ROOT, '.env')),
  ...parseEnv(path.join(ROOT, 'deploy', 'deploy.env')),
};

const server = String(env.DEPLOY_SERVER || '').trim();
const appPath = String(env.DEPLOY_APP_PATH || env.REMOTE_PATH || '/opt/pos').trim();
const identity = expandIdentity(env.SSH_IDENTITY_FILE || env.DEPLOY_SSH_IDENTITY || '');
const token = String(env.TELEGRAM_CUSTOMER_BOT_TOKEN || '').trim();

if (!server) {
  console.error('[cust-deploy] DEPLOY_SERVER missing');
  process.exit(1);
}
if (!token) {
  console.error('[cust-deploy] TELEGRAM_CUSTOMER_BOT_TOKEN missing in local .env');
  process.exit(1);
}

const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
if (identity) sshArgs.push('-i', identity);

console.log(`[cust-deploy] server=${server} app=${appPath} token_len=${token.length}`);

const remoteEnvScript = [
  'set -euo pipefail',
  `APP=${JSON.stringify(appPath)}`,
  'ENV_FILE="$APP/.env"',
  'mkdir -p "$APP"',
  'touch "$ENV_FILE"',
  `TOKEN=${JSON.stringify(token)}`,
  'if grep -q "^TELEGRAM_CUSTOMER_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null; then',
  '  grep -v "^TELEGRAM_CUSTOMER_BOT_TOKEN=" "$ENV_FILE" > "$ENV_FILE.tmp"',
  '  mv "$ENV_FILE.tmp" "$ENV_FILE"',
  'fi',
  'printf "\\n# Mijoz hisobotlari boti (alohida)\\nTELEGRAM_CUSTOMER_BOT_TOKEN=%s\\n" "$TOKEN" >> "$ENV_FILE"',
  `node -e ${JSON.stringify(
    "const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8');const m=t.match(/^TELEGRAM_CUSTOMER_BOT_TOKEN=(.*)$/m);console.log('remote_token_len='+(m&&m[1]?m[1].trim().length:0));",
  )} "$ENV_FILE"`,
].join('\n');

run('ssh-set-env', 'ssh', [...sshArgs, server, 'bash -s'], { input: remoteEnvScript });

const files = [
  'public-api/lib/customerOpsNotify.cjs',
  'public-api/lib/customerOpsNotify.smoke.test.cjs',
  'public-api/lib/balanceChangeNotify.cjs',
  'public-api/lib/marketplacePosCustomer.cjs',
  'public-api/routes/bot.cjs',
  'electron/services/salesService.cjs',
  'electron/services/customersService.cjs',
  'electron/services/returnsService.cjs',
  'electron/lib/posHardening.cjs',
  'telegram/customerOpsBot.cjs',
  'telegram/telegram-customer-bot.service.example',
  'docs/CUSTOMER-TELEGRAM-OPS-UZ.md',
  'docker-compose.yaml',
  'docker-compose.prod.yaml',
  'package.json',
];

for (const rel of files) {
  const local = path.join(ROOT, rel);
  if (!fs.existsSync(local)) {
    console.warn(`[cust-deploy] skip missing ${rel}`);
    continue;
  }
  const remoteDir = `${appPath}/${path.posix.dirname(rel.replace(/\\/g, '/'))}`;
  run(`ssh-mkdir ${rel}`, 'ssh', [...sshArgs, server, `mkdir -p ${JSON.stringify(remoteDir)}`]);
  const remote = `${server}:${appPath}/${rel.replace(/\\/g, '/')}`;
  run(`scp ${rel}`, 'scp', [...sshArgs, local, remote]);
}

const envPathJson = JSON.stringify(`${appPath}/.env`);
const getMeJs = [
  "const fs=require('fs');",
  `const envFile=${envPathJson};`,
  "const text=fs.readFileSync(envFile,'utf8');",
  "let token='';",
  'for (const line of text.split(/\\n/)) {',
  "  const t=line.trim();",
  "  if (t.startsWith('TELEGRAM_CUSTOMER_BOT_TOKEN=')) { token=t.slice(28).trim(); break; }",
  '}',
  "if(!token){console.log('no_token');process.exit(1);}",
  "fetch('https://api.telegram.org/bot'+encodeURIComponent(token)+'/getMe')",
  '.then(r=>r.json()).then(j=>{',
  "  if(!j.ok){console.log('getMe_fail');process.exit(1);}",
  "  console.log('prod_getMe_ok @'+(j.result.username||'')+' id='+j.result.id);",
  '}).catch(e=>{console.error(e.message);process.exit(1);});',
].join('');

const remotePost = [
  'set -euo pipefail',
  `APP=${JSON.stringify(appPath)}`,
  'cat > /etc/systemd/system/telegram-customer-bot.service <<EOF',
  '[Unit]',
  'Description=Telegram customer ops bot (sales/payment/nasiya DM)',
  'After=network-online.target public-api.service',
  'Wants=network-online.target',
  '',
  '[Service]',
  'Type=simple',
  `WorkingDirectory=${appPath}`,
  `EnvironmentFile=-${appPath}/.env`,
  `ExecStart=/usr/bin/node ${appPath}/telegram/customerOpsBot.cjs`,
  'Restart=always',
  'RestartSec=5',
  'StandardOutput=journal',
  'StandardError=journal',
  'SyslogIdentifier=telegram-customer-bot',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  'EOF',
  'systemctl daemon-reload',
  'systemctl enable telegram-customer-bot.service || true',
  'systemctl restart telegram-customer-bot.service',
  'systemctl restart public-api.service || true',
  // POS sotuvlari docker pos-server orqali — image ichida eski kod bo'lsa notify ishlamaydi.
  'if docker inspect pos-server >/dev/null 2>&1; then',
  '  docker cp "$APP/public-api/lib/customerOpsNotify.cjs" pos-server:/app/public-api/lib/customerOpsNotify.cjs || true',
  '  docker cp "$APP/electron/lib/posHardening.cjs" pos-server:/app/electron/lib/posHardening.cjs || true',
  '  docker cp "$APP/electron/services/salesService.cjs" pos-server:/app/electron/services/salesService.cjs || true',
  '  docker cp "$APP/electron/services/customersService.cjs" pos-server:/app/electron/services/customersService.cjs || true',
  '  docker cp "$APP/electron/services/returnsService.cjs" pos-server:/app/electron/services/returnsService.cjs || true',
  '  cd "$APP"',
  '  if [ -f docker-compose.prod.yaml ] && [ -f docker-compose.yaml ]; then',
  '    docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d pos-server || docker restart pos-server',
  '  else',
  '    docker restart pos-server',
  '  fi',
  'fi',
  'sleep 3',
  'systemctl is-active telegram-customer-bot.service || true',
  'systemctl is-active public-api.service || true',
  'docker inspect -f "{{.State.Health.Status}}" pos-server 2>/dev/null || docker inspect -f "{{.State.Status}}" pos-server 2>/dev/null || true',
  `node -e ${JSON.stringify(getMeJs)}`,
  'journalctl -u telegram-customer-bot -n 20 --no-pager || true',
].join('\n');

run('ssh-restart', 'ssh', [...sshArgs, server, 'bash -s'], { input: remotePost });
console.log('[cust-deploy] done');
