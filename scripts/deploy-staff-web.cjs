/**
 * Staff POS web deploy: sales-mobile/dist → server (public-api STAFF_WEB_DIR).
 * Ishlatish: npm run deploy:staff
 *
 * O'qiladi: deploy/deploy.env, .env, process.env
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAFF_ROOT = path.join(ROOT, 'sales-mobile');
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
  if (id) parts.push('-i', id);
  const opts = String(env.SSH_OPTS || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  parts.push(...opts);
  return { parts, identityPath: id || null };
}

function utcRev() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(
    d.getUTCMinutes(),
  )}${p(d.getUTCSeconds())}Z`;
}

const REMOTE_BODY = [
  'set -Eeuo pipefail',
  'WEB_ROOT="$1"',
  'RELEASES="$2"',
  'REV="$3"',
  'RESTART_PUBLIC_API="$4"',
  '',
  'NEW="$RELEASES/$REV"',
  '',
  'if [[ -d "$WEB_ROOT" && ! -L "$WEB_ROOT" ]]; then',
  '  BAKUP="${WEB_ROOT}.initial.$(date +%s)"',
  '  echo "[deploy:staff] $WEB_ROOT oddiy katalog; zaxira: $BAKUP"',
  '  mv "$WEB_ROOT" "$BAKUP" || true',
  'fi',
  '',
  'mkdir -p "$RELEASES"',
  'ln -sfn "$NEW" "${WEB_ROOT}.tmp"',
  'mv -T "${WEB_ROOT}.tmp" "$WEB_ROOT"',
  '',
  'ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf',
  'echo "[deploy:staff] aktiv: $NEW"',
  '',
  'if [[ "$RESTART_PUBLIC_API" = "1" ]]; then',
  '  if command -v systemctl >/dev/null 2>&1; then',
  "    sudo -n systemctl restart public-api 2>/dev/null || systemctl restart public-api 2>/dev/null || echo '[deploy:staff] public-api restart skipped'",
  '  fi',
  'fi',
].join('\n');

function main() {
  const env = mergeEnv();
  const SERVER = env.DEPLOY_SERVER || env.SERVER;
  const REMOTE_PATH = (
    env.STAFF_WEB_REMOTE_PATH ||
    env.DEPLOY_STAFF_WEB_PATH ||
    '/opt/pos/sales-mobile/dist'
  ).replace(/\/+$/, '');
  const resolvedReleases = (env.STAFF_WEB_RELEASES_DIR || '/opt/pos/sales-mobile-releases').replace(
    /\/+$/,
    '',
  );
  const SKIP_BUILD = String(env.SKIP_BUILD || '0') === '1';
  const NO_RESTART = String(env.NO_RESTART_PUBLIC_API || '0') === '1';
  const { parts: sshExtra, identityPath } = buildSshExtra(env);

  if (!SERVER) {
    console.error('\n[deploy:staff] DEPLOY_SERVER yo‘q. deploy/deploy.env yoki .env da DEPLOY_SERVER=user@host\n');
    process.exit(1);
  }

  if (!which('ssh')) {
    console.error('[deploy:staff] ssh topilmadi.');
    process.exit(1);
  }

  const isWin = process.platform === 'win32';
  const useTar =
    String(env.DEPLOY_STAFF_USE_TAR != null ? env.DEPLOY_STAFF_USE_TAR : isWin ? '1' : '0') === '1';
  const hasRsync = which('rsync') && !useTar;
  const hasScp = which('scp');
  if (!hasRsync && !hasScp) {
    console.error('[deploy:staff] rsync ham scp ham topilmadi.');
    process.exit(1);
  }

  if (identityPath && !fs.existsSync(identityPath)) {
    console.error('[deploy:staff] SSH kalit fayli topilmadi:', identityPath);
    process.exit(1);
  }

  const distPath = path.join(STAFF_ROOT, 'dist');
  const rev = utcRev();
  const releaseDir = `${resolvedReleases}/${rev}`;

  console.log('[deploy:staff] SERVER =', SERVER);
  console.log('[deploy:staff] REMOTE (web) =', REMOTE_PATH);
  console.log('[deploy:staff] RELEASES =', resolvedReleases, '/', rev);

  const ping = spawnSync(
    'ssh',
    [...sshExtra, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SERVER, 'true'],
    { stdio: 'inherit' },
  );
  if (ping.status !== 0) {
    console.error('[deploy:staff] SSH ulanmadi');
    process.exit(1);
  }

  if (!SKIP_BUILD) {
    console.log('[deploy:staff] build-staff-web…');
    execSync('node scripts/build-staff-web.cjs', { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  } else {
    console.log('[deploy:staff] SKIP_BUILD=1');
  }

  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    console.error('[deploy:staff] sales-mobile/dist/index.html yo‘q — avval npm run sales-mobile:export-web');
    process.exit(1);
  }

  const mk = spawnSync('ssh', [...sshExtra, SERVER, 'mkdir', '-p', releaseDir], { stdio: 'inherit' });
  if (mk.status !== 0) process.exit(mk.status || 1);

  const rsyncTarget = `${SERVER}:${releaseDir}/`;
  const srcDist = distPath + path.sep;
  let uploaded = false;

  if (hasRsync) {
    const sshCmd = ['ssh', ...sshExtra].join(' ');
    console.log('[deploy:staff] rsync…', rsyncTarget);
    const rs = spawnSync(
      'rsync',
      ['-az', '--delete', '--info=stats2', '-e', sshCmd, srcDist, rsyncTarget],
      { stdio: 'inherit', cwd: STAFF_ROOT },
    );
    uploaded = rs.status === 0;
    if (!uploaded) console.warn('[deploy:staff] rsync muvaffaqiyatsiz, tar+scp…');
  }

  if (!uploaded) {
    const tmpTar = path.join(os.tmpdir(), `staff-dist-${Date.now()}.tar`);
    const remoteTar = `${releaseDir}/__dist.tar`;
    try {
      execSync(`tar -C "${distPath}" -cf "${tmpTar}" .`, { stdio: 'inherit', shell: true });
      const sc = spawnSync('scp', [...sshExtra, tmpTar, `${SERVER}:${remoteTar}`], { stdio: 'inherit' });
      if (sc.status !== 0) throw new Error('scp failed');
      const ex = spawnSync(
        'ssh',
        [...sshExtra, SERVER, `tar -xf "${remoteTar}" -C "${releaseDir}" && rm -f "${remoteTar}"`],
        { stdio: 'inherit' },
      );
      if (ex.status !== 0) throw new Error('remote extract failed');
    } catch (e) {
      console.error('[deploy:staff] tar|ssh xato', e);
      process.exit(1);
    } finally {
      try {
        fs.rmSync(tmpTar, { force: true });
      } catch {
        // ignore
      }
    }
  }

  console.log('[deploy:staff] symlink + public-api restart…');
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
      NO_RESTART ? '0' : '1',
    ],
    { input: REMOTE_BODY, stdio: ['pipe', 'inherit', 'inherit'], encoding: 'utf8' },
  );
  if (remote.status !== 0) process.exit(remote.status || 1);

  const staffUrl = String(env.STAFF_WEB_APP_URL || 'https://staff.example.com/').replace(/\/$/, '');
  console.log('\n[deploy:staff] Tayyor. Rev:', rev);
  console.log('[deploy:staff] STAFF_WEB_APP_URL tekshiring:', staffUrl);
  console.log('[deploy:staff] BotFather Web App URL ham shu manzil bo‘lishi kerak.');
}

main();
