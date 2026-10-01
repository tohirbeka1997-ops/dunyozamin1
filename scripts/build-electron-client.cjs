/**
 * Build a Windows Electron installer provisioned for the production POS RPC.
 *
 * Credentials are read from ignored env files and written into the packaged
 * app only for the duration of electron-builder. They are never committed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GENERATED_CONFIG = path.join(ROOT, 'electron', 'config', 'client.defaults.json');
const BUILDER_OVERRIDE = path.join(ROOT, 'electron-builder.client.json');
const OUTPUT_DIR = String(process.env.POS_CLIENT_OUTPUT_DIR || 'release-client').trim();

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...parseEnvFile(path.join(ROOT, '.env')),
  ...parseEnvFile(path.join(ROOT, 'deploy', 'deploy.env')),
  ...process.env,
};

const hostUrl = String(
  env.POS_CLIENT_HOST_URL ||
    env.DEPLOY_API_URL ||
    env.VITE_POS_RPC_URL ||
    '',
)
  .trim()
  .replace(/\/+$/, '');
const secret = String(
  env.POS_CLIENT_BOOTSTRAP_SECRET ||
    env.DEPLOY_API_SECRET ||
    env.VITE_POS_RPC_SECRET ||
    env.POS_HOST_SECRET ||
    '',
).trim();

if (!/^https:\/\//i.test(hostUrl)) {
  console.error(
    '[electron-client] HTTPS server URL required. Set POS_CLIENT_HOST_URL or DEPLOY_API_URL.',
  );
  process.exit(1);
}
if (secret.length < 16) {
  console.error(
    '[electron-client] Server credential missing/too short. Set POS_CLIENT_BOOTSTRAP_SECRET or DEPLOY_API_SECRET.',
  );
  process.exit(1);
}

const config = {
  mode: 'client',
  client: { hostUrl, secret },
};

fs.writeFileSync(GENERATED_CONFIG, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
// The defaults file is gitignored, so electron-builder's file set skips it.
// extraResources copies it next to the app, where appConfig already looks.
// The override repeats package.json "build" so packaging stays complete if
// --config replaces rather than merges.
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const builderConfig = {
  ...(packageJson.build || {}),
  extraResources: [
    ...((packageJson.build && packageJson.build.extraResources) || []),
    { from: 'electron/config/client.defaults.json', to: 'client.defaults.json' },
  ],
};
fs.writeFileSync(BUILDER_OVERRIDE, `${JSON.stringify(builderConfig, null, 2)}\n`);

console.log(`[electron-client] Provisioning remote server: ${hostUrl}`);
console.log('[electron-client] Building Windows x64 installer...');

try {
  const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');
  const result = spawnSync(
    process.execPath,
    [
      electronBuilderCli,
      '--win',
      '--x64',
      '--config',
      BUILDER_OVERRIDE,
      `--config.directories.output=${OUTPUT_DIR}`,
    ],
    {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
} finally {
  for (const filePath of [GENERATED_CONFIG, BUILDER_OVERRIDE]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best effort: avoid leaving credentials or the temporary builder config on disk.
    }
  }
}
