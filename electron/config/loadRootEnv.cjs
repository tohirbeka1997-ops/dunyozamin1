/**

 * Loads repo-root `.env` then `.env.local` (override) into `process.env`.

 * Used by Electron main, public-api, and bots so one file drives HOST + Vite + TELEGRAM_* + OPENAI_*.

 *

 * Searches several roots so packaged / cwd / POS_ENV_DIR layouts still find the file.

 */

const fs = require('fs');

const path = require('path');



function uniquePaths(list) {

  const seen = new Set();

  const out = [];

  for (const p of list) {

    if (!p) continue;

    let resolved;

    try {

      resolved = path.resolve(String(p));

    } catch {

      continue;

    }

    if (seen.has(resolved)) continue;

    seen.add(resolved);

    out.push(resolved);

  }

  return out;

}



function candidateEnvRoots() {

  const roots = [];

  // electron/config → repo / app root

  roots.push(path.join(__dirname, '..', '..'));

  try {

    if (process.cwd()) roots.push(process.cwd());

  } catch {

    // ignore

  }

  try {

    if (process.execPath) roots.push(path.dirname(process.execPath));

  } catch {

    // ignore

  }

  if (process.resourcesPath) {

    roots.push(process.resourcesPath);

    roots.push(path.join(process.resourcesPath, '..'));

  }

  const envDir = String(process.env.POS_ENV_DIR || process.env.ENV_DIR || '').trim();

  if (envDir) roots.push(envDir);

  const envFile = String(process.env.POS_ENV_FILE || process.env.DOTENV_CONFIG_PATH || '').trim();

  if (envFile) roots.push(path.dirname(path.resolve(envFile)));

  return uniquePaths(roots);

}



/**

 * @returns {{ loaded: string[], rootsChecked: string[] }}

 */

function loadRootEnv() {

  const loaded = [];

  const rootsChecked = candidateEnvRoots();

  try {

    const dotenv = require('dotenv');

    const envFileOverride = String(process.env.POS_ENV_FILE || process.env.DOTENV_CONFIG_PATH || '').trim();

    if (envFileOverride && fs.existsSync(envFileOverride)) {

      dotenv.config({ path: envFileOverride, override: true });

      loaded.push(envFileOverride);

    }

    for (const root of rootsChecked) {

      const envPath = path.join(root, '.env');

      const localPath = path.join(root, '.env.local');

      // override: true — PowerShell / npm empty TELEGRAM_* / OPENAI_* / VITE_* still lose to .env

      if (fs.existsSync(envPath)) {

        dotenv.config({ path: envPath, override: true });

        loaded.push(envPath);

      }

      if (fs.existsSync(localPath)) {

        dotenv.config({ path: localPath, override: true });

        loaded.push(localPath);

      }

    }

  } catch {

    // dotenv missing or unreadable — ignore

  }

  return { loaded, rootsChecked };

}



module.exports = { loadRootEnv, candidateEnvRoots };


