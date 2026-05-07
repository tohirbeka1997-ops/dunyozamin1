/**
 * Telegram Mini App deploy: `mini-app` → server (Nginx: /opt/pos/mini-app/dist).
 * Ishlatish: npm run deploy:mini-app
 *
 * Muhim: `deploy:web` loyiha ildizidagi POS admin `dist/` ni yuboradi; Telegram Web App
 * alohida `mini-app/dist` — shu skript.
 *
 * O'qiladi: deploy/deploy.env, .env, process.env
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MINI_ROOT = path.join(ROOT, 'mini-app');
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

function mergeEnv() {
  return { ...parseEnvFile(ROOT_ENV_PATH), ...parseEnvFile(DEPLOY_ENV_PATH), ...process.env };
}

function which(cmd) {
  const isWin = process.platform === 'win32';
  const r = spawnSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8', shell: isWin });
  return r.status === 0 && String(r.stdout || '').trim().length > 0;
}

function sshOptsParts(SSH_OPTS) {
  return SSH_OPTS.trim() ? SSH_OPTS.trim().split(/\s+/).filter(Boolean) : [];
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

function buildSshExtra(env) {
  const parts = [];
  const id = expandSshIdentity(env.SSH_IDENTITY_FILE || env.SSH_KEY || '');
  if (id) {
    parts.push('-i', id);
  }
  parts.push(...sshOptsParts(env.SSH_OPTS || ''));
  return { parts, identityPath: id || null };
}

function utcRev() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(
    d.getUTCMinutes()
  )}${p(d.getUTCSeconds())}Z`;
}

const REMOTE_BODY = [
  'set -Eeuo pipefail',
  'WEB_ROOT="$1"',
  'RELEASES="$2"',
  'REV="$3"',
  'NO_RESTART_NGINX="$4"',
  '',
  'NEW="$RELEASES/$REV"',
  '',
  'if [[ -d "$WEB_ROOT" && ! -L "$WEB_ROOT" ]]; then',
  '  BAKUP="${WEB_ROOT}.initial.$(date +%s)"',
  '  echo "[deploy:mini] $WEB_ROOT oddiy katalog; zaxira: $BAKUP"',
  '  mv "$WEB_ROOT" "$BAKUP" || true',
  'fi',
  '',
  'mkdir -p "$RELEASES"',
  '',
  'ln -sfn "$NEW" "${WEB_ROOT}.tmp"',
  'mv -T "${WEB_ROOT}.tmp" "$WEB_ROOT"',
  '',
  'sudo -n chown -R www-data:www-data "$NEW" 2>/dev/null || chown -R www-data:www-data "$NEW" 2>/dev/null || true',
  '',
  'ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf',
  'echo "[deploy:mini] aktiv: $NEW"',
  '',
  'if [[ "$NO_RESTART_NGINX" != "1" ]]; then',
  '  if command -v systemctl >/dev/null 2>&1; then',
  "    sudo -n systemctl reload nginx 2>/dev/null || systemctl reload nginx 2>/dev/null || echo '[deploy:mini] nginx reload'",
  '  fi',
  'fi',
].join('\n');

function main() {
  const env = mergeEnv();
  const SERVER = env.DEPLOY_SERVER || env.SERVER;
  const REMOTE_PATH = (
    env.MINI_APP_REMOTE_PATH ||
    env.DEPLOY_MINI_APP_PATH ||
    '/opt/pos/mini-app/dist'
  ).replace(/\/+$/, '');
  const resolvedReleases = (env.MINI_APP_RELEASES_DIR || '/opt/pos/mini-app-releases').replace(
    /\/+$/,
    ''
  );
  const SKIP_BUILD = String(env.SKIP_BUILD || '0') === '1';
  const NO_RESTART_NGINX = String(env.NO_RESTART_NGINX || '0') === '1';
  const { parts: sshExtra, identityPath } = buildSshExtra(env);
  const viteApiUrl = String(
    env.DEPLOY_MINI_APP_VITE_PUBLIC_API_URL != null
      ? env.DEPLOY_MINI_APP_VITE_PUBLIC_API_URL
      : env.VITE_PUBLIC_API_URL != null
        ? env.VITE_PUBLIC_API_URL
        : ''
  );

  if (!SERVER) {
    console.error(
      '\n[deploy:mini] DEPLOY_SERVER yo‘q. deploy/deploy.env yoki .env da DEPLOY_SERVER=user@host\n'
    );
    process.exit(1);
  }

  if (!which('ssh')) {
    console.error('[deploy:mini] ssh topilmadi.');
    process.exit(1);
  }
  const isWin = process.platform === 'win32';
  const useTar =
    String(
      env.DEPLOY_MINI_APP_USE_TAR != null
        ? env.DEPLOY_MINI_APP_USE_TAR
        : isWin
          ? '1'
          : '0'
    ) === '1';
  // Windows: rsync odatda osilib qoladi — default tar+scp. Linux/Mac: rsync.
  const hasRsync = which('rsync') && !useTar;
  const hasScp = which('scp');
  if (!hasRsync && !hasScp) {
    console.error('[deploy:mini] rsync ham scp ham topilmadi.');
    process.exit(1);
  }

  if (identityPath && !fs.existsSync(identityPath)) {
    console.error('[deploy:mini] SSH kalit fayli topilmadi:', identityPath);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(MINI_ROOT, 'package.json'))) {
    console.error('[deploy:mini] mini-app/ topilmadi');
    process.exit(1);
  }

  const rev = utcRev();
  const distPath = path.join(MINI_ROOT, 'dist');

  console.log('[deploy:mini] SERVER =', SERVER);
  console.log('[deploy:mini] REMOTE (web) =', REMOTE_PATH);
  console.log('[deploy:mini] RELEASES =', resolvedReleases, '/', rev);
  console.log('[deploy:mini] VITE_PUBLIC_API_URL =', JSON.stringify(viteApiUrl) || '"" (bir domen)');

  console.log('[deploy:mini] SSH tekshiruvi…');
  const ping = spawnSync('ssh', [...sshExtra, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SERVER, 'true'], {
    stdio: 'inherit',
  });
  if (ping.status !== 0) {
    console.error('[deploy:mini] SSH ulanmadi');
    process.exit(1);
  }

  if (!SKIP_BUILD) {
    console.log('[deploy:mini] mini-app: npm run build…');
    const buildEnv = { ...process.env, ...env, VITE_PUBLIC_API_URL: viteApiUrl };
    execSync('npm run build', { stdio: 'inherit', cwd: MINI_ROOT, env: buildEnv });
  } else {
    console.log('[deploy:mini] SKIP_BUILD=1');
  }

  if (!fs.existsSync(distPath)) {
    console.error('[deploy:mini] mini-app/dist/ yo‘q');
    process.exit(1);
  }

  const releaseDir = `${resolvedReleases}/${rev}`;

  const mk = spawnSync('ssh', [...sshExtra, SERVER, 'mkdir', '-p', releaseDir], {
    stdio: 'inherit',
    shell: false,
  });
  if (mk.status !== 0) {
    console.error('[deploy:mini] mkdir remote xato');
    process.exit(mk.status || 1);
  }

  const rsyncTarget = `${SERVER}:${releaseDir}/`;
  const srcDist = distPath + path.sep;
  let uploaded = false;
  if (hasRsync) {
    const sshCmd = ['ssh', ...sshExtra].join(' ');
    console.log('[deploy:mini] rsync…', rsyncTarget);
    const rs = spawnSync(
      'rsync',
      ['-az', '--delete', '--info=stats2', '-e', sshCmd, srcDist, rsyncTarget],
      { stdio: 'inherit', cwd: MINI_ROOT, shell: false }
    );
    uploaded = rs.status === 0;
    if (!uploaded) {
      console.warn('[deploy:mini] rsync muvaffaqiyatsiz, tar+scp…');
    }
  }
  if (!uploaded) {
    if (useTar) {
      console.log('[deploy:mini] tar+scp (USE_TAR)…', rsyncTarget);
    } else if (hasRsync) {
      console.log('[deploy:mini] tar+scp (rsync xato)…', rsyncTarget);
    } else {
      console.log('[deploy:mini] rsync topilmadi, tar+scp…', rsyncTarget);
    }
    const tmpTar = path.join(os.tmpdir(), `mini-dist-${Date.now()}.tar`);
    const remoteTar = `${releaseDir}/__dist.tar`;
    try {
      execSync(`tar -C "${distPath}" -cf "${tmpTar}" .`, {
        stdio: 'inherit',
        cwd: MINI_ROOT,
        shell: true,
      });
      const sc = spawnSync('scp', [...sshExtra, tmpTar, `${SERVER}:${remoteTar}`], {
        stdio: 'inherit',
        cwd: MINI_ROOT,
        shell: false,
      });
      if (sc.status !== 0) {
        throw new Error('scp failed');
      }
      const ex = spawnSync(
        'ssh',
        [
          ...sshExtra,
          SERVER,
          `tar -xf "${remoteTar}" -C "${releaseDir}" && rm -f "${remoteTar}"`,
        ],
        { stdio: 'inherit', cwd: MINI_ROOT, shell: false }
      );
      if (ex.status !== 0) {
        throw new Error('remote extract failed');
      }
    } catch (e) {
      console.error('[deploy:mini] tar|ssh xato', e);
      process.exit(1);
    } finally {
      try {
        fs.rmSync(tmpTar, { force: true });
      } catch {
        // ignore
      }
    }
  }

  console.log('[deploy:mini] symlink + nginx…');
  const remote = spawnSync(
    'ssh',
    [
      ...sshExtra,
      SERVER,
      'bash',
      '-s',
      '--',
      REMOTE_PATH,
      resolvedReleases,
      rev,
      NO_RESTART_NGINX ? '1' : '0',
    ],
    { input: REMOTE_BODY, stdio: ['pipe', 'inherit', 'inherit'], cwd: ROOT, encoding: 'utf8' }
  );
  if (remote.status !== 0) {
    console.error('[deploy:mini] remote bash xato');
    process.exit(remote.status || 1);
  }

  const publicUrl = String(
    env.TELEGRAM_WEB_APP_URL || env.VITE_APP_PUBLIC_URL || 'https://app.dunyozamin.com'
  ).replace(/\/$/, '');
  console.log('[deploy:mini] Web App URL:', publicUrl);

  console.log('\n[deploy:mini] Tayyor. Rev:', rev);
}

main();
