/**
 * Bitta ngrok jarayonida pos-rpc (3333) + pos-web (4173).
 * Windows: kengaytmasiz npm shim ni spawn qilmaslik — faqat .exe yoki .cmd + bat.
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const projectCfg = path.join(__dirname, 'ngrok-pos-tunnels.yml');

let defaultCfg = '';
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  defaultCfg = path.join(process.env.LOCALAPPDATA, 'ngrok', 'ngrok.yml');
} else if (process.platform === 'darwin') {
  defaultCfg = path.join(os.homedir(), 'Library', 'Application Support', 'ngrok', 'ngrok.yml');
} else {
  defaultCfg = path.join(os.homedir(), '.config', 'ngrok', 'ngrok.yml');
}

const ngrokArgs = ['start', 'pos-rpc', 'pos-web'];
if (fs.existsSync(defaultCfg)) {
  ngrokArgs.push('--config', defaultCfg);
} else {
  console.warn('[ngrok:both] Standart ngrok.yml topilmadi:', defaultCfg);
  console.warn('  Avval: ngrok config add-authtoken ...');
}
ngrokArgs.push('--config', projectCfg);

const isWin = process.platform === 'win32' || /^win/i.test(process.env.OS || '');

/** @returns {string[]} */
function whereNgrokLines() {
  try {
    const out = execFileSync('where.exe', ['ngrok'], { encoding: 'utf8', windowsHide: true });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Windows: .cmd yoki .exe — kengaytmasiz shim emas */
function resolveNgrokBinaryWin() {
  const pf = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ngrok', 'ngrok.exe');
  if (fs.existsSync(pf)) return pf;
  const pf86 = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'ngrok', 'ngrok.exe');
  if (fs.existsSync(pf86)) return pf86;
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ngrok', 'ngrok.exe');
  if (fs.existsSync(local)) return local;

  const lines = whereNgrokLines();
  const cmd = lines.find((l) => /\.cmd$/i.test(l));
  if (cmd && fs.existsSync(cmd)) return cmd;
  const exe = lines.find((l) => /\.exe$/i.test(l));
  if (exe && fs.existsSync(exe)) return exe;
  return null;
}

function escapeBatchQuotes(s) {
  return String(s).replace(/"/g, '""');
}

function runWin() {
  const bin = resolveNgrokBinaryWin();
  if (!bin) {
    console.error('[ngrok:both] ngrok topilmadi. winget install ngrok.ngrok');
    process.exit(1);
  }

  if (/\.cmd$/i.test(bin)) {
    const batPath = path.join(__dirname, '_run_ngrok_both.bat');
    const line = `call "${escapeBatchQuotes(bin)}" ${ngrokArgs.map((a) => `"${escapeBatchQuotes(a)}"`).join(' ')}`;
    fs.writeFileSync(batPath, [`@echo off`, line, ''].join('\r\n'), 'utf8');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', batPath], {
      stdio: 'inherit',
      windowsHide: true,
      cwd: path.join(__dirname, '..'),
    });
  }

  return spawn(bin, ngrokArgs, {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    cwd: path.join(__dirname, '..'),
  });
}

function attachHandlers(child) {
  child.on('error', (err) => {
    console.error('[ngrok:both]', err.message);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

let child;
if (isWin) {
  child = runWin();
} else {
  child = spawn('ngrok', ngrokArgs, {
    stdio: 'inherit',
    shell: false,
    cwd: path.join(__dirname, '..'),
  });
}

attachHandlers(child);
