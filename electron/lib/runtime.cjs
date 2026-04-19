/**
 * Runtime Shim — Electron yoki Node.js server rejimi uchun universal abstraksiya.
 *
 * Maqsadi: `dbPath.cjs`, `appConfig.cjs`, `backupManager.cjs` va boshqa modullar
 * `require('electron')` ga to'g'ridan-to'g'ri bog'lanmasligi kerak. Shunday qilib,
 * shu loyiha Hetzner (yoki har qanday Linux VPS) da Electron'siz Node.js jarayoni
 * sifatida ham ishlashi mumkin.
 *
 * Rejimlar:
 *   POS_SERVER_MODE=1                → Server (Node.js only, Electron yo'q)
 *   default                          → Electron (app.getPath('userData'))
 *
 * Server rejimida ma'lumotlar katalogi:
 *   POS_DATA_DIR=/var/lib/pos        → aniq yo'l
 *   default                          → os.homedir() + '/.pos-data'
 *
 * E'tibor: bu modul `require('electron')` ni FAQAT Electron rejimida va
 * lazy-load orqali chaqiradi, shuning uchun server rejimida Electron
 * mavjud bo'lmasa ham xatolik bermaydi.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER_MODE_FLAG =
  process.env.POS_SERVER_MODE === '1' ||
  process.env.POS_SERVER_MODE === 'true' ||
  !!process.env.POS_SERVER_MODE_FORCED;

function isServerMode() {
  return SERVER_MODE_FLAG;
}

let cachedUserData = null;

function resolveServerUserDataDir() {
  const envDir = process.env.POS_DATA_DIR;
  if (envDir && String(envDir).trim()) {
    return path.resolve(String(envDir).trim());
  }
  return path.join(os.homedir(), '.pos-data');
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (_e) {
    // ignore (caller will get a clear error on actual write)
  }
}

/**
 * Electron yoki server rejimida ishlaydigan universal `appLike` object qaytaradi.
 * API: `getPath(name)` — hozircha faqat `'userData'` qo'llab-quvvatlanadi.
 *
 * @param {object|null} electronAppOverride — tashqaridan berilgan Electron app (optional)
 */
function getAppLike(electronAppOverride = null) {
  if (isServerMode()) {
    if (!cachedUserData) {
      cachedUserData = resolveServerUserDataDir();
      ensureDir(cachedUserData);
    }
    return {
      getPath(name) {
        if (name === 'userData' || name === 'appData' || name === 'home') {
          return cachedUserData;
        }
        if (name === 'logs') {
          const logsDir = path.join(cachedUserData, 'logs');
          ensureDir(logsDir);
          return logsDir;
        }
        if (name === 'temp') {
          return os.tmpdir();
        }
        throw new Error(`[runtime] getPath('${name}') is not supported in server mode`);
      },
      isPackaged: true,
      __serverShim: true,
    };
  }

  if (electronAppOverride && typeof electronAppOverride.getPath === 'function') {
    return electronAppOverride;
  }

  let electron;
  try {
    electron = require('electron');
  } catch (_e) {
    throw new Error(
      '[runtime] Electron is not available and POS_SERVER_MODE is not set. ' +
      'Set POS_SERVER_MODE=1 to run in Node.js-only server mode.'
    );
  }
  if (!electron || !electron.app) {
    throw new Error('[runtime] require("electron").app is unavailable');
  }
  return electron.app;
}

/**
 * Joriy rejim uchun userData direktoriyasini qaytaradi.
 */
function getUserDataDir(electronAppOverride = null) {
  return getAppLike(electronAppOverride).getPath('userData');
}

module.exports = {
  isServerMode,
  getAppLike,
  getUserDataDir,
};
