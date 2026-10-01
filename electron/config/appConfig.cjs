const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getAppLike } = require('../lib/runtime.cjs');

const CONFIG_FILENAME = 'pos-config.json';

function resolveApp(override) {
  // App config is device-local. When Electron passes its real `app` object,
  // prefer it even if a server-mode env flag leaked in from the root .env.
  if (override && typeof override.getPath === 'function') return override;
  return getAppLike(null);
}

function getConfigPath(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const userData = appInstance.getPath('userData');
  return path.join(userData, CONFIG_FILENAME);
}

function readProvisionedClientDefaults(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const candidates = [
    String(process.env.POS_CLIENT_DEFAULTS_FILE || '').trim(),
    path.join(appInstance.getAppPath?.() || '', 'electron', 'config', 'client.defaults.json'),
    process.resourcesPath
      ? path.join(process.resourcesPath, 'client.defaults.json')
      : '',
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const hostUrl = String(parsed?.client?.hostUrl || '').trim().replace(/\/+$/, '');
      const secret = String(parsed?.client?.secret || '').trim();
      if (parsed?.mode !== 'client' || !/^https?:\/\//i.test(hostUrl) || secret.length < 16) {
        continue;
      }
      return { mode: 'client', client: { hostUrl, secret } };
    } catch {
      // Ignore an invalid provisioning file and retain safe local defaults.
    }
  }
  return null;
}

function defaultConfig(electronApp = null) {
  const config = {
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
      feedLines: 6,
      cut: true,
      retryCount: 2,
    },
  };
  const provisioned = readProvisionedClientDefaults(electronApp);
  if (provisioned) {
    config.mode = 'client';
    config.client = { ...config.client, ...provisioned.client };
  }
  return config;
}

function readConfig(electronApp = null) {
  const appInstance = resolveApp(electronApp);
  const cfgPath = getConfigPath(appInstance);

  try {
    if (!fs.existsSync(cfgPath)) {
      const cfg = defaultConfig(appInstance);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
      return cfg;
    }

    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    const defaults = defaultConfig(appInstance);
    const merged = {
      ...defaults,
      ...parsed,
      host: { ...defaults.host, ...(parsed.host || {}) },
      client: { ...defaults.client, ...(parsed.client || {}) },
      printer: { ...defaults.printer, ...(parsed.printer || {}) },
    };
    const provisioned = readProvisionedClientDefaults(appInstance);
    const provisioningChanged =
      !!provisioned &&
      (merged.mode !== 'client' ||
        merged.client.hostUrl !== provisioned.client.hostUrl ||
        merged.client.secret !== provisioned.client.secret);
    if (provisioned) {
      // A server-client installer must remain a client even when Windows has
      // pos-config.json left from an older local/HOST installation.
      merged.mode = 'client';
      merged.client = { ...merged.client, ...provisioned.client };
    }
    if (!parsed.device_id || provisioningChanged) {
      try {
        fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf8');
      } catch {
        // ignore
      }
    }
    return merged;
  } catch (_e) {
    // Fail-safe: never crash the app due to config corruption
    const cfg = defaultConfig(appInstance);
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
  const cfg = defaultConfig(appInstance);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

module.exports = {
  getConfigPath,
  readConfig,
  writeConfig,
  resetConfig,
  readProvisionedClientDefaults,
};






