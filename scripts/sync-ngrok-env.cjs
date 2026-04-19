/**
 * ngrok ishlayotganda: http://127.0.0.1:4040/api/tunnels dan URL larni o‘qib .env ga yozadi.
 * Ishlatish: npm run ngrok:sync-env  (avval ngrok:both ochiq bo‘lsin)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function addrPort(addr) {
  if (!addr) return null;
  const s = String(addr);
  const m = s.match(/:(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

async function main() {
  let data;
  try {
    data = await fetchJson('http://127.0.0.1:4040/api/tunnels');
  } catch (e) {
    console.error('[ngrok:sync-env] 4040 ga ulanmadi. Avval `npm run ngrok:both` ishga tushiring.');
    process.exit(1);
  }

  const tunnels = data.tunnels || [];
  let rpcUrl = '';
  let appUrl = '';

  for (const t of tunnels) {
    const pub = t.public_url;
    if (!pub || !String(pub).startsWith('https://')) continue;
    const clean = String(pub).trim().replace(/\/+$/, '');
    const port = addrPort(t.config?.addr);
    const nm = String(t.name || '');
    if (nm === 'pos-rpc' || port === 3333) rpcUrl = clean;
    if (nm === 'pos-web' || port === 4173) appUrl = clean;
  }

  if (!rpcUrl || !appUrl) {
    console.error('[ngrok:sync-env] 3333 yoki 4173 tunnel topilmadi. Tunnels:', tunnels.length);
    console.error(JSON.stringify(tunnels.map((t) => ({ addr: t.config?.addr, url: t.public_url })), null, 2));
    process.exit(1);
  }

  if (!fs.existsSync(envPath)) {
    console.error('[ngrok:sync-env] .env yoq:', envPath);
    process.exit(1);
  }

  let text = fs.readFileSync(envPath, 'utf8');
  const setLine = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  };

  setLine('VITE_POS_RPC_URL', String(rpcUrl).trim());
  setLine('VITE_APP_PUBLIC_URL', String(appUrl).trim());
  fs.writeFileSync(envPath, text, 'utf8');
  console.log('[ngrok:sync-env] yangilandi:');
  console.log('  VITE_POS_RPC_URL=', rpcUrl);
  console.log('  VITE_APP_PUBLIC_URL=', appUrl);
  if (rpcUrl === appUrl) {
    console.warn(
      '[ngrok:sync-env] Ogohlantirish: ikkala URL bir xil. RPC va veb bir xil domen bo‘lmasligi kerak — ngrok-pos-tunnels.yml da pos-rpc uchun hostname qo‘ymang.',
    );
  }
  console.log('Keyin: npm run build');
}

main();
