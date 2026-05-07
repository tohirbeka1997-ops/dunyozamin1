/**
 * Serverda /opt/pos/.env: yaroqsiz "n#" qatorini olib tashlash, JWT_SECRET bo‘lmasa qo‘shish.
 * Remote: scp + `node /tmp/fix-server-public-api-env.cjs` yoki `ENV_FILE=... node ...`
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const p = process.env.ENV_FILE || '/opt/pos/.env';
let lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
lines = lines.filter((L) => L.trim() !== 'n#');
let text = lines.join('\n');
if (!text.endsWith('\n')) text += '\n';
if (!/^\s*JWT_SECRET=/m.test(text)) {
  const sec = crypto.randomBytes(32).toString('hex');
  text += '\n# public-api JWT (fix-server-public-api-env)\n';
  text += `JWT_SECRET=${sec}\n`;
  console.log('JWT_SECRET qo‘shildi, uzunlik:', sec.length);
} else {
  console.log('JWT_SECRET allaqachon bor, faqat tozalash.');
}
fs.writeFileSync(p, text, 'utf8');
