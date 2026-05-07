/**
 * Server deploy automation (POS API/Bot stack).
 *
 * Flow:
 *  1) Optional local checks (public-api tests)
 *  2) Sync repo snapshot to server (/opt/pos by default)
 *  3) Remote install + native rebuild (better-sqlite3)
 *  4) Restart systemd services
 *  5) Health check
 *
 * Env priority: deploy/deploy.env -> .env -> process.env
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function envAll() {
  return {
    ...parseEnvFile(ROOT_ENV_PATH),
    ...parseEnvFile(DEPLOY_ENV_PATH),
    ...process.env,
  };
}

function boolEnv(v, defaultValue = false) {
  if (v == null || v === '') return defaultValue;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function which(cmd) {
  const isWin = process.platform === 'win32';
  const r = spawnSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8', shell: isWin });
  return r.status === 0 && String(r.stdout || '').trim().length > 0;
}

function parseArgs(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function expandSshIdentity(raw) {
  if (!raw || !String(raw).trim()) return '';
  let p = String(raw).trim();
  p = p.replace(/%USERPROFILE%/gi, os.homedir());
  p = p.replace(/\$env\s*:\s*USERPROFILE/gi, os.homedir());
  if (p.startsWith('~') && (p.length === 1 || p[1] === '/' || p[1] === '\\')) {
    p = os.homedir() + p.slice(1);
  }
  return p.replace(/\\/g, '/');
}

function runStep(label, cmd, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  console.log(`[deploy:server] step:start ${label}`);
  const startedAt = Date.now();
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
  });
  const elapsed = Date.now() - startedAt;
  if (res.error && res.error.code === 'ETIMEDOUT') {
    console.error(`[deploy:server] step:timeout ${label} (${elapsed}ms)`);
    process.exit(124);
  }
  if (res.status !== 0) {
    console.error(`[deploy:server] step:fail ${label} (exit=${res.status ?? 'null'}, ${elapsed}ms)`);
    process.exit(res.status || 1);
  }
  console.log(`[deploy:server] step:ok ${label} (${elapsed}ms)`);
  return res;
}

function buildRemoteScript({
  appPath,
  installRoot,
  installPublicApi,
  rebuildRootNative,
  rebuildPublicApiNative,
  restartServices,
  healthUrl,
  rpcHealthUrl,
}) {
  // POS RPC alohida unit bo‘lishi mumkin (electron/server.cjs); yo‘q bo‘lsa deploy buzilmasin.
  const svcRestart = restartServices.length
    ? restartServices
        .map(
          (svc) =>
            `  systemctl restart ${svc} && echo "[remote] restarted ${svc}" || echo "[remote] WARN: ${svc} — restart muvaffaqiyatsiz yoki unit yo‘q"`,
        )
        .join('\n')
    : 'echo "[remote] restart skipped (no services configured)"';

  const rootChecks = installRoot
    ? [
        "node -e \"require('better-sqlite3'); new (require('better-sqlite3'))(':memory:').close(); console.log('[remote] root better-sqlite3 OK')\"",
      ]
    : ['echo "[remote] root install/rebuild skipped (server-only mode)"'];

  return [
    'set -Eeuo pipefail',
    `APP_PATH=${JSON.stringify(appPath)}`,
    `INSTALL_ROOT=${installRoot ? '1' : '0'}`,
    `INSTALL_PUBLIC_API=${installPublicApi ? '1' : '0'}`,
    `REBUILD_ROOT_NATIVE=${rebuildRootNative ? '1' : '0'}`,
    `REBUILD_PUBLIC_API_NATIVE=${rebuildPublicApiNative ? '1' : '0'}`,
    `HEALTH_URL=${JSON.stringify(healthUrl)}`,
    `RPC_HEALTH_URL=${JSON.stringify(rpcHealthUrl || '')}`,
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "[remote] node topilmadi" >&2',
    '  exit 1',
    'fi',
    'NODE_MAJOR="$(node -p "Number(process.versions.node.split(\'.\')[0])")"',
    'if [ "${NODE_MAJOR:-0}" -lt 20 ]; then',
    '  echo "[remote] Node.js 20+ talab qilinadi (hozir: $(node -v))" >&2',
    '  exit 1',
    'fi',
    '',
    'cd "$APP_PATH"',
    'echo "[remote] cwd=$PWD"',
    '',
    'if [ "$INSTALL_ROOT" = "1" ]; then',
    '  if [ -f package-lock.json ]; then',
    '    npm ci --omit=dev --ignore-scripts',
    '  else',
    '    npm install --omit=dev --ignore-scripts --no-audit --no-fund',
    '  fi',
    'fi',
    '',
    'if [ "$INSTALL_PUBLIC_API" = "1" ]; then',
    '  if [ -f public-api/package-lock.json ]; then',
    '    npm ci --omit=dev --ignore-scripts --prefix public-api',
    '  else',
    '    npm install --omit=dev --ignore-scripts --prefix public-api --no-audit --no-fund',
    '  fi',
    'fi',
    '',
    'if [ "$REBUILD_ROOT_NATIVE" = "1" ]; then',
    '  npm rebuild better-sqlite3 --build-from-source || npm install better-sqlite3 --build-from-source --no-audit --no-fund',
    'fi',
    '',
    'if [ "$REBUILD_PUBLIC_API_NATIVE" = "1" ]; then',
    '  npm rebuild better-sqlite3 --prefix public-api --build-from-source || npm install better-sqlite3 --prefix public-api --build-from-source --no-audit --no-fund',
    'fi',
    '',
    ...rootChecks,
    "node -e \"const B=require('./public-api/node_modules/better-sqlite3'); new B(':memory:').close(); console.log('[remote] public-api better-sqlite3 OK')\"",
    '',
    'if command -v systemctl >/dev/null 2>&1; then',
    `  ${svcRestart}`,
    'else',
    '  echo "[remote] systemctl topilmadi, restart o‘tkazib yuborildi"',
    'fi',
    '',
    'if command -v curl >/dev/null 2>&1; then',
    '  echo "[remote] health check: $HEALTH_URL"',
    '  for i in 1 2 3 4 5; do',
    '    if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then',
    '      break',
    '    fi',
    '    if [ "$i" = "5" ]; then',
    '      exit 7',
    '    fi',
    '    sleep 2',
    '  done',
    '  echo "[remote] health OK"',
    '  if [ -n "${RPC_HEALTH_URL:-}" ]; then',
    '    echo "[remote] POS RPC health (agar yo\'q bo\'lsa — WARN): ${RPC_HEALTH_URL}"',
    '    RPC_OK=0',
    '    for i in 1 2 3 4 5; do',
    '      if curl -fsS --max-time 10 "${RPC_HEALTH_URL}" >/dev/null; then',
    '        RPC_OK=1',
    '        echo "[remote] RPC health OK"',
    '        break',
    '      fi',
    '      sleep 2',
    '    done',
    '    if [ "$RPC_OK" != "1" ]; then',
    '      echo "[remote] WARN: RPC /health javob bermadi (pos-rpc.service yo\'q, Docker RPC boshqa portda yoki nginx ortida)" >&2',
    '    fi',
    '  fi',
    'else',
    '  echo "[remote] curl topilmadi, health check skipped"',
    'fi',
    '',
    'echo "[remote] deploy done"',
    '',
  ].join('\n');
}

function main() {
  const env = envAll();
  const server = env.DEPLOY_SERVER || env.SERVER;
  const appPath = (env.DEPLOY_APP_PATH || '/opt/pos').replace(/\/+$/, '') || '/opt/pos';
  const healthUrl = env.DEPLOY_HEALTH_URL || 'http://127.0.0.1:3334/health';
  // POST /rpc — electron/server.cjs; default :3333. Bo‘sh qilib yuborish yoki DEPLOY_SKIP_RPC_HEALTH=1 — o‘tkazib yuboradi.
  const rpcHealthUrl = boolEnv(env.DEPLOY_SKIP_RPC_HEALTH, false)
    ? ''
    : String(env.DEPLOY_RPC_HEALTH_URL != null && String(env.DEPLOY_RPC_HEALTH_URL).trim() !== ''
        ? env.DEPLOY_RPC_HEALTH_URL
        : 'http://127.0.0.1:3333/health').trim();
  const sshOpts = parseArgs(env.SSH_OPTS || '');
  const identityPath = expandSshIdentity(env.SSH_IDENTITY_FILE || env.SSH_KEY || '');
  const sshArgs = identityPath ? ['-i', identityPath, ...sshOpts] : sshOpts;
  const sshArgsNonInteractive = [
    ...sshArgs,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  const skipChecks = boolEnv(env.SKIP_DEPLOY_CHECKS, false);
  // Server deploy default: install root production deps too (telegram bot runtime).
  // `--omit=dev --ignore-scripts` keeps Electron/dev stack out of VPS install.
  const installRoot = boolEnv(env.DEPLOY_INSTALL_ROOT, true);
  const installPublicApi = boolEnv(env.DEPLOY_INSTALL_PUBLIC_API, true);
  const rebuildRootNative = boolEnv(env.DEPLOY_REBUILD_ROOT_NATIVE, true);
  const rebuildPublicApiNative = boolEnv(env.DEPLOY_REBUILD_PUBLIC_API_NATIVE, true);
  // RPC :3333 — systemd `pos-rpc.service` (electron/server.cjs). Docker compose ham 3333 bersa, bittasini o‘chiring (EADDRINUSE).
  const restartServices = String(
    env.DEPLOY_RESTART_SERVICES ||
      'public-api.service telegram-bot.service pos-rpc.service',
  )
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stepTimeoutMs = Math.max(30, Number(env.DEPLOY_STEP_TIMEOUT_SEC || 900)) * 1000;

  if (!server) {
    console.error('[deploy:server] DEPLOY_SERVER yo‘q (deploy/deploy.env yoki .env ga yozing)');
    process.exit(1);
  }
  if (!which('ssh')) {
    console.error('[deploy:server] ssh topilmadi');
    process.exit(1);
  }
  if (identityPath && !fs.existsSync(identityPath)) {
    console.error('[deploy:server] SSH kalit topilmadi:', identityPath);
    process.exit(1);
  }
  const hasRsync = which('rsync');
  const hasScp = which('scp');
  if (!hasRsync && !hasScp) {
    console.error('[deploy:server] rsync ham scp ham topilmadi');
    process.exit(1);
  }

  console.log('[deploy:server] server =', server);
  console.log('[deploy:server] appPath =', appPath);
  console.log('[deploy:server] health =', healthUrl);
  console.log('[deploy:server] restart =', restartServices.join(' '));
  if (rpcHealthUrl) {
    console.log('[deploy:server] rpcHealth =', rpcHealthUrl);
  } else {
    console.log('[deploy:server] rpcHealth = (skipped)');
  }

  if (!skipChecks) {
    console.log('[deploy:server] local precheck: npm run test:public-api');
    execSync('npm run test:public-api', { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  } else {
    console.log('[deploy:server] SKIP_DEPLOY_CHECKS=1');
  }

  runStep('ssh-ping', 'ssh', [...sshArgsNonInteractive, server, 'true'], { timeoutMs: 30_000 });

  if (hasRsync) {
    const excludeFile = path.join(ROOT, '.deployignore');
    const rsyncArgs = [
      '-az',
      '--delete',
      '--delete-excluded',
      '--exclude',
      '.git/',
      '--exclude',
      'node_modules/',
      '--exclude',
      'dist/',
      '--exclude',
      '.pos-data-dev/',
      '--exclude',
      'release/',
    ];
    if (fs.existsSync(excludeFile)) {
      rsyncArgs.push('--exclude-from', excludeFile);
    }
    rsyncArgs.push('-e', ['ssh', ...sshArgsNonInteractive].join(' '), `${ROOT}/`, `${server}:${appPath}/`);

    console.log('[deploy:server] rsync codebase...');
    runStep('sync-rsync', 'rsync', rsyncArgs, { cwd: ROOT, timeoutMs: stepTimeoutMs });
  } else {
    console.log('[deploy:server] rsync yo‘q, tar+scp fallback...');
    const tmpTar = path.join(os.tmpdir(), `pos-server-src-${Date.now()}.tar`);
    try {
      runStep('remote-mkdir', 'ssh', [...sshArgsNonInteractive, server, `mkdir -p "${appPath}"`], {
        cwd: ROOT,
        timeoutMs: 60_000,
      });

      const excludes = [
        '--exclude=.git',
        '--exclude=node_modules',
        '--exclude=dist',
        '--exclude=.pos-data-dev',
        '--exclude=release',
        '--exclude=.env',
        '--exclude=.env.*',
        '--exclude=deploy/deploy.env',
      ];
      execSync(`tar ${excludes.join(' ')} -cf "${tmpTar}" -C "${ROOT}" .`, {
        stdio: 'inherit',
        cwd: ROOT,
        shell: true,
      });

      runStep('sync-scp', 'scp', [...sshArgsNonInteractive, tmpTar, `${server}:${appPath}/__src.tar`], {
        cwd: ROOT,
        timeoutMs: stepTimeoutMs,
      });

      runStep(
        'remote-unpack',
        'ssh',
        [
          ...sshArgsNonInteractive,
          server,
          `tar -xf "${appPath}/__src.tar" -C "${appPath}" && rm -f "${appPath}/__src.tar"`,
        ],
        { cwd: ROOT, timeoutMs: stepTimeoutMs },
      );
    } finally {
      try {
        fs.rmSync(tmpTar, { force: true });
      } catch {
        // ignore
      }
    }
  }

  const remoteScript = buildRemoteScript({
    appPath,
    installRoot,
    installPublicApi,
    rebuildRootNative,
    rebuildPublicApiNative,
    restartServices,
    healthUrl,
    rpcHealthUrl,
  });

  console.log('[deploy:server] remote install/rebuild/restart...');
  runStep('remote-apply', 'ssh', [...sshArgsNonInteractive, server, 'bash', '-s'], {
    input: remoteScript,
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: ROOT,
    encoding: 'utf8',
    timeoutMs: stepTimeoutMs,
  });

  console.log('[deploy:server] muvaffaqiyatli yakunlandi');
  console.log('DEPLOY_DONE');
}

main();
