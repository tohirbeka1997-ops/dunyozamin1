/**
 * Loads repo-root `.env` then `.env.local` (override) into `process.env`.
 * Used by Electron main and `telegram/bot.cjs` so one file drives HOST + Vite build vars + bot.
 */
const fs = require('fs');
const path = require('path');

function loadRootEnv() {
  try {
    const dotenv = require('dotenv');
    const root = path.join(__dirname, '..', '..');
    const envPath = path.join(root, '.env');
    const localPath = path.join(root, '.env.local');
    // override: true — PowerShell / npm bo'sh TELEGRAM_* yoki VITE_* qo'ygan bo'lsa ham .env ustidan yozadi
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });
    if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
  } catch {
    // dotenv missing or unreadable — ignore
  }
}

module.exports = { loadRootEnv };
