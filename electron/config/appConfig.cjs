const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getAppLike } = require('../lib/runtime.cjs');

const CONFIG_FILENAME = 'pos-config.json';

function resolveApp(override) {
  return getAppLike(override || null);
}

function getConfigPath(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const userData = appInstance.getPath('userData');
  return path.join(userData, CONFIG_FILENAME);
}

function defaultConfig() {
  return {
    device_id: randomUUID(),
    // 'host' | 'client'
    mode: 'host',
    host: {
      bind: '0.0.0.0',
      port: 3333,
      // Shared secret used by clients to call host RPC (Bearer token)
      secret: randomUUID(),
      // Optional CORS allowlist for browser / Telegram WebView fetch to POST /rpc.
      // Empty array = allow any origin (`*`). Example: ["https://your-domain.com"]
      corsOrigins: [],
    },
    client: {
      // Example: http://192.168.1.10:3333
      hostUrl: '',
      secret: '',
    },
    printer: {
      type: 'epson',
      interface: 'usb',
      timeoutMs: 15000,
      charsPerLine: 48,
      textSize: { width: 0, height: 0 },
      usbVendorId: null,
      usbProductId: null,
      spoolerName: 'XP-80C',
      preferSpooler: true,
      feedLines: 3,
      cut: true,
      retryCount: 2,
    },
  };
}

function readConfig(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const cfgPath = getConfigPath(appInstance);

  try {
    if (!fs.existsSync(cfgPath)) {
      const cfg = defaultConfig();
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
      return cfg;
    }

    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    const defaults = defaultConfig();
    const merged = {
      ...defaults,
      ...parsed,
      host: { ...defaults.host, ...(parsed.host || {}) },
      client: { ...defaults.client, ...(parsed.client || {}) },
      printer: { ...defaults.printer, ...(parsed.printer || {}) },
    };
    if (!parsed.device_id) {
      try {
        fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf8');
      } catch {
        // ignore
      }
    }
    return merged;
  } catch (_e) {
    // Fail-safe: never crash the app due to config corruption
    const cfg = defaultConfig();
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    } catch {
      // ignore
    }
    return cfg;
  }
}

function writeConfig(patch, electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const cfgPath = getConfigPath(appInstance);
  const existing = readConfig(appInstance);
  const next = {
    ...existing,
    ...(patch || {}),
    host: { ...existing.host, ...(patch?.host || {}) },
    client: { ...existing.client, ...(patch?.client || {}) },
    printer: { ...existing.printer, ...(patch?.printer || {}) },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function resetConfig(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const cfgPath = getConfigPath(appInstance);
  const cfg = defaultConfig();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

module.exports = {
  getConfigPath,
  readConfig,
  writeConfig,
  resetConfig,
};






