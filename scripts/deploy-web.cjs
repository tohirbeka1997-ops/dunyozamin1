/**
 * Web deploy: build + rsync + server symlink (frontend-build-and-publish.sh bilan bir xil).
 * Ishlatish: npm run deploy:web
 *
 * Telegram Mini App alohida: `npm run deploy:mini-app` (Nginx: /opt/pos/mini-app/dist).
 *
 * O'qiladi: deploy/deploy.env, keyin .env, keyin process.env
 * Kerak: DEPLOY_SERVER | SERVER, VITE_POS_RPC_URL + VITE_POS_RPC_SECRET (yoki DEPLOY_*)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
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

/** Windows: %USERPROFILE%, PowerShell $env:USERPROFILE, ~ */
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
  // deploy-server bilan bir xil: passphrase/agent blokidan qochish, tez timeout
  parts.push('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new');
  return { parts, identityPath: id || null };
}

function utcRev() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(
    d.getUTCMinutes()
  )}${p(d.getUTCSeconds())}Z`;
}

function normalizeWebIndex() {
  const indexPath = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(indexPath)) return;
  const before = fs.readFileSync(indexPath, 'utf8');
  let html = before;
  // Electron builds use relative assets for file://. Web deploys must use root
  // assets so direct route refreshes like /product/:id do not request
  // /product/assets/*.js and receive index.html as text/html.
  html = html.replace(/(src|href)="\.\/assets\//g, '$1="/assets/');
  html = html.replace(/href="\.\/favicon\.png"/g, 'href="/favicon.png"');
  html = html.replace(/(src|href)="\.\/images\//g, '$1="/images/');
  if (html !== before) {
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('[deploy] web index asset paths normalized to /assets/ for browser deep links');
  }
}

/** bash -s uchun stdin ($1..$4 — JS template emas, oddiy qatorlar) */
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
  '  echo "[remote] $WEB_ROOT oddiy katalog; zaxira: $BAKUP"',
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
  'echo "[remote] aktiv: $NEW"',
  '',
  'if [[ "$NO_RESTART_NGINX" != "1" ]]; then',
  '  if command -v systemctl >/dev/null 2>&1; then',
  "    sudo -n systemctl reload nginx 2>/dev/null || systemctl reload nginx 2>/dev/null || echo '[remote] nginx reload'",
  '  fi',
  'fi',
].join('\n');

function main() {
  const env = mergeEnv();
  const SERVER = env.DEPLOY_SERVER || env.SERVER;
  const API_URL = String(
    env.DEPLOY_API_URL || env.API_URL || env.VITE_POS_RPC_URL || ''
  ).replace(/\/$/, '');
  const API_SECRET =
    env.DEPLOY_API_SECRET || env.API_SECRET || env.VITE_POS_RPC_SECRET || '';
  const REMOTE_PATH = (env.REMOTE_PATH || '/var/www/pos').replace(/\/+$/, '') || '/var/www/pos';
  const SKIP_BUILD = String(env.SKIP_BUILD || '0') === '1';
  const NO_RESTART_NGINX = String(env.NO_RESTART_NGINX || '0') === '1';
  const { parts: sshExtra, identityPath } = buildSshExtra(env);

  if (!SERVER) {
    console.error(
      '\n[deploy] DEPLOY_SERVER yo‘q. deploy/deploy.env (example dan) yoki .env da DEPLOY_SERVER=user@host\n'
    );
    process.exit(1);
  }
  if (!API_URL || !API_SECRET) {
    console.error(
      '\n[deploy] VITE_POS_RPC_URL va VITE_POS_RPC_SECRET .env da bo‘lishi kerak (yoki deploy/deploy.env)\n'
    );
    process.exit(1);
  }

  if (!which('ssh')) {
    console.error('[deploy] ssh topilmadi.');
    process.exit(1);
  }
  const hasRsync = which('rsync');
  const hasScp = which('scp');
  if (!hasRsync && !hasScp) {
    console.error('[deploy] rsync ham scp ham topilmadi.');
    process.exit(1);
  }

  if (identityPath && !fs.existsSync(identityPath)) {
    console.error('[deploy] SSH kalit fayli topilmadi:', identityPath);
    process.exit(1);
  }

  const remoteReleases = path.posix.normalize(path.posix.join(REMOTE_PATH, '..', 'pos-releases'));
  const rev = utcRev();

  console.log('[deploy] SERVER =', SERVER);
  console.log('[deploy] REMOTE_PATH =', REMOTE_PATH);
  console.log('[deploy] pos-releases =', remoteReleases, '/', rev);
  console.log('[deploy] API_URL =', API_URL);

  console.log('[deploy] SSH tekshiruvi…');
  const ping = spawnSync('ssh', [...sshExtra, SERVER, 'true'], {
    stdio: 'inherit',
  });
  if (ping.status !== 0) {
    console.error('[deploy] SSH ulanmadi');
    process.exit(1);
  }

  const tmpEnv = path.join(ROOT, '.env.production.local');
  let backup = null;
  if (!SKIP_BUILD) {
    if (fs.existsSync(tmpEnv)) {
      backup = `${tmpEnv}.bak.${process.pid}`;
      fs.copyFileSync(tmpEnv, backup);
    }
    fs.writeFileSync(
      tmpEnv,
      `VITE_POS_RPC_URL=${API_URL}\nVITE_POS_RPC_SECRET=${API_SECRET}\n`,
      'utf8'
    );
    try {
      console.log('[deploy] npm run build…');
      execSync('npm run build', { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
    } finally {
      fs.rmSync(tmpEnv, { force: true });
      if (backup && fs.existsSync(backup)) fs.renameSync(backup, tmpEnv);
    }
  } else {
    console.log('[deploy] SKIP_BUILD=1');
  }

  if (!fs.existsSync(path.join(ROOT, 'dist'))) {
    console.error('[deploy] dist/ yo‘q');
    process.exit(1);
  }
  normalizeWebIndex();

  const releaseDir = `${remoteReleases}/${rev}`;
  const mk = spawnSync('ssh', [...sshExtra, SERVER, 'mkdir', '-p', releaseDir], {
    stdio: 'inherit',
    shell: false,
  });
  if (mk.status !== 0) {
    console.error('[deploy] mkdir remote xato');
    process.exit(mk.status || 1);
  }

  const rsyncTarget = `${SERVER}:${releaseDir}/`;
  const srcDist = path.join(ROOT, 'dist') + '/';
  if (hasRsync) {
    const sshCmd = ['ssh', ...sshExtra].join(' ');
    console.log('[deploy] rsync…', rsyncTarget);
    const rs = spawnSync(
      'rsync',
      ['-az', '--delete', '--info=stats2', '-e', sshCmd, srcDist, rsyncTarget],
      { stdio: 'inherit', cwd: ROOT, shell: false }
    );
    if (rs.status !== 0) {
      console.error('[deploy] rsync xato');
      process.exit(rs.status || 1);
    }
  } else {
    console.log('[deploy] rsync topilmadi, tar+scp fallback…', rsyncTarget);
    // Robust fallback:
    //  1) dist ichini tar qilamiz
    //  2) tar faylni scp bilan release ichiga yuboramiz
    //  3) serverda extract qilamiz (release root)
    // Bu usulda `dist/dist` nested muammosi bo'lmaydi va -i yo'lida bo'shliq ham ishlaydi.
    const tmpTar = path.join(os.tmpdir(), `pos-dist-${Date.now()}.tar`);
    const remoteTar = `${releaseDir}/__dist.tar`;
    try {
      execSync(`tar -C "${path.join(ROOT, 'dist')}" -cf "${tmpTar}" .`, {
        stdio: 'inherit',
        cwd: ROOT,
        shell: true,
      });

      const sc = spawnSync('scp', [...sshExtra, tmpTar, `${SERVER}:${remoteTar}`], {
        stdio: 'inherit',
        cwd: ROOT,
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
        { stdio: 'inherit', cwd: ROOT, shell: false }
      );
      if (ex.status !== 0) {
        throw new Error('remote extract failed');
      }
    } catch (e) {
      console.error('[deploy] tar|ssh fallback xato');
      process.exit(1);
    } finally {
      try { fs.rmSync(tmpTar, { force: true }); } catch { /* ignore */ }
    }
  }

  console.log('[deploy] symlink + nginx…');
  const remote = spawnSync(
    'ssh',
    [...sshExtra, SERVER, 'bash', '-s', '--', REMOTE_PATH, remoteReleases, rev, NO_RESTART_NGINX ? '1' : '0'],
    { input: REMOTE_BODY, stdio: ['pipe', 'inherit', 'inherit'], cwd: ROOT, encoding: 'utf8' }
  );
  if (remote.status !== 0) {
    console.error('[deploy] remote bash xato');
    process.exit(remote.status || 1);
  }

  const healthUrl = `${API_URL}/health`;
  console.log('[deploy] Health:', healthUrl);
  const curl = spawnSync('curl', ['-sk', '--max-time', '8', healthUrl], { encoding: 'utf8' });
  if (curl.stdout && curl.stdout.includes('"ok"')) console.log('[deploy] Health OK');
  else console.warn('[deploy] Health javob shubhali');

  console.log('\n[deploy] Tayyor. Rev:', rev);
}

main();
