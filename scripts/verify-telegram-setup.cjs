/**
 * Telegram bot token va Web App URL ni tekshiradi (getMe).
 * Run: npm run telegram:verify
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const localPath = path.join(root, '.env.local');

function loadEnv() {
  const dotenv = require('dotenv');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });
  if (fs.existsSync(localPath)) dotenv.config({ path: localPath, override: true });
}

loadEnv();

for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEB_APP_URL', 'VITE_APP_PUBLIC_URL']) {
  if (process.env[k]) process.env[k] = String(process.env[k]).trim();
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const web =
  process.env.TELEGRAM_WEB_APP_URL ||
  process.env.VITE_APP_PUBLIC_URL ||
  '';

let exit = 0;
if (!token) {
  console.error('[verify] TELEGRAM_BOT_TOKEN yo‘q (.env)');
  exit = 1;
}
if (!web.startsWith('https://')) {
  console.error('[verify] TELEGRAM_WEB_APP_URL yoki VITE_APP_PUBLIC_URL — HTTPS kerak (masalan https://app.example.com)');
  exit = 1;
}
if (exit) process.exit(exit);

(async () => {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const j = await res.json();
  if (!j.ok) {
    console.error('[verify] getMe:', j.description || j);
    process.exit(1);
  }
  console.log('[verify] Bot OK:', '@' + j.result.username);
  console.log('[verify] Web App URL (kutilayotgan):', web);
  console.log('[verify] BotFather → Menu Button / Web App URL shu manzil bilan mos bo‘lsin.');
})().catch((e) => {
  console.error('[verify]', e.message);
  process.exit(1);
});
